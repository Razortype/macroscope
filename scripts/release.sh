#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Color output — graceful fallback when tput is absent or no terminal
# ──────────────────────────────────────────────
RED=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
_setup_colors() {
  command -v tput >/dev/null 2>&1 || return
  [ -t 1 ] || return
  local n; n=$(tput colors 2>/dev/null) || return
  [ "${n}" -ge 8 ] || return
  RED=$(tput setaf 1); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
  BOLD=$(tput bold);   RESET=$(tput sgr0)
}
_setup_colors

# ──────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
KEY_FILE="${HOME}/.tauri/macroscope.key"
BUNDLE_MACOS="${REPO_ROOT}/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"

# ──────────────────────────────────────────────
# State
# ──────────────────────────────────────────────
VERSION=""
TAG=""
DRY_RUN=false
CARGO_LOCK_AMENDED=false
CURRENT_STEP="init"

# ──────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────
log()  { echo "${BOLD}→${RESET} $*"; }
ok()   { echo "${GREEN}✓${RESET} $*"; }
warn() { echo "${YELLOW}⚠${RESET}  $*"; }
die()  { echo "${RED}❌${RESET} $*" >&2; exit 1; }

# ──────────────────────────────────────────────
# ERR trap — prints step context and recovery hints
# ──────────────────────────────────────────────
_on_error() {
  local line=$1
  echo "" >&2
  echo "${RED}❌ Failed at step: ${CURRENT_STEP} (line ${line})${RESET}" >&2
  echo "" >&2
  echo "Recovery:" >&2
  case "${CURRENT_STEP}" in
    pre-flight|version-derivation|notes)
      echo "  No files were modified. Fix the issue and re-run the script." >&2
      ;;
    version-bump)
      echo "  If commit is on origin: git revert HEAD && git push" >&2
      echo "  If not yet pushed:      git reset --soft HEAD~1" >&2
      ;;
    build)
      echo "  Version bump is committed. To continue manually:" >&2
      echo "    export TAURI_SIGNING_PRIVATE_KEY=\$(cat ${KEY_FILE})" >&2
      echo "    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''" >&2
      echo "    npm run tauri build" >&2
      ;;
    cargo-lock-amend)
      echo "  git add src-tauri/Cargo.lock && git commit --amend --no-edit && git push --force-with-lease" >&2
      ;;
    manifest)
      echo "  Build artifacts exist. Regenerate latest.json manually and resume from step 10 (publish)." >&2
      echo "  See release/README.md step 5." >&2
      ;;
    publish)
      echo "  All artifacts are ready in the repo root. Run gh release create manually." >&2
      echo "  See release/README.md step 6." >&2
      ;;
    verify)
      echo "  Release may be published. Verify manually:" >&2
      echo "    curl -sL https://github.com/Razortype/macroscope/releases/latest/download/latest.json | jq ." >&2
      echo "  Artifacts were NOT cleaned up — they are still in the repo root." >&2
      ;;
    *)
      echo "  Check the output above and release/README.md for manual recovery." >&2
      ;;
  esac
}
trap '_on_error $LINENO' ERR

# ──────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────
VERSION_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --version)   VERSION_OVERRIDE="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    *)           die "Unknown argument: $1\nUsage: $0 [--version X.Y.Z] [--dry-run]" ;;
  esac
done

cd "${REPO_ROOT}"

# ══════════════════════════════════════════════
# STEP 1 — Pre-flight checks
# ══════════════════════════════════════════════
CURRENT_STEP="pre-flight"
log "Running pre-flight checks..."

# a) Working tree clean
git diff-index --quiet HEAD -- \
  || die "Pre-flight [a]: Working tree has uncommitted changes. Run 'git status'."

# b) On main branch
_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
[ "${_branch}" = "main" ] \
  || die "Pre-flight [b]: Must be on 'main' (currently on '${_branch}')."

# c) Synced with origin/main
git fetch --quiet origin main
_local=$(git rev-parse HEAD)
_remote=$(git rev-parse origin/main)
[ "${_local}" = "${_remote}" ] \
  || die "Pre-flight [c]: Local main is behind origin/main. Run 'git pull'."

# d) Signing key readable
[ -f "${KEY_FILE}" ] \
  || die "Pre-flight [d]: Signing key not found at ${KEY_FILE}."
[ -r "${KEY_FILE}" ] \
  || die "Pre-flight [d]: Signing key at ${KEY_FILE} is not readable."

# e) jq installed
command -v jq >/dev/null 2>&1 \
  || die "Pre-flight [e]: 'jq' not found. Install with: brew install jq"

# f) gh authenticated
gh auth status >/dev/null 2>&1 \
  || die "Pre-flight [f]: GitHub CLI not authenticated. Run: gh auth login"

ok "Pre-flight checks a–f passed."

# ══════════════════════════════════════════════
# STEP 2 — Version derivation
# ══════════════════════════════════════════════
CURRENT_STEP="version-derivation"
log "Deriving release version..."

LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
_bare="${LATEST_TAG#v}"
IFS='.' read -r _maj _min _pat <<< "${_bare}"
PROPOSED="${_maj}.${_min}.$(( _pat + 1 ))"

if [ -n "${VERSION_OVERRIDE}" ]; then
  VERSION="${VERSION_OVERRIDE}"
  log "Using explicit version: ${VERSION}"
else
  printf "\n${YELLOW}Release version [${PROPOSED}]: ${RESET}"
  read -r _input
  VERSION="${_input:-${PROPOSED}}"
fi

echo "${VERSION}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || die "Version '${VERSION}' is not a valid semver (expected X.Y.Z)."

TAG="v${VERSION}"

# g) No version conflict
git tag -l | grep -qxF "${TAG}" \
  && die "Pre-flight [g]: Tag '${TAG}' already exists. Choose a different version." || true

ok "Version: ${VERSION}  Tag: ${TAG}"

# ══════════════════════════════════════════════
# STEP 3 — Release notes
# ══════════════════════════════════════════════
CURRENT_STEP="notes"
log "Resolving release notes..."

NOTES_DIR="${REPO_ROOT}/release/notes"
NOTES_FILE="${NOTES_DIR}/${TAG}.md"
mkdir -p "${NOTES_DIR}"

if [ -f "${NOTES_FILE}" ] && [ -s "${NOTES_FILE}" ]; then
  ok "Using existing notes: release/notes/${TAG}.md"
else
  log "Generating notes stub from git log ${LATEST_TAG}..HEAD ..."
  {
    printf "# Macroscope %s\n\n" "${TAG}"
    git log --oneline "${LATEST_TAG}..HEAD" | sed 's/^/- /'
  } > "${NOTES_FILE}"

  _stub_hash=$(md5 -q "${NOTES_FILE}" 2>/dev/null \
    || md5sum "${NOTES_FILE}" | cut -d' ' -f1)

  warn "Opening \${EDITOR:-vim} to edit release notes."
  ${EDITOR:-vim} "${NOTES_FILE}"

  [ -s "${NOTES_FILE}" ] \
    || die "Release notes file is empty. Cannot continue."

  _final_hash=$(md5 -q "${NOTES_FILE}" 2>/dev/null \
    || md5sum "${NOTES_FILE}" | cut -d' ' -f1)
  [ "${_stub_hash}" != "${_final_hash}" ] \
    || die "Release notes appear unchanged from the stub. Edit the file and re-run."

  ok "Release notes saved: release/notes/${TAG}.md"
fi

# ══════════════════════════════════════════════
# STEP 4 — Version bump
# ══════════════════════════════════════════════
CURRENT_STEP="version-bump"
log "Bumping version to ${VERSION} in three files..."

# JSON files: replace "version": "any" → "version": "NEW"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" package.json
# Cargo.toml: only the bare `version = "..."` line (not inline dependency version fields)
sed -i '' "s/^version = \"[^\"]*\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml

grep -q "\"version\": \"${VERSION}\"" src-tauri/tauri.conf.json \
  || die "Version bump failed in tauri.conf.json."
grep -q "\"version\": \"${VERSION}\"" package.json \
  || die "Version bump failed in package.json."
grep -q "^version = \"${VERSION}\"" src-tauri/Cargo.toml \
  || die "Version bump failed in Cargo.toml."

git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml
git commit -m "chore: bump version to ${VERSION}"
git push
ok "Version bump committed and pushed."

# ══════════════════════════════════════════════
# STEP 5 — Build
# ══════════════════════════════════════════════
CURRENT_STEP="build"
log "Building release bundle (this takes a few minutes)..."

TAURI_SIGNING_PRIVATE_KEY=$(cat "${KEY_FILE}")
export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

npm run tauri build

ARTIFACT_TAR="${BUNDLE_MACOS}/Macroscope.app.tar.gz"
ARTIFACT_SIG="${BUNDLE_MACOS}/Macroscope.app.tar.gz.sig"

[ -f "${ARTIFACT_TAR}" ] \
  || die "Build finished but expected artifact not found:\n  ${ARTIFACT_TAR}"
[ -f "${ARTIFACT_SIG}" ] \
  || die "Build finished but signature not found:\n  ${ARTIFACT_SIG}"

ok "Build complete. Both artifacts verified."

# ══════════════════════════════════════════════
# STEP 6 — Cargo.lock amend (silent, routine)
# ══════════════════════════════════════════════
CURRENT_STEP="cargo-lock-amend"
if [ -n "$(git status --porcelain src-tauri/Cargo.lock)" ]; then
  log "Cargo.lock changed — amending version bump commit..."
  git add src-tauri/Cargo.lock
  git commit --amend --no-edit
  git push --force-with-lease
  CARGO_LOCK_AMENDED=true
  ok "Cargo.lock included in version bump commit."
fi

# ══════════════════════════════════════════════
# STEP 7 — Copy artifacts to repo root (versioned names)
# ══════════════════════════════════════════════
CURRENT_STEP="manifest"
VERSIONED_TAR="Macroscope_${VERSION}_aarch64.app.tar.gz"
VERSIONED_SIG="Macroscope_${VERSION}_aarch64.app.tar.gz.sig"

log "Copying artifacts to repo root..."
cp "${ARTIFACT_TAR}" "${VERSIONED_TAR}"
cp "${ARTIFACT_SIG}" "${VERSIONED_SIG}"
ok "Copied: ${VERSIONED_TAR} and .sig"

# ══════════════════════════════════════════════
# STEP 8 — Generate latest.json
# ══════════════════════════════════════════════
log "Generating latest.json..."

_signature=$(cat "${VERSIONED_SIG}")
_iso_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
_notes=$(cat "${NOTES_FILE}")
_download_url="https://github.com/Razortype/macroscope/releases/download/${TAG}/Macroscope_${VERSION}_aarch64.app.tar.gz"

jq -n \
  --arg version   "${VERSION}" \
  --arg notes     "${_notes}" \
  --arg pub_date  "${_iso_date}" \
  --arg signature "${_signature}" \
  --arg url       "${_download_url}" \
  '{
    version:  $version,
    notes:    $notes,
    pub_date: $pub_date,
    platforms: {
      "darwin-aarch64": {
        signature: $signature,
        url: $url
      }
    }
  }' > latest.json

ok "latest.json written."

# ══════════════════════════════════════════════
# STEP 9 — Pre-publish confirmation gate
# ══════════════════════════════════════════════
CURRENT_STEP="confirm"
_dmg_path=$(find src-tauri/target -name "Macroscope_${VERSION}_aarch64.dmg" -type f 2>/dev/null | head -1 || true)

echo ""
echo "${BOLD}──────────────────────── Release Summary ────────────────────────${RESET}"
printf "  %-10s %s\n" "Version:" "${VERSION}"
printf "  %-10s %s\n" "Tag:"     "${TAG}"
echo "  Assets:"
printf "    %s  (%s)\n" "${VERSIONED_TAR}" "$(du -sh "${VERSIONED_TAR}" | cut -f1)"
printf "    %s\n"       "${VERSIONED_SIG}"
printf "    %s\n"       "latest.json"
if [ -n "${_dmg_path}" ]; then
  printf "    %s  (DMG, optional)\n" "${_dmg_path}"
else
  printf "    %s\n" "DMG: not present (will be skipped)"
fi
echo "  Manifest preview:"
jq '{version, pub_date, notes_preview: (.notes | split("\n") | .[0])}' latest.json \
  | sed 's/^/    /'
echo "${BOLD}─────────────────────────────────────────────────────────────────${RESET}"
echo ""

if [ "${DRY_RUN}" = true ]; then
  warn "Would publish. Stopping (dry run)."
  echo ""
  echo "Dry-run artifacts left in place for inspection:"
  printf "  %s\n" "${VERSIONED_TAR}" "${VERSIONED_SIG}" "latest.json" "${NOTES_FILE}"
  exit 0
fi

printf "${YELLOW}Press Enter to publish or Ctrl-C to abort: ${RESET}"
read -r

# ══════════════════════════════════════════════
# STEP 10 — Publish GitHub release
# ══════════════════════════════════════════════
CURRENT_STEP="publish"
log "Publishing GitHub release ${TAG}..."

_gh_assets=("${VERSIONED_TAR}" "${VERSIONED_SIG}" latest.json)
[ -n "${_dmg_path}" ] && _gh_assets+=("${_dmg_path}")

gh release create "${TAG}" \
  --title "Macroscope ${TAG}" \
  --notes-file "${NOTES_FILE}" \
  "${_gh_assets[@]}"

ok "GitHub release ${TAG} published."

# ══════════════════════════════════════════════
# STEP 11 — Tag refresh (safety: ensure tag points at amended commit)
# ══════════════════════════════════════════════
if [ "${CARGO_LOCK_AMENDED}" = true ]; then
  CURRENT_STEP="tag-refresh"
  log "Refreshing tag ${TAG} to ensure it points at the amended commit..."
  git tag -f "${TAG}"
  git push origin "${TAG}" --force
  ok "Tag ${TAG} refreshed."
fi

# ══════════════════════════════════════════════
# STEP 12 — Verify published manifest
# ══════════════════════════════════════════════
CURRENT_STEP="verify"
log "Verifying published manifest..."

_manifest_url="https://github.com/Razortype/macroscope/releases/latest/download/latest.json"
_published_version=$(curl -sL "${_manifest_url}" | jq -r '.version')

if [ "${_published_version}" != "${VERSION}" ]; then
  warn "Manifest version mismatch: expected '${VERSION}', got '${_published_version}'"
  warn "Artifacts NOT cleaned up — inspect the release manually."
  exit 1
fi

ok "Manifest verified: ${_published_version} is live at latest/download/latest.json"

# ══════════════════════════════════════════════
# STEP 13 — Cleanup
# ══════════════════════════════════════════════
CURRENT_STEP="cleanup"
log "Cleaning up release artifacts from working tree..."
rm -f "${VERSIONED_TAR}" "${VERSIONED_SIG}" latest.json

echo ""
ok "${BOLD}Released ${TAG}${RESET}"
