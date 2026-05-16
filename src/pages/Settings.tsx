import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, Activity, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "../components/ui/form";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Separator } from "../components/ui/separator";
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

function SectionSafety() {
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
  }, []);

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
            Macroscope can only move items to Trash from these locations.
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
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);

  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    invoke<LifetimeStats>("get_lifetime_stats").then(setStats).catch(() => {});
    invoke<ClaudeStatus>("get_claude_status").then(setClaudeStatus).catch(() => {});
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
          {claudeStatus?.version ? ` · Claude CLI v${claudeStatus.version}` : ""}
          {" · Built for macOS (Apple Silicon)"}
        </p>
      </div>
    </Section>
  );
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
