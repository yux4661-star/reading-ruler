# Reading Ruler — Agent Notes

Manifest V3 Chrome extension: no bundler, plain JS/HTML/CSS. Verify with `npm test` (`node:test`).

## Layout

| Path | Role |
|------|------|
| `manifest.json` | MV3: `activeTab`, `storage`; popup; service worker; content scripts load `rulerSettings.js` before `content.js`. |
| `src/rulerSettings.js` | Defaults, clamping, `normalizeSettings`, `getOverlayGeometry(height, width)` (strip width: `min(px, 100vw)`). |
| `src/content.js` | Overlay DOM; messages `READING_RULER_SETTINGS_UPDATED`; listens to `storage` for dimension changes; disables overlay after SPA URL changes. |
| `src/popup.*` | UI; **only `height` / `width` are written** to storage (`sync` first, debounced; `local` on failure). **`enabled` is not persisted** — popup init always shows ruler off (`请手动开启阅读尺`); turning on notifies the active tab only. |
| `src/background.js` | `onInstalled`: `normalizeSettings` for `enabled`/`height`/`width` in `sync` (migrates legacy keys). |
| `test/rulerSettings.test.js` | Helper + content-script harness tests. |

## Product rules (do not “fix” without an explicit spec change)

- `height` / `width` persist via `popup.js` (with `local` fallback); reloading the page restores geometry from storage but **does not** turn the ruler on — user enables again from the popup.
- Client-side navigations clear the overlay; user re-applies from the popup.
- `height` 40–320 px; `width` 240–1600 px; default width 960.

## Docs

- `README.md` — human install / smoke checks.
- `docs/superpowers/` — planning and design history; **design can lag** — source of truth is `src/`.
