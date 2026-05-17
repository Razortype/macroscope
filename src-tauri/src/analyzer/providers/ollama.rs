use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest;

use crate::analyzer::{AnalysisChunk, AnalysisRequest, AnalyzerService, ChunkPhase, TestConnectionResult};
use crate::error::AppError;
use crate::snapshot::AuditTokenUsage;

pub struct OllamaProvider {
    pub endpoint: String,
    pub model: String,
}

#[async_trait]
impl AnalyzerService for OllamaProvider {
    fn provider_id(&self) -> &'static str {
        "ollama"
    }

    fn display_name(&self) -> &'static str {
        "Ollama"
    }

    async fn test_connection(&self) -> Result<TestConnectionResult, AppError> {
        let client = reqwest::Client::new();
        let url = format!("{}/api/tags", self.endpoint.trim_end_matches('/'));
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value =
                    resp.json().await.unwrap_or(serde_json::Value::Null);
                let count = body
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                Ok(TestConnectionResult {
                    ok: true,
                    model_responded: Some(format!("{count} model(s) available")),
                    error: None,
                })
            }
            Ok(resp) => {
                let status = resp.status();
                Ok(TestConnectionResult {
                    ok: false,
                    model_responded: None,
                    error: Some(format!("HTTP {status}")),
                })
            }
            Err(e) => Ok(TestConnectionResult {
                ok: false,
                model_responded: None,
                error: Some(e.to_string()),
            }),
        }
    }

    async fn analyze(
        &self,
        request: AnalysisRequest,
        mut on_chunk: Box<dyn FnMut(AnalysisChunk) + Send>,
    ) -> Result<(String, AuditTokenUsage), AppError> {
        let client = reqwest::Client::new();
        let url = format!("{}/api/chat", self.endpoint.trim_end_matches('/'));

        let combined = format!("{}\n\n{}", request.system_prompt, request.user_prompt);
        let body = serde_json::json!({
            "model": self.model,
            "stream": true,
            "messages": [{ "role": "user", "content": combined }],
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
            return Err(AppError::Provider(format!("Ollama HTTP {status}: {text}")));
        }

        let mut stream = resp.bytes_stream();
        let mut full_text = String::new();
        let mut token_usage = AuditTokenUsage::default();
        let mut ndjson_buf = String::new();
        let mut first_chunk = true;
        let start = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| AppError::Http(e.to_string()))?;
            ndjson_buf.push_str(&String::from_utf8_lossy(&bytes));

            // Each line is a complete JSON object in NDJSON format
            while let Some(pos) = ndjson_buf.find('\n') {
                let line = ndjson_buf[..pos].trim().to_string();
                ndjson_buf = ndjson_buf[pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                let Ok(obj) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };

                let elapsed_ms = start.elapsed().as_millis() as u64;

                let done = obj.get("done").and_then(|v| v.as_bool()).unwrap_or(false);

                // Accumulate text from message.content
                if let Some(content) = obj
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                {
                    if !content.is_empty() {
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
                        full_text.push_str(content);
                        on_chunk(AnalysisChunk {
                            text: content.to_string(),
                            usage: None,
                            phase: None,
                        });
                    }
                }

                if done {
                    // Final object carries eval_count, prompt_eval_count
                    token_usage.input_tokens = obj
                        .get("prompt_eval_count")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    token_usage.output_tokens =
                        obj.get("eval_count").and_then(|v| v.as_u64()).unwrap_or(0);
                    // Ollama does not cache the same way; cache fields remain 0

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

/// Fetch the list of locally installed model names from the Ollama /api/tags endpoint.
pub async fn fetch_model_names(endpoint: &str) -> Result<Vec<String>, AppError> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(AppError::Provider(format!(
            "Ollama /api/tags returned HTTP {status}"
        )));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| AppError::Http(e.to_string()))?;
    let models = body
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Ok(models)
}
