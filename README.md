# Reading Ruler

A minimal Chrome extension that dims the page around a transparent reading window you can **drag to move**, **resize with handles**, and **dismiss with Esc**.

## Features

- Click the extension icon to open the popup.
- Enable or disable the reading ruler.
- Adjust the reading strip height from 40px to 320px.
- Adjust the reading strip width from 240px to 1600px.
- While the ruler is on: **drag the transparent reading area** to move the window (it stays fully inside the viewport). Corner and edge **handles** still resize width and height.
- Press **Escape** to turn the overlay off on the current tab. If the popup window is still open, the enable switch updates to match (via `chrome.storage.session`).
- Drag the **white corner or edge handles** on the strip to resize width and height; changes are debounced and saved to Chrome storage (`sync`, with `local` fallback when sync is rate-limited), same as the popup sliders.

## Install Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project folder.
5. Open a normal webpage and click the Reading Ruler extension icon.

## Install from GitHub

1. Clone this repository (`git clone <repo-url>`) or download the repository as a ZIP and extract it.
2. Follow **Install Locally** above; in step 4, choose the cloned or extracted folder.

## Test

Run:

```bash
npm test
```

The tests cover settings normalization, overlay behavior, and popup messaging.

## Manual Verification

- The popup opens from the extension icon; it loads with the ruler **off** until you enable it (saved `enabled` is not applied on open by design).
- The enable switch toggles the overlay on the active page.
- The height and width sliders change the transparent reading strip immediately.
- With the ruler on, **drag the transparent reading area** to move the strip; drag **handles** to resize.
- Press **Escape** to close the overlay on the current tab.
- Strip height and width persist after closing the popup and reloading the page; turn the ruler on again after a full reload (see `AGENTS.md`).
- Page scrolling and clicking still work while the overlay is enabled.
- On SPAs, client-side navigations clear the overlay until you toggle settings again (see `AGENTS.md`).
