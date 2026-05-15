(function initReadingRulerContent() {
  "use strict";

  const INITIALIZED_KEY = "__readingRulerExtensionContentInitialized";
  const ROOT_ID = "reading-ruler-extension-overlay";
  const MASK_COLOR = "rgba(0, 0, 0, 0.42)";
  const MESSAGE_TYPE = "READING_RULER_SETTINGS_UPDATED";

  if (globalThis[INITIALIZED_KEY]) {
    return;
  }
  globalThis[INITIALIZED_KEY] = true;

  const { normalizeSettings, getOverlayGeometry } = globalThis.RulerSettings;
  let currentSettings = normalizeSettings({});

  function getRoot() {
    return document.getElementById(ROOT_ID);
  }

  function getOverlayParts(root) {
    if (!root || root.dataset.readingRulerExtension !== "true") {
      return null;
    }

    const topMask = root.querySelector('[data-ruler-part="top"]');
    const middleRow = root.querySelector('[data-ruler-part="middle-row"]');
    const leftMask = root.querySelector('[data-ruler-part="left"]');
    const readingStrip = root.querySelector('[data-ruler-part="reading-strip"]');
    const rightMask = root.querySelector('[data-ruler-part="right"]');
    const bottomMask = root.querySelector('[data-ruler-part="bottom"]');

    if (
      !topMask ||
      !middleRow ||
      !leftMask ||
      !readingStrip ||
      !rightMask ||
      !bottomMask
    ) {
      return null;
    }

    return { topMask, middleRow, leftMask, readingStrip, rightMask, bottomMask };
  }

  function createRoot() {
    const existingRoot = getRoot();
    if (getOverlayParts(existingRoot)) {
      return existingRoot;
    }
    existingRoot?.remove();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.dataset.readingRulerExtension = "true";
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

    const middleRow = document.createElement("div");
    middleRow.dataset.rulerPart = "middle-row";

    const leftMask = document.createElement("div");
    leftMask.dataset.rulerPart = "left";

    const readingStrip = document.createElement("div");
    readingStrip.dataset.rulerPart = "reading-strip";

    const rightMask = document.createElement("div");
    rightMask.dataset.rulerPart = "right";

    const bottomMask = document.createElement("div");
    bottomMask.dataset.rulerPart = "bottom";

    Object.assign(topMask.style, { background: MASK_COLOR, flex: "0 0 auto" });
    Object.assign(middleRow.style, {
      flex: "0 0 auto",
      display: "flex",
      width: "100%",
    });
    Object.assign(leftMask.style, { background: MASK_COLOR, flex: "1 1 auto" });
    Object.assign(readingStrip.style, {
      flex: "0 0 auto",
      background: "transparent",
      boxShadow:
        "inset 0 1px rgba(255,255,255,0.24), inset 0 -1px rgba(255,255,255,0.24)",
    });
    Object.assign(rightMask.style, { background: MASK_COLOR, flex: "1 1 auto" });
    Object.assign(bottomMask.style, {
      background: MASK_COLOR,
      flex: "0 0 auto",
    });

    middleRow.append(leftMask, readingStrip, rightMask);
    root.append(topMask, middleRow, bottomMask);
    document.documentElement.append(root);

    return root;
  }

  function removeOverlay() {
    const root = getRoot();

    if (getOverlayParts(root)) {
      root.remove();
    }
  }

  function applySettings(nextSettings) {
    const settings = normalizeSettings({
      ...currentSettings,
      ...(nextSettings && typeof nextSettings === "object" ? nextSettings : {}),
    });
    currentSettings = settings;

    if (!settings.enabled) {
      removeOverlay();
      return;
    }

    const root = createRoot();
    const geometry = getOverlayGeometry(settings.height, settings.width);
    const { topMask, middleRow, readingStrip, bottomMask } = getOverlayParts(root);

    topMask.style.height = geometry.topHeight;
    middleRow.style.height = geometry.readingHeight;
    readingStrip.style.height = geometry.readingHeight;
    readingStrip.style.width = geometry.readingWidth;
    bottomMask.style.height = geometry.bottomHeight;
  }

  function readStoredDimensionsAndApply() {
    chrome.storage.local.get(["height", "width"], (localRaw) => {
      chrome.storage.sync.get(["height", "width"], (syncRaw) => {
        applySettings({
          enabled: false,
          height: localRaw?.height ?? syncRaw?.height,
          width: localRaw?.width ?? syncRaw?.width,
        });
      });
    });
  }

  readStoredDimensionsAndApply();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MESSAGE_TYPE) {
      applySettings(message.settings);
    }
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "sync" && areaName !== "local") {
      return;
    }

    const partialSettings = {};
    if (changes.height) {
      partialSettings.height = changes.height.newValue;
    }
    if (changes.width) {
      partialSettings.width = changes.width.newValue;
    }

    if (Object.keys(partialSettings).length > 0) {
      applySettings(partialSettings);
    }
  });

  const globalScope = globalThis;
  if (
    typeof globalScope.location?.href === "string" &&
    typeof globalScope.history?.pushState === "function" &&
    typeof globalScope.history?.replaceState === "function" &&
    typeof globalScope.addEventListener === "function"
  ) {
    let lastHref = globalScope.location.href;

    function disableRulerOnUrlChange() {
      const next = globalScope.location.href;
      if (next === lastHref) {
        return;
      }
      lastHref = next;
      applySettings({ enabled: false });
    }

    const originalPushState = globalScope.history.pushState.bind(
      globalScope.history,
    );
    const originalReplaceState = globalScope.history.replaceState.bind(
      globalScope.history,
    );

    globalScope.history.pushState = function patchedPushState(...args) {
      originalPushState(...args);
      disableRulerOnUrlChange();
    };
    globalScope.history.replaceState = function patchedReplaceState(...args) {
      originalReplaceState(...args);
      disableRulerOnUrlChange();
    };

    globalScope.addEventListener("popstate", disableRulerOnUrlChange);
    globalScope.addEventListener("hashchange", disableRulerOnUrlChange);
  }
})();
