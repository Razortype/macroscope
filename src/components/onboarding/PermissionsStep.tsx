import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Settings2, Shield, ExternalLink } from "lucide-react";
import { Checkbox } from "../ui/checkbox";

export type PermMode = "granular" | "fda";
export type PermStatus = "pending" | "granted" | "denied";

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

function StatusPill({ status }: { status: PermStatus }) {
  const cfg: Record<PermStatus, { bg: string; fg: string; label: string }> = {
    pending: {
      bg: "var(--color-severity-medium-bg)",
      fg: "var(--color-severity-medium-fg)",
      label: "PENDING",
    },
    granted: {
      bg: "var(--color-severity-low-bg)",
      fg: "var(--color-severity-low-fg)",
      label: "GRANTED",
    },
    denied: {
      bg: "var(--color-severity-high-bg)",
      fg: "var(--color-severity-high-fg)",
      label: "DENIED",
    },
  };
  const { bg, fg, label } = cfg[status];
  return (
    <span
      style={{
        background: bg,
        color: fg,
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
      {label}
    </span>
  );
}

function PermRow({
  perm,
  status,
  onStatusChange,
}: {
  perm: PermConfig;
  status: PermStatus;
  onStatusChange: (id: string, s: PermStatus) => void;
}) {
  const [opened, setOpened] = useState(false);

  async function openSettings() {
    try {
      await invoke("open_system_settings_pane", { pane: perm.pane });
    } catch {
      // silently ignore — the pane may still open
    }
    setOpened(true);
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

      {opened ? (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Checkbox
            checked={status === "granted"}
            onCheckedChange={(checked) =>
              onStatusChange(perm.id, checked ? "granted" : "pending")
            }
          />
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            I've granted this
          </span>
        </label>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          <StatusPill status={status} />
          <button
            type="button"
            onClick={openSettings}
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
              whiteSpace: "nowrap",
            }}
          >
            <ExternalLink size={11} />
            Open Settings
          </button>
        </div>
      )}
    </div>
  );
}

// ── PermissionsStep ───────────────────────────────────────────────────────────

export interface PermissionsStepProps {
  mode: PermMode;
  onModeChange: (mode: PermMode) => void;
  statuses: Record<string, PermStatus>;
  onStatusChange: (id: string, status: PermStatus) => void;
}

export function PermissionsStep({
  mode,
  onModeChange,
  statuses,
  onStatusChange,
}: PermissionsStepProps) {
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
            status={statuses[perm.id] ?? "pending"}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    </div>
  );
}
