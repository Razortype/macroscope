use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest;

use crate::analyzer::{AnalysisChunk, AnalysisRequest, AnalyzerService, ChunkPhase, TestConnectionResult};
use crate::error::AppError;
use crate::snapshot::AuditTokenUsage;

pub const MODELS: &[&str] = &[
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
];

pub struct GeminiProvider {
    pub api_key: String,
    pub model: String,
}

#[async_trait]
impl AnalyzerService for GeminiProvider {
    fn provider_id(&self) -> &'static str {
        "gemini"
    }

    fn display_name(&self) -> &'static str {
        "Gemini"
    }

    async fn test_connection(&self) -> Result<TestConnectionResult, AppError> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            self.model, self.api_key
        );
        let body = serde_json::json!({
            "contents": [{ "parts": [{ "text": "respond with ok" }] }],
            "generationConfig": { "maxOutputTokens": 16 },
        });
        let resp = client
            .post(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Http(e.to_string()))?;

        if resp.status().is_success() {
            Ok(TestConnectionResult {
                ok: true,
                model_responded: Some(self.model.clone()),
                error: None,
            })
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Ok(TestConnectionResult {
                ok: false,
                model_responded: None,
                error: Some(format!("HTTP {status}: {text}")),
            })
        }
    }

    async fn analyze(
        &self,
        request: AnalysisRequest,
        mut on_chunk: Box<dyn FnMut(AnalysisChunk) + Send>,
    ) -> Result<(String, AuditTokenUsage), AppError> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
            self.model, self.api_key
        );

        let combined = format!("{}\n\n{}", request.system_prompt, request.user_prompt);
        let body = serde_json::json!({
            "contents": [{ "parts": [{ "text": combined }] }],
        });

        let resp = client
            .post(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Http(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!("Gemini HTTP {status}: {text}")));
        }

        let mut stream = resp.bytes_stream();
        let mut full_text = String::new();
        let mut token_usage = AuditTokenUsage::default();
        let mut sse_buf = String::new();
        let mut first_chunk = true;
        let start = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| AppError::Http(e.to_string()))?;
            sse_buf.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(pos) = sse_buf.find('\n') {
                let line = sse_buf[..pos].trim().to_string();
                sse_buf = sse_buf[pos + 1..].to_string();

                if !line.starts_with("data: ") {
                    continue;
                }
                let data = &line[6..];

                let Ok(event) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };

                let elapsed_ms = start.elapsed().as_millis() as u64;

                // Extract token usage from usageMetadata
                if let Some(meta) = event.get("usageMetadata") {
                    token_usage.input_tokens = meta
                        .get("promptTokenCount")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(token_usage.input_tokens);
                    token_usage.output_tokens = meta
                        .get("candidatesTokenCount")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(token_usage.output_tokens);
                    token_usage.cache_read_input_tokens = meta
                        .get("cachedContentTokenCount")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                }

                // Extract text from candidates[0].content.parts[0].text
                if let Some(text_part) = event
                    .get("candidates")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("content"))
                    .and_then(|c| c.get("parts"))
                    .and_then(|p| p.get(0))
                    .and_then(|p| p.get("text"))
                    .and_then(|t| t.as_str())
                {
                    if !text_part.is_empty() {
                        if first_chunk {
                            first_chunk = false;
                            on_chunk(AnalysisChunk {
                                text: String::new(),
                                usage: None,
                                phase: Some(ChunkPhase {
                                    name: "analyzing".into(),
                                    pid: None,
                                    elapsed_ms,
                                    timing: None,
                                }),
                            });
                        }
                        full_text.push_str(text_part);
                        on_chunk(AnalysisChunk {
                            text: text_part.to_string(),
                            usage: None,
                            phase: None,
                        });
                    }
                }

                // Detect finish reason
                if let Some(finish) = event
                    .get("candidates")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("finishReason"))
                    .and_then(|v| v.as_str())
                {
                    if finish == "STOP" || finish == "MAX_TOKENS" {
                        on_chunk(AnalysisChunk {
                            text: String::new(),
                            usage: Some(token_usage.clone()),
                            phase: Some(ChunkPhase {
                                name: "complete".into(),
                                pid: None,
                                elapsed_ms,
                                timing: None,
                            }),
                        });
                    }
                }
            }
        }

        Ok((full_text, token_usage))
    }
}
