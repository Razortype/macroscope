# Dev scripts

Local development helpers — not used by the application itself.

## generate-icons.mjs

Regenerates the macOS icon bundle (`src-tauri/icons/`) from a source PNG.
Run when the app icon needs updating.

```bash
node scripts/generate-icons.mjs
```

## update.sh

Builds a release bundle and reinstalls Macroscope into `/Applications`.
Closes any running instance first, then re-launches the freshly installed
copy. Useful for testing release builds without going through the dev loop.

```bash
npm run update
```

---

Both scripts are local-only conveniences. End users install Macroscope
from a release artifact or by running `cargo tauri build` themselves.
