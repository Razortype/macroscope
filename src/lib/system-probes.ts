export interface SystemProbe {
  key: string;
  label: string;
  description: string;
  scope: readonly string[];
}

// When adding or removing probes, mirror this list in
// src-tauri/src/snapshot/mod.rs (the tokio::join! block).
export const SYSTEM_PROBE_REGISTRY: readonly SystemProbe[] = [
  {
    key: "disk",
    label: "Disk & storage",
    description:
      "Volume capacity for / and the total size of well-known cache and data locations. Size totals only; per-file detail comes from Large files.",
    scope: [
      "/ (volume stats)",
      "~/Library/Caches",
      "~/Library/Application Support/Notion",
      "~/.cache",
      "~/.npm",
      "~/Library/Containers/com.docker.docker",
      "~/Library/Developer/Xcode/DerivedData",
      "~/Desktop",
      "~/Downloads",
    ],
  },
  {
    key: "processes",
    label: "Running processes",
    description:
      "All processes currently consuming significant memory (≥ 10 MB RSS).",
    scope: ["System-wide (all running processes)"],
  },
  {
    key: "network",
    label: "Network listeners",
    description:
      "All ports accepting inbound connections and active outbound TCP sessions.",
    scope: ["System-wide (all network connections via lsof)"],
  },
  {
    key: "persistence",
    label: "Persistence & login items",
    description:
      "Programs configured to run automatically at login or system boot.",
    scope: [
      "~/Library/LaunchAgents",
      "/Library/LaunchAgents",
      "/Library/LaunchDaemons",
      "Login items (System Events)",
    ],
  },
  {
    key: "users",
    label: "User accounts",
    description: "Local macOS user accounts registered with the system.",
    scope: ["macOS Directory Service (dscl)"],
  },
  {
    key: "kernel",
    label: "Kernel extensions",
    description:
      "Third-party kernel extensions currently loaded into the kernel.",
    scope: ["Loaded kernel state (kmutil showloaded)"],
  },
  {
    key: "apps",
    label: "Installed apps & leftovers",
    description:
      "Installed .app bundles and leftover data in ~/Library from uninstalled apps. Cache directories overlap with Disk — Disk shows totals, this lists orphaned leftovers.",
    scope: [
      "/Applications",
      "~/Applications",
      "~/Library/Application Support",
      "~/Library/Preferences",
      "~/Library/Caches",
    ],
  },
  {
    key: "large_files",
    label: "Large files",
    description:
      "Files ≥ 50 MB in common home folders, grouped by type and recency.",
    scope: ["~/Desktop", "~/Downloads", "~/Documents", "~/Movies"],
  },
] as const;
