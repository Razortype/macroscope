# Macroscope Architecture

Design decisions and platform notes captured before implementation began.
Most of these answer the question "why did we do it this way?" and are
worth reading if you plan to contribute or extend Macroscope.

---

## Area 1: Tauri v2

### 1a. Scaffold (`create-tauri-app`)

No `--target` flag on `create-tauri-app`. Use interactive prompts or:

```bash
npm create tauri-app@latest . -- --template react-ts
```

The `aarch64-apple-darwin` target is NOT set at scaffold time. Set it post-init in
`.cargo/config.toml`:

```toml
[build]
target = "aarch64-apple-darwin"
```

Or pass `--target aarch64-apple-darwin` at build time: `cargo tauri build --target aarch64-apple-darwin`.

### 1b. `tauri-plugin-shell` v2 — Capabilities Syntax

**Breaking change from v1:** The old `tauri.conf.json` `allowlist.shell` is gone. In v2,
every allowed command must be explicitly declared in a capability scope object. Wildcard `cmd`
paths are NOT supported — each entry requires a literal absolute path:

```json
{
  "permissions": ["shell:allow-execute"],
  "scope": {
    "allow": [
      {
        "name": "claude-cmd",
        "cmd": "/opt/homebrew/bin/claude",
        "args": [{ "validator": ".*" }],
        "sidecar": false
      }
    ]
  }
}
```

**Practical consequence for Macroscope:** For a user-configurable binary path, the cleanest
solution is to bypass the JS shell plugin entirely and spawn `claude` directly from Rust via
`tokio::process::Command`. This avoids the literal-path restriction and keeps all subprocess
logic in Rust where the allowlist enforcement lives. This is the chosen approach.

### 1c. `tauri-plugin-global-shortcut` v2 — Runtime API

Key types: `GlobalShortcutExt` (trait), `Shortcut`, `Modifiers`, `Code`, `ShortcutState`.

```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Modifiers, Code};

let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyM);
app.global_shortcut().register(shortcut)?;
// later:
app.global_shortcut().unregister(shortcut)?;
```

**Gotcha:** Double-registering the same shortcut causes a silent failure on some macOS versions.
Always `unregister` before re-registering (e.g., on settings change).

### 1d. Window API — Show/Hide/Focus/Center, Hide-on-Blur

Rust `WebviewWindow` methods (all return `Result`):
- `window.show()` / `window.hide()`
- `window.set_focus()` — brings to front and focuses
- `window.center()`
- `window.is_visible()` → `Result<bool>`

There is NO built-in `hide_on_blur` config option in `tauri.conf.json`. Implement via:

```rust
window.on_window_event(|event| {
    if let WindowEvent::Focused(false) = event {
        window.hide().unwrap();
    }
});
```

Hide-on-Esc: implement in JS (`keydown` listener calling `appWindow.hide()`). Simpler than
Rust and requires no additional permissions.

### 1e. Capabilities/Permissions JSON Schema

Files live in `src-tauri/capabilities/*.json`, auto-loaded. Minimal capability file:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main window capabilities",
  "windows": ["main"],
  "platforms": ["macOS"],
  "permissions": [
    "core:default",
    "shell:allow-execute",
    "shell:allow-open",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "core:window:allow-center",
    "core:window:allow-is-visible"
  ]
}
```

Permission identifiers follow `${plugin-name}:${permission-name}`.

---

## Area 2: Claude Code CLI (`claude` binary) on macOS

### 2a. `claude -p --output-format json` in Non-Interactive Context

Confirmed: works fully non-interactively with piped stdin. JSON output schema:

```json
{
  "type": "result",
  "subtype": "success",
  "result": "<text response>",
  "session_id": "<uuid>",
  "total_cost_usd": 0.0042,
  "duration_ms": 3210,
  "is_error": false
}
```

The text response is in the `result` field. For structured outputs via `--json-schema`, the
validated output appears in `structured_output` alongside metadata.

### 2b. Passing Large JSON Blobs

Three options:
1. **Pipe via stdin** — capped at ~10 MB. Exceeding exits non-zero with a clear error.
2. **File reference in prompt** — write JSON to a temp file, reference the path in the prompt
   string. Bypasses the 10 MB stdin cap. **This is the chosen approach for Macroscope.**
3. **Inline in prompt string** — impractical for large blobs due to shell escaping.

Implementation: use the `tempfile` crate (`NamedTempFile`) so the file is automatically
removed on drop (success, error, or panic). No manual cleanup needed.

### 2c. Exit Codes

- `0` — success
- Non-zero (typically `1`) — failure (auth error, network error, API error, stdin cap exceeded)
- Errors surfaced on **stderr** in text form AND reflected in JSON as `"is_error": true` with
  a message in `result`.

`claude auth status` exits `0` if logged in, `1` if not — useful for the startup health check.

### 2d. Install Paths on Apple Silicon macOS

Priority order for auto-detection:
1. `/opt/homebrew/bin/claude` — most common (Homebrew on Apple Silicon)
2. `~/.local/bin/claude` — native installer (newer default)
3. `/usr/local/bin/claude` — Intel Homebrew path (less relevant for aarch64)
4. `~/.claude/local/claude` — older/alternative path

Strategy: check paths in order via `Path::exists()`, or spawn `which claude` as fallback.

### 2e. Auth Inheritance

Reads credentials from `~/.claude.json` automatically. No flags needed. Do NOT use `--bare`
(bypasses OAuth and requires `ANTHROPIC_API_KEY` env var). Tauri inherits the user's env,
so auth works automatically for non-bare invocations.

---

## Area 3: Tailwind v4 + Vite + Tauri

### 3a. `@tailwindcss/vite` Setup

```bash
npm install tailwindcss @tailwindcss/vite
```

`vite.config.ts`:
```typescript
import tailwindcss from "@tailwindcss/vite";
// add tailwindcss() to plugins array
```

Import in CSS: `@import "tailwindcss"` (replaces all `@tailwind base/components/utilities`
directives from v3). No `tailwind.config.js` required or needed.

### 3b. `@theme` Block and Utility Class Generation

**Critical:** Only variables inside `@theme {}` generate Tailwind utility classes. Variables
in `:root {}` are invisible to the class generator.

```css
@theme {
  --color-text-primary: hsl(210 15% 95%); /* → text-text-primary, bg-text-primary, etc. */
  --color-bg-base: hsl(220 14% 7%);       /* → bg-bg-base */
}
```

Naming convention: `--color-*` maps to color utilities (`text-`, `bg-`, `border-`, `ring-`),
`--font-*` maps to `font-*`, `--spacing-*` to spacing utilities.

### 3c. WKWebView on macOS

No critical known issues. WKWebView on macOS 13+ handles `@layer`, custom properties, and
CSS variables correctly. Handle dark mode explicitly via `@theme` variables — do not rely on
`prefers-color-scheme` media queries propagating through WKWebView automatically.

---

## Area 4: macOS Command Surface

| Command | Gotcha |
|---|---|
| `df -b /` | Use `-b` for bytes. `-k` on macOS gives 1024-byte blocks (not 512 per POSIX). `-h` is human-readable only. |
| `du -sh <path>` | Returns partial results + stderr warnings for permission-denied subdirs, but exit code may still be 0. Handle stderr gracefully. |
| `lsof -i -nP` | No sudo needed for current-user connections. System-wide connections need elevation. Can emit thousands of lines. |
| `ps -axo pid,ppid,user,rss,comm,etime` | `rss` is in **KB** (multiply ×1024 for bytes). `comm` truncates at ~15 chars — use `command` for full path. |
| `launchctl list` | Tab-separated 3 columns: PID (or `-`), last exit status, label. Skip header line. |
| `osascript` login items | Requires Automation permission (System Events). Add `com.apple.security.automation.apple-events` to entitlements. If denied, returns error — must be handled gracefully as a partial failure. |
| `dscl . list /Users` | Returns dozens of `_`-prefixed system accounts (e.g., `_www`, `daemon`). Filter: only UIDs ≥ 501 are regular users. |
| `kmutil showloaded` | No sudo or SIP requirement for reading. Replaced `kextstat` in macOS 11+. |

---

## Area 5: Allowlist Enforcement

### Glob Matching

Use **`globset`** crate (not `glob`): actively maintained, BurntSushi. Supports matching
multiple patterns simultaneously, correct `*`-doesn't-cross-separator semantics by default.
Use `**` for recursive matching.

```toml
globset = "0.4"
```

### Tilde Expansion

`std::path::Path` does NOT expand `~`. Use the `dirs` crate:

```toml
dirs = "5"
```

```rust
fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}
```

All allowlist checks happen in Rust — the frontend cannot bypass them.

---

## Area 6: `trash` Crate on macOS

- Uses `NSFileManager.trashItem(at:resultingItemURL:)` — same API as Finder "Move to Trash".
  Files are fully recoverable from Finder's Trash.
- Works correctly on `aarch64-apple-darwin`. No known Apple Silicon issues.
- **Gotcha:** "Put Back" metadata (restore to original location) is only set for the FIRST
  item trashed per process — an OS-level limitation of `NSFileManager`, not a crate bug.
  Subsequent items go to Trash but lose original-path tracking in Finder's UI.
- `trash::delete(path)` handles directories recursively as a single Trash unit.
- `trash::delete_all(paths)` for batch operations.
- Fails with `Err` for permission-denied or SIP-protected paths — handle gracefully.

---

## Key Surprises

1. `tauri-plugin-shell` v2 does NOT support wildcard `cmd` — literal paths only. Bypassed by
   spawning from Rust directly.
2. `df -k` on macOS reports 1024-byte blocks, not 512. Use `df -b` for bytes.
3. `ps rss` is KB, not bytes.
4. Only `@theme {}` (not `:root {}`) generates Tailwind v4 utility classes.
5. `claude --bare` skips OAuth — do not use for Macroscope.
6. `trash` crate "Put Back" limitation: only the first item per process gets full Finder
   restore-path metadata.
7. `dscl . list /Users` returns dozens of `_`-prefixed system accounts — always filter.

---

## Final Architecture Decisions

| Decision | Choice | Reason |
|---|---|---|
| `claude` spawning | `tokio::process::Command` in Rust | Bypasses `tauri-plugin-shell` literal-path restriction |
| Large snapshot payload | Write to `NamedTempFile`, reference path in prompt | Avoids 10 MB stdin cap; auto-cleaned on drop |
| Glob matching | `globset` crate | Actively maintained, correct semantics |
| Tilde expansion | `dirs` crate | `std::path::Path` doesn't expand `~` |
| Allowlist enforcement | Rust only | Frontend cannot bypass |
| Hide-on-blur | Rust `on_window_event` | Direct OS event |
| Hide-on-Esc | JS `keydown` listener | Simpler, no extra permissions |
| Default prompts | `include_str!` at compile time + copy to AppSupport for user discoverability | App never breaks if user deletes AppSupport files |
| Error handling | `thiserror`-based `AppError` in `error.rs` | Consistent across all Tauri commands |
