import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Activity, Check, AlertCircle, Loader2,
  Eye, EyeOff, Terminal, Cpu, Sparkles, Zap, Server,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "../ui/input";
import { Section } from "./SectionWrapper";
import type { ProviderId, ProviderConfig } from "../../types/provider";
import {
  ANTHROPIC_MODELS as ANTHROPIC_MODEL_LIST,
  OPENAI_MODELS as OPENAI_MODEL_LIST,
  GEMINI_MODELS as GEMINI_MODEL_LIST,
} from "../../types/provider";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ProviderCard {
  id: ProviderId;
  label: string;
  sublabel: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

const PROVIDER_CARDS: ProviderCard[] = [
  { id: "gemini",        label: "Gemini",        sublabel: "API key",      Icon: Zap },
  { id: "claude_cli",   label: "Claude CLI",    sublabel: "subscription", Icon: Terminal },
  { id: "anthropic_api", label: "Anthropic API", sublabel: "API key",      Icon: Cpu },
  { id: "open_ai",      label: "OpenAI",        sublabel: "API key",      Icon: Sparkles },
  { id: "ollama",       label: "Ollama",        sublabel: "local",        Icon: Server },
];

const KEY_PROVIDERS: ProviderId[] = ["anthropic_api", "open_ai", "gemini"];

interface TestState {
  ok: boolean;
  msg: string;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        color: "var(--color-text-secondary)",
        lineHeight: 1,
        display: "block",
      }}
    >
      {children}
    </label>
  );
}

function ApiKeyInput({
  provider,
  hasKey,
  onKeySet,
}: {
  provider: ProviderId;
  hasKey: boolean;
  onKeySet: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  async function commitKey() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await invoke("set_provider_secret", { provider, secret: draft.trim() });
      setDraft("");
      onKeySet();
      toast.success("API key saved to Keychain");
    } catch (e) {
      toast.error(`Could not save key: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <FieldLabel>API key</FieldLabel>
      <div style={{ display: "flex", gap: "6px" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            type={visible ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitKey}
            onKeyDown={(e) => e.key === "Enter" && commitKey()}
            placeholder={hasKey ? "••••••••  Key set — replace" : "Paste API key…"}
            disabled={saving}
            style={{
              width: "100%",
              background: "var(--color-bg-elev-2)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: "5px 32px 5px 8px",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setVisible((v) => !v)}
            style={{
              position: "absolute",
              right: "6px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--color-text-disabled)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {visible ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>
      {hasKey && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
          Key stored in macOS Keychain · enter a new value to replace
        </span>
      )}
    </div>
  );
}

function ModelSelect({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: readonly string[];
  onChange: (v: string) => void;
}) {
  const [custom, setCustom] = useState(!models.includes(value) && value !== "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <FieldLabel>{label}</FieldLabel>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <select
          value={custom ? "__custom__" : value}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setCustom(true);
            } else {
              setCustom(false);
              onChange(e.target.value);
            }
          }}
          style={{
            background: "var(--color-bg-elev-2)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "5px 8px",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            outline: "none",
            flex: 1,
          }}
        >
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value="__custom__">Custom…</option>
        </select>
        {custom && (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="model-id"
            style={{
              background: "var(--color-bg-elev-2)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: "5px 8px",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              outline: "none",
              flex: 1,
            }}
          />
        )}
      </div>
    </div>
  );
}

function TestConnectionButton({ onTest }: { onTest: () => Promise<TestState> }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestState | null>(null);

  async function run() {
    setTesting(true);
    setResult(null);
    try {
      const r = await onTest();
      setResult(r);
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={run}
        disabled={testing}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          background: "none",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-sm)",
          padding: "3px 8px",
          color: "var(--color-text-secondary)",
          fontSize: "var(--text-xs)",
          fontFamily: "var(--font-sans)",
          cursor: testing ? "not-allowed" : "pointer",
          opacity: testing ? 0.6 : 1,
        }}
      >
        {testing
          ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
          : <Activity size={11} />}
        {testing ? "Testing…" : "Test connection"}
      </button>
      {result && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-mono)",
            color: result.ok
              ? "var(--color-severity-low-fg)"
              : "var(--color-severity-high-fg)",
          }}
        >
          {result.ok ? <Check size={11} /> : <AlertCircle size={11} />}
          {result.ok ? `Connected · ${result.msg}` : result.msg.slice(0, 80)}
        </span>
      )}
    </div>
  );
}

// ── AIProviderContent (inner; no Section wrapper) ─────────────────────────────

export function AIProviderContent() {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<ProviderConfig>("get_provider_config").then(setConfig).catch(() => {});
    for (const pid of KEY_PROVIDERS) {
      invoke<boolean>("has_provider_secret", { provider: pid })
        .then((has) => setKeyStatus((prev) => ({ ...prev, [pid]: has })))
        .catch(() => {});
    }
  }, []);

  async function saveConfig(updated: ProviderConfig) {
    setConfig(updated);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      try {
        await invoke("set_provider_config", { config: updated });
      } catch (e) {
        toast.error(`Could not save provider config: ${String(e)}`);
      }
    }, 400);
  }

  async function selectProvider(id: ProviderId) {
    if (!config) return;
    await saveConfig({ ...config, active_provider: id });
  }

  async function testProvider(pid: ProviderId): Promise<TestState> {
    const res = await invoke<{ ok: boolean; model_responded: string | null; error: string | null }>(
      "test_provider_connection",
      { providerId: pid }
    );
    return res.ok
      ? { ok: true, msg: res.model_responded ?? "ok" }
      : { ok: false, msg: res.error ?? "unknown error" };
  }

  async function fetchOllamaModels() {
    if (!config) return;
    setFetchingModels(true);
    try {
      const models = await invoke<string[]>("fetch_ollama_models", {
        endpoint: config.ollama.endpoint,
      });
      setOllamaModels(models);
      if (models.length > 0 && !config.ollama.model) {
        await saveConfig({ ...config, ollama: { ...config.ollama, model: models[0] } });
      }
      toast.success(`${models.length} model(s) found`);
    } catch (e) {
      toast.error(`Could not fetch models: ${String(e)}`);
    } finally {
      setFetchingModels(false);
    }
  }

  if (!config) return null;

  const active = config.active_provider;

  const configPanels: Record<ProviderId, React.ReactNode> = {
    claude_cli: (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <FieldLabel>CLI path override</FieldLabel>
          <Input
            placeholder="Auto-detected"
            value={config.claude_cli.path_override}
            onChange={(e) =>
              saveConfig({ ...config, claude_cli: { path_override: e.target.value } })
            }
          />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            Auto-detection order: /opt/homebrew/bin/claude, ~/.local/bin/claude,
            /usr/local/bin/claude, ~/.claude/local/claude
          </span>
        </div>
        <TestConnectionButton onTest={() => testProvider("claude_cli")} />
      </div>
    ),
    anthropic_api: (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <ApiKeyInput
          provider="anthropic_api"
          hasKey={!!keyStatus["anthropic_api"]}
          onKeySet={() => setKeyStatus((p) => ({ ...p, anthropic_api: true }))}
        />
        <ModelSelect
          label="Model"
          value={config.anthropic_api.model}
          models={ANTHROPIC_MODEL_LIST}
          onChange={(m) => saveConfig({ ...config, anthropic_api: { model: m } })}
        />
        <TestConnectionButton onTest={() => testProvider("anthropic_api")} />
      </div>
    ),
    open_ai: (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <ApiKeyInput
          provider="open_ai"
          hasKey={!!keyStatus["open_ai"]}
          onKeySet={() => setKeyStatus((p) => ({ ...p, open_ai: true }))}
        />
        <ModelSelect
          label="Model"
          value={config.openai.model}
          models={OPENAI_MODEL_LIST}
          onChange={(m) => saveConfig({ ...config, openai: { model: m } })}
        />
        <TestConnectionButton onTest={() => testProvider("open_ai")} />
      </div>
    ),
    gemini: (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <ApiKeyInput
          provider="gemini"
          hasKey={!!keyStatus["gemini"]}
          onKeySet={() => setKeyStatus((p) => ({ ...p, gemini: true }))}
        />
        <ModelSelect
          label="Model"
          value={config.gemini.model}
          models={GEMINI_MODEL_LIST}
          onChange={(m) => saveConfig({ ...config, gemini: { model: m } })}
        />
        <TestConnectionButton onTest={() => testProvider("gemini")} />
      </div>
    ),
    ollama: (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <FieldLabel>Endpoint</FieldLabel>
          <Input
            placeholder="http://localhost:11434"
            value={config.ollama.endpoint}
            onChange={(e) =>
              saveConfig({ ...config, ollama: { ...config.ollama, endpoint: e.target.value } })
            }
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <FieldLabel>Model</FieldLabel>
          <div style={{ display: "flex", gap: "6px" }}>
            <select
              value={config.ollama.model}
              onChange={(e) =>
                saveConfig({ ...config, ollama: { ...config.ollama, model: e.target.value } })
              }
              style={{
                flex: 1,
                background: "var(--color-bg-elev-2)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: "5px 8px",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-xs)",
                outline: "none",
              }}
            >
              {config.ollama.model && !ollamaModels.includes(config.ollama.model) && (
                <option value={config.ollama.model}>{config.ollama.model}</option>
              )}
              {ollamaModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {ollamaModels.length === 0 && !config.ollama.model && (
                <option value="" disabled>Fetch models first</option>
              )}
            </select>
            <button
              type="button"
              onClick={fetchOllamaModels}
              disabled={fetchingModels}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "none",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: "3px 8px",
                color: "var(--color-text-secondary)",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-sans)",
                cursor: fetchingModels ? "not-allowed" : "pointer",
                opacity: fetchingModels ? 0.6 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {fetchingModels
                ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                : null}
              {fetchingModels ? "Fetching…" : "Fetch"}
            </button>
          </div>
          {ollamaModels.length > 0 && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {ollamaModels.length} model(s) installed locally
            </span>
          )}
        </div>
        <TestConnectionButton onTest={() => testProvider("ollama")} />
      </div>
    ),
  };

  return (
    <>
      {/* Provider card grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "8px",
        }}
      >
        {PROVIDER_CARDS.map(({ id, label, sublabel, Icon }) => {
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => selectProvider(id)}
              style={{
                position: "relative",
                background: "var(--color-bg-elev-2)",
                border: selected
                  ? "2px solid var(--color-accent)"
                  : "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: selected ? "11px" : "12px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                textAlign: "left",
              }}
            >
              {selected && (
                <span
                  style={{
                    position: "absolute",
                    top: "6px",
                    right: "6px",
                    color: "var(--color-accent)",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <Check size={11} />
                </span>
              )}
              <Icon
                size={16}
                style={{ color: selected ? "var(--color-accent)" : "var(--color-text-muted)" }}
              />
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 500,
                  color: selected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                }}
              >
                {label}
              </span>
              <span style={{ fontSize: "10px", color: "var(--color-text-disabled)" }}>
                {sublabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* Conditional config panel */}
      <div
        style={{
          marginTop: "16px",
          paddingTop: "16px",
          borderTop: "1px solid var(--color-border-divider)",
        }}
      >
        {configPanels[active]}
      </div>
    </>
  );
}

// ── SectionAIProvider (with Section wrapper; used in Settings) ────────────────

export function SectionAIProvider() {
  return (
    <Section title="AI Provider">
      <AIProviderContent />
    </Section>
  );
}
