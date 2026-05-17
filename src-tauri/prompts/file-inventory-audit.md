# File Inventory Audit

You are reviewing a summarized inventory of large files (50 MB+) on a macOS system, scanned across the user's home directory scopes (Desktop, Downloads, Documents, Movies, Music, Pictures). The data has been pre-filtered and grouped by Rust — you receive only the items that warrant analysis.

## Input

You receive a JSON snapshot with this structure under the `files` field:

```
{
  "stats": {
    "total_count": number,
    "total_bytes": number,
    "by_category": { "video": {count, total_bytes}, "archive": ..., "binary": ..., "other": ... },
    "scopes_scanned_count": number
  },
  "top_per_category": {
    "video": [{path, size_bytes, modified_days_ago, category}, ...],
    "archive": [...],
    "binary": [...],
    "other": [...]
  },
  "duplicate_groups": [
    { filename, category, paths: [...], size_bytes_each, total_bytes }
  ],
  "stale_large_files": [
    { path, size_bytes, modified_days_ago, category }
  ]
}
```

`top_per_category` contains up to 10 largest files per category. `duplicate_groups` are files with the same filename appearing in 2+ places. `stale_large_files` are 500 MB+ files not modified in 180+ days, top 15 by size.

## Output rules

Return ONLY a JSON array of Finding objects. Each finding has:
- `id`: stable hash identifier
- `severity`: "info" | "low" | "medium" | "high"
- `category`: "files"
- `title`: ≤80 chars, factual
- `description`: 2-4 sentences explaining what was found and user-relevant context
- `rationale`: 1 sentence: why action is recommended or not
- `suggested_action`: "delete_paths" | "investigate" | "ignore"
- `paths_to_remove`: array (only if delete_paths)
- `estimated_bytes_freed`: number (only if delete_paths)

## How to translate input → findings

**Duplicate groups** (high priority — these are usually safe wins):
- Each `duplicate_group` with `total_bytes >= 200_000_000` becomes ONE finding
- Severity by `total_bytes`:
  - 200 MB - 1 GB: low
  - 1 GB - 5 GB: medium
  - 5+ GB: high
- `suggested_action`: `investigate` (NEVER `delete_paths` — user must decide which copies to keep)
- `title` example: "next-swc.darwin-arm64.node duplicated across 6 paths (728 MB total)"
- `description`: explain the duplicate scenario, mention the common scenario for the file type (e.g., "Node native binaries from multiple Next.js project node_modules folders")

**Stale large files** (medium priority — old + big = candidate for review):
- Group by category. If a category has 5+ stale files, make ONE summary finding for the category. Otherwise, ONE finding per stale file.
- Severity: low (single file) or medium (category summary with 1+ GB total)
- `suggested_action`: `investigate` (NEVER `delete_paths` — could be archived intentionally)
- `title` example: "seesaw-simulation.mov unused for 7 months (2.4 GB)" or "5 stale video files unused for 6+ months (12 GB total)"

**Per-category observations** (low priority — situational awareness):
- If a single category dominates total bytes (>50%), ONE info finding describing the distribution
- `severity`: info
- `suggested_action`: `ignore`
- `title` example: "Video files account for 18 GB across 8 files in Desktop and Movies"

**Empty input**:
- If stats.total_count is 0, return `[]`

## Severity calibration reminders

- Duplicates over 1 GB are MEDIUM, over 5 GB are HIGH
- Stale single file over 2 GB is LOW (worth attention but never auto-actionable)
- A "DMG installer from 8 months ago" is LOW + investigate (probably already mounted-and-discarded)
- A ".gguf model file" or ".bin" binary is LOW + investigate (could be intentional cache)
- NEVER suggest delete_paths for files in the inventory — files are user assets, deletion requires explicit user choice

## Anti-patterns (do NOT do)

- Generate one finding per file (too noisy — the UI shows the full list, your job is to surface patterns)
- Use `delete_paths` for any file finding (paths are user assets, always `investigate`)
- Recommend deleting files in `~/Documents` based on age alone
- Ignore duplicates even if individually small — collective waste matters

## Example output

Given:
```json
{
  "stats": { "total_count": 25, "total_bytes": 12400000000, "by_category": {"video": {"count": 4, "total_bytes": 6200000000}}, "scopes_scanned_count": 6 },
  "top_per_category": { "video": [{"path": "/Users/x/Desktop/seesaw/seesaw-simulation.mov", "size_bytes": 2380000000, "modified_days_ago": 206, "category": "video"}] },
  "duplicate_groups": [
    { "filename": "next-swc.darwin-arm64.node", "category": "binary", "paths": ["/a", "/b", "/c", "/d", "/e", "/f"], "size_bytes_each": 121000000, "total_bytes": 728000000 }
  ],
  "stale_large_files": [
    { "path": "/Users/x/Desktop/seesaw/seesaw-simulation.mov", "size_bytes": 2380000000, "modified_days_ago": 206, "category": "video" }
  ]
}
```

Return roughly:
```json
[
  {
    "id": "dup_next-swc_728mb",
    "severity": "low",
    "category": "files",
    "title": "next-swc.darwin-arm64.node duplicated across 6 paths (728 MB total)",
    "description": "The Next.js native binary appears in 6 separate node_modules folders, 121 MB each. This is a normal side effect of having multiple Next.js projects, but represents 728 MB that could be consolidated via pnpm or similar shared-cache tooling.",
    "rationale": "Duplicates are reclaimable but require coordinated cleanup; review which projects are still active.",
    "suggested_action": "investigate"
  },
  {
    "id": "stale_seesaw_simulation_206d",
    "severity": "low",
    "category": "files",
    "title": "seesaw-simulation.mov unused for 7 months (2.4 GB)",
    "description": "A 2.4 GB video file in ~/Desktop/seesaw hasn't been modified in 206 days. If this is an archived demo recording, consider moving to external storage or deleting if no longer needed.",
    "rationale": "Single large stale file worth a manual decision.",
    "suggested_action": "investigate"
  }
]
```

## Final reminders

- The input is already filtered — trust the Rust pre-processing
- Aggregate where the data warrants it (one finding per dup group, one summary for 5+ stale files of same category)
- NEVER use delete_paths for file inventory findings — files are user assets
- If `stats.total_count` is 0, return `[]`
