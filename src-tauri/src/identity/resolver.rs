use std::path::Path;
use crate::snapshot::apps::{InstalledApp, LeftoverDir};
use super::{aliases, system_managed, CanonicalApp, ClassifiedLeftover, IdentityGraph, LeftoverStatus};

// ── CanonicalApp construction ─────────────────────────────────────────────────

/// Classify a single leftover against a pre-built canonical app list.
/// Used by target_resolver to avoid rebuilding the graph per path.
pub(crate) fn classify_one(leftover: &LeftoverDir, canonical: &[CanonicalApp]) -> ClassifiedLeftover {
    classify(leftover, canonical)
}

pub(super) fn build_graph(raw_apps: &[InstalledApp], raw_leftovers: &[LeftoverDir]) -> IdentityGraph {
    let installed: Vec<CanonicalApp> = raw_apps.iter().map(build_canonical).collect();
    let leftovers: Vec<ClassifiedLeftover> = raw_leftovers
        .iter()
        .map(|l| classify(l, &installed))
        .collect();
    IdentityGraph { installed, leftovers }
}

fn build_canonical(app: &InstalledApp) -> CanonicalApp {
    let bundle_id = app.bundle_id.clone().unwrap_or_default();
    let display_name = app.name.clone();

    // Executable name = stem of the .app bundle path (e.g. "Brave Browser")
    let executable_name = Path::new(&app.path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(String::from)
        .unwrap_or_else(|| display_name.clone());

    // vendor_segment = index 1 of the reverse-domain bundle_id (e.g. "brave" from "com.brave.Browser")
    let vendor_segment = bundle_id.split('.').nth(1).unwrap_or("").to_string();

    // Precomputed lowercase patterns for fast matching
    let mut dir_patterns: Vec<String> = Vec::new();

    // Last segment of bundle_id (e.g. "Browser")
    if let Some(last) = bundle_id.split('.').last() {
        let l = last.to_lowercase();
        if !l.is_empty() {
            dir_patterns.push(l);
        }
    }
    // Full bundle_id itself (e.g. "com.brave.Browser" for .plist files)
    if !bundle_id.is_empty() {
        dir_patterns.push(bundle_id.to_lowercase());
    }
    // Vendor aliases (e.g. "bravesoftware")
    for alias in aliases::lookup_aliases(&vendor_segment) {
        dir_patterns.push(alias.to_lowercase());
    }
    // Display name and executable name
    dir_patterns.push(display_name.to_lowercase());
    let exec_lower = executable_name.to_lowercase();
    if !dir_patterns.contains(&exec_lower) {
        dir_patterns.push(exec_lower);
    }

    CanonicalApp { bundle_id, display_name, executable_name, vendor_segment, dir_patterns }
}

// ── Leftover classification ───────────────────────────────────────────────────

fn classify(leftover: &LeftoverDir, canonical: &[CanonicalApp]) -> ClassifiedLeftover {
    let dir_name = Path::new(&leftover.path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&leftover.path)
        .to_string();

    // Strip .plist suffix for Preferences entries before pattern matching
    let match_name = dir_name.trim_end_matches(".plist").to_lowercase();

    // Rules 1-4 (via precomputed dir_patterns on each CanonicalApp)
    for app in canonical {
        if app.dir_patterns.iter().any(|p| p == &match_name) {
            return ClassifiedLeftover {
                path: leftover.path.clone(),
                dir_name,
                size_bytes: leftover.size_bytes,
                status: LeftoverStatus::Companion {
                    belongs_to_bundle_id: app.bundle_id.clone(),
                    belongs_to_display_name: app.display_name.clone(),
                },
            };
        }
    }

    // Rule 5: macOS system service or default dev-tool cache
    if system_managed::is_system_managed(&dir_name) {
        return ClassifiedLeftover {
            path: leftover.path.clone(),
            dir_name,
            size_bytes: leftover.size_bytes,
            status: LeftoverStatus::SystemManaged,
        };
    }

    // Rule 6: electron shell cache pattern (e.g. app_shell_cache_562354)
    if let Some(hint) = electron_cache_hint(&dir_name) {
        return ClassifiedLeftover {
            path: leftover.path.clone(),
            dir_name,
            size_bytes: leftover.size_bytes,
            status: LeftoverStatus::Ambiguous { pattern_hint: hint },
        };
    }

    // Rule 7: default — orphaned leftover
    ClassifiedLeftover {
        path: leftover.path.clone(),
        dir_name,
        size_bytes: leftover.size_bytes,
        status: LeftoverStatus::Orphaned,
    }
}

/// Returns "electron_shell_cache" if dir_name matches `*_cache_<digits>`.
fn electron_cache_hint(dir_name: &str) -> Option<String> {
    if let Some(pos) = dir_name.rfind("_cache_") {
        let suffix = &dir_name[pos + 7..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return Some("electron_shell_cache".to_string());
        }
    }
    None
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::apps::{InstalledApp, LeftoverDir};

    fn make_app(name: &str, bundle_id: Option<&str>, path: &str) -> InstalledApp {
        InstalledApp {
            name: name.to_string(),
            bundle_id: bundle_id.map(String::from),
            path: path.to_string(),
            size_bytes: 100_000_000,
            last_opened_days_ago: Some(5),
        }
    }

    fn make_leftover(path: &str) -> LeftoverDir {
        LeftoverDir { path: path.to_string(), size_bytes: 50_000_000, matched_app_name: None }
    }

    fn resolve(apps: &[InstalledApp], leftovers: &[LeftoverDir]) -> Vec<ClassifiedLeftover> {
        build_graph(apps, leftovers).leftovers
    }

    // Rule 1: last segment of bundle_id matches dir_name (case-insensitive)
    #[test]
    fn rule1_last_bundle_segment() {
        let apps = &[make_app("Brave Browser", Some("com.brave.Browser"), "/Applications/Brave Browser.app")];
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/Browser")];
        let cl = &resolve(apps, leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::Companion { .. }), "expected Companion, got {:?}", cl.status);
    }

    // Rule 2: vendor alias match (e.g. "BraveSoftware" is alias for "brave")
    #[test]
    fn rule2_vendor_alias() {
        let apps = &[make_app("Brave Browser", Some("com.brave.Browser"), "/Applications/Brave Browser.app")];
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/BraveSoftware")];
        let cl = &resolve(apps, leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::Companion { .. }), "expected Companion via alias, got {:?}", cl.status);
    }

    // Rule 3: display_name match (case-insensitive)
    #[test]
    fn rule3_display_name_case_insensitive() {
        let apps = &[make_app("Brave Browser", Some("com.brave.Browser"), "/Applications/Brave Browser.app")];
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/brave browser")];
        let cl = &resolve(apps, leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::Companion { .. }), "expected Companion via display_name");
    }

    // Rule 4: executable_name match (case-insensitive)
    #[test]
    fn rule4_executable_name() {
        let apps = &[make_app("MyTool", None, "/Applications/MyTool.app")];
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/mytool")];
        let cl = &resolve(apps, leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::Companion { .. }), "expected Companion via executable_name");
    }

    // Rule 5: system managed whitelist
    #[test]
    fn rule5_system_managed() {
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/SiriTTS")];
        let cl = &resolve(&[], leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::SystemManaged), "expected SystemManaged for SiriTTS");
    }

    // Rule 6: electron cache pattern
    #[test]
    fn rule6_electron_cache_pattern() {
        let leftovers = &[make_leftover("/Users/x/Library/Caches/app_shell_cache_562354")];
        let cl = &resolve(&[], leftovers)[0];
        assert!(
            matches!(cl.status, LeftoverStatus::Ambiguous { ref pattern_hint } if pattern_hint == "electron_shell_cache"),
            "expected Ambiguous electron pattern, got {:?}", cl.status
        );
    }

    // Rule 7: orphaned — no match anywhere
    #[test]
    fn rule7_orphaned() {
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/SomeUnknownApp123")];
        let cl = &resolve(&[], leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::Orphaned), "expected Orphaned");
    }

    // Real-world Brave case: BraveSoftware dir → Companion("com.brave.Browser")
    #[test]
    fn brave_software_dir_is_companion() {
        let apps = &[make_app("Brave Browser", Some("com.brave.Browser"), "/Applications/Brave Browser.app")];
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/BraveSoftware")];
        let cl = &resolve(apps, leftovers)[0];
        match &cl.status {
            LeftoverStatus::Companion { belongs_to_bundle_id, belongs_to_display_name } => {
                assert_eq!(belongs_to_bundle_id, "com.brave.Browser");
                assert_eq!(belongs_to_display_name, "Brave Browser");
            }
            other => panic!("expected Companion, got {:?}", other),
        }
    }

    // Plist file companion: com.brave.Browser.plist → Companion via full bundle_id match
    #[test]
    fn plist_file_matched_to_companion() {
        let apps = &[make_app("Brave Browser", Some("com.brave.Browser"), "/Applications/Brave Browser.app")];
        let leftovers = &[make_leftover("/Users/x/Library/Preferences/com.brave.Browser.plist")];
        let cl = &resolve(apps, leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::Companion { .. }), "plist should be Companion");
    }

    // Rule ordering: Companion takes priority over SystemManaged
    #[test]
    fn companion_wins_over_system_managed() {
        // "Mozilla" is in system_managed list AND is an alias for "mozilla" vendor
        let apps = &[make_app("Firefox", Some("org.mozilla.firefox"), "/Applications/Firefox.app")];
        let leftovers = &[make_leftover("/Users/x/Library/Application Support/Mozilla")];
        let cl = &resolve(apps, leftovers)[0];
        // Rule 2 (alias "Mozilla" for vendor "mozilla") fires before rule 5
        assert!(matches!(cl.status, LeftoverStatus::Companion { .. }),
            "Mozilla should be Companion when Firefox is installed, got {:?}", cl.status);
    }

    // Electron cache: any_name_cache_<digits> pattern
    #[test]
    fn generic_electron_cache_pattern() {
        let leftovers = &[make_leftover("/Users/x/Library/Caches/some_electron_cache_9001")];
        let cl = &resolve(&[], leftovers)[0];
        assert!(matches!(cl.status, LeftoverStatus::Ambiguous { .. }));
    }
}
