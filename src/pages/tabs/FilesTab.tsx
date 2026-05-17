import { useState, useMemo, useCallback } from "react";
import type { LargeFile } from "../../types/snapshot";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function formatRelativeDays(days: number): string {
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

function badgeStyle(file: LargeFile): React.CSSProperties {
  const text = badgeText(file);
  const isVideo = ["VIDEO"].includes(text);
  return {
    display: "inline-block",
    padding: "1px 5px",
    borderRadius: "var(--radius-xs)",
    fontSize: "9px",
    fontWeight: 600,
    letterSpacing: "0.06em",
    fontFamily: "var(--font-mono)",
    background: isVideo
      ? "rgba(59, 130, 246, 0.15)"
      : "var(--color-bg-elev-3)",
    color: isVideo
      ? "rgb(147, 197, 253)"
      : "var(--color-text-muted)",
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterCategory = "all" | "video" | "archive" | "binary" | "other";
type SortBy = "path" | "age" | "size";
type SortDir = "asc" | "desc";

interface FilesTabProps {
  files: LargeFile[];
  onExecute: (paths: string[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FilesTab({ files, onExecute }: FilesTabProps) {
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [sortBy, setSortBy] = useState<SortBy>("size");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
          No large files detected ✓
        </span>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          Run a snapshot to scan ~/Desktop, ~/Downloads, ~/Documents, ~/Movies, ~/Music, ~/Pictures
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
    return `${cat} ${s.count} · ${formatBytes(s.bytes)}`;
  };

  const GRID = "32px minmax(0,1fr) 110px 100px 70px";

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Filter chips + action row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <button style={filterChipStyle(filter === "all")} onClick={() => setFilter("all")}>
          all {files.length}
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
            {selected.size} selected · {formatBytes(totalSelectedBytes)}
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
          move selected to trash
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
          path{sortArrow("path")}
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
          last modified{sortArrow("age")}
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
          size{sortArrow("size")}
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
          cat
        </div>
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
          const isLast = i === visibleFiles.length - 1;
          const isBigFile = file.size_bytes >= 1_000_000_000;

          return (
            <div
              key={file.path}
              onClick={() => handleToggle(file.path)}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: "8px",
                padding: "8px 12px",
                alignItems: "center",
                borderBottom: isLast ? "none" : "1px solid var(--color-border-divider)",
                background: isSelected ? "rgba(var(--color-accent-rgb, 245,158,11), 0.08)" : "transparent",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--color-bg-elev-2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = isSelected
                  ? "rgba(245,158,11, 0.08)"
                  : "transparent";
              }}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleToggle(file.path)}
                onClick={(e) => e.stopPropagation()}
                style={{ cursor: "pointer", accentColor: "var(--color-accent)", width: "14px", height: "14px" }}
              />

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
                  }}
                >
                  {pathBasename(file.path)}
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {file.path}
                </div>
              </div>

              {/* Last modified */}
              <div
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-muted)",
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
                }}
              >
                {formatBytes(file.size_bytes)}
              </div>

              {/* Category badge */}
              <div>
                <span style={badgeStyle(file)}>{badgeText(file)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
