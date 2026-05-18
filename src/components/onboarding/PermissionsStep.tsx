import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderOpen, Settings2, Shield, ExternalLink } from "lucide-react";
import { Button } from "../ui/button";

export type PermMode = "granular" | "fda";

interface PermConfig {
  id: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  description: string;
  pane: string;
}

const GRANULAR_PERMS: PermConfig[] = [
  {
    id: "automation",
    Icon: Settings2,
    title: "System Events automation",
    description: "Needed for app inventory via AppleScript",
    pane: "Automation",
  },
  {
    id: "desktop",
    Icon: FolderOpen,
    title: "Desktop folder",
    description: "Access to files on your Desktop",
    pane: "DesktopFolder",
  },
  {
    id: "downloads",
    Icon: FolderOpen,
    title: "Downloads folder",
    description: "Access to files in Downloads",
    pane: "DownloadsFolder",
  },
  {
    id: "documents",
    Icon: FolderOpen,
    title: "Documents folder",
    description: "Access to files in Documents",
    pane: "DocumentsFolder",
  },
];

const FDA_PERM: PermConfig = {
  id: "fda",
  Icon: Shield,
  title: "Full Disk Access",
  description: "Grants read access to your entire home directory",
  pane: "AllFiles",
};

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ granted }: { granted: boolean }) {
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
      {granted ? "GRANTED" : "PENDING"}
    </span>
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
            Open Settings
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
  const [statuses, setStatuses] = useState({
    automation: false,
    desktop: false,
    downloads: false,
    documents: false,
    fda: false,
  });

  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const onGrantedCountChangeRef = useRef(onGrantedCountChange);
  useEffect(() => { onGrantedCountChangeRef.current = onGrantedCountChange; }, [onGrantedCountChange]);

  async function probeAll(currentMode: PermMode) {
    const [automation, desktop, downloads, documents, fda] = await Promise.all([
      invoke<{ granted: boolean }>("probe_automation_permission").catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_folder_access", { path: "~/Desktop" }).catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_folder_access", { path: "~/Downloads" }).catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_folder_access", { path: "~/Documents" }).catch(() => ({ granted: false })),
      invoke<{ granted: boolean }>("probe_full_disk_access").catch(() => ({ granted: false })),
    ]);

    const next = {
      automation: automation.granted,
      desktop: desktop.granted,
      downloads: downloads.granted,
      documents: documents.granted,
      fda: fda.granted,
    };
    setStatuses(next);

    const count =
      currentMode === "fda"
        ? (next.fda ? 1 : 0)
        : [next.automation, next.desktop, next.downloads, next.documents].filter(Boolean).length;
    onGrantedCountChangeRef.current(count);
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

  const perms = mode === "granular" ? GRANULAR_PERMS : [FDA_PERM];

  const helperText =
    mode === "granular"
      ? "Macroscope only requests the folders it needs."
      : "One permission grants access to your entire home directory.";

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
              {m === "granular" ? "Granular" : "Full Disk Access"}
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
            granted={statuses[perm.id as keyof typeof statuses]}
          />
        ))}
      </div>
    </div>
  );
}
