use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::analyzer::expand_tilde;
use crate::identity::{
    build_canonical_apps, classify_leftover_with_apps, CanonicalApp, ClassifiedLeftover,
    LeftoverStatus,
};
use crate::snapshot::apps::{InstalledApp, LeftoverDir};
use crate::snapshot::processes::ProcessInfo;

// ── Types ─────────────────────────────────────────────────────────────────────

/// How an individual path should be treated in the execute flow.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActionClass {
    /// Real orphan: no installed app matches, not system-managed. Safe to trash.
    SafeOrphan,
    /// Belongs to an installed app that is currently running.
    /// Block execution — removing active app data can corrupt state.
    CompanionRunning { app_display: String, app_bundle_id: String },
    /// Belongs to an installed app that is NOT currently running.
    /// Warn the user; allow if they explicitly opt in.
    CompanionNotRunning { app_display: String, app_bundle_id: String },
    /// macOS system service directory. Never execute.
    SystemManaged,
    /// Unknown directory matching an Electron-cache pattern. Never auto-execute.
    Ambiguous { pattern_hint: String },
    /// Under /Library, /System, or another path requiring sudo. Never execute.
    Protected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedTarget {
    pub path: String,
    pub size_bytes: u64,
    pub action_class: ActionClass,
    pub display_label: String,
}

// ── Expansion list ────────────────────────────────────────────────────────────

/// Directories that, when targeted as a whole, must be expanded to direct
/// children before execution. Mirrors executor::EXPAND_ON_EXECUTION.
const EXPANDABLE_DIRS: &[&str] = &[
    "~/Library/Caches/",
    "~/Library/Logs/",
];

// ── Entry point ───────────────────────────────────────────────────────────────

/// Resolve finding target paths to an identity-classified, per-item list.
///
/// Parent directories (~/Library/Caches, ~/Library/Logs) are expanded to their
/// direct children so the preview modal can show each item individually.
/// Each item receives an ActionClass that drives the UI grouping and the backend
/// execution gate.
///
/// This function is synchronous (du calls are blocking) — call via spawn_blocking.
pub fn resolve_finding_targets(
    finding_paths: &[String],
    installed_apps: &[InstalledApp],
    classified_leftovers: &[ClassifiedLeftover],
    running_processes: &[ProcessInfo],
) -> Vec<ResolvedTarget> {
    let home = dirs::home_dir().unwrap_or_default();

    // Build path → ClassifiedLeftover lookup (O(1) per lookup)
    let classified_map: HashMap<&str, &ClassifiedLeftover> =
        classified_leftovers.iter().map(|cl| (cl.path.as_str(), cl)).collect();

    // Build CanonicalApp list once for on-the-fly classification and running checks
    let canonical_apps = build_canonical_apps(installed_apps);

    let mut results = Vec::new();

    for raw_path in finding_paths {
        let expanded = expand_tilde(raw_path);

        if is_expandable(&expanded, &home) && expanded.is_dir() {
            // Expand to direct children and classify each individually
            match std::fs::read_dir(&expanded) {
                Ok(entries) => {
                    let mut children: Vec<PathBuf> =
                        entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
                    children.sort(); // deterministic order
                    for child in children {
                        let target = classify_single(
                            &child,
                            &classified_map,
                            &canonical_apps,
                            running_processes,
                        );
                        results.push(target);
                    }
                }
                Err(_) => {
                    results.push(ResolvedTarget {
                        path: expanded.display().to_string(),
                        size_bytes: 0,
                        action_class: ActionClass::Protected,
                        display_label: dir_name_str(&expanded),
                    });
                }
            }
        } else {
            let target =
                classify_single(&expanded, &classified_map, &canonical_apps, running_processes);
            results.push(target);
        }
    }

    results
}

// ── Single-path classification ────────────────────────────────────────────────

fn classify_single(
    path: &Path,
    classified_map: &HashMap<&str, &ClassifiedLeftover>,
    canonical_apps: &[CanonicalApp],
    running_processes: &[ProcessInfo],
) -> ResolvedTarget {
    let path_str = path.display().to_string();
    let size_bytes = dir_size(path).unwrap_or(0);

    // Protected: system-level paths that the executor would deny
    if is_protected(path) {
        return ResolvedTarget {
            path: path_str,
            size_bytes,
            action_class: ActionClass::Protected,
            display_label: format!("{} (system-protected)", dir_name_str(path)),
        };
    }

    // Look up in the snapshot's classified_leftovers by exact path
    if let Some(cl) = classified_map.get(path_str.as_str()) {
        return cl_to_resolved_target(cl, canonical_apps, running_processes, &path_str, size_bytes);
    }

    // Not in the stored classification — re-classify on the fly using identity rules
    let dummy = LeftoverDir {
        path: path_str.clone(),
        size_bytes,
        matched_app_name: None,
    };
    let reclassified = classify_leftover_with_apps(&dummy, canonical_apps);
    cl_to_resolved_target(
        &reclassified,
        canonical_apps,
        running_processes,
        &path_str,
        size_bytes,
    )
}

fn cl_to_resolved_target(
    cl: &ClassifiedLeftover,
    canonical_apps: &[CanonicalApp],
    running_processes: &[ProcessInfo],
    path_str: &str,
    size_bytes: u64,
) -> ResolvedTarget {
    let name = &cl.dir_name;

    let (action_class, display_label) = match &cl.status {
        LeftoverStatus::Orphaned => (ActionClass::SafeOrphan, name.clone()),

        LeftoverStatus::Companion { belongs_to_bundle_id, belongs_to_display_name } => {
            let running =
                is_app_running_by_bundle_id(belongs_to_bundle_id, canonical_apps, running_processes);
            if running {
                (
                    ActionClass::CompanionRunning {
                        app_display: belongs_to_display_name.clone(),
                        app_bundle_id: belongs_to_bundle_id.clone(),
                    },
                    format!("{name} ({belongs_to_display_name}, running)"),
                )
            } else {
                (
                    ActionClass::CompanionNotRunning {
                        app_display: belongs_to_display_name.clone(),
                        app_bundle_id: belongs_to_bundle_id.clone(),
                    },
                    format!("{name} ({belongs_to_display_name})"),
                )
            }
        }

        LeftoverStatus::SystemManaged => {
            (ActionClass::SystemManaged, format!("{name} (system)"))
        }

        LeftoverStatus::SelfManaged => {
            (ActionClass::SystemManaged, format!("{name} (self)"))
        }

        LeftoverStatus::Ambiguous { pattern_hint } => (
            ActionClass::Ambiguous { pattern_hint: pattern_hint.clone() },
            format!("{name} ({pattern_hint})"),
        ),
    };

    ResolvedTarget { path: path_str.to_string(), size_bytes, action_class, display_label }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn is_expandable(path: &Path, home: &Path) -> bool {
    for raw in EXPANDABLE_DIRS {
        let expanded = if raw.starts_with("~/") {
            home.join(&raw[2..])
        } else {
            PathBuf::from(raw)
        };
        // Strip trailing slash added by the constant
        let base = PathBuf::from(expanded.display().to_string().trim_end_matches('/'));
        if path == base {
            return true;
        }
    }
    false
}

fn is_protected(path: &Path) -> bool {
    let s = path.display().to_string();
    // System-level paths (not ~/Library — user Library is allowed)
    s.starts_with("/Library/")
        || s.starts_with("/System/")
        || s.starts_with("/usr/")
        || s.starts_with("/bin/")
        || s.starts_with("/sbin/")
        || s.starts_with("/private/")
}

fn is_app_running_by_bundle_id(
    bundle_id: &str,
    canonical_apps: &[CanonicalApp],
    processes: &[ProcessInfo],
) -> bool {
    let Some(canonical) = canonical_apps.iter().find(|c| c.bundle_id == bundle_id) else {
        return false;
    };
    let exec_lower = canonical.executable_name.to_lowercase();
    processes
        .iter()
        .any(|p| p.command.to_lowercase().contains(&exec_lower))
}

fn dir_name_str(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string()
}

fn dir_size(path: &Path) -> Option<u64> {
    if path.is_file() {
        return path.metadata().ok().map(|m| m.len());
    }
    if !path.exists() {
        return Some(0);
    }
    let out = std::process::Command::new("du")
        .args(["-sk", &path.display().to_string()])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let kb: u64 = stdout.split_whitespace().next()?.parse().ok()?;
    Some(kb * 1024)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{ClassifiedLeftover, LeftoverStatus};
    use crate::snapshot::apps::{InstalledApp, LeftoverDir};
    use crate::snapshot::processes::ProcessInfo;

    fn make_app(name: &str, bid: &str, path: &str) -> InstalledApp {
        InstalledApp {
            name: name.to_string(),
            bundle_id: Some(bid.to_string()),
            path: path.to_string(),
            size_bytes: 200_000_000,
            last_opened_days_ago: Some(5),
        }
    }

    fn make_process(command: &str) -> ProcessInfo {
        ProcessInfo {
            pid: 1234,
            ppid: 1,
            user: "test".to_string(),
            rss_bytes: 100_000_000,
            command: command.to_string(),
            etime: "01:23".to_string(),
        }
    }

    fn make_classified(path: &str, dir: &str, size: u64, status: LeftoverStatus) -> ClassifiedLeftover {
        ClassifiedLeftover {
            path: path.to_string(),
            dir_name: dir.to_string(),
            size_bytes: size,
            status,
        }
    }

    fn run(
        paths: &[&str],
        apps: &[InstalledApp],
        classified: &[ClassifiedLeftover],
        processes: &[ProcessInfo],
    ) -> Vec<ResolvedTarget> {
        let paths: Vec<String> = paths.iter().map(|s| s.to_string()).collect();
        resolve_finding_targets(&paths, apps, classified, processes)
    }

    // (a) Leaf orphan → SafeOrphan
    #[test]
    fn leaf_orphan_is_safe() {
        let classified = &[make_classified(
            "/Users/x/Library/Application Support/JetBrains",
            "JetBrains",
            999_000_000,
            LeftoverStatus::Orphaned,
        )];
        let targets = run(
            &["/Users/x/Library/Application Support/JetBrains"],
            &[],
            classified,
            &[],
        );
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].action_class, ActionClass::SafeOrphan);
    }

    // (b) SiriTTS → SystemManaged
    #[test]
    fn system_managed_entry() {
        let classified = &[make_classified(
            "/Users/x/Library/Application Support/SiriTTS",
            "SiriTTS",
            50_000_000,
            LeftoverStatus::SystemManaged,
        )];
        let targets = run(
            &["/Users/x/Library/Application Support/SiriTTS"],
            &[],
            classified,
            &[],
        );
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].action_class, ActionClass::SystemManaged);
    }

    // (c) Brave running → CompanionRunning
    #[test]
    fn companion_running_when_brave_is_running() {
        let apps = &[make_app("Brave Browser", "com.brave.Browser", "/Applications/Brave Browser.app")];
        let classified = &[make_classified(
            "/Users/x/Library/Application Support/BraveSoftware",
            "BraveSoftware",
            500_000_000,
            LeftoverStatus::Companion {
                belongs_to_bundle_id: "com.brave.Browser".to_string(),
                belongs_to_display_name: "Brave Browser".to_string(),
            },
        )];
        let processes = &[make_process(
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        )];
        let targets = run(
            &["/Users/x/Library/Application Support/BraveSoftware"],
            apps,
            classified,
            processes,
        );
        assert_eq!(targets.len(), 1);
        assert!(matches!(targets[0].action_class, ActionClass::CompanionRunning { .. }));
    }

    // (c') Brave NOT running → CompanionNotRunning
    #[test]
    fn companion_not_running_when_brave_is_closed() {
        let apps = &[make_app("Brave Browser", "com.brave.Browser", "/Applications/Brave Browser.app")];
        let classified = &[make_classified(
            "/Users/x/Library/Application Support/BraveSoftware",
            "BraveSoftware",
            500_000_000,
            LeftoverStatus::Companion {
                belongs_to_bundle_id: "com.brave.Browser".to_string(),
                belongs_to_display_name: "Brave Browser".to_string(),
            },
        )];
        // No running processes
        let targets = run(
            &["/Users/x/Library/Application Support/BraveSoftware"],
            apps,
            classified,
            &[],
        );
        assert_eq!(targets.len(), 1);
        assert!(matches!(targets[0].action_class, ActionClass::CompanionNotRunning { .. }));
    }

    // (d) /Library/LaunchDaemons/... → Protected
    #[test]
    fn system_library_is_protected() {
        let targets = run(&["/Library/LaunchDaemons/com.example.plist"], &[], &[], &[]);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].action_class, ActionClass::Protected);
    }

    // On-the-fly reclassification for orphan not in classified_leftovers
    #[test]
    fn on_the_fly_orphan_reclassification() {
        // No classified_leftovers — resolver re-runs identity rules
        let targets = run(&["/Users/x/Library/Application Support/SomeUnknownApp"], &[], &[], &[]);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].action_class, ActionClass::SafeOrphan);
    }
}
