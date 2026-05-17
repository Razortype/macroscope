// Mirror of src-tauri/src/provider_config.rs

export type ProviderId =
  | "claude_cli"
  | "anthropic_api"
  | "open_ai"
  | "gemini"
  | "ollama";

export interface ClaudeCliConfig {
  path_override: string;
}

export interface AnthropicApiConfig {
  model: string;
}

export interface OpenAiConfig {
  model: string;
}

export interface GeminiConfig {
  model: string;
}

export interface OllamaConfig {
  endpoint: string;
  model: string;
}

export interface ProviderConfig {
  active_provider: ProviderId;
  claude_cli: ClaudeCliConfig;
  anthropic_api: AnthropicApiConfig;
  openai: OpenAiConfig;
  gemini: GeminiConfig;
  ollama: OllamaConfig;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude_cli: "Claude Code CLI",
  anthropic_api: "Anthropic API",
  open_ai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama",
};

export const ANTHROPIC_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-haiku-4-1",
] as const;

export const OPENAI_MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
];

export const GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
