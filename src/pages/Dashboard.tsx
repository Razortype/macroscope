import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import type { Finding } from "../types/finding";
import type { PersistenceEntry, Snapshot } from "../types/snapshot";
import { computeServiceTarget } from "../lib/persistence";
import { useAnalysisRun } from "../context/AnalysisRunContext";
import TopBar from "../components/TopBar";
import TabBar, { type TabId } from "../components/TabBar";
import PreviewDialog, { type ExecuteResult } from "../components/PreviewDialog";
import AnalysisProgress from "../components/AnalysisProgress";
import OverviewTab, { type LastAnalysisSummary } from "./tabs/OverviewTab";
import FindingsTab from "./tabs/FindingsTab";
import AppsTab from "./tabs/AppsTab";
import FilesTab from "./tabs/FilesTab";
import SecurityTab from "./tabs/SecurityTab";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

const ALL_PRESETS = ["disk-audit", "security-audit", "app-lifecycle-audit", "file-inventory-audit"];

function buildLastAnalysis(
  data: Finding[],
  startedAt: number | null
): LastAnalysisSummary {
  const now = Date.now();
  return {
    completedAt: now,
    totalDurationMs: now - (startedAt ?? now),
    audits: [
      { preset: "disk-audit", label: "disk", findingCount: data.filter((f) => f.category === "disk").length },
      { preset: "security-audit", label: "security", findingCount: data.filter((f) => ["security", "persistence", "network"].includes(f.category)).length },
      { preset: "app-lifecycle-audit", label: "apps", findingCount: data.filter((f) => f.category === "apps").length },
      { preset: "file-inventory-audit", label: "files", findingCount: data.filter((f) => f.category === "files").length },
    ],
  };
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort((a, b) => {
    const sv = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (sv !== 0) return sv;
    return a.category.localeCompare(b.category);
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();
  const { run, startRun, deactivateRun } = useAnalysisRun();

  const [active, setActive] = useState<TabId>("overview");
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [activeSnapshotId, setActiveSnapshotId] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [executedPaths, setExecutedPaths] = useState<Set<string>>(new Set());
  const [partialPaths, setPartialPaths] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogFindings, setDialogFindings] = useState<Finding[]>([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<LastAnalysisSummary | null>(null);
  const analysisStartedAtRef = useRef<number | null>(null);

  const latestIdQuery = useQuery<number | null>({
    queryKey: ["latest_snapshot_id"],
    queryFn: () => invoke<number | null>("latest_snapshot_id"),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (latestIdQuery.data == null || activeSnapshotId != null) return;
    const id = latestIdQuery.data;
    Promise.all([
      invoke<Snapshot>("get_snapshot", { id }),
      invoke<Finding[]>("get_findings_for_snapshot", { snapshotId: id }),
    ]).then(([snap, found]) => {
      setActiveSnapshot(snap);
      setActiveSnapshotId(id);
      setFindings(sortFindings(found));
    }).catch(() => {});
  }, [latestIdQuery.data, activeSnapshotId]);

  const runFullScan = useMutation<Finding[], string>({
    onMutate: () => {
      startRun();
      analysisStartedAtRef.current = Date.now();
      setFindings(null);
      setSelectedIds(new Set());
      setExecutedPaths(new Set());
      setPartialPaths(new Set());
      setAnalyzeError(null);
    },
    mutationFn: async () => {
      const snap = await invoke<Snapshot>("take_snapshot");
      const id = await invoke<number>("save_snapshot", { snapshot: snap });
      setActiveSnapshot(snap);
      setActiveSnapshotId(id);
      qc.invalidateQueries({ queryKey: ["latest_snapshot_id"] });
      return invoke<Finding[]>("analyze_snapshot", { snapshotId: id, presets: ALL_PRESETS });
    },
    onSuccess: (data) => {
      setFindings(sortFindings(data));
      setLastAnalysis(buildLastAnalysis(data, analysisStartedAtRef.current));
    },
    onError: (err) => { deactivateRun(); setAnalyzeError(err); },
  });

  const reAnalyze = useMutation<Finding[], string>({
    onMutate: () => {
      startRun();
      analysisStartedAtRef.current = Date.now();
      setFindings(null);
      setSelectedIds(new Set());
      setExecutedPaths(new Set());
      setPartialPaths(new Set());
      setAnalyzeError(null);
    },
    mutationFn: async () => {
      if (activeSnapshotId == null) throw new Error("No snapshot loaded");
      return invoke<Finding[]>("analyze_snapshot", { snapshotId: activeSnapshotId, presets: ALL_PRESETS });
    },
    onSuccess: (data) => {
      setFindings(sortFindings(data));
      setLastAnalysis(buildLastAnalysis(data, analysisStartedAtRef.current));
    },
    onError: (err) => { deactivateRun(); setAnalyzeError(err); },
  });

  const isAnalyzing = runFullScan.isPending || reAnalyze.isPending;
  const showingProgress = run.active || isAnalyzing;
  const deleteableFindings = findings?.filter((f) => f.suggested_action === "delete_paths") ?? [];

  // When a run that started while Dashboard was unmounted completes, reload
  // findings from DB. Also fires in the normal case (harmless re-fetch).
  const prevRunActiveRef = useRef(run.active);
  useEffect(() => {
    const wasActive = prevRunActiveRef.current;
    prevRunActiveRef.current = run.active;
    if (wasActive && !run.active && activeSnapshotId != null) {
      invoke<Finding[]>("get_findings_for_snapshot", { snapshotId: activeSnapshotId })
        .then((found) => setFindings(sortFindings(found)))
        .catch(() => {});
    }
  }, [run.active, activeSnapshotId]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedFindings = deleteableFindings.filter((f) => selectedIds.has(f.id));
  const totalBytesToFree = selectedFindings.reduce((sum, f) => sum + (f.estimated_bytes_freed ?? 0), 0);

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
    setSelectedIds((prev) => prev.size === ids.length ? new Set() : new Set(ids));
  }, [findings, deleteableFindings]);

  const handleCleanLeftover = useCallback((paths: string[], name: string, bytes: number) => {
    const stubFinding: Finding = {
      id: `leftover_clean_${name.replace(/\s+/g, "_")}`,
      severity: "medium",
      category: "apps",
      title: `Clean leftover: ${name}`,
      description: `Remove orphaned application data for ${name}.`,
      rationale: "Application is no longer installed.",
      suggested_action: "delete_paths",
      paths_to_remove: paths,
      estimated_bytes_freed: bytes,
    };
    setDialogFindings([stubFinding]);
    setDialogOpen(true);
  }, []);

  const handleFilesExecute = useCallback((paths: string[]) => {
    const totalBytes = (activeSnapshot?.large_files?.files ?? [])
      .filter((f) => paths.includes(f.path))
      .reduce((sum, f) => sum + f.size_bytes, 0);
    const stubFinding: Finding = {
      id: `files_trash_${Date.now()}`,
      severity: totalBytes >= 5_000_000_000 ? "high" : totalBytes >= 1_000_000_000 ? "medium" : "low",
      category: "files",
      title: `Move ${paths.length} file${paths.length !== 1 ? "s" : ""} to trash (${formatBytes(totalBytes)})`,
      description: `Move ${paths.length} selected large file${paths.length !== 1 ? "s" : ""} to the Trash.`,
      rationale: "User-selected files to remove.",
      suggested_action: "delete_paths",
      paths_to_remove: paths,
      estimated_bytes_freed: totalBytes,
    };
    setDialogFindings([stubFinding]);
    setDialogOpen(true);
  }, [activeSnapshot]);

  const handleTogglePersistence = useCallback(
    async (entry: PersistenceEntry, action: "disable" | "enable") => {
      try {
        await invoke("toggle_persistence", {
          label: entry.label,
          serviceTarget: computeServiceTarget(entry),
          action,
          requiresSudo: entry.kind === "system_daemon" || entry.kind === "system_agent",
        });
        // Update only after backend confirms — toggle position reflects real state
        setActiveSnapshot((prev) => {
          if (!prev?.persistence) return prev;
          return {
            ...prev,
            persistence: {
              ...prev.persistence,
              entries: prev.persistence.entries.map((e) =>
                e.label === entry.label ? { ...e, disabled: action === "disable" } : e
              ),
            },
          };
        });
        toast.success(`${entry.label}: ${action}d`);
      } catch (err) {
        toast.error(`Failed to ${action} ${entry.label}: ${String(err)}`);
      }
    },
    []
  );

  const handleExecuteComplete = useCallback(({ moved, partial }: ExecuteResult) => {
    setExecutedPaths((prev) => new Set([...prev, ...moved]));
    setPartialPaths((prev) => new Set([...prev, ...partial]));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const f of deleteableFindings) {
        const allResolved = (f.paths_to_remove ?? []).every((p) => moved.has(p) || partial.has(p));
        if (allResolved) next.delete(f.id);
      }
      return next;
    });
  }, [deleteableFindings]);

  if (latestIdQuery.isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <TopBar />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TopBar
        activeSnapshot={activeSnapshot}
        activeSnapshotId={activeSnapshotId}
        findingCount={findings?.length ?? null}
        isAnalyzing={isAnalyzing}
        onTakeSnapshot={() => runFullScan.mutate()}
        onReAnalyze={() => reAnalyze.mutate()}
      />
      <TabBar
        active={active}
        onChange={setActive}
        counts={{
          findings: findings?.length,
          apps: activeSnapshot?.apps
            ? activeSnapshot.apps.installed.length + activeSnapshot.apps.leftovers.length
            : undefined,
        }}
      />

      <div style={{ flex: 1, overflow: "auto", overflowX: "hidden" }}>
        {showingProgress && (
          <div style={{ padding: "20px 20px 0" }}>
            <AnalysisProgress />
          </div>
        )}
        {analyzeError && (
          <div
            style={{
              margin: "12px 20px 0",
              padding: "8px 12px",
              background: "var(--color-severity-high-bg)",
              color: "var(--color-severity-high-fg)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-xs)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {analyzeError}
          </div>
        )}
        {active === "overview" && (
          <OverviewTab
            latestSnapshot={activeSnapshot}
            findings={findings}
            lastAnalysis={lastAnalysis}
            onJumpToFindings={() => setActive("findings")}
            onJumpToApps={() => setActive("apps")}
            onJumpToFiles={() => setActive("files")}
          />
        )}
        {active === "findings" && (
          <FindingsTab
            findings={findings}
            selectedIds={selectedIds}
            executedPaths={executedPaths}
            partialPaths={partialPaths}
            onToggleSelection={handleSelectChange}
            onSelectAll={handleSelectAll}
            deleteableCount={deleteableFindings.length}
            classifiedLeftovers={activeSnapshot?.apps?.classified_leftovers ?? []}
          />
        )}
        {active === "apps" && (
          <AppsTab
            apps={activeSnapshot?.apps ?? null}
            executedPaths={executedPaths}
            partialPaths={partialPaths}
            onCleanLeftover={handleCleanLeftover}
          />
        )}
        {active === "files" && (
          <FilesTab
            files={activeSnapshot?.large_files?.files ?? []}
            executedPaths={executedPaths}
            partialPaths={partialPaths}
            onExecute={handleFilesExecute}
          />
        )}
        {active === "security" && (
          <SecurityTab
            snapshot={activeSnapshot}
            findings={findings ?? []}
            onTogglePersistence={handleTogglePersistence}
          />
        )}
      </div>

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
            onClick={() => { setDialogFindings(selectedFindings); setDialogOpen(true); }}
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

      <PreviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        findings={dialogFindings}
        snapshotId={activeSnapshotId}
        onComplete={handleExecuteComplete}
      />
    </div>
  );
}
