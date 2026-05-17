// Mirror of src-tauri/src/snapshot/*.rs structs.
// Field names are snake_case — Rust serde default, no rename_all applied.
// Option<T> → T | null
// Result<Vec<String>, String> → { Ok: string[] } | { Err: string }
//   (serde_json default for Result: tagged enum with "Ok"/"Err" keys)
// DateTime<Utc> → ISO 8601 string e.g. "2025-11-20T14:32:01.123456Z"

export interface SnapshotMeta {
  id: number;
  created_at: string; // ISO 8601 UTC
}

export interface ProbeFailure {
  probe: string;
  message: string;
}

export interface VolumeStats {
  mount: string;
  size_bytes: number;
  used_bytes: number;
  available_bytes: number;
  capacity_pct: number;
}

export interface PathSize {
  path: string;
  size_bytes: number;
  exists: boolean;
}

export interface DiskReport {
  volume: VolumeStats;
  watched_paths: PathSize[];
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  rss_bytes: number;
  command: string;
  etime: string;
}

export interface ListeningPort {
  pid: number;
  process: string;
  protocol: string;
  address: string;
  port: number;
}

export interface Connection {
  pid: number;
  process: string;
  protocol: string;
  local: string;
  remote: string;
  state: string;
}

export interface NetworkReport {
  listening: ListeningPort[];
  established: Connection[];
}

export interface PlistEntry {
  path: string;
  filename: string;
  modified_at: string | null; // ISO 8601 or null
  size_bytes: number;
}

// serde_json serializes Result<Vec<String>, String> as:
//   { "Ok": ["item1", "item2"] }  — when Automation permission is granted
//   { "Err": "Automation permission required..." }  — when TCC denies
export type LoginItemsResult = { Ok: string[] } | { Err: string };

export type PersistenceKind =
  | "user_agent"
  | "user_daemon"
  | "system_daemon"
  | "system_agent"
  | "login_item";

export interface PersistenceEntry {
  label: string;
  path: string;
  kind: PersistenceKind;
  program: string | null;
  disabled: boolean;
  source: string | null;
}

export interface PersistenceReport {
  launch_agents_user: PlistEntry[];
  launch_agents_system: PlistEntry[];
  launch_daemons: PlistEntry[];
  login_items: LoginItemsResult;
  entries: PersistenceEntry[];
}

export interface UserAccount {
  username: string;
  uid: number;
  home_dir: string;
  real_name: string | null;
}

export interface KernelExtension {
  bundle_id: string;
  version: string;
  refs: number;
}

export interface KernelReport {
  extensions: KernelExtension[];
}

export interface InstalledApp {
  name: string;
  bundle_id: string | null;
  path: string;
  size_bytes: number;
  last_opened_days_ago: number | null;
}

export interface LeftoverDir {
  path: string;
  size_bytes: number;
  matched_app_name: string | null;
}

// Mirrors identity::target_resolver types.
export type ActionClass =
  | { type: "safe_orphan" }
  | { type: "companion_running"; app_display: string; app_bundle_id: string }
  | { type: "companion_not_running"; app_display: string; app_bundle_id: string }
  | { type: "system_managed" }
  | { type: "ambiguous"; pattern_hint: string }
  | { type: "protected" };

export interface ResolvedTarget {
  path: string;
  size_bytes: number;
  action_class: ActionClass;
  display_label: string;
}

// Mirrors identity::LeftoverStatus — internally-tagged serde enum.
export type LeftoverStatus =
  | { type: "orphaned" }
  | { type: "companion"; belongs_to_bundle_id: string; belongs_to_display_name: string }
  | { type: "system_managed" }
  | { type: "ambiguous"; pattern_hint: string };

export interface ClassifiedLeftover {
  path: string;
  dir_name: string;
  size_bytes: number;
  status: LeftoverStatus;
}

export interface AppsSnapshot {
  installed: InstalledApp[];
  /** Legacy: orphaned-only leftovers. Present in all snapshots for backward compat. */
  leftovers: LeftoverDir[];
  /** Identity-classified full leftover list. Empty array for snapshots pre-dating this field. */
  classified_leftovers: ClassifiedLeftover[];
}

export interface LargeFile {
  path: string;
  size_bytes: number;
  modified_days_ago: number;
  category: "video" | "archive" | "binary" | "other";
}

export interface LargeFilesSnapshot {
  files: LargeFile[];
  scopes_scanned: string[];
  partial_failures: string[];
}

export interface Snapshot {
  created_at: string;           // ISO 8601 UTC
  disk: DiskReport | null;
  processes: ProcessInfo[] | null;
  network: NetworkReport | null;
  persistence: PersistenceReport | null;
  users: UserAccount[] | null;
  kernel: KernelReport | null;
  apps: AppsSnapshot | null;
  large_files: LargeFilesSnapshot | null;
  partial_failures: ProbeFailure[]; // always an array, never null
  executed_paths: string[];
  partial_paths: string[];
}

// Mirror of src-tauri/src/analyzer.rs::ClaudeStatus
export interface ClaudeStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}
