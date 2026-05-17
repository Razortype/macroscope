use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest;

use crate::analyzer::{AnalysisChunk, AnalysisRequest, AnalyzerService, ChunkPhase, TestConnectionResult};
use crate::error::AppError;
use crate::snapshot::AuditTokenUsage;

pub const MODELS: &[&str] = &[
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-haiku-4-1",
];

pub struct AnthropicApiProvider {
    pub api_key: String,
    pub model: String,
}

#[async_trait]
impl AnalyzerService for AnthropicApiProvider {
    fn provider_id(&self) -> &'static str {
        "anthropic_api"
    }

    fn display_name(&self) -> &'static str {
        "Anthropic API"
    }

    async fn test_connection(&self) -> Result<TestConnectionResult, AppError> {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": "respond with ok" }],
        });
        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
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

        let mut messages = vec![];
        messages.push(serde_json::json!({
            "role": "user",
            "content": format!("{}\n\n{}", request.system_prompt, request.user_prompt)
        }));

        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 8192,
            "stream": true,
            "messages": messages,
        });

        let resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Http(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Provider(format!("Anthropic API HTTP {status}: {text}")));
        }

        let mut stream = resp.bytes_stream();
        let mut full_text = String::new();
        let mut token_usage = AuditTokenUsage::default();
        let mut sse_data = String::new();
        let mut first_chunk = true;
        let mut elapsed_ms: u64 = 0;
        let start = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| AppError::Http(e.to_string()))?;
            sse_data.push_str(&String::from_utf8_lossy(&bytes));

            // Process complete SSE lines
            while let Some(newline_pos) = sse_data.find('\n') {
                let line = sse_data[..newline_pos].trim().to_string();
                sse_data = sse_data[newline_pos + 1..].to_string();

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

                elapsed_ms = start.elapsed().as_millis() as u64;

                match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "message_start" => {
                        // Capture input token counts from message_start.message.usage
                        if let Some(u) = event.get("message").and_then(|m| m.get("usage")) {
                            token_usage.input_tokens = u
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            token_usage.cache_read_input_tokens = u
                                .get("cache_read_input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            token_usage.cache_creation_input_tokens = u
                                .get("cache_creation_input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                        }
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
                    }
                    "content_block_delta" => {
                        if let Some(delta_text) = event
                            .get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            full_text.push_str(delta_text);
                            on_chunk(AnalysisChunk {
                                text: delta_text.to_string(),
                                usage: None,
                                phase: None,
                            });
                        }
                    }
                    "message_delta" => {
                        if let Some(u) = event.get("usage") {
                            token_usage.output_tokens = u
                                .get("output_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(token_usage.output_tokens);
                        }
                    }
                    "message_stop" => {
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
                    _ => {}
                }
            }
        }

        Ok((full_text, token_usage))
    }
}
