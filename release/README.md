# Release process

Manual release checklist for Macroscope. Run all commands from the repo root.

## Prerequisites

- Tauri signing key at `~/.tauri/macroscope.key` (generated during initial setup; keep in password manager)
- `gh` CLI authenticated (`gh auth status`)

---

## Steps

### 1. Bump version

Edit both files to the new version string (semver, e.g. `0.3.0`):

```
src-tauri/tauri.conf.json   → "version": "0.3.0"
package.json                → "version": "0.3.0"
src-tauri/Cargo.toml        → version = "0.3.0"
```

Commit the version bump:

```sh
git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml
git commit -m "chore: bump version to 0.3.0"
git tag v0.3.0
```

### 2. Build the release bundle

```sh
npm run tauri build
```

Output: `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Macroscope.app`

### 3. Archive the .app bundle

```sh
VERSION=0.3.0
tar -czf Macroscope_${VERSION}_aarch64.app.tar.gz \
  -C src-tauri/target/aarch64-apple-darwin/release/bundle/macos \
  Macroscope.app
```

### 4. Sign the archive

```sh
npm run tauri -- signer sign \
  -k ~/.tauri/macroscope.key \
  Macroscope_${VERSION}_aarch64.app.tar.gz
```

This produces `Macroscope_${VERSION}_aarch64.app.tar.gz.sig`.

### 5. Build latest.json

Copy `release/latest.json.template` to `latest.json` and fill in the placeholders:

- `{{VERSION}}` → `0.3.0`
- `{{RELEASE_NOTES}}` → one-line summary or markdown paragraph
- `{{ISO_DATE}}` → current UTC datetime, e.g. `2026-05-21T00:00:00Z`
- `{{SIGNATURE}}` → the full contents of `Macroscope_${VERSION}_aarch64.app.tar.gz.sig`

```sh
cat Macroscope_${VERSION}_aarch64.app.tar.gz.sig
# paste that output as the "signature" value in latest.json
```

### 6. Publish GitHub Release

```sh
gh release create v${VERSION} \
  --title "Macroscope v${VERSION}" \
  --notes "$(cat latest.json | python3 -c 'import sys,json; print(json.load(sys.stdin)["notes"])')" \
  Macroscope_${VERSION}_aarch64.app.tar.gz \
  Macroscope_${VERSION}_aarch64.app.tar.gz.sig \
  latest.json
```

The `latest.json` asset name must be exactly `latest.json` — this is what the updater endpoint resolves to at:
`https://github.com/Razortype/macroscope/releases/latest/download/latest.json`

### 7. Verify

After publishing, check the manifest is reachable:

```sh
curl -sL https://github.com/Razortype/macroscope/releases/latest/download/latest.json | python3 -m json.tool
```

---

## Backlog (not yet implemented)

- GitHub Actions workflow to automate steps 2–6
- Periodic background update check (currently launch-only)
- In-app changelog rendering (currently plain `notes` string)
- Intel (darwin-x86\_64) build target
- Apple Developer ID code signing and notarization
