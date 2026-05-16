import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import type { Finding } from "../types/finding";
import type { ClaudeStatus, Snapshot, SnapshotMeta } from "../types/snapshot";
import HeroMetrics from "../components/HeroMetrics";
import FindingCard from "../components/FindingCard";
import ExecuteDialog from "../components/ExecuteDialog";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function snapshotAge(ts: string): string {
  try {
    return formatDistanceToNow(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

const ALL_PRESETS = ["disk-audit", "security-audit"];

// Sort findings: severity desc (high→info), then category asc for grouping
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort((a, b) => {
    const sv = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (sv !== 0) return sv;
    return a.category.localeCompare(b.category);
  });
}

// ── Empty / Onboarding state ─────────────────────────────────────────────────

function OnboardingCard({ onStart, isPending }: { onStart: () => void; isPending: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div
        style={{
          background: "var(--color-bg-elev-1)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: "40px",
          maxWidth: "560px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-2xl)",
            fontWeight: 500,
            color: "var(--color-text-primary)",
            lineHeight: "var(--leading-tight)",
          }}
        >
          Welcome to Macroscope
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            color: "var(--color-text-secondary)",
            lineHeight: "var(--leading-base)",
          }}
        >
          Macroscope inspects your Mac, identifies cleanup opportunities, and flags security
          configuration that warrants attention. Each system audit takes 30–90 seconds and
          uses your local Claude CLI.
        </p>
        <div style={{ paddingTop: "8px" }}>
          <button
            onClick={onStart}
            disabled={isPending}
            style={{
              background: isPending ? "var(--color-accent-muted)" : "var(--color-accent)",
              color: "var(--color-accent-on)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "10px 20px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: isPending ? "not-allowed" : "pointer",
            }}
          >
            {isPending ? "Scanning…" : "Take first snapshot"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();

  // ── Persistent state ──────────────────────────────────────────────────────
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [activeSnapshotId, setActiveSnapshotId] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [executedPaths, setExecutedPaths] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const claudeQuery = useQuery<ClaudeStatus>({
    queryKey: ["claude_status"],
    queryFn: () => invoke<ClaudeStatus>("get_claude_status"),
    staleTime: Infinity,
  });

  const historyQuery = useQuery<SnapshotMeta[]>({
    queryKey: ["snapshots"],
    queryFn: () => invoke<SnapshotMeta[]>("list_snapshots"),
  });

  const latestIdQuery = useQuery<number | null>({
    queryKey: ["latest_snapshot_id"],
    queryFn: () => invoke<number | null>("latest_snapshot_id"),
    staleTime: Infinity,
  });

  // ── On-mount restore: load latest snapshot + its findings ─────────────────
  useEffect(() => {
    if (latestIdQuery.data == null || activeSnapshotId != null) return;
    const id = latestIdQuery.data;
    Promise.all([
      invoke<Snapshot>("get_snapshot", { id }),
      invoke<Finding[]>("get_findings_for_snapshot", { snapshotId: id }),
    ]).then(([snap, foundFindings]) => {
      setActiveSnapshot(snap);
      setActiveSnapshotId(id);
      setFindings(sortFindings(foundFindings));
    }).catch(() => {
      // First-launch edge case: latest_snapshot_id returned but row was deleted
    });
  }, [latestIdQuery.data, activeSnapshotId]);

  // ── Chained take+analyze mutation ─────────────────────────────────────────
  const runFullScan = useMutation<Finding[], string>({
    // onMutate fires synchronously before the async work — clears stale data immediately
    // so the old findings panel unmounts right when the button is clicked.
    onMutate: () => {
      setFindings(null);
      setSelectedIds(new Set());
      setExecutedPaths(new Set());
      setAnalyzeError(null);
    },
    mutationFn: async () => {
      const snap = await invoke<Snapshot>("take_snapshot");
      const id = await invoke<number>("save_snapshot", { snapshot: snap });
      setActiveSnapshot(snap);
      setActiveSnapshotId(id);
      qc.invalidateQueries({ queryKey: ["snapshots"] });
      qc.invalidateQueries({ queryKey: ["latest_snapshot_id"] });
      const found = await invoke<Finding[]>("analyze_snapshot", {
        snapshotId: id,
        presets: ALL_PRESETS,
      });
      return found;
    },
    onSuccess: (data) => {
      setFindings(sortFindings(data));
    },
    onError: (err) => setAnalyzeError(err),
  });

  // Re-analyze without taking a new snapshot
  const reAnalyze = useMutation<Finding[], string>({
    onMutate: () => {
      setFindings(null);
      setSelectedIds(new Set());
      setExecutedPaths(new Set());
      setAnalyzeError(null);
    },
    mutationFn: async () => {
      if (activeSnapshotId == null) throw new Error("No snapshot loaded");
      return invoke<Finding[]>("analyze_snapshot", {
        snapshotId: activeSnapshotId,
        presets: ALL_PRESETS,
      });
    },
    onSuccess: (data) => {
      setFindings(sortFindings(data));
    },
    onError: (err) => setAnalyzeError(err),
  });

  // Load an older snapshot from history
  const loadSnapshot = useCallback(async (id: number) => {
    try {
      const [snap, found] = await Promise.all([
        invoke<Snapshot>("get_snapshot", { id }),
        invoke<Finding[]>("get_findings_for_snapshot", { snapshotId: id }),
      ]);
      setActiveSnapshot(snap);
      setActiveSnapshotId(id);
      setFindings(sortFindings(found));
      setSelectedIds(new Set());
      setAnalyzeError(null);
    } catch (e) {
      setAnalyzeError(String(e));
    }
  }, []);

  // Delete snapshot from history
  const deleteSnapshot = useCallback(async (id: number) => {
    await invoke("delete_snapshot", { id });
    qc.invalidateQueries({ queryKey: ["snapshots"] });
    if (id === activeSnapshotId) {
      setActiveSnapshot(null);
      setActiveSnapshotId(null);
      setFindings(null);
      setSelectedIds(new Set());
    }
  }, [activeSnapshotId, qc]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const claudeStatus = claudeQuery.data ?? null;
  const isAnalyzing = runFullScan.isPending || reAnalyze.isPending;
  const isTakingFirst = runFullScan.isPending && activeSnapshotId == null;
  const hasSnapshot = latestIdQuery.data != null;

  const deleteableFindings = findings?.filter((f) => f.suggested_action === "delete_paths") ?? [];
  const selectedFindings = deleteableFindings.filter((f) => selectedIds.has(f.id));
  const totalBytesToFree = selectedFindings.reduce(
    (sum, f) => sum + (f.estimated_bytes_freed ?? 0),
    0
  );

  const handleSelectChange = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!findings) return;
    const ids = deleteableFindings.map((f) => f.id);
    setSelectedIds((prev) =>
      prev.size === ids.length ? new Set() : new Set(ids)
    );
  }, [findings, deleteableFindings]);

  const handleExecuteComplete = useCallback((movedPaths: Set<string>) => {
    setExecutedPaths((prev) => new Set([...prev, ...movedPaths]));
    // Deselect findings whose paths were all successfully moved
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const f of deleteableFindings) {
        const allMoved = (f.paths_to_remove ?? []).every((p) => movedPaths.has(p));
        if (allMoved) next.delete(f.id);
      }
      return next;
    });
  }, [deleteableFindings]);

  // ── Loading state (initial restore) ──────────────────────────────────────
  if (latestIdQuery.isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
          Loading…
        </span>
      </div>
    );
  }

  // ── Onboarding (no snapshots ever taken) ─────────────────────────────────
  if (!hasSnapshot && !runFullScan.isPending) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 20px 0" }}>
          <HeroMetrics snapshot={null} claudeStatus={claudeStatus} />
        </div>
        <OnboardingCard
          onStart={() => runFullScan.mutate()}
          isPending={runFullScan.isPending}
        />
        {runFullScan.error && (
          <div style={{ padding: "0 20px", marginTop: "8px" }}>
            <ErrorBanner message={runFullScan.error} />
          </div>
        )}
      </div>
    );
  }

  // ── Main cockpit ──────────────────────────────────────────────────────────
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--color-bg-base)",
      }}
    >
      {/* Scrollable main area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 0" }}>
        {/* Hero metrics */}
        <div style={{ marginBottom: "16px" }}>
          <HeroMetrics snapshot={activeSnapshot} claudeStatus={claudeStatus} />
        </div>

        {/* Action row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <button
            onClick={() => runFullScan.mutate()}
            disabled={isAnalyzing}
            style={{
              background: isAnalyzing ? "var(--color-accent-muted)" : "var(--color-accent)",
              color: "var(--color-accent-on)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "7px 14px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: isAnalyzing ? "not-allowed" : "pointer",
            }}
          >
            {isTakingFirst ? "Scanning…" : isAnalyzing ? "Analyzing…" : "Take snapshot"}
          </button>

          {activeSnapshot && !isAnalyzing && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              Snapshot #{activeSnapshotId}
              {" · "}
              {snapshotAge(activeSnapshot.created_at)}
              {findings != null && ` · ${findings.length} findings`}
            </span>
          )}

          {activeSnapshotId != null && !isAnalyzing && (
            <button
              onClick={() => reAnalyze.mutate()}
              style={{
                background: "none",
                border: "none",
                padding: "0 4px",
                cursor: "pointer",
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
              }}
            >
              ↻ Re-analyze
            </button>
          )}

          {isAnalyzing && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontStyle: "italic" }}>
              Running disk + security audit in parallel… (30–90 s)
            </span>
          )}
        </div>

        {/* Error banners */}
        {analyzeError && <ErrorBanner message={analyzeError} />}

        {/* Analysis in-progress placeholder */}
        {isAnalyzing && <AnalyzingPlaceholder />}

        {/* Findings */}
        {!isAnalyzing && findings !== null && (
          <FindingsSection
            findings={findings}
            selectedIds={selectedIds}
            executedPaths={executedPaths}
            onSelectChange={handleSelectChange}
            onSelectAll={handleSelectAll}
            deleteableCount={deleteableFindings.length}
          />
        )}
      </div>

      {/* Sticky footer — visible when items are selected */}
      {selectedIds.size > 0 && (
        <div
          style={{
            flexShrink: 0,
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border-divider)",
            background: "var(--color-bg-elev-1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            {selectedIds.size} selected
            {totalBytesToFree > 0 && (
              <span style={{ fontFamily: "var(--font-mono)", marginLeft: "8px", color: "var(--color-text-muted)" }}>
                · {formatBytes(totalBytesToFree)} to free
              </span>
            )}
          </span>
          <button
            onClick={() => setDialogOpen(true)}
            style={{
              background: "var(--color-accent)",
              color: "var(--color-accent-on)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "7px 16px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Execute selected ({selectedIds.size})
          </button>
        </div>
      )}

      {/* Execute confirmation dialog */}
      <ExecuteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        findings={selectedFindings}
        onComplete={handleExecuteComplete}
      />

      {/* Collapsible history strip */}
      <HistoryStrip
        metas={historyQuery.data ?? []}
        activeId={activeSnapshotId}
        onLoad={loadSnapshot}
        onDelete={deleteSnapshot}
        disabled={isAnalyzing}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AnalyzingPlaceholder() {
  return (
    <div
      style={{
        margin: "0 -20px",
        padding: "28px 20px",
        background: "var(--color-bg-elev-1)",
        borderTop: "1px solid var(--color-border-divider)",
        borderBottom: "1px solid var(--color-border-divider)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: "var(--color-text-primary)",
        }}
      >
        {/* Pulsing dot */}
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "var(--color-accent)",
            display: "inline-block",
            animation: "pulse 1.4s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
        Analyzing your system...
      </div>
      <p
        style={{
          margin: 0,
          paddingLeft: "18px",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
        }}
      >
        Running disk and security audits in parallel · typical duration: 30–90 seconds
      </p>
      <style>{`@keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
      }`}</style>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        marginBottom: "12px",
        padding: "8px 12px",
        background: "var(--color-severity-high-bg)",
        color: "var(--color-severity-high-fg)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--text-xs)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {message}
    </div>
  );
}

function FindingsSection({
  findings,
  selectedIds,
  executedPaths,
  onSelectChange,
  onSelectAll,
  deleteableCount,
}: {
  findings: Finding[];
  selectedIds: Set<string>;
  executedPaths: Set<string>;
  onSelectChange: (id: string, checked: boolean) => void;
  onSelectAll: () => void;
  deleteableCount: number;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 20px",
          margin: "0 -20px",
          borderTop: "1px solid var(--color-border-divider)",
          borderBottom: "1px solid var(--color-border-divider)",
          background: "var(--color-bg-elev-1)",
        }}
      >
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-text-secondary)" }}>
          Findings ({findings.length})
        </span>
        {deleteableCount > 0 && (
          <button
            onClick={onSelectAll}
            style={{
              background: "none", border: "none", padding: 0,
              cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--color-text-muted)",
            }}
          >
            {selectedIds.size === deleteableCount ? "⊟ Deselect all" : "⊞ Select all"}
          </button>
        )}
      </div>

      {findings.length === 0 ? (
        <div
          style={{
            padding: "24px 0",
            fontSize: "var(--text-sm)",
            color: "var(--color-status-ok)",
            fontFamily: "var(--font-mono)",
          }}
        >
          No findings — system looks clean
        </div>
      ) : (
        <div style={{ margin: "0 -20px" }}>
          {findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              selected={selectedIds.has(f.id)}
              executed={(f.paths_to_remove ?? []).length > 0 && (f.paths_to_remove ?? []).every((p) => executedPaths.has(p))}
              onSelectChange={(checked) => onSelectChange(f.id, checked)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryStrip({
  metas,
  activeId,
  onLoad,
  onDelete,
  disabled,
}: {
  metas: SnapshotMeta[];
  activeId: number | null;
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--color-border-divider)",
        background: "var(--color-bg-elev-1)",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%", background: "none", border: "none",
          padding: "9px 20px", textAlign: "left", cursor: "pointer",
          display: "flex", alignItems: "center", gap: "6px",
          fontSize: "var(--text-xs)", color: "var(--color-text-muted)",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }}>{expanded ? "▾" : "▸"}</span>
        Snapshot history ({metas.length})
      </button>

      {expanded && (
        <div
          style={{
            maxHeight: "200px", overflowY: "auto",
            padding: "0 20px 10px",
            display: "flex", flexDirection: "column", gap: "1px",
          }}
        >
          {metas.length === 0 && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>
              No snapshots
            </div>
          )}
          {metas.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "3px 6px", borderRadius: "var(--radius-xs)",
                background: m.id === activeId ? "var(--color-bg-elev-3)" : "transparent",
              }}
            >
              <button
                onClick={() => !disabled && onLoad(m.id)}
                style={{
                  flex: 1, background: "none", border: "none", padding: 0,
                  cursor: disabled ? "not-allowed" : "pointer", textAlign: "left",
                  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
                  color: disabled
                    ? "var(--color-text-disabled)"
                    : m.id === activeId ? "var(--color-text-primary)" : "var(--color-text-muted)",
                }}
              >
                #{m.id} · {m.created_at}
              </button>
              <button
                onClick={() => !disabled && onDelete(m.id)}
                style={{
                  background: "none", border: "none", padding: "0 2px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  color: "var(--color-text-disabled)",
                  fontSize: "var(--text-xs)",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
