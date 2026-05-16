import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, Activity } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "../components/ui/form";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { settingsSchema, type SettingsValues } from "../types/settings";
import { loadSettings, saveSettings } from "../lib/settings";
import type { ClaudeStatus } from "../types/snapshot";

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

// ── Section: Claude CLI ────────────────────────────────────────────────────────

function SectionClaudeCLI() {
  const form = useFormContext<SettingsValues>();
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    invoke<ClaudeStatus>("get_claude_status").then(setClaudeStatus).catch(() => {});
  }, []);

  async function testConnection() {
    setTesting(true);
    try {
      const status = await invoke<ClaudeStatus>("get_claude_status");
      setClaudeStatus(status);
      if (status.available) {
        toast.success(`Claude CLI is reachable · ${status.version ?? "?"}`);
      } else {
        toast.error(`Claude CLI not found: ${status.error ?? "unknown error"}`);
      }
    } catch (e) {
      toast.error(`Test failed: ${String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section
      title="Claude CLI"
      description="Macroscope uses your local Claude CLI for analysis. Leave the path empty to use auto-detection."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <FormField
          control={form.control}
          name="claude_cli_path"
          render={({ field }) => (
            <FormItem>
              <FormLabel>CLI path override</FormLabel>
              <FormControl>
                <Input
                  placeholder={claudeStatus?.path ?? "Auto-detected"}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Auto-detection order: /opt/homebrew/bin/claude, ~/.local/bin/claude,
                /usr/local/bin/claude, ~/.claude/local/claude
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {claudeStatus?.path && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {claudeStatus.path}
            </span>
          )}
          {claudeStatus?.version && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              v{claudeStatus.version}
            </span>
          )}
          <button
            type="button"
            onClick={testConnection}
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
            <Activity size={12} />
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>
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

function SectionSafety() {
  return <Section title="Safety" />;
}

function SectionAbout() {
  return <Section title="About" />;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settings() {
  const [saving, setSaving] = useState(false);

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
            <SectionClaudeCLI />
            <SectionHotkey />
            <SectionSafety />
            <SectionAbout />
          </form>
        </Form>
      </div>
    </div>
  );
}

export { Section, FieldRow };
