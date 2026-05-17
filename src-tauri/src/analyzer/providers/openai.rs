use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest;

use crate::analyzer::{AnalysisChunk, AnalysisRequest, AnalyzerService, ChunkPhase, TestConnectionResult};
use crate::error::AppError;
use crate::snapshot::AuditTokenUsage;

pub const MODELS: &[&str] = &[
    "gpt-5",
    "gpt-5-mini",
    "gpt-4.1",
    "gpt-4o",
    "gpt-4o-mini",
];

pub struct OpenAiProvider {
    pub api_key: String,
    pub model: String,
}

#[async_trait]
impl AnalyzerService for OpenAiProvider {
    fn provider_id(&self) -> &'static str {
        "openai"
    }

    fn display_name(&self) -> &'static str {
        "OpenAI"
    }

    async fn test_connection(&self) -> Result<TestConnectionResult, AppError> {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": "respond with ok" }],
        });
        let resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
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

        let combined = format!("{}\n\n{}", request.system_prompt, request.user_prompt);
        let body = serde_json::json!({
            "model": self.model,
            "stream": true,
            "stream_options": { "include_usage": true },
            "messages": [{ "role": "user", "content": combined }],
        });

        let resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Http(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!("OpenAI HTTP {status}: {text}")));
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
                if data == "[DONE]" {
                    break;
                }

                let Ok(event) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };

                let elapsed_ms = start.elapsed().as_millis() as u64;

                // Usage is on the final chunk
                if let Some(usage) = event.get("usage") {
                    token_usage.input_tokens =
                        usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    token_usage.output_tokens =
                        usage.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                    token_usage.cache_read_input_tokens = usage
                        .get("prompt_tokens_details")
                        .and_then(|d| d.get("cached_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                }

                if let Some(delta_content) = event
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|t| t.as_str())
                {
                    if !delta_content.is_empty() {
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
                        full_text.push_str(delta_content);
                        on_chunk(AnalysisChunk {
                            text: delta_content.to_string(),
                            usage: None,
                            phase: None,
                        });
                    }
                }

                // Detect finish_reason = stop
                if let Some("stop") = event
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("finish_reason"))
                    .and_then(|v| v.as_str())
                {
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

        Ok((full_text, token_usage))
    }
}
