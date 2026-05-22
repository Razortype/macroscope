import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen, Key, Settings2, Shield, ExternalLink } from "lucide-react";
import { Button } from "../ui/button";
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
} from "../ui/alert-dialog";

export type PermMode = "granular" | "fda";

interface PermConfig {
  id: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  description: string;
  pane: string;
}

const GRANULAR_PERM_CONFIGS = [
  { id: "automation", Icon: Settings2, pane: "Automation" },
  { id: "desktop",    Icon: FolderOpen, pane: "DesktopFolder" },
  { id: "downloads",  Icon: FolderOpen, pane: "DownloadsFolder" },
  { id: "documents",  Icon: FolderOpen, pane: "DocumentsFolder" },
] as const;

const FDA_PERM_CONFIG = { id: "fda", Icon: Shield, pane: "AllFiles" } as const;

function OpenSettingsLabel() {
  const { t } = useTranslation("onboarding");
  return <>{t("steps.permissions.open_settings_btn")}</>;
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ granted }: { granted: boolean }) {
  const { t } = useTranslation("onboarding");
  return (
    <span
      style={{
        background: granted
          ? "var(--color-severity-low-bg)"
          : "var(--color-severity-medium-bg)",
        color: granted
          ? "var(--color-severity-low-fg)"
          : "var(--color-severity-medium-fg)",
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        borderRadius: "var(--radius-xs)",
        padding: "2px 6px",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {granted ? t("steps.permissions.status_granted") : t("steps.permissions.status_pending")}
    </span>
  );
}

export type KeychainStatus = "granted" | "denied" | "unknown" | "not_needed";

// ── Keychain status pill ──────────────────────────────────────────────────────

export function KeychainStatusPill({ status }: { status: KeychainStatus }) {
  const { t } = useTranslation("onboarding");
  const styles: Record<KeychainStatus, { bg: string; fg: string }> = {
    granted:    { bg: "var(--color-severity-low-bg)",    fg: "var(--color-severity-low-fg)" },
    denied:     { bg: "var(--color-severity-high-bg)",   fg: "var(--color-severity-high-fg)" },
    unknown:    { bg: "var(--color-severity-medium-bg)", fg: "var(--color-severity-medium-fg)" },
    not_needed: { bg: "var(--color-bg-elev-3)",          fg: "var(--color-text-muted)" },
  };
  const labelKey = {
    granted:    "steps.permissions.perms.keychain.status_granted",
    denied:     "steps.permissions.perms.keychain.status_denied",
    unknown:    "steps.permissions.perms.keychain.status_pending",
    not_needed: "steps.permissions.perms.keychain.status_not_needed",
  } as const;

  return (
    <span
      style={{
        background: styles[status].bg,
        color: styles[status].fg,
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        borderRadius: "var(--radius-xs)",
        padding: "2px 6px",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {t(labelKey[status])}
    </span>
  );
}

// ── Keychain permission row ───────────────────────────────────────────────────

export function KeychainPermRow({
  status,
  onGrant,
}: {
  status: KeychainStatus;
  onGrant: () => Promise<void>;
}) {
  const { t } = useTranslation("onboarding");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px",
        background: "var(--color-bg-elev-2)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <Key size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
          {t("steps.permissions.perms.keychain.title")}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "2px" }}>
          {t("steps.permissions.perms.keychain.description")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <KeychainStatusPill status={status} />
        {status !== "granted" && status !== "not_needed" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="default" size="sm">
                {t("steps.permissions.perms.keychain.grant_button")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("steps.permissions.perms.keychain.modal_title")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("steps.permissions.perms.keychain.modal_body")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={onGrant}>
                  {t("steps.permissions.perms.keychain.modal_continue")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

// ── Permission row ────────────────────────────────────────────────────────────

function PermRow({
  perm,
  granted,
}: {
  perm: PermConfig;
  granted: boolean;
}) {
  async function openSettings() {
    await invoke("open_system_settings_pane", { pane: perm.pane }).catch(() => {});
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px",
        background: "var(--color-bg-elev-2)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <perm.Icon
        size={16}
        style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {perm.title}
        </div>
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            marginTop: "2px",
          }}
        >
          {perm.description}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexShrink: 0,
        }}
      >
        <StatusPill granted={granted} />
        {!granted && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={openSettings}
          >
            <OpenSettingsLabel />
            <ExternalLink size={11} />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── PermissionsStep ───────────────────────────────────────────────────────────

export interface PermissionsStepProps {
  mode: PermMode;
  onModeChange: (mode: PermMode) => void;
  onGrantedCountChange: (count: number) => void;
}

export function PermissionsStep({
  mode,
  onModeChange,
  onGrantedCountChange,
}: PermissionsStepProps) {
  const { t } = useTranslation("onboarding");
  const [statuses, setStatuses] = useState<{
    automation: boolean;
    desktop: boolean;
    downloads: boolean;
    documents: boolean;
    fda: boolean;
    keychain: KeychainStatus;
  }>({
    automation: false,
    desktop: false,
    downloads: false,
    documents: false,
    fda: false,
    keychain: "unknown",
  });

  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const onGrantedCountChangeRef = useRef(onGrantedCountChange);
  useEffect(() => { onGrantedCountChangeRef.current = onGrantedCountChange; }, [onGrantedCountChange]);

  async function probeAll(currentMode: PermMode) {
    const [automation, desktop, downloads, documents, fda, keychainRes] = await Promise.all([
      invoke<{ granted: boolean }>("probe_automation_permission").catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_folder_access", { path: "~/Desktop" }).catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_folder_access", { path: "~/Downloads" }).catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_folder_access", { path: "~/Documents" }).catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_full_disk_access").catch(() => ({ granted: false })),
      invoke<{ state: string }>("check_keychain_access", { allowProbe: false }).catch(() => ({ state: "unknown" })),
    ]);

    const next = {
      automation: automation.granted,
      desktop: desktop.granted,
      downloads: downloads.granted,
      documents: documents.granted,
      fda: fda.granted,
      keychain: keychainRes.state as KeychainStatus,
    };
    setStatuses(next);

    const count =
      currentMode === "fda"
        ? (next.fda ? 1 : 0)
        : [next.automation, next.desktop, next.downloads, next.documents].filter(Boolean).length;
    onGrantedCountChangeRef.current(count);
  }

  async function handleKeychainGrant() {
    try {
      const res = await invoke<{ state: string }>("check_keychain_access", { allowProbe: true });
      setStatuses((prev) => ({ ...prev, keychain: res.state as KeychainStatus }));
    } catch {
      setStatuses((prev) => ({ ...prev, keychain: "unknown" }));
    }
  }

  // Run probes on mount and whenever mode changes
  useEffect(() => {
    probeAll(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Re-probe on window focus (user may have toggled in System Settings)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused && !cancelled) probeAll(modeRef.current);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const permConfigs = mode === "granular" ? GRANULAR_PERM_CONFIGS : [FDA_PERM_CONFIG];
  const perms: PermConfig[] = permConfigs.map((c) => ({
    id: c.id,
    Icon: c.Icon,
    pane: c.pane,
    title: t(`steps.permissions.perms.${c.id}.title`),
    description: t(`steps.permissions.perms.${c.id}.description`),
  }));

  const helperText =
    mode === "granular"
      ? t("steps.permissions.helper_granular")
      : t("steps.permissions.helper_fda");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div
          style={{
            display: "inline-flex",
            gap: "3px",
            background: "var(--color-bg-elev-2)",
            borderRadius: "var(--radius-md)",
            padding: "3px",
            alignSelf: "flex-start",
          }}
        >
          {(["granular", "fda"] as PermMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              style={{
                background: mode === m ? "var(--color-bg-elev-3)" : "none",
                border:
                  mode === m
                    ? "1px solid var(--color-border-subtle)"
                    : "1px solid transparent",
                borderRadius: "var(--radius-sm)",
                padding: "5px 12px",
                color:
                  mode === m
                    ? "var(--color-text-primary)"
                    : "var(--color-text-muted)",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-sans)",
                fontWeight: mode === m ? 500 : 400,
                cursor: "pointer",
              }}
            >
              {m === "granular" ? t("steps.permissions.mode_granular") : t("steps.permissions.mode_fda")}
            </button>
          ))}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {helperText}
        </p>
      </div>

      {/* Permission rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {perms.map((perm) => (
          <PermRow
            key={perm.id}
            perm={perm}
            granted={statuses[perm.id as keyof typeof statuses] as boolean}
          />
        ))}
        <KeychainPermRow
          status={statuses.keychain}
          onGrant={handleKeychainGrant}
        />
      </div>
    </div>
  );
}
