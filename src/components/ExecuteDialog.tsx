import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import type { Finding } from "../types/finding";

interface ExecutionItem {
  path: string;
  status: string;
  bytes: number;
  error: string | null;
}

interface ExecutionReport {
  items: ExecutionItem[];
  total_bytes_freed: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  findings: Finding[];
  onComplete: (movedPaths: Set<string>) => void;
}

export default function ExecuteDialog({ open, onOpenChange, findings, onComplete }: Props) {
  const [pending, setPending] = useState(false);

  const allPaths = findings.flatMap((f) => f.paths_to_remove ?? []);
  const totalEstimate = findings.reduce((s, f) => s + (f.estimated_bytes_freed ?? 0), 0);

  async function handleConfirm() {
    if (allPaths.length === 0) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    try {
      const report = await invoke<ExecutionReport>("execute_paths", { paths: allPaths });
      const moved = new Set(
        report.items.filter((i) => i.status === "moved").map((i) => i.path)
      );
      const failed = report.items.filter((i) => i.status !== "moved");

      if (report.total_bytes_freed > 0) {
        toast.success(`Moved to Trash — ${formatBytes(report.total_bytes_freed)} freed`);
      } else if (moved.size === 0) {
        toast.error("Nothing was moved — all paths were denied or failed");
      }

      if (failed.length > 0) {
        toast.error(
          `${failed.length} path${failed.length > 1 ? "s" : ""} could not be moved`,
          {
            description: failed.map((i) => `${i.path}: ${i.error ?? i.status}`).join("\n"),
            duration: 8000,
          }
        );
      }

      onComplete(moved);
      onOpenChange(false);
    } catch (e) {
      toast.error(`Execution failed: ${String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move to Trash</AlertDialogTitle>
          <AlertDialogDescription>
            {allPaths.length} path{allPaths.length !== 1 ? "s" : ""} will be moved to Trash
            {totalEstimate > 0 && ` (≈ ${formatBytes(totalEstimate)})`}.
            You can recover them from Trash if needed.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div
          style={{
            maxHeight: "200px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            background: "var(--color-bg-elev-1)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 10px",
            border: "1px solid var(--color-border-subtle)",
          }}
        >
          {allPaths.map((p) => (
            <span
              key={p}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--color-text-secondary)",
                wordBreak: "break-all",
              }}
            >
              {p}
            </span>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={pending}
          >
            {pending ? "Moving…" : "Move to Trash"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
