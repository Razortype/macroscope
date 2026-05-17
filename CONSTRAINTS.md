# Constraints

Non-functional truths about Macroscope. These are not bugs; they are scope
decisions for v0.1.0.

## Platform

- **macOS Sequoia (15.x) or later, Apple Silicon only.** Built and tested
  on aarch64-apple-darwin. Earlier macOS versions and Intel Macs are
  untested. Some features (NSFileManager trash API, current launchctl
  behavior, SMAppService login items) are version-sensitive and may break
  on older systems.
- **English-locale macOS assumed.** Standard library paths (`~/Library/
  Application Support`, `~/Library/Caches`, etc.) are referenced verbatim.
  Non-English locales are untested.

## Dependencies

- **Claude Code CLI required.** Macroscope invokes `claude -p` as a
  subprocess and parses its stream-json output. It does not call the
  Anthropic API directly and does not accept an API key. Your Claude Code
  subscription is the auth mechanism.
- **No fallback if Claude is unavailable.** If the CLI cannot be reached,
  snapshots will still complete the probe stage but the analyzer stage
  fails and no findings are produced.

## Operations

- **No background snapshot.** Snapshots are triggered manually from the
  Take snapshot button. There is no daemon, no scheduled scan, no
  filesystem watcher.
- **No auto-update.** Updates require pulling source and rebuilding.
  Sparkle, MAS, and signed-DMG distribution are out of scope for v0.1.0.
- **No code signing or notarization.** The bundled app is unsigned;
  Gatekeeper will warn on first launch. Right-click then Open to bypass.

## Privacy and network

- **Zero telemetry.** Macroscope does not phone home, does not send usage
  data to any server, does not enable analytics. The only outbound network
  traffic is whatever your local Claude Code CLI generates against
  api.anthropic.com.
- **No remote sync.** Snapshot data is stored locally in
  `~/Library/Application Support/Macroscope/`. There is no iCloud, no
  cross-device, no backup.

## Storage

- **SQLite snapshot database**: `~/Library/Application Support/Macroscope/
  macroscope.db`. Pruned to the snapshot retention setting (default 10).
- **Audit log**: `~/Library/Application Support/Macroscope/audit.log`.
  Every move-to-Trash operation is appended here for review. The log is
  not rotated; you can move or delete it manually.

## Cleanup safety

- **Trash only.** Macroscope never performs permanent deletion. Items go
  to `~/.Trash` via the macOS NSFileManager API. Empty Trash to confirm
  removal.
- **Denylist is absolute.** Paths in the denylist (`/`, `~/Documents`,
  `/System`, `/Library`, `/usr`, `/bin`, `/sbin`, `~/Library/Mobile
  Documents`) are blocked even if reachable through other rules. There is
  no way to override this from the UI.
- **Companion data is never auto-cleaned.** If a directory belongs to an
  installed app per the identity graph, it is shown but the clean action
  is disabled. The user can opt in per item via the preview dialog.

## Identity graph

- **Vendor alias table is a seed.** The current alias mapping covers
  common vendors (Brave, JetBrains, Google, Mozilla, Parallels, Zoom,
  Docker, OpenAI, Anthropic, Perplexity, Unity, etc.). It is intentionally
  small. Edge cases (JDownloader2 vs "JDownloader 2", Telegram Desktop
  standalone vs Mac App Store Telegram) may produce false orphans until
  the table is extended.
- **System-managed whitelist is also a seed.** Standard macOS daemons and
  services are included. Unknown system services may appear as orphans
  until the list is extended.

## Out of scope for v0.1.0

- Auto-update mechanism
- Code signing and notarization
- Direct Anthropic API integration (subscription bypass)
- Background scheduled snapshots
- Cross-platform support (Linux, Windows)
- Intel Mac support
- Localized UI
- Cloud backup of snapshots
- Multi-user account separation
- Custom audit prompt editing
- Plugin system
