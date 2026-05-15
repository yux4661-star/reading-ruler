# Reading Ruler Extension Implementation Plan

> **2026-05-13 sync:** This file is a historical step-by-step plan with embedded snapshots of early code. The **current behavior** (including `width`, `storage.local` fallback for dimensions, SPA navigation clearing the overlay, interactive overlay controls, and popup tab state query) lives in `src/`, `AGENTS.md`, and `README.md`. Treat the checklist/procedures below as **archive**, not a live spec.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal unpacked Chrome extension that dims the webpage above and below a centered transparent reading strip, with popup controls for enable/disable and strip height.

**Architecture:** Use a plain Manifest V3 extension with no build step. Keep shared setting normalization and geometry in one pure helper file, load that helper before both `content.js` and `popup.js`, and test it with Node's built-in test runner.

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript, HTML, CSS, Node `node:test`.

---

## File Structure

- Create `package.json`: stores test script only, with no runtime dependencies.
- Create `manifest.json`: declares MV3 extension metadata, `storage` and `activeTab` permissions, popup, background service worker, and content scripts.
- Create `src/rulerSettings.js`: pure helper plus browser/global exports for settings defaults, validation, and overlay geometry.
- Create `test/rulerSettings.test.js`: Node tests for helper behavior.
- Create `src/content.js`: creates, updates, and removes the webpage overlay.
- Create `src/popup.html`: popup control markup.
- Create `src/popup.css`: popup styling.
- Create `src/popup.js`: popup state loading, persistence, and active-tab messaging.
- Create `src/background.js`: minimal MV3 service worker.
- Create `README.md`: local installation and verification instructions.

The repository is under git; treat the task checklist below as **historical**. Commit after logical chunks of work as you prefer.

---

### Task 1: Add Test Harness And Failing Settings Tests

**Files:**
- Create: `package.json`
- Create: `test/rulerSettings.test.js`

- [ ] **Step 1: Create the Node test script**

Create `package.json`:

```json
{
  "name": "reading-ruler-extension",
  "version": "0.1.0",
  "private": true,
  "description": "A minimal Chrome extension for a centered reading ruler overlay.",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write failing tests for the desired helper API**

Create `test/rulerSettings.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_SETTINGS,
  clampHeight,
  normalizeSettings,
  getOverlayGeometry,
} = require("../src/rulerSettings.js");

test("normalizeSettings returns defaults when input is empty", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test("normalizeSettings falls back when enabled is not boolean", () => {
  assert.equal(normalizeSettings({ enabled: "yes", height: 140 }).enabled, false);
});

test("normalizeSettings falls back when height is invalid", () => {
  assert.equal(normalizeSettings({ enabled: true, height: "large" }).height, 120);
  assert.equal(normalizeSettings({ enabled: true, height: Number.NaN }).height, 120);
});

test("clampHeight limits height to supported bounds", () => {
  assert.equal(clampHeight(20), 40);
  assert.equal(clampHeight(40), 40);
  assert.equal(clampHeight(180), 180);
  assert.equal(clampHeight(320), 320);
  assert.equal(clampHeight(500), 320);
});

test("normalizeSettings rounds numeric heights before clamping", () => {
  assert.deepEqual(normalizeSettings({ enabled: true, height: 99.6 }), {
    enabled: true,
    height: 100,
  });
});

test("getOverlayGeometry derives centered mask sizes from height", () => {
  assert.deepEqual(getOverlayGeometry(120), {
    topHeight: "calc((100vh - 120px) / 2)",
    readingHeight: "120px",
    bottomHeight: "calc((100vh - 120px) / 2)",
  });
});
```

- [ ] **Step 3: Run tests and verify they fail because the helper is missing**

Run:

```bash
npm test
```

Expected: FAIL with a module resolution error for `../src/rulerSettings.js`.

---

### Task 2: Implement Settings Helper

**Files:**
- Create: `src/rulerSettings.js`
- Test: `test/rulerSettings.test.js`

- [ ] **Step 1: Create the minimal helper implementation**

Create `src/rulerSettings.js`:

```js
(function attachRulerSettings(root) {
  "use strict";

  const MIN_HEIGHT = 40;
  const MAX_HEIGHT = 320;
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    height: 120,
  });

  function clampHeight(value) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) {
      return DEFAULT_SETTINGS.height;
    }
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, rounded));
  }

  function normalizeSettings(value) {
    const source = value && typeof value === "object" ? value : {};

    return {
      enabled:
        typeof source.enabled === "boolean"
          ? source.enabled
          : DEFAULT_SETTINGS.enabled,
      height:
        typeof source.height === "number"
          ? clampHeight(source.height)
          : DEFAULT_SETTINGS.height,
    };
  }

  function getOverlayGeometry(height) {
    const normalizedHeight = clampHeight(height);
    const halfMaskHeight = `calc((100vh - ${normalizedHeight}px) / 2)`;

    return {
      topHeight: halfMaskHeight,
      readingHeight: `${normalizedHeight}px`,
      bottomHeight: halfMaskHeight,
    };
  }

  const api = {
    DEFAULT_SETTINGS,
    MIN_HEIGHT,
    MAX_HEIGHT,
    clampHeight,
    normalizeSettings,
    getOverlayGeometry,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.RulerSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
```

- [ ] **Step 2: Run tests and verify they pass**

Run:

```bash
npm test
```

Expected: PASS for all `rulerSettings` tests.

---

### Task 3: Add Extension Manifest And Background Worker

**Files:**
- Create: `manifest.json`
- Create: `src/background.js`

- [ ] **Step 1: Create the Manifest V3 file**

Create `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Reading Ruler",
  "version": "0.1.0",
  "description": "Dim the page above and below a centered reading strip.",
  "permissions": ["activeTab", "storage"],
  "action": {
    "default_title": "Reading Ruler",
    "default_popup": "src/popup.html"
  },
  "background": {
    "service_worker": "src/background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/rulerSettings.js", "src/content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Add a minimal service worker**

Create `src/background.js`:

```js
importScripts("rulerSettings.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["enabled", "height"], (storedSettings) => {
    const settings = globalThis.RulerSettings.normalizeSettings(storedSettings);

    chrome.storage.sync.set(settings);
  });
});
```

- [ ] **Step 3: Run tests to ensure helper behavior is unchanged**

Run:

```bash
npm test
```

Expected: PASS.

---

### Task 4: Implement Content Overlay

**Files:**
- Create: `src/content.js`
- Test: `test/rulerSettings.test.js`

- [ ] **Step 1: Add the content script**

Create `src/content.js`:

```js
(function initReadingRulerContent() {
  "use strict";

  const ROOT_ID = "reading-ruler-extension-overlay";
  const MASK_COLOR = "rgba(0, 0, 0, 0.42)";
  const MESSAGE_TYPE = "READING_RULER_SETTINGS_UPDATED";

  const { normalizeSettings, getOverlayGeometry } = globalThis.RulerSettings;

  function getRoot() {
    return document.getElementById(ROOT_ID);
  }

  function createRoot() {
    const existingRoot = getRoot();
    if (existingRoot) {
      return existingRoot;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      display: "flex",
      flexDirection: "column",
    });

    const topMask = document.createElement("div");
    topMask.dataset.rulerPart = "top";

    const readingStrip = document.createElement("div");
    readingStrip.dataset.rulerPart = "reading-strip";

    const bottomMask = document.createElement("div");
    bottomMask.dataset.rulerPart = "bottom";

    Object.assign(topMask.style, { background: MASK_COLOR, flex: "0 0 auto" });
    Object.assign(readingStrip.style, {
      flex: "0 0 auto",
      background: "transparent",
      boxShadow: "inset 0 1px rgba(255,255,255,0.24), inset 0 -1px rgba(255,255,255,0.24)",
    });
    Object.assign(bottomMask.style, { background: MASK_COLOR, flex: "0 0 auto" });

    root.append(topMask, readingStrip, bottomMask);
    document.documentElement.append(root);

    return root;
  }

  function removeOverlay() {
    getRoot()?.remove();
  }

  function applySettings(nextSettings) {
    const settings = normalizeSettings(nextSettings);

    if (!settings.enabled) {
      removeOverlay();
      return;
    }

    const root = createRoot();
    const geometry = getOverlayGeometry(settings.height);
    const topMask = root.querySelector('[data-ruler-part="top"]');
    const readingStrip = root.querySelector('[data-ruler-part="reading-strip"]');
    const bottomMask = root.querySelector('[data-ruler-part="bottom"]');

    topMask.style.height = geometry.topHeight;
    readingStrip.style.height = geometry.readingHeight;
    bottomMask.style.height = geometry.bottomHeight;
  }

  chrome.storage.sync.get(["enabled", "height"], applySettings);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE_TYPE) {
      applySettings(message.settings);
    }
  });
})();
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Load the extension manually and verify first page behavior**

Manual check:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select `/Users/heyuxing/WorkSpace/Ruler`.
5. Open a normal website, such as `https://example.com`.

Expected: no visible overlay yet because default `enabled` is `false`, and the console has no extension errors.

---

### Task 5: Implement Popup UI And Messaging

**Files:**
- Create: `src/popup.html`
- Create: `src/popup.css`
- Create: `src/popup.js`

- [ ] **Step 1: Add popup markup**

Create `src/popup.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>阅读尺</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <main class="popup">
      <header class="header">
        <div>
          <h1>阅读尺</h1>
          <p>让页面只突出当前阅读区域</p>
        </div>
      </header>

      <label class="switch-row">
        <span>
          <strong>启用阅读尺</strong>
          <small>上下遮罩，中间透明</small>
        </span>
        <input id="enabled" type="checkbox" />
      </label>

      <label class="slider-row" for="height">
        <span>
          <strong>阅读区域高度</strong>
          <small><span id="heightValue">120</span>px</small>
        </span>
        <input id="height" type="range" min="40" max="320" step="1" />
      </label>

      <p id="status" class="status" role="status"></p>
    </main>

    <script src="rulerSettings.js"></script>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Add popup styling**

Create `src/popup.css`:

```css
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  min-width: 280px;
  background: #f7f5f0;
  color: #1f2933;
}

.popup {
  display: grid;
  gap: 16px;
  padding: 16px;
}

.header h1 {
  margin: 0;
  font-size: 18px;
}

.header p,
small,
.status {
  color: #5b6673;
}

.header p {
  margin: 4px 0 0;
  font-size: 12px;
}

.switch-row,
.slider-row {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #d7d0c5;
  border-radius: 12px;
  background: #fffaf2;
}

.switch-row {
  grid-template-columns: 1fr auto;
  align-items: center;
}

.switch-row span,
.slider-row span {
  display: grid;
  gap: 2px;
}

strong {
  font-size: 14px;
}

small {
  font-size: 12px;
}

input[type="checkbox"] {
  width: 20px;
  height: 20px;
  accent-color: #5b6ee1;
}

input[type="range"] {
  width: 100%;
  accent-color: #5b6ee1;
}

.status {
  min-height: 16px;
  margin: 0;
  font-size: 12px;
}
```

- [ ] **Step 3: Add popup behavior**

Create `src/popup.js`:

```js
(function initReadingRulerPopup() {
  "use strict";

  const MESSAGE_TYPE = "READING_RULER_SETTINGS_UPDATED";
  const { DEFAULT_SETTINGS, MIN_HEIGHT, MAX_HEIGHT, normalizeSettings } =
    globalThis.RulerSettings;

  const enabledInput = document.getElementById("enabled");
  const heightInput = document.getElementById("height");
  const heightValue = document.getElementById("heightValue");
  const status = document.getElementById("status");

  function setStatus(message) {
    status.textContent = message;
  }

  function render(settings) {
    enabledInput.checked = settings.enabled;
    heightInput.min = String(MIN_HEIGHT);
    heightInput.max = String(MAX_HEIGHT);
    heightInput.value = String(settings.height);
    heightValue.textContent = String(settings.height);
  }

  function getSettingsFromForm() {
    return normalizeSettings({
      enabled: enabledInput.checked,
      height: Number(heightInput.value),
    });
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab;
  }

  async function notifyActiveTab(settings) {
    const tab = await getActiveTab();
    if (!tab?.id) {
      setStatus("已保存设置。当前标签页不可更新。");
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPE,
        settings,
      });
      setStatus("已应用到当前页面。");
    } catch {
      setStatus("已保存设置。此页面不支持注入阅读尺。");
    }
  }

  async function saveAndNotify() {
    const settings = getSettingsFromForm();
    render(settings);
    await chrome.storage.sync.set(settings);
    await notifyActiveTab(settings);
  }

  chrome.storage.sync.get(["enabled", "height"], async (storedSettings) => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...storedSettings,
    });
    render(settings);
    await notifyActiveTab(settings);
  });

  enabledInput.addEventListener("change", saveAndNotify);
  heightInput.addEventListener("input", saveAndNotify);
})();
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Manually verify popup behavior**

Manual check:

1. Reload the unpacked extension in `chrome://extensions`.
2. Open `https://example.com`.
3. Click the Reading Ruler extension icon.
4. Turn on "启用阅读尺".
5. Move the height slider.
6. Close and reopen the popup.
7. Reload the webpage.

Expected:

- Turning on the switch shows a dimmed overlay with a centered transparent strip.
- Moving the slider immediately changes the strip height.
- Closing and reopening the popup keeps the saved switch and height values.
- Reloading the webpage preserves the enabled overlay and saved height.

---

### Task 6: Add Local Usage Documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Add README instructions**

Create `README.md`:

```md
# Reading Ruler

A minimal Chrome extension that dims the page above and below a centered transparent reading strip.

## Features

- Click the extension icon to open the popup.
- Enable or disable the reading ruler.
- Adjust the reading strip height from 40px to 320px.
- Save settings with Chrome sync storage.

## Install Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this project folder.
5. Open a normal webpage and click the Reading Ruler extension icon.

## Test

Run:

```bash
npm test
```

The tests cover settings normalization and overlay geometry helpers.

## Manual Verification

- The popup opens from the extension icon.
- The enable switch toggles the overlay on the active page.
- The height slider changes the transparent reading strip immediately.
- Settings persist after closing the popup and reloading the page.
- Page scrolling and clicking still work while the overlay is enabled.
```

- [ ] **Step 2: Run automated tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run final manual verification**

Manual check:

1. Reload the unpacked extension.
2. Test on `https://example.com`.
3. Test on a longer article page.
4. Confirm restricted pages fail quietly by trying a Chrome internal page.

Expected:

- Normal webpages show and update the reading ruler.
- Restricted pages may show the popup status "已保存设置。此页面不支持注入阅读尺。"
- No manual test reveals blocked clicks or broken scrolling.

---

## Plan Self-Review

- Spec coverage: Manifest V3, popup toggle, height slider, centered overlay, storage persistence, active-tab updates, helper tests, and manual verification are covered.
- Completeness scan: no unfinished tasks remain; each code-producing step contains exact file content.
- Type consistency: `enabled`, `height`, `normalizeSettings`, `getOverlayGeometry`, and `READING_RULER_SETTINGS_UPDATED` are used consistently across tests, popup, and content script.
