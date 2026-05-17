use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use chrono::Utc;
use globset::{GlobBuilder, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use trash::macos::{DeleteMethod, TrashContextExtMacos};

use crate::analyzer::expand_tilde;
use crate::db::Db;
use crate::error::AppError;

// Use NSFileManager instead of the default osascript/Finder method.
// The Finder method sends Apple Events which can fail with -10010 (errAEWrongDataType)
// for paths containing spaces, dots, or other characters on macOS Sequoia+.
fn trash_ctx() -> trash::TrashContext {
    let mut ctx = trash::TrashContext::default();
    ctx.set_delete_method(DeleteMethod::NsFileManager);
    ctx
}

// ── Output types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionItem {
    pub path: String,
    pub status: String, // "moved" | "denied" | "failed"
    pub bytes: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReport {
    pub items: Vec<ExecutionItem>,
    pub total_bytes_freed: u64,
}

// ── Allowlist and deny list ───────────────────────────────────────────────────

// Exact-prefix allowlist: a path is allowed if it starts with one of these
// (after tilde expansion). Order is irrelevant; deny list is checked first.
const ALLOWED_PREFIXES: &[&str] = &[
    "~/.cache/",
    "~/.npm/",
    "~/Library/Caches/",
    "~/Library/Application Support/",
    "~/Library/Preferences/",
    "~/Library/Developer/Xcode/DerivedData/",
    "~/Library/Developer/CoreSimulator/Caches/",
    "~/Library/Logs/",
    "~/Desktop/",
    "~/Downloads/",
    "~/Movies/",
    "~/Music/",
    "~/Pictures/",
];

// Static glob patterns not tied to any project root.
const STATIC_ALLOWED_GLOBS: &[&str] = &[
    "~/.cache/huggingface/hub/models--*",
];

// Build artifact directory names applied per configured project root via resolve_all_globs.
pub const BUILD_ARTIFACT_GLOBS: &[&str] = &[
    "node_modules", ".next", ".nuxt", ".svelte-kit",
    "target", "build", "dist", "out",
    "__pycache__", ".venv", ".pytest_cache", ".mypy_cache",
    ".gradle", "Pods",
];

/// Returns all effective glob patterns: static globs plus one pattern per (project_root, artifact)
/// pair. Project-root patterns are already absolute; static ones use `~/` and are expanded later.
pub fn resolve_all_globs(project_roots: &[PathBuf]) -> Vec<String> {
    let mut result: Vec<String> = STATIC_ALLOWED_GLOBS.iter().map(|s| s.to_string()).collect();
    for root in project_roots {
        let root_str = root.display().to_string();
        let root_str = root_str.trim_end_matches('/');
        for &suffix in BUILD_ARTIFACT_GLOBS {
            result.push(format!("{root_str}/*/{suffix}"));
        }
    }
    result
}

/// Reads project_roots from DB settings (stored as a JSON array of path strings).
pub fn load_project_roots(db: &Db) -> Vec<PathBuf> {
    db.get_setting("project_roots")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|s| expand_tilde(&s))
        .collect()
}

// Hard deny: these prefixes are NEVER allowed regardless of the allowlist above.
// These are checked before the allowlist.
const DENIED_PREFIXES: &[&str] = &[
    "~/Documents/",
    "~/Library/Mobile Documents/",
    "/System/",
    "/Library/",
    "/usr/",
    "/bin/",
    "/sbin/",
];

// The root "/" itself is also denied (guards against empty-string expansion).
const DENIED_EXACT: &[&str] = &["/"];

// Directories where the directory itself can't be trashed atomically but each
// child can be attempted independently.  Finder/system daemons lock individual
// com.apple.* subdirs inside ~/Library/Caches; expanding lets us recover the
// non-locked subset rather than failing the whole operation.
const EXPAND_ON_EXECUTION: &[&str] = &[
    "~/Library/Caches/",
    "~/Library/Logs/",
];

// ── Path validation ───────────────────────────────────────────────────────────

/// Validate that `path` is safe to move to Trash.
/// Returns the expanded, canonical PathBuf on success.
/// Returns `AppError::PathNotAllowed` if the path fails any check.
pub fn check_path(path: &str, project_roots: &[PathBuf]) -> Result<PathBuf, AppError> {
    let expanded = expand_tilde(path);
    let expanded_str = expanded.display().to_string();

    // 1. Hard deny (checked before everything else)
    for prefix in DENIED_EXACT {
        if expanded_str == *prefix {
            return Err(AppError::PathNotAllowed(format!(
                "{path}: matches hard-deny exact rule ({})",
                prefix
            )));
        }
    }
    // Expand deny prefixes (they may contain ~)
    for raw_prefix in DENIED_PREFIXES {
        let denied = expand_tilde(raw_prefix);
        if expanded.starts_with(&denied) {
            return Err(AppError::PathNotAllowed(format!(
                "{path}: matches hard-deny prefix ({})",
                raw_prefix
            )));
        }
    }

    // 2. Deny com.apple.* paths even under allowed prefixes (system data)
    let last_component = expanded
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if last_component.starts_with("com.apple.") {
        return Err(AppError::PathNotAllowed(format!(
            "{path}: system data (com.apple.*) is never deletable"
        )));
    }

    // 3. Exact-prefix allowlist
    for raw_prefix in ALLOWED_PREFIXES {
        let allowed = expand_tilde(raw_prefix);
        // Path must start with the allowed directory, OR be the directory itself
        // (e.g. "~/.npm/_cacache" without trailing slash is also fine)
        let allowed_no_slash = allowed.display().to_string().trim_end_matches('/').to_string();
        if expanded.starts_with(&allowed) || expanded_str == allowed_no_slash {
            return Ok(expanded);
        }
    }

    // 4. Glob allowlist
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    let mut builder = GlobSetBuilder::new();
    for raw_glob in resolve_all_globs(project_roots) {
        let expanded_glob = if raw_glob.starts_with("~/") {
            format!("{}/{}", home.display(), &raw_glob[2..])
        } else {
            raw_glob.clone()
        };
        let glob = GlobBuilder::new(&expanded_glob)
            .literal_separator(true) // * does not cross /
            .build()
            .map_err(|e| AppError::Config(format!("invalid glob {raw_glob}: {e}")))?;
        builder.add(glob);
    }
    let glob_set = builder.build().map_err(|e| AppError::Config(e.to_string()))?;

    if glob_set.is_match(&expanded) {
        return Ok(expanded);
    }

    Err(AppError::PathNotAllowed(format!(
        "{path}: not in allowlist — only pre-approved directories may be trashed"
    )))
}

// ── Executor ─────────────────────────────────────────────────────────────────

/// Execute ONLY paths the user has explicitly reviewed in the preview modal.
///
/// `safe_paths`        — ActionClass::SafeOrphan items the user confirmed
/// `companion_approved` — ActionClass::CompanionNotRunning items the user
///                        individually opted in to (checkbox in preview modal)
///
/// CompanionRunning, SystemManaged, Protected, and Ambiguous paths are NEVER
/// accepted here — the frontend does not send them, and even if it somehow did,
/// `check_path()` provides a final backend safety net.
///
/// The action_class of each approved path is written to the audit log before
/// execution so the log is self-explaining.
pub async fn execute_previewed_paths(
    safe_paths: Vec<String>,
    companion_approved: Vec<String>,
    db: &Db,
) -> Result<ExecutionReport, AppError> {
    let project_roots = load_project_roots(db);
    let audit_log = audit_log_path()?;
    if let Some(parent) = audit_log.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut items: Vec<ExecutionItem> = Vec::new();
    let mut total_freed: u64 = 0;

    for path in &safe_paths {
        append_audit_log_classed(&audit_log, path, "safe_orphan", "queued", 0, None);
        let item = execute_single(path, &audit_log, &project_roots).await;
        if item.status == "moved" || item.status == "partial" {
            total_freed += item.bytes;
        }
        items.push(item);
    }

    for path in &companion_approved {
        append_audit_log_classed(&audit_log, path, "companion_not_running", "queued", 0, None);
        let item = execute_single(path, &audit_log, &project_roots).await;
        if item.status == "moved" || item.status == "partial" {
            total_freed += item.bytes;
        }
        items.push(item);
    }

    Ok(ExecutionReport { items, total_bytes_freed: total_freed })
}

pub async fn execute_actions(paths: Vec<String>, db: &Db) -> Result<ExecutionReport, AppError> {
    let project_roots = load_project_roots(db);
    let audit_log = audit_log_path()?;

    // Ensure the parent directory exists (it should from Db::new, but be safe)
    if let Some(parent) = audit_log.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut items: Vec<ExecutionItem> = Vec::new();
    let mut total_freed: u64 = 0;

    for path in paths {
        let item = execute_single(&path, &audit_log, &project_roots).await;
        if item.status == "moved" || item.status == "partial" {
            total_freed += item.bytes;
        }
        items.push(item);
    }

    Ok(ExecutionReport {
        items,
        total_bytes_freed: total_freed,
    })
}

async fn execute_single(path: &str, audit_log: &Path, project_roots: &[PathBuf]) -> ExecutionItem {
    match check_path(path, project_roots) {
        Err(AppError::PathNotAllowed(msg)) => {
            append_audit_log(audit_log, path, "denied", 0, Some(&msg));
            ExecutionItem {
                path: path.to_string(),
                status: "denied".to_string(),
                bytes: 0,
                error: Some(msg),
            }
        }
        Err(e) => {
            let msg = e.to_string();
            append_audit_log(audit_log, path, "failed", 0, Some(&msg));
            ExecutionItem {
                path: path.to_string(),
                status: "failed".to_string(),
                bytes: 0,
                error: Some(msg),
            }
        }
        Ok(canonical) => {
            if should_expand(&canonical) {
                return execute_expanded(&canonical, path, audit_log).await;
            }
            // Capture size BEFORE trashing
            let bytes = dir_size(&canonical).unwrap_or(0);
            match trash_ctx().delete(&canonical) {
                Ok(()) => {
                    append_audit_log(audit_log, path, "moved", bytes, None);
                    ExecutionItem {
                        path: path.to_string(),
                        status: "moved".to_string(),
                        bytes,
                        error: None,
                    }
                }
                Err(e) => {
                    let msg = e.to_string();
                    append_audit_log(audit_log, path, "failed", 0, Some(&msg));
                    ExecutionItem {
                        path: path.to_string(),
                        status: "failed".to_string(),
                        bytes: 0,
                        error: Some(msg),
                    }
                }
            }
        }
    }
}

// ── Expansion logic ───────────────────────────────────────────────────────────

fn should_expand(canonical: &Path) -> bool {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return false,
    };
    for raw in EXPAND_ON_EXECUTION {
        let expanded = if raw.starts_with("~/") {
            home.join(&raw[2..])
        } else {
            PathBuf::from(raw)
        };
        // EXPAND_ON_EXECUTION entries have trailing slashes; strip before comparing.
        let base = PathBuf::from(expanded.display().to_string().trim_end_matches('/'));
        if canonical == base {
            return true;
        }
    }
    false
}

/// Trash each direct child of `canonical` independently, aggregating results.
/// Returns a single ExecutionItem with status "moved" / "partial" / "failed".
async fn execute_expanded(canonical: &Path, original_path: &str, audit_log: &Path) -> ExecutionItem {
    let entries = match fs::read_dir(canonical) {
        Ok(e) => e,
        Err(e) => {
            let msg = format!("failed to read directory: {e}");
            append_audit_log(audit_log, original_path, "failed", 0, Some(&msg));
            return ExecutionItem {
                path: original_path.to_string(),
                status: "failed".to_string(),
                bytes: 0,
                error: Some(msg),
            };
        }
    };

    let children: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    let total = children.len();

    if total == 0 {
        append_audit_log(audit_log, original_path, "moved", 0, None);
        return ExecutionItem {
            path: original_path.to_string(),
            status: "moved".to_string(),
            bytes: 0,
            error: None,
        };
    }

    let mut moved_bytes: u64 = 0;
    let mut moved_count: usize = 0;
    let mut failed_count: usize = 0;

    for child in &children {
        let child_bytes = dir_size(child).unwrap_or(0);
        match trash_ctx().delete(child) {
            Ok(()) => {
                moved_bytes += child_bytes;
                moved_count += 1;
            }
            Err(_) => {
                failed_count += 1;
            }
        }
    }

    let (status, error): (&str, Option<String>) = if failed_count == 0 {
        ("moved", None)
    } else if moved_count == 0 {
        ("failed", Some(format!("all {total} subdirectories could not be moved")))
    } else {
        (
            "partial",
            Some(format!(
                "{failed_count} of {total} subdirectories could not be moved (system locks)"
            )),
        )
    };

    append_audit_log(audit_log, original_path, status, moved_bytes, error.as_deref());
    ExecutionItem {
        path: original_path.to_string(),
        status: status.to_string(),
        bytes: moved_bytes,
        error,
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn dir_size(path: &Path) -> Option<u64> {
    // Best-effort recursive size using du -sk. Falls back to metadata for files.
    if path.is_file() {
        return path.metadata().ok().map(|m| m.len());
    }
    let out = std::process::Command::new("du")
        .args(["-sk", &path.display().to_string()])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let kb: u64 = stdout.split_whitespace().next()?.parse().ok()?;
    Some(kb * 1024)
}

fn append_audit_log(log: &Path, path: &str, status: &str, bytes: u64, error: Option<&str>) {
    let line = format!(
        "{}\n",
        serde_json::json!({
            "timestamp": Utc::now().to_rfc3339(),
            "path": path,
            "status": status,
            "bytes": bytes,
            "error": error,
        })
    );
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn append_audit_log_classed(
    log: &Path,
    path: &str,
    action_class: &str,
    status: &str,
    bytes: u64,
    error: Option<&str>,
) {
    let line = format!(
        "{}\n",
        serde_json::json!({
            "timestamp": Utc::now().to_rfc3339(),
            "path": path,
            "action_class": action_class,
            "status": status,
            "bytes": bytes,
            "error": error,
        })
    );
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn audit_log_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("audit.log"))
}

// ── First-run project root auto-detection ─────────────────────────────────────

/// Detects likely project root directories on this machine by checking a list of
/// conventional candidates plus any `~/Desktop/*/Projects/` subdirectory pattern.
/// Only directories that exist on disk are included. The result is deduplicated.
pub fn auto_detect_project_roots() -> Vec<PathBuf> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    let mut candidates: Vec<PathBuf> = vec![
        home.join("Desktop").join("Projects"),
        home.join("Documents").join("Projects"),
        home.join("Code"),
        home.join("Workspace"),
        home.join("Projects"),
        home.join("Repos"),
        home.join("Dev"),
        home.join("dev"),
    ];

    // ~/Desktop/*/Projects/ — any Desktop subdir that contains a Projects/ child
    if let Ok(entries) = std::fs::read_dir(home.join("Desktop")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let projects = path.join("Projects");
                if projects.is_dir() {
                    candidates.push(projects);
                }
            }
        }
    }

    let mut seen = std::collections::HashSet::new();
    candidates
        .into_iter()
        .filter(|p| p.is_dir())
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

// ── Allowlist/denylist accessors (exposed as Tauri commands) ──────────────────

#[tauri::command]
pub fn get_allowed_prefixes() -> Vec<String> {
    ALLOWED_PREFIXES.iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
pub async fn get_allowed_globs(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    let db = db.inner().clone();
    let project_roots = tokio::task::spawn_blocking(move || load_project_roots(&db))
        .await
        .unwrap_or_default();
    Ok(resolve_all_globs(&project_roots))
}

#[tauri::command]
pub fn get_denied_prefixes() -> Vec<String> {
    DENIED_PREFIXES.iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
pub fn get_denied_exact() -> Vec<String> {
    DENIED_EXACT.iter().map(|s| s.to_string()).collect()
}

// ── Launchctl toggle ─────────────────────────────────────────────────────────

const DENIED_LABEL_PREFIXES: &[&str] = &[
    "com.apple.",
    "system.",
    "auth.",
    "homed",
    "cloudd",
    "bird",
    "lsd",
    "tccd",
    "secinitd",
    "syspolicyd",
    "WindowServer",
    "loginwindow",
    "SafariBookmarksSyncAgent",
];

pub fn is_label_toggleable(label: &str) -> bool {
    !DENIED_LABEL_PREFIXES.iter().any(|denied| label.starts_with(denied))
}

/// Returns true if every character in `s` is safe in a launchd label:
/// ASCII alphanumeric, dot, hyphen, or underscore. Rejects anything that
/// could act as a shell metacharacter when interpolated into a command string.
fn is_safe_label_chars(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// Returns true if `target` matches the expected launchctl service target format:
///   gui/<digits>/<label>
///   user/<digits>/<label>
///   system/<label>
/// where <label> passes is_safe_label_chars. Rejects any string that would
/// carry metacharacters into the osascript do-shell-script argument.
fn is_safe_service_target(target: &str) -> bool {
    if let Some(rest) = target.strip_prefix("system/") {
        return is_safe_label_chars(rest);
    }
    for prefix in &["gui/", "user/"] {
        if let Some(rest) = target.strip_prefix(prefix) {
            if let Some(slash_pos) = rest.find('/') {
                let uid_part = &rest[..slash_pos];
                let label_part = &rest[slash_pos + 1..];
                return !uid_part.is_empty()
                    && uid_part.chars().all(|c| c.is_ascii_digit())
                    && is_safe_label_chars(label_part);
            }
        }
    }
    false
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ToggleAction {
    Disable,
    Enable,
}

pub struct ToggleResult {
    pub label: String,
    pub action: ToggleAction,
    pub success: bool,
    pub error: Option<String>,
}

pub fn toggle_launchctl(
    label: &str,
    service_target: &str,
    action: ToggleAction,
    requires_sudo: bool,
) -> ToggleResult {
    if !is_label_toggleable(label) {
        return ToggleResult {
            label: label.to_string(),
            action,
            success: false,
            error: Some(format!("label '{}' is in denylist (system service)", label)),
        };
    }

    // Reject labels or service targets that contain shell metacharacters. Both
    // values flow into an osascript `do shell script "..."` argument when
    // requires_sudo is true; a malformed plist label could otherwise inject
    // arbitrary commands with administrator privileges.
    if !is_safe_label_chars(label) || !is_safe_service_target(service_target) {
        return ToggleResult {
            label: label.to_string(),
            action,
            success: false,
            error: Some(format!(
                "rejected: '{}' contains characters not permitted in a launchd service target",
                label
            )),
        };
    }

    let verb = match action {
        ToggleAction::Disable => "disable",
        ToggleAction::Enable => "enable",
    };

    let output = if requires_sudo {
        let cmd = format!(
            "do shell script \"/bin/launchctl {} {}\" with administrator privileges",
            verb, service_target
        );
        std::process::Command::new("osascript").args(["-e", &cmd]).output()
    } else {
        std::process::Command::new("/bin/launchctl")
            .args([verb, service_target])
            .output()
    };

    match output {
        Ok(out) if out.status.success() => {
            log_audit_toggle(label, service_target, action, true, None);
            ToggleResult { label: label.to_string(), action, success: true, error: None }
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            log_audit_toggle(label, service_target, action, false, Some(&err));
            ToggleResult { label: label.to_string(), action, success: false, error: Some(err) }
        }
        Err(e) => {
            let err = e.to_string();
            log_audit_toggle(label, service_target, action, false, Some(&err));
            ToggleResult { label: label.to_string(), action, success: false, error: Some(err) }
        }
    }
}

fn log_audit_toggle(
    label: &str,
    service_target: &str,
    action: ToggleAction,
    success: bool,
    error: Option<&str>,
) {
    let verb = match action {
        ToggleAction::Disable => "disable",
        ToggleAction::Enable => "enable",
    };
    let status = if success { "ok" } else { "failed" };
    let line = format!(
        "{}\n",
        serde_json::json!({
            "timestamp": Utc::now().to_rfc3339(),
            "action": "toggle",
            "verb": verb,
            "service_target": service_target,
            "label": label,
            "status": status,
            "error": error,
        })
    );
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let log_path = home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("audit.log");
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = f.write_all(line.as_bytes());
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{check_path, is_label_toggleable, is_safe_label_chars, is_safe_service_target};

    #[test]
    fn allowed_cache_prefix() {
        // ~/.cache/ is in the exact-prefix allowlist
        let result = check_path("~/.cache/something", &[]);
        assert!(result.is_ok(), "expected Ok, got: {result:?}");
    }

    #[test]
    fn denied_documents_prefix() {
        // ~/Documents/ is in the hard-deny list — must reject even if it somehow
        // matched an allowlist entry (it doesn't, but the deny check runs first)
        let result = check_path("~/Documents/anything", &[]);
        assert!(result.is_err(), "expected Err for Documents path");
        let err_str = result.unwrap_err().to_string();
        assert!(err_str.contains("hard-deny"), "error should mention hard-deny: {err_str}");
    }

    #[test]
    fn allowed_via_glob() {
        // Project-root-derived glob: node_modules under a configured project root
        let home = dirs::home_dir().unwrap();
        let root = home.join("Desktop").join("TestProjects");
        let test_path = format!("{}/my-app/node_modules", root.display());
        let result = check_path(&test_path, &[root]);
        assert!(result.is_ok(), "expected glob match for project root, got: {result:?}");
    }

    #[test]
    fn denied_non_allowlisted_path() {
        // A random path that is not in any allowlist entry
        let result = check_path("~/SomeOtherFolder/random.txt", &[]);
        assert!(result.is_err(), "expected Err for non-allowlisted path");
    }

    #[test]
    fn leftover_directories_are_allowed() {
        let result = check_path("~/Library/Application Support/Adobe", &[]);
        assert!(result.is_ok(), "expected Application Support/Adobe to be allowed: {result:?}");

        let result = check_path("~/Library/Preferences/com.adobe.Acrobat.plist", &[]);
        assert!(result.is_ok(), "expected Preferences plist to be allowed: {result:?}");
    }

    #[test]
    fn apple_paths_are_denied_even_under_allowed_prefix() {
        let result = check_path("~/Library/Application Support/com.apple.calendarservices", &[]);
        assert!(result.is_err(), "expected com.apple.* to be denied: {result:?}");

        let result = check_path("~/Library/Preferences/com.apple.Safari.plist", &[]);
        assert!(result.is_err(), "expected com.apple.* plist to be denied: {result:?}");
    }

    #[test]
    fn apple_labels_are_denied() {
        assert!(!is_label_toggleable("com.apple.WindowServer"));
        assert!(!is_label_toggleable("com.apple.loginwindow"));
        assert!(!is_label_toggleable("homed"));
        assert!(!is_label_toggleable("cloudd"));
    }

    #[test]
    fn third_party_labels_are_allowed() {
        assert!(is_label_toggleable("com.perplexity.comet"));
        assert!(is_label_toggleable("com.tailscale.tailscaled"));
        assert!(is_label_toggleable("com.dr.buho.BuhoCleaner.helper"));
    }

    // ── Service-target whitelist validation ───────────────────────────────────

    #[test]
    fn valid_service_targets_accepted() {
        assert!(is_safe_service_target("system/com.tailscale.tailscaled"));
        assert!(is_safe_service_target("gui/501/com.brave.Browser.helper"));
        assert!(is_safe_service_target("user/502/org.mozilla.updater"));
        assert!(is_safe_service_target("gui/1000/com.example.app-name_v2"));
    }

    #[test]
    fn shell_injection_via_semicolon_rejected() {
        assert!(!is_safe_service_target("gui/501/com.foo; rm -rf /"));
        assert!(!is_safe_label_chars("com.foo; rm -rf /"));
    }

    #[test]
    fn shell_injection_via_subshell_rejected() {
        assert!(!is_safe_service_target("gui/501/com.foo$(whoami)"));
        assert!(!is_safe_service_target("gui/501/com.foo`id`"));
        assert!(!is_safe_label_chars("com.foo$(whoami)"));
    }

    #[test]
    fn shell_injection_via_pipe_and_ampersand_rejected() {
        assert!(!is_safe_service_target("gui/501/com.foo&&curl evil.com"));
        assert!(!is_safe_service_target("gui/501/com.foo|cat /etc/passwd"));
    }

    #[test]
    fn shell_injection_via_quotes_rejected() {
        assert!(!is_safe_service_target("gui/501/'com.foo'"));
        assert!(!is_safe_service_target("gui/501/com.foo\"bar"));
        assert!(!is_safe_label_chars("'com.foo'"));
    }

    #[test]
    fn malformed_target_structure_rejected() {
        assert!(!is_safe_service_target(""));
        assert!(!is_safe_service_target("gui/abc/com.foo")); // non-numeric uid
        assert!(!is_safe_service_target("gui/com.foo"));    // missing uid segment
        assert!(!is_safe_service_target("bad/501/com.foo")); // unknown domain
        assert!(!is_safe_service_target("system/"));        // empty label
    }

    #[test]
    fn empty_and_space_labels_rejected() {
        assert!(!is_safe_label_chars(""));
        assert!(!is_safe_label_chars("com.foo bar"));
        assert!(!is_safe_label_chars("com.foo\tbar"));
    }
}
