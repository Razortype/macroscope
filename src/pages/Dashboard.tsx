import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import type { Finding } from "../types/finding";
import type { ClaudeStatus, Snapshot, SnapshotMeta } from "../types/snapshot";
import HeroMetrics from "../components/HeroMetrics";
import ActionRow from "../components/ActionRow";
import FindingCard from "../components/FindingCard";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function lastSnapshotAge(metas: SnapshotMeta[] | undefined): string | null {
  if (!metas || metas.length === 0) return null;
  const latest = metas[0];
  try {
    return formatDistanceToNow(new Date(latest.created_at), { addSuffix: true });
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();

  // ── State ────────────────────────────────────────────────────────────────
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const claudeQuery = useQuery<ClaudeStatus>({
    queryKey: ["claude_status"],
    queryFn: () => invoke<ClaudeStatus>("get_claude_status"),
    staleTime: Infinity,
  });

  const historyQuery = useQuery<SnapshotMeta[]>({
    queryKey: ["snapshots"],
    queryFn: () => invoke<SnapshotMeta[]>("list_snapshots"),
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const takeMutation = useMutation<Snapshot, string>({
    mutationFn: () => invoke<Snapshot>("take_snapshot"),
    onSuccess: async (snap) => {
      const id = await invoke<number>("save_snapshot", { snapshot: snap });
      setActiveSnapshot(snap);
      setFindings(null);
      setSelectedIds(new Set());
      setAnalyzeError(null);
      qc.invalidateQueries({ queryKey: ["snapshots"] });
      // Cache the snapshot by id so we can retrieve it later
      qc.setQueryData(["snapshot", id], snap);
    },
  });

  const analyzeMutation = useMutation<Finding[], string, { id: number; preset: string }>({
    mutationFn: ({ id, preset }) =>
      invoke<Finding[]>("analyze_snapshot", { snapshotId: id, preset }),
    onSuccess: (data) => {
      setFindings(data);
      setSelectedIds(new Set());
      setAnalyzeError(null);
    },
    onError: (err) => setAnalyzeError(err),
  });

  // ── Callbacks ────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(
    (preset: string) => {
      if (!historyQuery.data?.[0]) return;
      setAnalyzeError(null);
      analyzeMutation.mutate({ id: historyQuery.data[0].id, preset });
    },
    [historyQuery.data, analyzeMutation]
  );

  const handleSelectChange = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!findings) return;
    const deleteable = findings.filter((f) => f.suggested_action === "delete_paths");
    setSelectedIds((prev) =>
      prev.size === deleteable.length
        ? new Set()
        : new Set(deleteable.map((f) => f.id))
    );
  }, [findings]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const claudeStatus = claudeQuery.data ?? null;
  const canAnalyze =
    !!historyQuery.data?.length &&
    claudeStatus?.available === true &&
    !analyzeMutation.isPending;

  const deleteableFindings = findings?.filter((f) => f.suggested_action === "delete_paths") ?? [];
  const selectedFindings = deleteableFindings.filter((f) => selectedIds.has(f.id));
  const totalBytesToFree = selectedFindings.reduce(
    (sum, f) => sum + (f.estimated_bytes_freed ?? 0),
    0
  );

  const snapshotForMetrics = activeSnapshot ?? null;

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
      {/* ── Scrollable main area ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 0" }}>
        {/* Hero metrics */}
        <div style={{ marginBottom: "20px" }}>
          <HeroMetrics snapshot={snapshotForMetrics} claudeStatus={claudeStatus} />
        </div>

        {/* Action row */}
        <ActionRow
          onTakeSnapshot={() => takeMutation.mutate()}
          onAnalyze={handleAnalyze}
          isTakingSnapshot={takeMutation.isPending}
          canAnalyze={canAnalyze}
          lastSnapshotAge={lastSnapshotAge(historyQuery.data)}
        />

        {/* Error banners */}
        {takeMutation.error && (
          <ErrorBanner message={`Snapshot failed: ${takeMutation.error}`} />
        )}
        {analyzeError && (
          <ErrorBanner message={`Analysis failed: ${analyzeError}`} />
        )}
        {analyzeMutation.isPending && (
          <div
            style={{
              padding: "10px 20px",
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            Analyzing… (this may take 30–90 seconds)
          </div>
        )}

        {/* Findings section */}
        {findings !== null && (
          <FindingsSection
            findings={findings}
            selectedIds={selectedIds}
            onSelectChange={handleSelectChange}
            onSelectAll={handleSelectAll}
            deleteableCount={deleteableFindings.length}
          />
        )}
      </div>

      {/* ── Sticky action footer (only when something is selected) ── */}
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

      {/* ── Snapshot history (collapsible, always at bottom) ── */}
      <HistoryStrip
        metas={historyQuery.data ?? []}
        activeId={historyQuery.data?.[0]?.id ?? null}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        margin: "0 0 12px",
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
  onSelectChange,
  onSelectAll,
  deleteableCount,
}: {
  findings: Finding[];
  selectedIds: Set<string>;
  onSelectChange: (id: string, checked: boolean) => void;
  onSelectAll: () => void;
  deleteableCount: number;
}) {
  return (
    <div>
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 20px",
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
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            {selectedIds.size === deleteableCount ? "⊟ Deselect all" : "⊞ Select all"}
          </button>
        )}
      </div>

      {findings.length === 0 ? (
        <div
          style={{
            padding: "24px 20px",
            fontSize: "var(--text-sm)",
            color: "var(--color-status-ok)",
            fontFamily: "var(--font-mono)",
          }}
        >
          No findings — system looks clean
        </div>
      ) : (
        <div>
          {findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              selected={selectedIds.has(f.id)}
              onSelectChange={(checked) => onSelectChange(f.id, checked)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryStrip({ metas, activeId }: { metas: SnapshotMeta[]; activeId: number | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid var(--color-border-divider)",
        background: "var(--color-bg-elev-1)",
      }}
    >
      {/* Toggle header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "10px 20px",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }}>{expanded ? "▾" : "▸"}</span>
        Snapshot history ({metas.length})
      </button>

      {/* Expanded list */}
      {expanded && (
        <div
          style={{
            maxHeight: "200px",
            overflowY: "auto",
            padding: "0 20px 10px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {metas.length === 0 && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>
              No snapshots yet
            </div>
          )}
          {metas.map((m) => (
            <div
              key={m.id}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: m.id === activeId ? "var(--color-text-primary)" : "var(--color-text-muted)",
                padding: "2px 0",
              }}
            >
              #{m.id} · {m.created_at}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
