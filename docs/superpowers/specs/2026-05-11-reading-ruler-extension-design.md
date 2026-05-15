# Reading Ruler Chrome Extension Design

> **Archive (2026-05-11):** Snapshot of the first design. The shipped extension adds drag-to-move, resize handles, **Esc** to dismiss (with popup sync via `chrome.storage.session`), debounced persist from the overlay, and **`READING_RULER_QUERY_STATE`** so the popup checkbox can reflect the tab. Authoritative behavior: `src/`, `AGENTS.md`, and `README.md`.

## Goal

Build a minimal Chrome extension that helps with web reading by dimming the page above and below a transparent horizontal reading area. The first version focuses on a stable, easy-to-load extension with a simple popup for turning the ruler on or off and adjusting the reading area's height.

## Scope

The extension will support:

- A Chrome Manifest V3 extension that can be loaded as an unpacked extension.
- A popup opened from the extension icon.
- A primary enable/disable toggle in the popup.
- A slider for changing the height of the transparent reading area.
- A fixed center-positioned reading area whose **width** is user-configurable (capped by viewport width via CSS `min(widthPx, 100vw)`).
- Darkened top, bottom, left, and right mask regions while the reading ruler is enabled (middle row is a horizontal flex strip: left mask | reading area | right mask).
- Settings persisted primarily with `chrome.storage.sync`; `height` and `width` writes debounced in the popup use `chrome.storage.local` as a fallback when `sync` is rate-limited or errors.
- Immediate updates on the active tab when the user changes settings.

The first version will not support:

- Moving the ruler vertically.
- Following the mouse.
- Website-specific profiles.
- Framework-based UI or a build step.

## Recommended Approach

Use a plain JavaScript Chrome extension with no build tooling. This keeps installation simple, reduces project setup cost, and matches the narrow first-version feature set.

## Architecture

The extension will have three main runtime pieces:

- `popup`: reads and writes settings, then sends updates to the active tab.
- `content script`: owns the DOM overlay injected into each web page.
- `background service worker`: provides a future-safe place for extension-level behavior and can remain minimal in the first version.

The content script creates a single overlay root when needed. The overlay root uses fixed positioning and `pointer-events: none` so it does not block normal page interaction. It renders dimmed masks above and below the middle row; the middle row contains left mask, transparent reading strip, and right mask so variable width is centered horizontally.

## File Structure

- `manifest.json`: Manifest V3 metadata, permissions, popup, background service worker, and content script registration.
- `src/background.js`: Minimal service worker. It can define defaults or serve as an extension point.
- `src/content.js`: Creates, updates, and removes the reading ruler overlay in the current webpage.
- `src/popup.html`: Popup markup with toggle, height slider, and width slider.
- `src/popup.css`: Popup styling.
- `src/popup.js`: Popup behavior, settings persistence, and active-tab messaging.
- `src/rulerSettings.js`: Small shared pure JavaScript helpers for defaults, validation, and CSS geometry calculation.
- `test/rulerSettings.test.js`: Unit tests for the pure helper behavior.
Note: the repo may omit packaged `icons/` for unpacked-only development loads.

## Settings Model

Persisted and normalized settings:

```js
{
  enabled: false,
  height: 120,
  width: 960
}
```

`height` is measured in pixels (`40`–`320`, default `120`). `width` is measured in pixels (`240`–`1600`, default `960`); the rendered strip uses `min(widthPx, 100vw)` so it never exceeds the viewport. Values loaded from storage are normalized so invalid or out-of-range data cannot break the overlay.

## Data Flow

When the popup opens:

1. `popup.js` loads persisted `height` / `width` from `chrome.storage.sync`, with `chrome.storage.local` as a fallback for those keys.
2. The popup renders `enabled` as **off** and prompts the user to enable manually (`请手动开启阅读尺`); this avoids auto-enabling on open.
3. Slider tweaks use debounced writes for `height` / `width` (sync first, `local` on failure) to avoid `sync` quota errors during fast drags.

When the user enables the ruler or moves the sliders:

1. `popup.js` normalizes the new settings.
2. `popup.js` notifies the active tab immediately.
3. Dimension changes are persisted with the debounce strategy above. **`enabled` is not written to storage by the popup** (only `height` / `width` keys are saved).

When a page loads:

1. `content.js` reads stored `height` / `width` (local merged over sync) and applies geometry with `enabled: false` so no overlay shows until the user turns it on from the popup.
2. Subsequent messages from the popup apply full `{ enabled, height, width }`.
3. On client-side navigations (SPA), the content script clears `enabled` until the user interacts again.

## Overlay Behavior

The reading ruler overlay will:

- Use a stable root element id so duplicate overlays are avoided.
- Cover the viewport with `position: fixed`.
- Use `z-index` high enough to appear above normal page content.
- Use `pointer-events: none` so links, selection, scrolling, and page controls continue to work.
- Recalculate section heights using CSS `calc()` based on the selected reading area height.
- Keep the transparent reading area centered in the viewport.
- On single-page apps, patching `history.pushState` / `replaceState` and listening for `popstate` / `hashchange` disables the overlay after client-side URL changes (user re-applies via popup).

## Error Handling

The extension should fail quietly on restricted pages where content scripts cannot run, such as the Chrome Web Store or browser internal pages. The popup may still save settings even if the active tab cannot receive an update.

Invalid stored settings will be normalized to defaults and bounds. Messaging failures from restricted tabs will not block saving user preferences.

## Testing And Verification

Automated tests will cover pure helper behavior in `src/rulerSettings.js`:

- Default settings are applied when storage is empty.
- Invalid `enabled` values fall back to `false`.
- Invalid `height` values fall back to the default.
- Heights below `40` clamp to `40`.
- Heights above `320` clamp to `320`.
- Widths below `240` clamp to `240`; widths above `1600` clamp to `1600`.
- Overlay geometry values are derived from the normalized height and width.

Manual Chrome verification will cover:

- The extension loads as an unpacked extension.
- The popup opens from the extension icon.
- The toggle enables and disables the overlay on a normal webpage.
- The height and width sliders change the transparent reading area immediately.
- Settings persist after closing and reopening the popup.
- Page clicks and scrolling still work while the overlay is enabled.

## Acceptance Criteria

The work is complete when:

- A user can load the extension folder in Chrome.
- Clicking the extension icon opens a popup with an enable switch plus height and width sliders.
- Enabling the ruler dims the page above and below a centered transparent reading strip.
- Adjusting the sliders changes strip height and width.
- Height and width persist across popup reopen and page reload; the overlay must be re-enabled from the popup after a full reload.
- Automated tests for settings normalization and geometry pass.
