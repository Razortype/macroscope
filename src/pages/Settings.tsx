import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, ExternalLink, RotateCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "../components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Separator } from "../components/ui/separator";
import { settingsSchema, type SettingsValues } from "../types/settings";
import { loadSettings, saveSettings } from "../lib/settings";
import { Section } from "../components/settings/SectionWrapper";
import { SectionAIProvider } from "../components/settings/AIProviderSection";
import { SectionProjectRoots } from "../components/settings/ProjectRootsSection";
import { SectionSystemAudit } from "../components/settings/SystemAuditSection";

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

// ── Section: Project Artifacts ────────────────────────────────────────────────

function SectionProjectArtifacts() {
  const form = useFormContext<SettingsValues>();
  return (
    <Section
      title="Project artifacts"
      description="Controls how build artifacts (node_modules, target/, .venv, etc.) are classified during analysis."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <FormField
          control={form.control}
          name="artifact_active_days"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Active threshold (days)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  style={{ width: "88px" }}
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Projects touched within this many days are considered active (low severity).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="artifact_stale_days"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stale threshold (days)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  style={{ width: "88px" }}
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Projects untouched beyond this many days are considered stale (high severity). Between active and stale thresholds is idle (medium).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="artifact_min_size_mb"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Minimum size (MB)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  style={{ width: "88px" }}
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Artifact groups smaller than this are not surfaced as findings.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
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

// ── Section: Updates ──────────────────────────────────────────────────────────

type UpdateCheckResult =
  | { kind: "available"; version: string; notes: string }
  | { kind: "up_to_date" }
  | { kind: "error"; message: string };

const UPDATE_LAST_CHECKED_KEY = "update_last_checked";

function formatCheckedAt(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

function SectionUpdates() {
  const [appVersion, setAppVersion] = useState<string>("…");
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    invoke<string | null>("get_setting", { key: UPDATE_LAST_CHECKED_KEY })
      .then(setLastChecked)
      .catch(() => {});
  }, []);

  async function handleCheckNow() {
    setChecking(true);
    const now = new Date().toISOString();
    try {
      const result = await invoke<UpdateCheckResult>("check_for_update");
      await invoke("set_setting", { key: UPDATE_LAST_CHECKED_KEY, value: now });
      setLastChecked(now);
      if (result.kind === "available") {
        toast.success(`Macroscope v${result.version} is available.`);
      } else if (result.kind === "up_to_date") {
        toast.success("Macroscope is up to date.");
      } else {
        toast.error(`Update check failed: ${result.message}`);
      }
    } catch (e) {
      toast.error(`Update check failed: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Section title="Updates">
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-disabled)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Macroscope v{appVersion}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            type="button"
            onClick={handleCheckNow}
            disabled={checking}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "var(--color-bg-elev-2)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-md)",
              padding: "7px 14px",
              color: checking ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
              fontSize: "var(--text-sm)",
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              cursor: checking ? "not-allowed" : "pointer",
              opacity: checking ? 0.6 : 1,
            }}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-disabled)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Last checked: {formatCheckedAt(lastChecked)}
          </span>
        </div>
      </div>
    </Section>
  );
}

// ── Section: Developer ────────────────────────────────────────────────────────

function SectionDeveloper() {
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    setResetting(true);
    try {
      sessionStorage.removeItem("mscope_auto_snapshot");
      await invoke("reset_app_state");
      toast.success("App state reset");
      navigate("/");
    } catch (e) {
      toast.error(`Reset failed: ${String(e)}`);
    } finally {
      setResetting(false);
    }
  }

  return (
    <Section title="Developer">
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          Deletes all snapshots and analysis results, resets all settings, and triggers the
          first-run wizard on next launch. API keys in macOS Keychain are preserved.
        </p>
        <div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={resetting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "var(--color-severity-high-bg)",
                  border: "1px solid var(--color-severity-high)",
                  borderRadius: "var(--radius-md)",
                  padding: "7px 14px",
                  color: "var(--color-severity-high-fg)",
                  fontSize: "var(--text-sm)",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  cursor: resetting ? "not-allowed" : "pointer",
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                <RotateCcw size={13} />
                {resetting ? "Resetting…" : "Reset app state"}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset app state?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes all snapshots, clears project roots, resets the AI provider,
                  and triggers onboarding on next launch. API keys in macOS Keychain are
                  preserved. This cannot be undone. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  className="bg-[var(--color-severity-high)] text-white hover:opacity-90 transition-opacity"
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
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
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--color-bg-base)",
      }}
    >
      {/* Sticky header — outside the scroll region so it stays pinned */}
      <div style={{ flexShrink: 0, padding: "24px 24px 0", background: "var(--color-bg-base)" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              paddingBottom: "16px",
              borderBottom: "1px solid var(--color-border-divider)",
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
        </div>
      </div>

      {/* Scrollable form content */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "20px 24px 24px" }}>
          <Form {...form}>
            <form
              onSubmit={onSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <SectionGeneral />
              <SectionAIProvider />
              <SectionHotkey />
              <SectionSystemAudit />
              <SectionProjectRoots onChanged={() => setRootsVersion((v) => v + 1)} />
              <SectionProjectArtifacts />
              <SectionSafety refreshKey={rootsVersion} />
              <SectionAbout />
              <SectionUpdates />
              <SectionDeveloper />
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}

export { Section, FieldRow } from "../components/settings/SectionWrapper";
