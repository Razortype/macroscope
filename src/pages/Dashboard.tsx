// DEV-ONLY: temporary inspector for shape validation + analyzer testing.
// Entire file replaced in Step 6.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { Finding, Severity } from "../types/finding";
import type { ClaudeStatus, Snapshot, SnapshotMeta } from "../types/snapshot";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function severityColors(s: Severity): { fg: string; bg: string } {
  return {
    fg: `var(--color-severity-${s}-fg)`,
    bg: `var(--color-severity-${s}-bg)`,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FindingCard({ f }: { f: Finding }) {
  const { fg, bg } = severityColors(f.severity);
  return (
    <div style={{
      background: "var(--color-bg-elev-2)", border: "1px solid var(--color-border-subtle)",
      borderRadius: "6px", padding: "12px", display: "flex", flexDirection: "column", gap: "6px",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{
          background: bg, color: fg, borderRadius: "4px",
          padding: "1px 7px", fontSize: "var(--text-xs)", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.04em",
        }}>
          {f.severity}
        </span>
        <span style={{
          color: "var(--color-text-muted)", fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
        }}>
          {f.category}
        </span>
        <span style={{
          marginLeft: "auto", color: "var(--color-text-disabled)",
          fontSize: "var(--text-xs)",
        }}>
          {f.suggested_action}
        </span>
      </div>

      {/* Title */}
      <div style={{ fontWeight: 500, fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>
        {f.title}
      </div>

      {/* Description */}
      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: "var(--leading-snug)" }}>
        {f.description}
      </div>

      {/* Rationale */}
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        color: "var(--color-text-muted)", lineHeight: "var(--leading-snug)",
        borderLeft: "2px solid var(--color-border-subtle)", paddingLeft: "8px",
      }}>
        {f.rationale}
      </div>

      {/* Paths to remove */}
      {f.paths_to_remove && f.paths_to_remove.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {f.paths_to_remove.map(p => (
            <div key={p} style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              color: "var(--color-severity-high-fg)", background: "var(--color-severity-high-bg)",
              borderRadius: "3px", padding: "2px 6px",
            }}>
              {p}
            </div>
          ))}
          {f.estimated_bytes_freed != null && (
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              color: "var(--color-status-ok)", marginTop: "2px",
            }}>
              ↑ {formatBytes(f.estimated_bytes_freed)} freed
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<Snapshot | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  // Claude status — fetched once on mount
  const claudeQuery = useQuery<ClaudeStatus>({
    queryKey: ["claude_status"],
    queryFn: () => invoke<ClaudeStatus>("get_claude_status"),
    staleTime: Infinity,
  });
  const claudeStatus = claudeQuery.data;

  // History list
  const historyQuery = useQuery<SnapshotMeta[]>({
    queryKey: ["snapshots"],
    queryFn: () => invoke<SnapshotMeta[]>("list_snapshots"),
  });

  // Take + auto-save
  const takeMutation = useMutation<Snapshot, string>({
    mutationFn: () => invoke<Snapshot>("take_snapshot"),
    onSuccess: async (snap) => {
      const id = await invoke<number>("save_snapshot", { snapshot: snap });
      setViewing(snap);
      setViewingId(id);
      setFindings(null);
      qc.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });

  // Load historical snapshot
  const loadMutation = useMutation<Snapshot, string, number>({
    mutationFn: (id) => invoke<Snapshot>("get_snapshot", { id }),
    onSuccess: (snap, id) => {
      setViewing(snap);
      setViewingId(id);
      setFindings(null);
    },
  });

  // Delete
  const deleteMutation = useMutation<void, string, number>({
    mutationFn: (id) => invoke<void>("delete_snapshot", { id }),
    onSuccess: (_, id) => {
      if (viewingId === id) { setViewing(null); setViewingId(null); setFindings(null); }
      qc.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });

  // Analyze — variable is the preset string
  const analyzeMutation = useMutation<Finding[], string, string>({
    mutationFn: (preset) =>
      invoke<Finding[]>("analyze_snapshot", { snapshotId: viewingId, preset }),
    onSuccess: (data) => setFindings(data),
  });

  const canAnalyze = viewing !== null && claudeStatus?.available === true && !analyzeMutation.isPending;
  const snapshotError = takeMutation.error ?? loadMutation.error ?? deleteMutation.error;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      padding: "16px", gap: "10px",
      background: "var(--color-bg-base)", color: "var(--color-text-primary)",
      fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", overflowY: "auto",
    }}>

      {/* Claude unavailable banner */}
      {claudeStatus && !claudeStatus.available && (
        <div style={{
          background: "var(--color-severity-medium-bg)", color: "var(--color-severity-medium-fg)",
          border: "1px solid var(--color-severity-medium-bg)", borderRadius: "6px",
          padding: "8px 12px", fontSize: "var(--text-xs)",
        }}>
          Claude CLI unavailable: {claudeStatus.error} — Configure Claude CLI in Settings
        </div>
      )}

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={() => takeMutation.mutate()}
          disabled={takeMutation.isPending}
          style={{
            background: takeMutation.isPending ? "var(--color-accent-muted)" : "var(--color-accent)",
            color: "var(--color-accent-on)", border: "none", borderRadius: "6px",
            padding: "7px 14px", fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
            fontWeight: 500, cursor: takeMutation.isPending ? "not-allowed" : "pointer",
          }}
        >
          {takeMutation.isPending ? "Probing…" : "Take snapshot (dev)"}
        </button>

        <button
          onClick={() => analyzeMutation.mutate("disk-audit")}
          disabled={!canAnalyze}
          style={{
            background: "var(--color-bg-elev-2)", color: canAnalyze ? "var(--color-text-primary)" : "var(--color-text-disabled)",
            border: "1px solid var(--color-border-subtle)", borderRadius: "6px",
            padding: "7px 12px", fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
            cursor: canAnalyze ? "pointer" : "not-allowed",
          }}
        >
          Disk audit
        </button>

        <button
          onClick={() => analyzeMutation.mutate("security-audit")}
          disabled={!canAnalyze}
          style={{
            background: "var(--color-bg-elev-2)", color: canAnalyze ? "var(--color-text-primary)" : "var(--color-text-disabled)",
            border: "1px solid var(--color-border-subtle)", borderRadius: "6px",
            padding: "7px 12px", fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
            cursor: canAnalyze ? "pointer" : "not-allowed",
          }}
        >
          Security audit
        </button>

        {viewing && (
          <span style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
            id={viewingId} · {viewing.created_at}
            {viewing.partial_failures.length > 0 && (
              <span style={{ color: "var(--color-severity-medium-fg)", marginLeft: "8px" }}>
                {viewing.partial_failures.length} probe failure(s):{" "}
                {viewing.partial_failures.map(f => f.probe).join(", ")}
              </span>
            )}
          </span>
        )}

        {analyzeMutation.isPending && (
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
            Analyzing… (this may take 30–90 seconds)
          </span>
        )}
      </div>

      {/* Snapshot errors */}
      {snapshotError && (
        <div style={{
          color: "var(--color-severity-high-fg)", background: "var(--color-severity-high-bg)",
          padding: "6px 10px", borderRadius: "4px",
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        }}>
          {snapshotError}
        </div>
      )}

      {/* Analyze error */}
      {analyzeMutation.isError && (
        <div style={{
          color: "var(--color-severity-high-fg)", background: "var(--color-severity-high-bg)",
          padding: "6px 10px", borderRadius: "4px",
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        }}>
          Analysis failed: {analyzeMutation.error}
        </div>
      )}

      {/* History panel */}
      <div style={{
        background: "var(--color-bg-elev-1)", border: "1px solid var(--color-border-subtle)",
        borderRadius: "6px", padding: "10px", flexShrink: 0,
      }}>
        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)", marginBottom: "6px" }}>
          History ({historyQuery.data?.length ?? 0} snapshots)
        </div>
        {historyQuery.data?.length === 0 && (
          <div style={{ color: "var(--color-text-disabled)", fontSize: "var(--text-xs)" }}>
            No snapshots yet
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "110px", overflowY: "auto" }}>
          {historyQuery.data?.map(meta => (
            <div key={meta.id} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "3px 6px", borderRadius: "4px",
              background: meta.id === viewingId ? "var(--color-bg-elev-3)" : "transparent",
            }}>
              <button
                onClick={() => loadMutation.mutate(meta.id)}
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  color: meta.id === viewingId ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", textAlign: "left",
                }}
              >
                #{meta.id} · {meta.created_at}
              </button>
              <button
                onClick={() => deleteMutation.mutate(meta.id)}
                style={{
                  background: "none", border: "none", padding: 0,
                  cursor: "pointer", color: "var(--color-text-disabled)",
                  fontSize: "var(--text-xs)", marginLeft: "auto",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Findings section */}
      {findings !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
            Findings ({findings.length})
          </div>
          {findings.length === 0 ? (
            <div style={{
              color: "var(--color-status-ok)", fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)", padding: "10px",
              background: "var(--color-bg-elev-1)", border: "1px solid var(--color-border-subtle)",
              borderRadius: "6px",
            }}>
              No findings — system looks clean
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {findings.map(f => <FindingCard key={f.id} f={f} />)}
            </div>
          )}
        </div>
      )}

      {/* JSON viewer */}
      {viewing && (
        <pre style={{
          overflow: "auto", minHeight: "200px",
          background: "var(--color-bg-elev-1)", border: "1px solid var(--color-border-subtle)",
          borderRadius: "6px", padding: "14px", margin: 0,
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
          color: "var(--color-text-primary)", lineHeight: "var(--leading-snug)",
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {JSON.stringify(viewing, null, 2)}
        </pre>
      )}
    </div>
  );
}
