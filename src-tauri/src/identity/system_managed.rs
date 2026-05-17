/// Directory names that belong to macOS system services or developer tool
/// defaults. These are hidden from the UI by default (SYSTEM badge, show-system
/// toggle reveals them). Never recommend deletion of these entries.
pub const SYSTEM_MANAGED_DIRS: &[&str] = &[
    // macOS system services
    "SiriTTS",
    "GeoServices",
    "Maps",
    "ControlCenter",
    "CallHistoryDB",
    "CallHistoryTransactions",
    "contactsd",
    "identityservicesd",
    "stickersd",
    "FaceTime",
    "AddressBook",
    "locationaccessstored",
    "homeenergyd",
    "tipsd",
    "iLifeMediaBrowser",
    "Instruments",
    "Knowledge",
    "kpeople",
    "kpeoplevcard",
    "DifferentialPrivacy",
    "FileProvider",
    "AudioUnitCache",
    "LSMImageCache",
    "TrickPlay",
    "CloudKit",
    "EnergyKit",
    "ARFileCache",
    "App Store",
    "Dock",
    "Mozilla",
    "networkserviceproxy",
    "Music",
    "ByHost",
    "State",
    "Preferences",
    // Dev tool default caches — not really user leftovers
    "Homebrew",
    "conda",
    "pnpm",
];

pub fn is_system_managed(dir_name: &str) -> bool {
    SYSTEM_MANAGED_DIRS.contains(&dir_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_system_dirs_are_managed() {
        assert!(is_system_managed("SiriTTS"));
        assert!(is_system_managed("contactsd"));
        assert!(is_system_managed("Homebrew"));
    }

    #[test]
    fn unknown_dirs_are_not_managed() {
        assert!(!is_system_managed("BraveSoftware"));
        assert!(!is_system_managed("JetBrains"));
    }

    #[test]
    fn check_is_case_sensitive() {
        // Must match exact case — dir_name comes from filesystem as-is
        assert!(!is_system_managed("siritts"));
        assert!(is_system_managed("SiriTTS"));
    }
}
