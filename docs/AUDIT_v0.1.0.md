# Code Quality Audit — v0.1.0

Date: 2026-05-17  
Scope: all Rust source (`src-tauri/src/`) and all TypeScript source (`src/`)  
Read-only investigation. No changes made.

---

## Critical

### 1. Shell injection in `toggle_launchctl` via `osascript`

**File:** `src-tauri/src/executor.rs:607–614`

```rust
let cmd = format!(
    "do shell script \"/bin/launchctl {} {}\" with administrator privileges",
    verb, service_target
);
std::process::Command::new("osascript").args(["-e", &cmd]).output()
```

`service_target` is built from `entry.label`, which comes from plist filenames on disk. A plist with a label containing shell metacharacters (`;`, `` ` ``, `$(…)`) would be injected into the shell string passed to `osascript`. The `is_label_toggleable()` guard only checks known prefixes — it does not sanitize the full label string.

**Fix:** Build the launchctl command without the osascript shell wrapper. Pass the service target as a discrete argument to `sudo -A /bin/launchctl` or use a more constrained authorization method. Never interpolate arbitrary strings into an AppleScript `do shell script`.

---

### 2. Hardcoded UID 501 in TypeScript service target

**File:** `src/lib/persistence.ts:4`

```typescript
export function computeServiceTarget(entry: PersistenceEntry): string {
  const uid = "501";
```

This value is passed to the Rust `toggle_persistence` command, which uses it verbatim in the `launchctl` service target string (e.g. `gui/501/com.example.agent`). On any machine where the primary user is not UID 501 (UID 502+ is common after user account deletions and recreations), `launchctl` silently targets the wrong domain. Agents will appear to toggle successfully but the command operates on a different user's domain.

The Rust side correctly calls `unsafe { libc::getuid() }` in `persistence.rs:54` when constructing the target server-side, but that function is never used for the toggle flow — the frontend-computed value is used instead.

**Fix:** Expose a `get_current_uid` Tauri command backed by `libc::getuid()` and call it once at startup. Alternatively, compute the service target entirely on the Rust side and pass only the entry label and kind from the frontend.

---

## High

### 3. Blocking I/O on the async executor in `get_lifetime_stats`

**File:** `src-tauri/src/lib.rs:303`

```rust
pub async fn get_lifetime_stats(db: State<'_, Db>) -> Result<LifetimeStats, String> {
    let (snapshots, findings) = tokio::task::spawn_blocking(move || { … }).await…;
    let bytes_freed = read_bytes_freed_from_audit_log(); // <-- blocking here
    Ok(LifetimeStats { … })
}
```

`read_bytes_freed_from_audit_log()` calls `std::fs::read_to_string` directly in an async function body, outside `spawn_blocking`. This blocks the Tokio executor thread. As the audit log grows (one entry per execution), this becomes progressively slower and starves concurrent async tasks.

**Fix:** Move `read_bytes_freed_from_audit_log()` into the existing `spawn_blocking` closure alongside the DB calls.

---

### 4. `execute_paths` command bypasses identity-classification gate

**File:** `src-tauri/src/lib.rs:415` / `src-tauri/src/executor.rs:248`

`execute_paths` (mapped to the `execute_paths` Tauri command) calls `execute_actions`, which goes straight to the allowlist check without running identity classification. The reviewed path `execute_previewed_paths` applies the `ActionClass` gate (`CompanionRunning`, `SystemManaged`, `Protected`, `Ambiguous` are all blocked). `execute_paths` skips this entirely — it only enforces the path allowlist.

The command is still registered in `lib.rs:415` and therefore callable from any frontend code. The current UI exclusively uses `execute_previewed`, so this isn't exploited today, but it is an active attack surface if the command handler table is ever accessed.

**Fix:** If `execute_paths` serves no purpose in the current flow, remove the command registration and the `execute_actions` function. If it is kept for internal use, add at minimum a documentation comment explaining why identity classification is intentionally skipped.

---

### 5. Unsafe `unwrap()` in `analyze_snapshot` after availability check

**File:** `src-tauri/src/analyzer.rs:252`

```rust
if !claude_status.available {
    return Err(…);
}
let claude_path = claude_status.path.clone().unwrap(); // panics if path is None
```

`available: true` does not guarantee `path: Some(…)` — the two fields are set independently in `compute_claude_status`. If `path` is ever `None` while `available` is `true` (e.g. a future code path sets `available` without setting `path`), this panics the tokio task. The panic propagates as a join error upstream.

**Fix:**
```rust
let claude_path = claude_status.path.clone()
    .ok_or_else(|| AppError::ClaudeCli("Claude path is None despite available=true".into()))?;
```

---

### 6. Sequential app metadata probing — `O(n)` subprocess calls

**File:** `src-tauri/src/snapshot/apps.rs:57–70`

```rust
for path in &app_paths {
    let meta = read_app_meta(path).await;  // sequential
```

`read_app_meta` spawns up to four subprocesses per app: one `mdls` for bundle ID, up to three `mdls` for last-opened date variants, and one `du` via `spawn_blocking`. For 80 apps this is 320+ sequential subprocess calls. The apps probe is the slowest in the snapshot pipeline.

**Fix:** Collect the futures and drive them with `futures::future::join_all` or similar. The `du` calls already use this pattern via `spawn_blocking` handles collected before the join loop — extend the same pattern to the full `read_app_meta` call.

---

## Medium

### 7. `count_all_findings()` loads and deserializes all payload blobs to count items

**File:** `src-tauri/src/db.rs:235–247`

```rust
pub fn count_all_findings(&self) -> Result<usize, AppError> {
    let mut stmt = conn.prepare("SELECT payload FROM analysis_results")?;
    for row in rows {
        let payload = row?;
        if let Ok(findings) = serde_json::from_str::<Vec<serde_json::Value>>(&payload) {
            total += findings.len();
        }
    }
```

Every call deserializes every findings blob to count array elements. Called from `get_lifetime_stats` which is called by the Settings page. As snapshot count grows, this becomes O(snapshots × findings) deserialisation work.

**Fix:** Add a `finding_count INTEGER` column to `analysis_results` and populate it at insert time, or use SQLite's `json_array_length(payload)` in the query.

---

### 8. Login item `disabled` state is always `false`

**File:** `src-tauri/src/snapshot/persistence.rs:120–132`

```rust
if let Ok(ref items) = login_items {
    for item in items {
        entries.push(PersistenceEntry {
            …
            disabled: false,  // no way to determine disabled state
```

`osascript` returns only the name of each login item. `launchctl print-disabled` queries launchd domains but login items are managed by the Login Items system (SMAppService / legacy `lsregister`), not launchd. The disabled field is therefore always `false` regardless of whether the user has disabled the item in System Settings.

The Security tab toggle switch shows each login item as "enabled" when it may not be. Toggling a login item via launchctl is also the wrong mechanism — login items should use `SMAppService` or `sfltool`.

This is an accuracy issue for the current probe and a behavioral issue for the toggle. Flag as medium because the Security tab is informational.

---

### 9. `allPaths` missing from `PreviewDialog` `useEffect` dependency array

**File:** `src/components/PreviewDialog.tsx:183–205`

```typescript
const allPaths = findings.flatMap((f) => f.paths_to_remove ?? []);

useEffect(() => {
  …
  invoke<ResolvedTarget[]>("preview_execution", { snapshotId, paths: allPaths })
}, [open, snapshotId]); // eslint-disable-line react-hooks/exhaustive-deps
```

`allPaths` is derived from `findings` but excluded from the dependency array. When the dialog is opened for a different set of findings but `open` and `snapshotId` don't change (e.g. clicking "Execute" for a different finding while the dialog is still open), `preview_execution` will be called with stale paths from the first invocation. The eslint-disable comment silences the warning without explaining the intent.

**Fix:** Add `allPaths` to the dependency array, or stabilize the paths with `useMemo` keyed on `findings` and add the memoized value to deps. If the intent is truly "run once per open", document why and confirm the case where findings change doesn't apply.

---

### 10. Tab badge uses legacy `leftovers` field instead of `classified_leftovers`

**File:** `src/pages/Dashboard.tsx:326–330`

```typescript
apps: activeSnapshot?.apps
  ? activeSnapshot.apps.installed.length + activeSnapshot.apps.leftovers.length
  : undefined,
```

`leftovers` is the backward-compat field that only contains `Orphaned` items. The full leftover list — including `Companion`, `SystemManaged`, `Ambiguous` entries — is in `classified_leftovers`. The Apps tab badge under-counts the total leftover set.

Same issue appears in `src/pages/tabs/OverviewTab.tsx:581`:
```typescript
return `${a.installed.length} installed · ${a.leftovers.length} leftovers · ${stale} stale`;
```

**Fix:** Use `activeSnapshot.apps.classified_leftovers.length` in both places.

---

## Low

### 11. `useTauriEvent` hook is defined but never imported anywhere

**File:** `src/hooks/useTauriEvent.ts`

The hook is exported but `grep` finds no imports in the codebase. `AnalysisRunContext.tsx` uses `listen` directly. Either delete the file or document that it is reserved for future use.

---

### 12. `PROBE_KEYS` in `AnalysisRunContext` silently drops `large_files` probe events

**File:** `src/context/AnalysisRunContext.tsx:67–76, 203–205`

```typescript
export const PROBE_KEYS = [
  "disk", "processes", "network", "persistence", "users", "kernel", "apps",
] as const;
…
const idx = PROBE_KEYS.indexOf(payload.probe as ProbeKey);
if (idx === -1) return prev;  // large_files events dropped here silently
```

The backend emits `snapshot:probe` events with `probe: "large_files"` (via `probe_timed_infallible`). These are silently discarded. If hiding `large_files` from the progress UI is intentional, the backend should not emit events for it, or the emit should be conditional. If it is unintentional, `"large_files"` needs to be added to `PROBE_KEYS`.

---

### 13. Hardcoded watched path for Notion in disk probe

**File:** `src-tauri/src/snapshot/disk.rs:84`

```rust
home.join("Library/Application Support/Notion"),
```

One of the eight watched paths is Notion-specific and unconditional. On machines without Notion this returns `exists: false` and wastes a `du` subprocess call. More importantly, if this list ever grows, it becomes an arbitrary maintenance burden. The watched paths should either be configurable or driven by what's actually installed.

---

### 14. Tauri event listener cleanup is async in a synchronous cleanup slot

**File:** `src/context/AnalysisRunContext.tsx:311–313`

```typescript
return () => {
  Promise.all(pending).then((fns) => fns.forEach((fn) => fn()));
};
```

React's effect cleanup is synchronous. The Promise chain fires after the cleanup slot returns, meaning the unlisten calls happen at an unspecified future tick. `AnalysisRunProvider` wraps the full app and is never unmounted in practice, so this is dormant. But if it ever is unmounted (e.g. in tests), the listeners will leak until the pending Promises resolve.

**Fix:** Collect resolved unlisten functions into a ref and call them synchronously in the cleanup, or use a flag pattern to unlisten as each Promise resolves.

---

### 15. `db.rs` mutex lock `.unwrap()` calls — no poisoning recovery

**File:** `src-tauri/src/db.rs:65` and 13 other locations

Every `Db` method calls `self.conn.lock().unwrap()`. If a thread panics while holding the mutex, all subsequent lock calls will panic the process. For this use case (single-process, single writer, short critical sections) this is pragmatically acceptable, but it should at minimum use `.expect("db mutex poisoned")` so crash reports carry a meaningful message rather than a bare "called `Option::unwrap()` on a `None` value".

---

### 16. Duplicate detection groups by filename only — false positive rate is high

**File:** `src-tauri/src/snapshot/large_files.rs:252–278`

Files are grouped into "duplicates" if they share the same filename. Two `image.png` files in different directories with entirely different content are reported as duplicates. Files with identical content but different names are missed. This analysis is sent to Claude, which should reason about it, but the signal quality is low and may produce low-confidence findings about spurious "duplicates".

---

## Summary Table

| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|
| 1 | Critical | executor.rs | 607 | Shell injection via osascript service_target interpolation |
| 2 | Critical | persistence.ts | 4 | UID hardcoded to 501; wrong domain for non-default users |
| 3 | High | lib.rs | 303 | Blocking `read_to_string` in async function body |
| 4 | High | lib.rs | 415 | `execute_paths` command bypasses identity classification |
| 5 | High | analyzer.rs | 252 | `unwrap()` on `path` after `available` check — not equivalent |
| 6 | High | snapshot/apps.rs | 57 | Sequential mdls + du calls per app — no parallelism |
| 7 | Medium | db.rs | 235 | `count_all_findings` deserializes all payloads to count |
| 8 | Medium | snapshot/persistence.rs | 128 | Login item `disabled` field is always false |
| 9 | Medium | PreviewDialog.tsx | 205 | `allPaths` missing from useEffect deps; eslint-disable masks it |
| 10 | Medium | Dashboard.tsx | 327 | Tab badge uses legacy `leftovers` count, not `classified_leftovers` |
| 11 | Low | hooks/useTauriEvent.ts | — | Exported hook is unused dead code |
| 12 | Low | AnalysisRunContext.tsx | 203 | `large_files` probe events silently dropped |
| 13 | Low | snapshot/disk.rs | 84 | Hardcoded Notion watched path |
| 14 | Low | AnalysisRunContext.tsx | 311 | Async Tauri listener cleanup in sync cleanup slot |
| 15 | Low | db.rs | 65+ | Mutex `.unwrap()` with no poison message |
| 16 | Low | snapshot/large_files.rs | 252 | Filename-only duplicate detection, high false positive rate |
