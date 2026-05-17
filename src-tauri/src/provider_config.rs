use serde::{Deserialize, Serialize};
use crate::db::Db;
use crate::error::AppError;

const CONFIG_KEY: &str = "provider_config";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    ClaudeCli,
    AnthropicApi,
    OpenAi,
    Gemini,
    Ollama,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderId::ClaudeCli => "claude_cli",
            ProviderId::AnthropicApi => "anthropic_api",
            ProviderId::OpenAi => "openai",
            ProviderId::Gemini => "gemini",
            ProviderId::Ollama => "ollama",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderId::ClaudeCli => "Claude Code CLI",
            ProviderId::AnthropicApi => "Anthropic API",
            ProviderId::OpenAi => "OpenAI",
            ProviderId::Gemini => "Gemini",
            ProviderId::Ollama => "Ollama",
        }
    }

    pub fn keychain_account(&self) -> Option<&'static str> {
        match self {
            ProviderId::AnthropicApi => Some(crate::keychain::ACCOUNT_ANTHROPIC),
            ProviderId::OpenAi => Some(crate::keychain::ACCOUNT_OPENAI),
            ProviderId::Gemini => Some(crate::keychain::ACCOUNT_GEMINI),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ClaudeCliConfig {
    pub path_override: String,
}

impl Default for ClaudeCliConfig {
    fn default() -> Self {
        Self { path_override: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AnthropicApiConfig {
    pub model: String,
}

impl Default for AnthropicApiConfig {
    fn default() -> Self {
        Self { model: "claude-sonnet-4-7".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OpenAiConfig {
    pub model: String,
}

impl Default for OpenAiConfig {
    fn default() -> Self {
        Self { model: "gpt-4.1".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GeminiConfig {
    pub model: String,
}

impl Default for GeminiConfig {
    fn default() -> Self {
        Self { model: "gemini-2.5-flash".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OllamaConfig {
    pub endpoint: String,
    pub model: String,
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://localhost:11434".into(),
            model: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderConfig {
    pub active_provider: ProviderId,
    pub claude_cli: ClaudeCliConfig,
    pub anthropic_api: AnthropicApiConfig,
    pub openai: OpenAiConfig,
    pub gemini: GeminiConfig,
    pub ollama: OllamaConfig,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            active_provider: ProviderId::ClaudeCli,
            claude_cli: ClaudeCliConfig::default(),
            anthropic_api: AnthropicApiConfig::default(),
            openai: OpenAiConfig::default(),
            gemini: GeminiConfig::default(),
            ollama: OllamaConfig::default(),
        }
    }
}

impl ProviderConfig {
    pub fn load(db: &Db) -> Result<Self, AppError> {
        match db.get_setting(CONFIG_KEY)? {
            Some(json) => {
                let mut cfg: Self = serde_json::from_str(&json).unwrap_or_default();
                // Migration: if claude_cli path_override is empty but legacy
                // claude_cli_path setting exists, copy it over.
                if cfg.claude_cli.path_override.is_empty() {
                    if let Ok(Some(legacy)) = db.get_setting(crate::db::settings_keys::CLAUDE_CLI_PATH) {
                        cfg.claude_cli.path_override = legacy;
                    }
                }
                Ok(cfg)
            }
            None => {
                // First run — migrate existing claude_cli_path if present
                let mut cfg = Self::default();
                if let Ok(Some(legacy)) = db.get_setting(crate::db::settings_keys::CLAUDE_CLI_PATH) {
                    cfg.claude_cli.path_override = legacy;
                }
                Ok(cfg)
            }
        }
    }

    pub fn save(&self, db: &Db) -> Result<(), AppError> {
        let json = serde_json::to_string(self)?;
        db.set_setting(CONFIG_KEY, &json)?;
        Ok(())
    }
}
