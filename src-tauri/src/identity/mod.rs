pub mod aliases;
pub mod system_managed;
pub mod target_resolver;
mod resolver;

use serde::{Deserialize, Serialize};
use crate::snapshot::apps::{InstalledApp, LeftoverDir};

// ── Types ─────────────────────────────────────────────────────────────────────

/// An installed .app bundle with precomputed match patterns.
#[derive(Debug, Clone)]
pub struct CanonicalApp {
    pub bundle_id: String,
    pub display_name: String,
    pub executable_name: String,
    pub vendor_segment: String,
    /// Lowercase strings that any leftover dir_name can be compared against.
    /// Generated from bundle_id segments + aliases + display_name + executable_name.
    pub dir_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LeftoverStatus {
    /// No installed app matches — genuine orphan, safe to clean.
    Orphaned,
    /// Belongs to an installed app. Clean button should be disabled.
    Companion {
        belongs_to_bundle_id: String,
        belongs_to_display_name: String,
    },
    /// macOS system service or developer default cache. Hidden by default.
    SystemManaged,
    /// Belongs to Macroscope itself. Hidden by default alongside SystemManaged.
    SelfManaged,
    /// Pattern matches an Electron shell cache or similar, but no vendor known.
    Ambiguous {
        pattern_hint: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifiedLeftover {
    pub path: String,
    pub dir_name: String,
    pub size_bytes: u64,
    pub status: LeftoverStatus,
}

/// The result of classifying an apps snapshot through the identity layer.
#[derive(Debug, Clone)]
pub struct IdentityGraph {
    pub installed: Vec<CanonicalApp>,
    pub leftovers: Vec<ClassifiedLeftover>,
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub fn resolve(raw_apps: &[InstalledApp], raw_leftovers: &[LeftoverDir]) -> IdentityGraph {
    resolver::build_graph(raw_apps, raw_leftovers)
}

/// Build CanonicalApp list from installed apps, without classifying any leftovers.
/// Cheap: call once and reuse for repeated per-path classification.
pub(crate) fn build_canonical_apps(installed_apps: &[InstalledApp]) -> Vec<CanonicalApp> {
    resolver::build_graph(installed_apps, &[]).installed
}

/// Classify a single leftover directory against a pre-built canonical app list.
pub(crate) fn classify_leftover_with_apps(
    leftover: &LeftoverDir,
    canonicals: &[CanonicalApp],
) -> ClassifiedLeftover {
    resolver::classify_one(leftover, canonicals)
}
