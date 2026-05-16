// DEV-ONLY: temporary snapshot inspector for shape validation.
// Entire file replaced in Step 6.
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "../types/snapshot";

export default function Dashboard() {
  const mutation = useMutation<Snapshot, string>({
    mutationFn: () => invoke<Snapshot>("take_snapshot"),
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        padding: "20px",
        gap: "12px",
        background: "var(--color-bg-base)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          style={{
            background: mutation.isPending
              ? "var(--color-accent-muted)"
              : "var(--color-accent)",
            color: "var(--color-accent-on)",
            border: "none",
            borderRadius: "6px",
            padding: "8px 16px",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            cursor: mutation.isPending ? "not-allowed" : "pointer",
          }}
        >
          {mutation.isPending ? "Probing…" : "Take snapshot (dev)"}
        </button>

        {mutation.isSuccess && (
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
            {mutation.data.created_at}
            {mutation.data.partial_failures.length > 0 && (
              <span style={{ color: "var(--color-severity-medium-fg)", marginLeft: "12px" }}>
                {mutation.data.partial_failures.length} probe failure(s):{" "}
                {mutation.data.partial_failures.map((f) => f.probe).join(", ")}
              </span>
            )}
          </span>
        )}
      </div>

      {mutation.isError && (
        <div
          style={{
            color: "var(--color-severity-high-fg)",
            background: "var(--color-severity-high-bg)",
            padding: "8px 12px",
            borderRadius: "4px",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
          }}
        >
          Error: {mutation.error}
        </div>
      )}

      {mutation.isSuccess && (
        <pre
          style={{
            flex: 1,
            overflow: "auto",
            background: "var(--color-bg-elev-1)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "6px",
            padding: "16px",
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-primary)",
            lineHeight: "var(--leading-snug)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {JSON.stringify(mutation.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
