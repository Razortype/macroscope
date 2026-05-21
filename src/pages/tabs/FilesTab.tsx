import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { LargeFile } from "../../types/snapshot";
import RowActions from "../../components/RowActions";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function formatRelativeDays(days: number): string {
  // i18n-deferred: replace with Intl.RelativeTimeFormat keyed off locale
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 60) return "last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function pathBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

function badgeText(file: LargeFile): string {
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  if (["mov", "mp4", "mkv", "webm", "avi", "m4v"].includes(ext)) return "VIDEO";
  if (ext === "dmg") return "DMG";
  if (ext === "iso") return "ISO";
  if (["gguf", "safetensors", "onnx", "pb", "h5", "ckpt", "pt", "pth"].includes(ext)) return "MODEL";
  if (ext === "node") return "NODE";
  if (ext === "bin") return "BINARY";
  if (["zip", "tar", "gz", "bz2", "xz", "7z", "rar"].includes(ext)) return "ARCHIVE";
  return "OTHER";
}

function badgeStyle(file: LargeFile, dimmed: boolean): React.CSSProperties {
  const text = badgeText(file);
  const isVideo = text === "VIDEO";
  return {
    display: "inline-block",
    padding: "1px 5px",
    borderRadius: "var(--radius-xs)",
    fontSize: "9px",
    fontWeight: 600,
    letterSpacing: "0.06em",
    fontFamily: "var(--font-mono)",
    background: isVideo ? "rgba(59, 130, 246, 0.15)" : "var(--color-bg-elev-3)",
    color: isVideo ? "rgb(147, 197, 253)" : "var(--color-text-muted)",
    opacity: dimmed ? 0.5 : 1,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterCategory = "all" | "video" | "archive" | "binary" | "other";
type SortBy = "path" | "age" | "size";
type SortDir = "asc" | "desc";

interface FilesTabProps {
  files: LargeFile[];
  executedPaths: Set<string>;
  partialPaths: Set<string>;
  onExecute: (paths: string[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FilesTab({ files, executedPaths, partialPaths, onExecute }: FilesTabProps) {
  const { t } = useTranslation("tabs");
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [sortBy, setSortBy] = useState<SortBy>("size");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Auto-clear executed paths from selection
  useEffect(() => {
    if (executedPaths.size === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const p of executedPaths) {
        if (next.has(p)) { next.delete(p); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [executedPaths]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, { count: number; bytes: number }> = {
      video: { count: 0, bytes: 0 },
      archive: { count: 0, bytes: 0 },
      binary: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 },
    };
    for (const f of files) {
      stats[f.category].count++;
      stats[f.category].bytes += f.size_bytes;
    }
    return stats;
  }, [files]);

  const visibleFiles = useMemo(() => {
    let result = filter === "all" ? files : files.filter((f) => f.category === filter);
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "size") cmp = a.size_bytes - b.size_bytes;
      else if (sortBy === "age") cmp = a.modified_days_ago - b.modified_days_ago;
      else cmp = a.path.localeCompare(b.path);
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [files, filter, sortBy, sortDir]);

  const totalSelectedBytes = useMemo(() => {
    return files.filter((f) => selected.has(f.path)).reduce((sum, f) => sum + f.size_bytes, 0);
  }, [files, selected]);

  const handleSort = useCallback(
    (col: SortBy) => {
      if (sortBy === col) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortBy(col);
        setSortDir("desc");
      }
    },
    [sortBy]
  );

  const handleToggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const handleExecute = useCallback(() => {
    if (selected.size === 0) return;
    onExecute(Array.from(selected));
  }, [selected, onExecute]);

  if (files.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 20px",
          gap: "8px",
          color: "var(--color-text-muted)",
        }}
      >
        <span style={{ fontSize: "24px" }}>📁</span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          {t("files_tab.empty_title")}
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          {t("files_tab.empty_hint")}
        </span>
      </div>
    );
  }

  const sortArrow = (col: SortBy) =>
    sortBy === col ? (sortDir === "desc" ? " ↓" : " ↑") : " ⇅";

  const filterChipStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--color-accent)" : "var(--color-bg-elev-2)",
    color: active ? "var(--color-accent-on)" : "var(--color-text-secondary)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "4px 10px",
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  });

  const formatCategoryLabel = (cat: string) => {
    const s = categoryStats[cat];
    if (!s || s.count === 0) return `${cat} 0`;
    return t("files_tab.filter_category", { cat, count: s.count, bytes: formatBytes(s.bytes) });
  };

  const GRID = "32px minmax(0,1fr) 110px 100px 70px 28px";

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Filter chips + action row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <button style={filterChipStyle(filter === "all")} onClick={() => setFilter("all")}>
          {t("files_tab.filter_all", { count: files.length })}
        </button>
        {(["video", "archive", "binary", "other"] as const).map((cat) => (
          <button
            key={cat}
            style={filterChipStyle(filter === cat)}
            onClick={() => setFilter(cat)}
          >
            {formatCategoryLabel(cat)}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {selected.size > 0 && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--color-text-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {t("files_tab.selected_summary", { count: selected.size, bytes: formatBytes(totalSelectedBytes) })}
          </span>
        )}
        <button
          onClick={handleExecute}
          disabled={selected.size === 0}
          style={{
            background: selected.size > 0 ? "var(--color-severity-medium-fg)" : "var(--color-bg-elev-3)",
            color: selected.size > 0 ? "#fff" : "var(--color-text-muted)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "5px 12px",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            cursor: selected.size > 0 ? "pointer" : "default",
            whiteSpace: "nowrap",
            opacity: selected.size > 0 ? 1 : 0.5,
          }}
        >
          {t("files_tab.move_to_trash")}
        </button>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: "8px",
          padding: "0 4px",
          alignItems: "center",
        }}
      >
        <div />
        <button
          onClick={() => handleSort("path")}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: sortBy === "path" ? "var(--color-text-secondary)" : "var(--color-text-muted)",
          }}
        >
          {t("files_tab.col_path")}{sortArrow("path")}
        </button>
        <button
          onClick={() => handleSort("age")}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: sortBy === "age" ? "var(--color-text-secondary)" : "var(--color-text-muted)",
          }}
        >
          {t("files_tab.col_last_modified")}{sortArrow("age")}
        </button>
        <button
          onClick={() => handleSort("size")}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "right",
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: sortBy === "size" ? "var(--color-text-secondary)" : "var(--color-text-muted)",
          }}
        >
          {t("files_tab.col_size")}{sortArrow("size")}
        </button>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          {t("files_tab.col_cat")}
        </div>
        <div />
      </div>

      {/* File rows */}
      <div
        style={{
          background: "var(--color-bg-elev-1)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "6px",
          overflow: "hidden",
        }}
      >
        {visibleFiles.map((file, i) => {
          const isSelected = selected.has(file.path);
          const isExecuted = executedPaths.has(file.path);
          const isPartial = partialPaths.has(file.path);
          const isDimmed = isExecuted || isPartial;
          const isLast = i === visibleFiles.length - 1;
          const isBigFile = file.size_bytes >= 1_000_000_000;

          return (
            <div
              key={file.path}
              onClick={() => { if (!isExecuted) handleToggle(file.path); }}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: "8px",
                padding: "8px 12px",
                alignItems: "center",
                borderBottom: isLast ? "none" : "1px solid var(--color-border-divider)",
                background: isSelected ? "rgba(245,158,11, 0.08)" : "transparent",
                cursor: isExecuted ? "default" : "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isSelected && !isExecuted) (e.currentTarget as HTMLElement).style.background = "var(--color-bg-elev-2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = isSelected
                  ? "rgba(245,158,11, 0.08)"
                  : "transparent";
              }}
            >
              {/* Checkbox / Check icon */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isExecuted ? (
                  <Check size={14} color="var(--color-severity-low-fg)" />
                ) : (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggle(file.path)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: "pointer", accentColor: "var(--color-accent)", width: "14px", height: "14px" }}
                  />
                )}
              </div>

              {/* Path block */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: isDimmed ? "line-through" : "none",
                    opacity: isDimmed ? 0.4 : 1,
                  }}
                >
                  {pathBasename(file.path)}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textDecoration: isDimmed ? "line-through" : "none",
                        opacity: isDimmed ? 0.4 : 1,
                        cursor: "default",
                      }}
                    >
                      {file.path}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>{file.path}</span>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Last modified */}
              <div
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-muted)",
                  opacity: isDimmed ? 0.4 : 1,
                }}
              >
                {formatRelativeDays(file.modified_days_ago)}
              </div>

              {/* Size */}
              <div
                style={{
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                  color: isBigFile ? "var(--color-severity-medium-fg)" : "var(--color-text-primary)",
                  textAlign: "right",
                  opacity: isDimmed ? 0.4 : 1,
                }}
              >
                {formatBytes(file.size_bytes)}
              </div>

              {/* Category badge / executed badge */}
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                {!isDimmed && (
                  <span style={badgeStyle(file, false)}>{badgeText(file)}</span>
                )}
                {isExecuted && !isPartial && (
                  <span
                    style={{
                      background: "rgba(105,211,176,0.15)",
                      color: "var(--color-severity-low-fg)",
                      fontSize: "9px",
                      padding: "2px 6px",
                      borderRadius: "3px",
                      letterSpacing: "0.06em",
                      fontWeight: 500,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {t("files_tab.badge_moved")}
                  </span>
                )}
                {isPartial && (
                  <span
                    style={{
                      background: "rgba(245,166,35,0.15)",
                      color: "var(--color-severity-medium-fg)",
                      fontSize: "9px",
                      padding: "2px 6px",
                      borderRadius: "3px",
                      letterSpacing: "0.06em",
                      fontWeight: 500,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {t("files_tab.badge_partial")}
                  </span>
                )}
              </div>

              {/* Row actions */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <RowActions path={file.path} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
