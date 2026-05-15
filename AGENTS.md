# Reading Ruler — Agent Notes

Manifest V3 Chrome extension: no bundler, plain JS/HTML/CSS. Verify with `npm test` (`node:test`).

## Layout

| Path | Role |
|------|------|
| `manifest.json` | MV3: `activeTab`, `storage`; popup; service worker; content scripts load `rulerSettings.js` before `content.js`. |
| `src/rulerSettings.js` | Defaults, clamping, `normalizeSettings`, `getOverlayGeometry(height, width)` (strip width: `min(px, 100vw)`). |
| `src/content.js` | Overlay DOM; **move grip** (`move-grip`) on the reading strip: **click-drag** to reposition (strip stays in viewport); **8 resize handles** (corners + edges); **`Escape`** closes the overlay (capture-phase `keydown`); messages `READING_RULER_SETTINGS_UPDATED`; responds to `READING_RULER_QUERY_STATE` with `{ enabled }` for popup sync; listens to `storage` for dimension changes; debounced persist of `height`/`width` after drag-resize; disables overlay after SPA URL changes. |
| `src/popup.*` | UI; **only `height` / `width` are written** to storage (`sync` first, debounced; `local` on failure). **`enabled` is not persisted** — on open, sends `READING_RULER_QUERY_STATE` to the active tab when possible so the checkbox matches the page; if the tab reports on: "阅读尺已在当前页面开启。"; otherwise "请手动开启阅读尺。" Listens to `chrome.storage.session` for `readingRulerEscDismissed` so the switch matches **Esc** on the page. |
| `src/background.js` | `onInstalled`: `normalizeSettings` for `enabled`/`height`/`width` in `sync` (migrates legacy keys). |
| `test/rulerSettings.test.js` | Helper + content-script harness tests. |

## Product rules (do not “fix” without an explicit spec change)

- `height` / `width` persist via `popup.js` (with `local` fallback); reloading the page restores geometry from storage but **does not** turn the ruler on — user enables again from the popup.
- Client-side navigations clear the overlay; user re-applies from the popup.
- With the overlay on: **Esc** turns it off; if the popup is still open, the enable switch syncs off via `chrome.storage.session` (no `enabled` persistence — turn on again from the popup when needed).
- `height` 40–320 px; `width` 240–1600 px; default width 960.

## Docs

- `README.md` — human install / smoke checks.
- `docs/superpowers/` — planning and design history; **design can lag** — source of truth is `src/`.
