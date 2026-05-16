# Design Token Usage Rules

## Color tokens

All colors are defined in `tokens.css` inside `@theme {}`, which makes them available as
Tailwind utility classes (e.g. `bg-bg-base`, `text-text-primary`, `border-border-subtle`).

### Amber accent (`--color-accent`)
Used **only** for:
- Primary action buttons ("Take snapshot", "Execute selected")
- Focus rings on interactive elements

Never use accent for decoration, status, or informational content.

### Severity colors
Used **only** in:
- Finding severity badges (`info` / `low` / `medium` / `high`)
- Severity indicator dots

Do not use severity colors for general UI states (loading, empty, success).

### Mono font (`--font-mono`)
Required for:
- File paths and directory paths
- Sizes (e.g. "2.7 GB", "143 MB")
- PIDs and port numbers
- Timestamps in the audit log
- Hashes and identifiers

Use sans-serif (`--font-sans`) for everything else.

## CSS variable vs. Tailwind class

For **static** values in component classes: use Tailwind utilities (`text-text-primary`).

For **dynamic** values (values computed at runtime or conditionally applied):
use inline styles: `style={{ color: 'var(--color-severity-high-fg)' }}`.

This avoids Tailwind v4 variable-resolution edge cases when class names are constructed
dynamically (e.g. `text-severity-${level}-fg` won't work — use inline style instead).

## Elevation system

| Token          | Use case                                         |
|----------------|--------------------------------------------------|
| `bg-bg-base`   | Page/window background                           |
| `bg-bg-elev-1` | Sidebar, panels                                  |
| `bg-bg-elev-2` | Cards, modals                                    |
| `bg-bg-elev-3` | Dropdowns, tooltips, popovers                    |
