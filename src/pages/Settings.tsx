import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  ArrowLeft, Activity, ExternalLink, X, Plus,
  Terminal, Cpu, Sparkles, Zap, Server,
  Eye, EyeOff, Check, AlertCircle, Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "../components/ui/form";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Separator } from "../components/ui/separator";
import { settingsSchema, type SettingsValues } from "../types/settings";
import { loadSettings, saveSettings } from "../lib/settings";
import type { ProviderId, ProviderConfig } from "../types/provider";
import {
  ANTHROPIC_MODELS as ANTHROPIC_MODEL_LIST,
  OPENAI_MODELS as OPENAI_MODEL_LIST,
  GEMINI_MODELS as GEMINI_MODEL_LIST,
} from "../types/provider";

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--color-bg-elev-1)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "20px",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {title}
      </h2>
      {description && (
        <p
          style={{
            margin: "4px 0 16px",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {description}
        </p>
      )}
      <div style={{ marginTop: description ? 0 : "16px" }}>{children}</div>
    </section>
  );
}

// ── Field row layout helper ────────────────────────────────────────────────────

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {children}
    </div>
  );
}

// ── Section: General ──────────────────────────────────────────────────────────

function SectionGeneral() {
  const form = useFormContext<SettingsValues>();
  return (
    <Section title="General">
      <FormField
        control={form.control}
        name="snapshot_retention"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Snapshot retention</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                style={{ width: "88px" }}
                {...field}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            </FormControl>
            <FormDescription>
              Older snapshots are pruned automatically when this limit is reached.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </Section>
  );
}

// Plain label that matches FormLabel visually but requires no FormFieldContext.
// Use this inside SectionAIProvider which manages its own state outside react-hook-form.
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

// ── Section: AI Provider ──────────────────────────────────────────────────────

interface ProviderCard {
  id: ProviderId;
  label: string;
  sublabel: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

const PROVIDER_CARDS: ProviderCard[] = [
  { id: "gemini", label: "Gemini", sublabel: "API key", Icon: Zap },
  { id: "claude_cli", label: "Claude CLI", sublabel: "subscription", Icon: Terminal },
  { id: "anthropic_api", label: "Anthropic API", sublabel: "API key", Icon: Cpu },
  { id: "open_ai", label: "OpenAI", sublabel: "API key", Icon: Sparkles },
  { id: "ollama", label: "Ollama", sublabel: "local", Icon: Server },
];

const KEY_PROVIDERS: ProviderId[] = ["anthropic_api", "open_ai", "gemini"];

interface TestState {
  ok: boolean;
  msg: string;
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

function TestConnectionButton({
  onTest,
}: {
  onTest: () => Promise<TestState>;
}) {
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
        {testing ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Activity size={11} />}
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
            color: result.ok ? "var(--color-severity-low-fg)" : "var(--color-severity-high-fg)",
          }}
        >
          {result.ok ? <Check size={11} /> : <AlertCircle size={11} />}
          {result.ok
            ? `Connected · ${result.msg}`
            : result.msg.slice(0, 80)}
        </span>
      )}
    </div>
  );
}

function SectionAIProvider() {
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
    if (res.ok) {
      return { ok: true, msg: res.model_responded ?? "ok" };
    }
    return { ok: false, msg: res.error ?? "unknown error" };
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

  // ── Config panels ────────────────────────────────────────────────────────

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
          onChange={(m) =>
            saveConfig({ ...config, anthropic_api: { model: m } })
          }
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
          onChange={(m) =>
            saveConfig({ ...config, openai: { model: m } })
          }
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
          onChange={(m) =>
            saveConfig({ ...config, gemini: { model: m } })
          }
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
              {fetchingModels ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : null}
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
    <Section title="AI Provider">
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
                background: selected ? "var(--color-bg-elev-2)" : "var(--color-bg-elev-2)",
                border: selected
                  ? "2px solid var(--color-accent)"
                  : "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: selected ? "11px 11px 11px 11px" : "12px",
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
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--color-text-disabled)",
                }}
              >
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
    </Section>
  );
}

// ── Section: Hotkey ───────────────────────────────────────────────────────────

function SectionHotkey() {
  const form = useFormContext<SettingsValues>();
  return (
    <Section
      title="Hotkey"
      description="Global hotkey to summon Macroscope from anywhere. Activation arrives in a future update."
    >
      <div style={{ opacity: 0.75, display: "flex", flexDirection: "column", gap: "16px" }}>
        <FormField
          control={form.control}
          name="hotkey_enabled"
          render={({ field }) => (
            <FormItem>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel style={{ cursor: "pointer", margin: 0 }}>
                  Enable global hotkey
                </FormLabel>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="hotkey_combo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hotkey combination</FormLabel>
              <FormControl>
                <Input readOnly style={{ width: "160px", cursor: "default" }} {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-disabled)", fontStyle: "italic" }}>
          Currently inactive — values saved but not registered with the system.
        </p>
      </div>
    </Section>
  );
}

// ── Section: Project Roots ────────────────────────────────────────────────────

function SectionProjectRoots({ onChanged }: { onChanged: () => void }) {
  const [roots, setRoots] = useState<string[]>([]);

  useEffect(() => {
    invoke<[string, string][]>("list_settings").then((rows) => {
      const map = Object.fromEntries(rows);
      const raw = map["project_roots"];
      if (raw) {
        try {
          setRoots(JSON.parse(raw));
        } catch {
          setRoots([]);
        }
      }
    }).catch(() => {});
  }, []);

  async function persistRoots(updated: string[]) {
    await invoke("set_setting", {
      key: "project_roots",
      value: JSON.stringify(updated),
    });
    setRoots(updated);
    onChanged();
  }

  async function removeRoot(root: string) {
    await persistRoots(roots.filter((r) => r !== root));
  }

  async function addRoot() {
    const selected = await openDialog({ directory: true, multiple: false, title: "Select project directory" });
    if (!selected || typeof selected !== "string") return;
    if (roots.includes(selected)) return;
    await persistRoots([...roots, selected]);
  }

  return (
    <Section
      title="Project Roots"
      description="Macroscope cleans build artifacts (node_modules, target, .venv, .gradle, etc.) from these directories. Auto-detected on first launch — edit anytime."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {roots.length === 0 ? (
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--color-text-disabled)",
              fontStyle: "italic",
            }}
          >
            No project directories configured. Add one to enable build artifact cleanup.
          </p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              background: "var(--color-bg-elev-2)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 10px",
              border: "1px solid var(--color-border-subtle)",
            }}
          >
            {roots.map((root) => (
              <div
                key={root}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-secondary)",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {root}
                </span>
                <button
                  type="button"
                  onClick={() => removeRoot(root)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "none",
                    border: "none",
                    padding: "2px",
                    cursor: "pointer",
                    color: "var(--color-text-disabled)",
                    flexShrink: 0,
                  }}
                  aria-label={`Remove ${root}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addRoot}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            alignSelf: "flex-start",
            background: "none",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "3px 8px",
            color: "var(--color-text-secondary)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          <Plus size={12} />
          Add directory…
        </button>
      </div>
    </Section>
  );
}

// ── Section: Safety ───────────────────────────────────────────────────────────

function PathList({ paths, globs }: { paths: string[]; globs?: string[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        background: "var(--color-bg-elev-2)",
        borderRadius: "var(--radius-sm)",
        padding: "8px 10px",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      {paths.map((p) => (
        <span
          key={p}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-secondary)",
          }}
        >
          {p}
        </span>
      ))}
      {globs?.map((g) => (
        <span key={g} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          <span style={{ color: "var(--color-text-secondary)" }}>{g}</span>
          <span style={{ color: "var(--color-text-disabled)", marginLeft: "6px" }}>(glob)</span>
        </span>
      ))}
    </div>
  );
}

function SectionSafety({ refreshKey }: { refreshKey: number }) {
  const [allowedPrefixes, setAllowedPrefixes] = useState<string[]>([]);
  const [allowedGlobs, setAllowedGlobs] = useState<string[]>([]);
  const [deniedPrefixes, setDeniedPrefixes] = useState<string[]>([]);
  const [deniedExact, setDeniedExact] = useState<string[]>([]);
  const auditLogPath = "~/Library/Application Support/Macroscope/audit.log";

  useEffect(() => {
    Promise.all([
      invoke<string[]>("get_allowed_prefixes"),
      invoke<string[]>("get_allowed_globs"),
      invoke<string[]>("get_denied_prefixes"),
      invoke<string[]>("get_denied_exact"),
    ]).then(([ap, ag, dp, de]) => {
      setAllowedPrefixes(ap);
      setAllowedGlobs(ag);
      setDeniedPrefixes(dp);
      setDeniedExact(de);
    });
  }, [refreshKey]);

  async function revealAuditLog() {
    await invoke("reveal_in_finder", { path: auditLogPath }).catch((e) => {
      toast.error(`Could not open Finder: ${String(e)}`);
    });
  }

  return (
    <Section title="Safety">
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Allowed paths */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Allowed paths
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            Macroscope can only move items to Trash from these locations. This list updates
            automatically based on your Project Roots above.
          </p>
          <PathList paths={allowedPrefixes} globs={allowedGlobs} />
        </div>

        <Separator />

        {/* Denied paths */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Denied paths (always blocked)
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            These locations are never touched, regardless of any other rule.
          </p>
          <PathList paths={[...deniedExact, ...deniedPrefixes]} />
        </div>

        <Separator />

        {/* Audit log */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Audit log
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            Every move-to-Trash operation is recorded for review.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {auditLogPath}
            </span>
            <button
              type="button"
              onClick={revealAuditLog}
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
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <ExternalLink size={12} />
              Reveal in Finder
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ── Section: About ────────────────────────────────────────────────────────────

interface LifetimeStats {
  snapshots: number;
  findings: number;
  bytes_freed: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function SectionAbout() {
  const [appVersion, setAppVersion] = useState<string>("…");
  const [stats, setStats] = useState<LifetimeStats | null>(null);

  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    invoke<LifetimeStats>("get_lifetime_stats").then(setStats).catch(() => {});
  }, []);

  const statCards = [
    { label: "Snapshots taken", value: stats ? String(stats.snapshots) : "—" },
    { label: "Findings discovered", value: stats ? String(stats.findings) : "—" },
    { label: "Space freed", value: stats ? formatBytes(stats.bytes_freed) : "—" },
  ];

  return (
    <Section title="About">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          {statCards.map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: "var(--color-bg-elev-2)",
                borderRadius: "var(--radius-sm)",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xl)",
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                }}
              >
                {value}
              </span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Build info */}
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-disabled)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Macroscope v{appVersion}
          {" · Built for macOS (Apple Silicon)"}
        </p>
      </div>
    </Section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settings() {
  const [saving, setSaving] = useState(false);
  const [rootsVersion, setRootsVersion] = useState(0);

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsSchema.parse({}),
  });

  useEffect(() => {
    loadSettings().then((values) => form.reset(values));
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      await saveSettings(values);
      toast.success("Settings saved");
      form.reset(values);
    } catch (e) {
      toast.error(`Could not save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  });

  const isDirty = form.formState.isDirty;

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--color-bg-base)" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px" }}>
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            paddingBottom: "16px",
            borderBottom: "1px solid var(--color-border-divider)",
            marginBottom: "20px",
          }}
        >
          <Link
            to="/"
            style={{
              display: "flex",
              alignItems: "center",
              color: "var(--color-text-muted)",
              textDecoration: "none",
              padding: "4px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <ArrowLeft size={16} />
          </Link>
          <span
            style={{
              fontSize: "var(--text-xl)",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              flex: 1,
            }}
          >
            Settings
          </span>
          <button
            onClick={onSubmit}
            disabled={!isDirty || saving}
            style={{
              background: isDirty && !saving ? "var(--color-accent)" : "var(--color-accent-muted)",
              color: "var(--color-accent-on)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "7px 16px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: isDirty && !saving ? "pointer" : "not-allowed",
              opacity: isDirty && !saving ? 1 : 0.6,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </header>

        {/* Form */}
        <Form {...form}>
          <form
            onSubmit={onSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <SectionGeneral />
            <SectionAIProvider />
            <SectionHotkey />
            <SectionProjectRoots onChanged={() => setRootsVersion((v) => v + 1)} />
            <SectionSafety refreshKey={rootsVersion} />
            <SectionAbout />
          </form>
        </Form>
      </div>
    </div>
  );
}

export { Section, FieldRow };
