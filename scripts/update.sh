#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly APP_NAME="Macroscope"
readonly INSTALL_PATH="/Applications/${APP_NAME}.app"
readonly BUILD_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${APP_NAME}.app"

echo "→ closing any running ${APP_NAME} instance..."
osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
sleep 1

echo "→ building release bundle..."
npm run tauri build

if [[ ! -d "${BUILD_PATH}" ]]; then
  echo "✗ build did not produce ${BUILD_PATH}" >&2
  exit 1
fi

if [[ -d "${INSTALL_PATH}" ]]; then
  echo "→ removing previous installation at ${INSTALL_PATH}..."
  rm -rf "${INSTALL_PATH}"
fi

echo "→ installing fresh build to ${INSTALL_PATH}..."
cp -R "${BUILD_PATH}" "${INSTALL_PATH}"

echo "→ launching ${APP_NAME}..."
open "${INSTALL_PATH}"

readonly COMMIT_HASH=$(git rev-parse --short HEAD)
readonly VERSION=$(node -p "require('./package.json').version")
echo ""
echo "✓ ${APP_NAME} v${VERSION} (${COMMIT_HASH}) installed and launched"
