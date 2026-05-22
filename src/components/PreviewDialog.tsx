import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { X, CircleCheck, CircleAlert, OctagonX, Loader2 } from "lucide-react";
import type { Finding } from "../types/finding";
import type { ResolvedTarget, ActionClass } from "../types/snapshot";
import RowActions from "./RowActions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

interface ExecutionReport {
  items: { path: string; status: string; bytes: number; error: string | null }[];
  total_bytes_freed: number;
}

export interface ExecuteResult {
  moved: Set<string>;
  partial: Set<string>;
}

// ── Action class helpers ──────────────────────────────────────────────────────

function isBlocked(ac: ActionClass): boolean {
  return (
    ac.type === "companion_running" ||
    ac.type === "system_managed" ||
    ac.type === "protected" ||
    ac.type === "ambiguous"
  );
}

// chipLabel uses hardcoded English labels — these are technical classifications
// that stay English per Q10 (technical jargon).
function chipLabel(ac: ActionClass): string {
  if (ac.type === "safe_orphan") return "ORPHAN";
  if (ac.type === "companion_running") return `RUNNING · ${ac.app_display}`;
  if (ac.type === "companion_not_running") return `COMPANION · ${ac.app_display}`;
  if (ac.type === "system_managed") return "SYSTEM";
  if (ac.type === "ambiguous") return "INVESTIGATE";
  return "PROTECTED";
}

function chipStyle(ac: ActionClass): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: "9px", fontWeight: 600, padding: "2px 6px",
    borderRadius: "var(--radius-xs)", textTransform: "uppercase",
    letterSpacing: "0.06em", fontFamily: "var(--font-mono)", whiteSpace: "nowrap",
  };
  if (ac.type === "safe_orphan") return { ...base, background: "var(--color-severity-low-bg)", color: "var(--color-severity-low-fg)" };
  if (ac.type === "companion_not_running") return { ...base, background: "var(--color-severity-info-bg)", color: "var(--color-severity-info-fg)" };
  return { ...base, background: "var(--color-bg-elev-3)", color: "var(--color-text-muted)" };
}

function rowIcon(ac: ActionClass) {
  if (ac.type === "safe_orphan") return <CircleCheck size={13} color="var(--color-severity-low-fg)" />;
  if (ac.type === "companion_not_running") return <CircleAlert size={13} color="var(--color-accent)" />;
  if (ac.type === "companion_running") return <OctagonX size={13} color="var(--color-severity-high-fg)" />;
  return <OctagonX size={13} color="var(--color-text-muted)" />;
}

// ── Row component ─────────────────────────────────────────────────────────────

function TargetRow({
  target, checked, onCheck,
}: {
  target: ResolvedTarget; checked: boolean; onCheck?: (v: boolean) => void;
}) {
  const blocked = isBlocked(target.action_class);

  const isCompanionNotRunning = target.action_class.type === "companion_not_running";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "20px 20px minmax(0,1fr) 72px 80px 28px",
        gap: "8px",
        padding: "7px 12px",
        borderBottom: "1px solid var(--color-border-divider)",
        alignItems: "center",
        opacity: blocked ? 0.5 : 1,
        background: isCompanionNotRunning ? "rgba(245,166,35,0.03)" : "transparent",
      }}
    >
      {/* Checkbox */}
      <div>
        {!blocked && onCheck && (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            style={{ width: 13, height: 13, accentColor: "var(--color-accent)", cursor: "pointer" }}
          />
        )}
      </div>
      {/* Icon */}
      <div style={{ display: "flex", alignItems: "center" }}>
        {rowIcon(target.action_class)}
      </div>
      {/* Label + path */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {target.display_label}
        </div>
        <div
          style={{
            fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {target.path}
        </div>
        {isCompanionNotRunning && (
          <CompanionNote app={(target.action_class as { app_display: string }).app_display} />
        )}
      </div>
      {/* Size */}
      <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)", textAlign: "right" }}>
        {formatBytes(target.size_bytes)}
      </div>
      {/* Chip */}
      <div>
        <span style={chipStyle(target.action_class)}>{chipLabel(target.action_class)}</span>
      </div>
      {/* Row actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <RowActions path={target.path} />
      </div>
    </div>
  );
}

function CompanionNote({ app }: { app: string }) {
  const { t } = useTranslation("findings");
  return (
    <div style={{ fontSize: "10px", color: "var(--color-text-muted)", marginTop: "1px" }}>
      {t("preview.companion_note", { app })}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count, subtotalBytes }: { label: string; count: number; subtotalBytes: number }) {
  return (
    <div
      style={{
        padding: "6px 12px",
        background: "var(--color-bg-elev-2)",
        borderBottom: "1px solid var(--color-border-divider)",
        fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--color-text-muted)",
        fontFamily: "var(--font-mono)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}
    >
      <span>{label}{subtotalBytes > 0 ? ` · ${formatBytes(subtotalBytes)}` : ""}</span>
      <span style={{ fontWeight: 400 }}>{count}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  findings: Finding[];
  snapshotId: number | null;
  onComplete: (result: ExecuteResult) => void;
}

type Phase = "loading" | "review" | "executing" | "error";

export default function PreviewDialog({ open, onOpenChange, findings, snapshotId, onComplete }: Props) {
  const { t } = useTranslation("findings");
  const [phase, setPhase] = useState<Phase>("loading");
  const [targets, setTargets] = useState<ResolvedTarget[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  const allPaths = findings.flatMap((f) => f.paths_to_remove ?? []);

  // Load preview when dialog opens
  useEffect(() => {
    if (!open) return;
    if (allPaths.length === 0) { setTargets([]); setPhase("review"); return; }
    if (snapshotId == null) { setLoadError("No snapshot context — cannot preview"); setPhase("error"); return; }

    setPhase("loading");
    setLoadError(null);

    invoke<ResolvedTarget[]>("preview_execution", { snapshotId, paths: allPaths })
      .then((result) => {
        setTargets(result);
        // Pre-check safe orphan targets; leave companion_not_running unchecked
        const preChecked = new Set(
          result.filter((t) => t.action_class.type === "safe_orphan").map((t) => t.path)
        );
        setChecked(preChecked);
        setPhase("review");
      })
      .catch((err) => {
        setLoadError(String(err));
        setPhase("error");
      });
  }, [open, snapshotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  const handleCheck = useCallback((path: string, val: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      val ? next.add(path) : next.delete(path);
      return next;
    });
  }, []);

  const handleExecute = useCallback(async () => {
    setPhase("executing");
    try {
      const safePaths = targets
        .filter((tgt) => tgt.action_class.type === "safe_orphan" && checked.has(tgt.path))
        .map((tgt) => tgt.path);
      const companionApproved = targets
        .filter((tgt) => tgt.action_class.type === "companion_not_running" && checked.has(tgt.path))
        .map((tgt) => tgt.path);

      const report = await invoke<ExecutionReport>("execute_previewed", {
        safePaths,
        companionApproved,
      });

      const moved = new Set(report.items.filter((i) => i.status === "moved").map((i) => i.path));
      const partial = new Set(report.items.filter((i) => i.status === "partial").map((i) => i.path));
      const partialItems = report.items.filter((i) => i.status === "partial");
      const failed = report.items.filter((i) => i.status !== "moved" && i.status !== "partial");

      if (report.total_bytes_freed > 0) {
        if (partialItems.length > 0) {
          toast.success(t("preview.moved_partial_toast", { bytes: formatBytes(report.total_bytes_freed), partial: partialItems.length }));
        } else {
          toast.success(t("preview.moved_toast", { bytes: formatBytes(report.total_bytes_freed) }));
        }
      } else if (moved.size === 0 && partial.size === 0) {
        toast.error(t("preview.nothing_moved_toast"));
      }

      for (const item of partialItems) {
        toast.warning(item.path, { description: item.error ?? t("preview.partial_warning"), duration: 8000 });
      }
      if (failed.length > 0) {
        toast.error(t("preview.failed_paths_toast", { count: failed.length }), {
          description: failed.map((i) => `${i.path}: ${i.error ?? i.status}`).join("\n"),
          duration: 8000,
        });
      }

      onComplete({ moved, partial });
      onOpenChange(false);
    } catch (e) {
      toast.error(t("preview.execute_failed_toast", { detail: String(e) }));
      setPhase("review");
    }
  }, [targets, checked, onComplete, onOpenChange, t]);

  if (!open) return null;

  // ── Groups ──────────────────────────────────────────────────────────────────
  const safeTargets = targets.filter((t) => t.action_class.type === "safe_orphan");
  const companionNotRunning = targets.filter((t) => t.action_class.type === "companion_not_running");
  const skipped = targets.filter((t) => isBlocked(t.action_class));

  const checkedTargets = targets.filter((t) => checked.has(t.path));
  const checkedSize = checkedTargets.reduce((s, t) => s + t.size_bytes, 0);
  const checkedCount = checkedTargets.length;
  // Section subtotals: Safe + Companion use checked-only; Skipped uses total (none actionable)
  const safeSize = safeTargets.filter((t) => checked.has(t.path)).reduce((s, t) => s + t.size_bytes, 0);
  const companionCheckedSize = companionNotRunning.filter((t) => checked.has(t.path)).reduce((s, t) => s + t.size_bytes, 0);
  const skippedSize = skipped.reduce((s, t) => s + t.size_bytes, 0);

  const canExecute = checkedCount > 0 && phase === "review";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => onOpenChange(false)}
        style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal
        style={{
          position: "fixed", inset: 0, zIndex: 51,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: "auto",
            width: "min(680px, 96vw)",
            maxHeight: "80vh",
            background: "var(--color-bg-elev-1)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-lg)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "16px 20px 12px",
              borderBottom: "1px solid var(--color-border-divider)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {phase === "loading"
                    ? t("preview.title_loading")
                    : t("preview.title_review", { count: targets.length })}
                </div>
                {phase === "review" && safeSize > 0 && (
                  <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "3px" }}>
                    {t("preview.subtitle_safe", { bytes: formatBytes(safeSize) })}
                    {skipped.length > 0 && t("preview.subtitle_skipped", { count: skipped.length })}
                  </div>
                )}
              </div>
              <button
                onClick={() => onOpenChange(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: "2px" }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
            {phase === "loading" && (
              <div style={{ padding: "40px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
                <Loader2 size={16} className="mscope-pulse" />
                {t("preview.body_loading")}
              </div>
            )}

            {phase === "error" && (
              <div style={{ padding: "24px 20px", color: "var(--color-severity-medium-fg)", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
                {loadError ?? t("preview.error_fallback")}
              </div>
            )}

            {phase === "review" && targets.length === 0 && (
              <div style={{ padding: "24px 20px", color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
                {t("preview.empty")}
              </div>
            )}

            {(phase === "review" || phase === "executing") && targets.length > 0 && (
              <>
                {/* Safe section */}
                {safeTargets.length > 0 && (
                  <>
                    <SectionHeader label={t("preview.section_safe")} count={safeTargets.length} subtotalBytes={safeSize} />
                    {safeTargets.map((t) => (
                      <TargetRow
                        key={t.path}
                        target={t}
                        checked={checked.has(t.path)}
                        onCheck={(v) => handleCheck(t.path, v)}
                      />
                    ))}
                  </>
                )}

                {/* Companion (not running) section */}
                {companionNotRunning.length > 0 && (
                  <>
                    <SectionHeader label={t("preview.section_companion")} count={companionNotRunning.length} subtotalBytes={companionCheckedSize} />
                    {companionNotRunning.map((t) => (
                      <TargetRow
                        key={t.path}
                        target={t}
                        checked={checked.has(t.path)}
                        onCheck={(v) => handleCheck(t.path, v)}
                      />
                    ))}
                  </>
                )}

                {/* Skipped section */}
                {skipped.length > 0 && (
                  <>
                    <SectionHeader label={t("preview.section_skipped")} count={skipped.length} subtotalBytes={skippedSize} />
                    {skipped.map((t) => (
                      <TargetRow key={t.path} target={t} checked={false} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--color-border-divider)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
              {phase === "review" && checkedCount > 0
                ? t("preview.footer_selected", { count: checkedCount, bytes: formatBytes(checkedSize) })
                : phase === "review"
                ? t("preview.footer_none")
                : ""}
            </span>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => onOpenChange(false)}
                disabled={phase === "executing"}
                style={{
                  background: "none",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 16px",
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  opacity: phase === "executing" ? 0.5 : 1,
                }}
              >
                {t("common:actions.cancel")}
              </button>
              <button
                onClick={handleExecute}
                disabled={!canExecute}
                style={{
                  background: canExecute ? "var(--color-accent)" : "var(--color-text-muted)",
                  color: canExecute ? "#1a1a26" : "var(--color-text-disabled)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 16px",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  cursor: canExecute ? "pointer" : "not-allowed",
                  minWidth: "120px",
                }}
              >
                {phase === "executing"
                  ? t("common:status.moving")
                  : t("preview.execute_btn", { count: checkedCount })}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
