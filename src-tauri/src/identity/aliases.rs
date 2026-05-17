/// Seed vendor alias table.
/// Key is the vendor_segment (index 1 of reverse-domain bundle_id, lowercased).
/// Values are directory names that belong to that vendor.
pub const VENDOR_ALIASES: &[(&str, &[&str])] = &[
    ("brave",       &["BraveSoftware"]),
    ("google",      &["Google", "Chrome"]),
    ("jetbrains",   &["JetBrains"]),
    ("microsoft",   &["Microsoft", "Microsoft DevDiv", "Microsoft Edge"]),
    ("mozilla",     &["Mozilla", "Firefox"]),
    ("parallels",   &["Parallels", "Parallels Software"]),
    ("zoom",        &["Zoom", "ZoomUpdater", "ZoomChat"]),
    ("docker",      &["Docker", "com.docker.docker"]),
    ("openai",      &["OpenAI", "ChatGPT", "ChatGPTHelper"]),
    ("anthropic",   &["Claude", "Anthropic"]),
    ("perplexity",  &["Perplexity", "Comet"]),
    ("thebrowser",  &["Dia", "company.thebrowser.dia"]),
    ("unity3d",     &["Unity", "UnityHub", "DefaultCompany"]),
    ("drbuho",      &["BuhoCleaner"]),
    // BuhoNTFS intentionally NOT included — separate Buho product;
    // user wants to see it as a leftover and decide independently.
];

/// Returns the alias slice for the given vendor segment, or an empty slice.
pub fn lookup_aliases(vendor_segment: &str) -> &'static [&'static str] {
    let lower = vendor_segment.to_lowercase();
    for (key, aliases) in VENDOR_ALIASES {
        if *key == lower.as_str() {
            return aliases;
        }
    }
    &[]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brave_aliases_found() {
        let aliases = lookup_aliases("brave");
        assert!(aliases.contains(&"BraveSoftware"), "expected BraveSoftware in brave aliases");
    }

    #[test]
    fn unknown_vendor_returns_empty() {
        assert!(lookup_aliases("xyzzy").is_empty());
    }

    #[test]
    fn lookup_is_case_insensitive_on_vendor() {
        let lower = lookup_aliases("google");
        let upper = lookup_aliases("Google");
        assert_eq!(lower.len(), upper.len());
    }
}
