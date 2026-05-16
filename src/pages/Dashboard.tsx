// DEV-ONLY: temporary snapshot inspector for shape validation.
// Entire file replaced in Step 6.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { Snapshot, SnapshotMeta } from "../types/snapshot";

export default function Dashboard() {
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<Snapshot | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);

  // History list — refetched after every save or delete
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
      qc.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });

  // Load historical snapshot
  const loadMutation = useMutation<Snapshot, string, number>({
    mutationFn: (id) => invoke<Snapshot>("get_snapshot", { id }),
    onSuccess: (snap, id) => {
      setViewing(snap);
      setViewingId(id);
    },
  });

  // Delete
  const deleteMutation = useMutation<void, string, number>({
    mutationFn: (id) => invoke<void>("delete_snapshot", { id }),
    onSuccess: (_, id) => {
      if (viewingId === id) {
        setViewing(null);
        setViewingId(null);
      }
      qc.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });

  const error = takeMutation.error ?? loadMutation.error ?? deleteMutation.error;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      padding: "16px", gap: "12px",
      background: "var(--color-bg-base)", color: "var(--color-text-primary)",
      fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)",
    }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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

        {viewing && (
          <span style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
            id={viewingId} · {viewing.created_at}
            {viewing.partial_failures.length > 0 && (
              <span style={{ color: "var(--color-severity-medium-fg)", marginLeft: "10px" }}>
                {viewing.partial_failures.length} probe failure(s): {viewing.partial_failures.map(f => f.probe).join(", ")}
              </span>
            )}
          </span>
        )}
      </div>

      {error && (
        <div style={{
          color: "var(--color-severity-high-fg)", background: "var(--color-severity-high-bg)",
          padding: "6px 10px", borderRadius: "4px",
          fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
        }}>
          {error}
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
          <div style={{ color: "var(--color-text-disabled)", fontSize: "var(--text-xs)" }}>No snapshots yet</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "120px", overflowY: "auto" }}>
          {historyQuery.data?.map(meta => (
            <div key={meta.id} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "3px 6px", borderRadius: "4px",
              background: meta.id === viewingId ? "var(--color-bg-elev-3)" : "transparent",
            }}>
              <button
                onClick={() => loadMutation.mutate(meta.id)}
                style={{
                  background: "none", border: "none", padding: 0,
                  cursor: "pointer", color: meta.id === viewingId ? "var(--color-text-primary)" : "var(--color-text-secondary)",
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

      {/* JSON viewer */}
      {viewing && (
        <pre style={{
          flex: 1, overflow: "auto",
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
