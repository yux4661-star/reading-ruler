(function initReadingRulerContent() {
  "use strict";

  const INITIALIZED_KEY = "__readingRulerExtensionContentInitialized";
  const ROOT_ID = "reading-ruler-extension-overlay";
  const MASK_COLOR = "rgba(0, 0, 0, 0.42)";
  const MESSAGE_TYPE = "READING_RULER_SETTINGS_UPDATED";
  const QUERY_STATE_MESSAGE_TYPE = "READING_RULER_QUERY_STATE";
  const MOVE_GRIP_PART = "move-grip";
  /** Session flag so the popup can sync its switch if the user presses Esc on the page. */
  const SESSION_ESC_KEY = "readingRulerEscDismissed";
  const HANDLE_SIZE = 12;
  const PERSIST_DEBOUNCE_MS = 450;

  if (globalThis[INITIALIZED_KEY]) {
    return;
  }
  globalThis[INITIALIZED_KEY] = true;

  const { normalizeSettings, clampWidth, clampHeight } = globalThis.RulerSettings;

  let currentSettings = normalizeSettings({});
  let wasEnabled = false;
  let pointerCenterX = 0;
  let pointerCenterY = 0;
  let layoutFrame = 0;
  let resizing = false;
  let resizeSession = null;
  let dragMoveSession = null;
  let persistTimer = null;

  function getViewportSize() {
    const vw = globalThis.innerWidth || document.documentElement.clientWidth || 0;
    const vh = globalThis.innerHeight || document.documentElement.clientHeight || 0;
    return { vw: Math.max(vw, 1), vh: Math.max(vh, 1) };
  }

  function resetPointerCenter() {
    const { vw, vh } = getViewportSize();
    pointerCenterX = vw / 2;
    pointerCenterY = vh / 2;
  }

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
    const readingWrap = root.querySelector('[data-ruler-part="reading-wrap"]');
    const readingStrip = root.querySelector('[data-ruler-part="reading-strip"]');
    const rightMask = root.querySelector('[data-ruler-part="right"]');
    const bottomMask = root.querySelector('[data-ruler-part="bottom"]');

    if (
      !topMask ||
      !middleRow ||
      !leftMask ||
      !readingWrap ||
      !readingStrip ||
      !rightMask ||
      !bottomMask
    ) {
      return null;
    }

    return {
      topMask,
      middleRow,
      leftMask,
      readingWrap,
      readingStrip,
      rightMask,
      bottomMask,
    };
  }

  function createHandle(handleId) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.dataset.rulerHandle = handleId;
    handle.setAttribute("aria-hidden", "true");
    handle.tabIndex = -1;

    const cursorByHandle = {
      nw: "nwse-resize",
      n: "ns-resize",
      ne: "nesw-resize",
      e: "ew-resize",
      se: "nwse-resize",
      s: "ns-resize",
      sw: "nesw-resize",
      w: "ew-resize",
    };

    Object.assign(handle.style, {
      position: "absolute",
      width: `${HANDLE_SIZE}px`,
      height: `${HANDLE_SIZE}px`,
      padding: "0",
      margin: "0",
      border: "1px solid rgba(0,0,0,0.35)",
      borderRadius: "2px",
      background: "rgba(255,255,255,0.88)",
      boxSizing: "border-box",
      zIndex: "3",
      pointerEvents: "auto",
      cursor: cursorByHandle[handleId] || "default",
      boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
    });

    const positions = {
      nw: { left: "0", top: "0", transform: "translate(-50%, -50%)" },
      n: { left: "50%", top: "0", transform: "translate(-50%, -50%)" },
      ne: { left: "100%", top: "0", transform: "translate(-50%, -50%)" },
      e: { left: "100%", top: "50%", transform: "translate(-50%, -50%)" },
      se: { left: "100%", top: "100%", transform: "translate(-50%, -50%)" },
      s: { left: "50%", top: "100%", transform: "translate(-50%, -50%)" },
      sw: { left: "0", top: "100%", transform: "translate(-50%, -50%)" },
      w: { left: "0", top: "50%", transform: "translate(-50%, -50%)" },
    };

    Object.assign(handle.style, positions[handleId] || {});

    handle.addEventListener("mousedown", onHandleMouseDown);
    return handle;
  }

  function clearPersistTimer() {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  }

  function persistDimensionsToStorage() {
    const normalized = normalizeSettings(currentSettings);
    const payload = { height: normalized.height, width: normalized.width };

    try {
      chrome.storage.sync.set(payload, () => {
        if (chrome.runtime?.lastError) {
          chrome.storage.local.set(payload);
        }
      });
    } catch {
      try {
        chrome.storage.local.set(payload);
      } catch {
        // Ignore storage failures from restricted contexts.
      }
    }
  }

  function schedulePersistDimensions() {
    clearPersistTimer();
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistDimensionsToStorage();
    }, PERSIST_DEBOUNCE_MS);
  }

  function flushPersistDimensions() {
    clearPersistTimer();
    persistDimensionsToStorage();
  }

  function scheduleLayout() {
    if (layoutFrame) {
      cancelAnimationFrame(layoutFrame);
    }
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      applyLayout();
    });
  }

  function notifyPopupEscDismissed() {
    try {
      const sessionApi = chrome.storage?.session;
      if (!sessionApi?.set) {
        return;
      }

      const payload = { [SESSION_ESC_KEY]: Date.now() };
      const maybePromise = sessionApi.set(payload);

      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => {});
      }
    } catch {
      // Ignore when session storage is unavailable.
    }
  }

  function onViewportResize() {
    if (!currentSettings.enabled) {
      return;
    }

    scheduleLayout();
  }

  function onResizePointerMove(event) {
    if (!resizing || !resizeSession) {
      return;
    }

    const dx = event.clientX - resizeSession.startX;
    const dy = event.clientY - resizeSession.startY;
    const {
      startLogicalW,
      startLogicalH,
      startDispW,
      startDispH,
      startCx,
      startCy,
      handle,
      vw,
      vh,
    } = resizeSession;

    let newLogicalW = startLogicalW;
    let newLogicalH = startLogicalH;
    let newCx = startCx;
    let newCy = startCy;

    switch (handle) {
      case "se": {
        newLogicalW = clampWidth(startLogicalW + dx);
        newLogicalH = clampHeight(startLogicalH + dy);
        const nwX = startCx - startDispW / 2;
        const nwY = startCy - startDispH / 2;
        const nextDispW = Math.min(newLogicalW, vw);
        const nextDispH = Math.min(newLogicalH, vh);
        newCx = nwX + nextDispW / 2;
        newCy = nwY + nextDispH / 2;
        break;
      }
      case "nw": {
        newLogicalW = clampWidth(startLogicalW - dx);
        newLogicalH = clampHeight(startLogicalH - dy);
        const seX = startCx + startDispW / 2;
        const seY = startCy + startDispH / 2;
        const nextDispW = Math.min(newLogicalW, vw);
        const nextDispH = Math.min(newLogicalH, vh);
        newCx = seX - nextDispW / 2;
        newCy = seY - nextDispH / 2;
        break;
      }
      case "ne": {
        newLogicalW = clampWidth(startLogicalW + dx);
        newLogicalH = clampHeight(startLogicalH - dy);
        const swX = startCx - startDispW / 2;
        const swY = startCy + startDispH / 2;
        const nextDispW = Math.min(newLogicalW, vw);
        const nextDispH = Math.min(newLogicalH, vh);
        newCx = swX + nextDispW / 2;
        newCy = swY - nextDispH / 2;
        break;
      }
      case "sw": {
        newLogicalW = clampWidth(startLogicalW - dx);
        newLogicalH = clampHeight(startLogicalH + dy);
        const neX = startCx + startDispW / 2;
        const neY = startCy - startDispH / 2;
        const nextDispW = Math.min(newLogicalW, vw);
        const nextDispH = Math.min(newLogicalH, vh);
        newCx = neX - nextDispW / 2;
        newCy = neY + nextDispH / 2;
        break;
      }
      case "n": {
        newLogicalH = clampHeight(startLogicalH - dy);
        const southY = startCy + startDispH / 2;
        const nextDispH = Math.min(newLogicalH, vh);
        newCy = southY - nextDispH / 2;
        break;
      }
      case "s": {
        newLogicalH = clampHeight(startLogicalH + dy);
        const northY = startCy - startDispH / 2;
        const nextDispH = Math.min(newLogicalH, vh);
        newCy = northY + nextDispH / 2;
        break;
      }
      case "e": {
        newLogicalW = clampWidth(startLogicalW + dx);
        const westX = startCx - startDispW / 2;
        const nextDispW = Math.min(newLogicalW, vw);
        newCx = westX + nextDispW / 2;
        break;
      }
      case "w": {
        newLogicalW = clampWidth(startLogicalW - dx);
        const eastX = startCx + startDispW / 2;
        const nextDispW = Math.min(newLogicalW, vw);
        newCx = eastX - nextDispW / 2;
        break;
      }
      default:
        break;
    }

    currentSettings = normalizeSettings({
      ...currentSettings,
      height: newLogicalH,
      width: newLogicalW,
    });
    pointerCenterX = newCx;
    pointerCenterY = newCy;
    applyLayout();
    schedulePersistDimensions();
  }

  function endResizeInteraction() {
    if (!resizing) {
      return;
    }

    resizing = false;
    resizeSession = null;
    globalThis.removeEventListener("mousemove", onResizePointerMove, true);
    globalThis.removeEventListener("mouseup", onResizePointerEnd, true);
    flushPersistDimensions();
  }

  function onResizePointerEnd() {
    endResizeInteraction();
  }

  function endDragMoveInteraction() {
    if (!dragMoveSession) {
      return;
    }

    dragMoveSession = null;
    globalThis.removeEventListener("mousemove", onMoveGripPointerMove, true);
    globalThis.removeEventListener("mouseup", onMoveGripPointerEnd, true);

    const root = getRoot();
    const moveGrip = root?.querySelector(`[data-ruler-part="${MOVE_GRIP_PART}"]`);
    if (moveGrip) {
      moveGrip.style.cursor = "grab";
    }
  }

  function onMoveGripPointerMove(event) {
    if (!dragMoveSession || resizing) {
      return;
    }

    const dx = event.clientX - dragMoveSession.startX;
    const dy = event.clientY - dragMoveSession.startY;
    pointerCenterX = dragMoveSession.startCx + dx;
    pointerCenterY = dragMoveSession.startCy + dy;
    scheduleLayout();
  }

  function onMoveGripPointerEnd() {
    endDragMoveInteraction();
  }

  function onMoveGripMouseDown(event) {
    if (!currentSettings.enabled || resizing) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragMoveSession = {
      startX: event.clientX,
      startY: event.clientY,
      startCx: pointerCenterX,
      startCy: pointerCenterY,
    };

    event.currentTarget.style.cursor = "grabbing";
    globalThis.addEventListener("mousemove", onMoveGripPointerMove, true);
    globalThis.addEventListener("mouseup", onMoveGripPointerEnd, true);
  }

  function onEscapeKey(event) {
    if (!currentSettings.enabled) {
      return;
    }

    if (event.key !== "Escape" && event.code !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    applySettings({ enabled: false });
    notifyPopupEscDismissed();
  }

  function onHandleMouseDown(event) {
    if (!currentSettings.enabled) {
      return;
    }

    const handleId = event.currentTarget?.dataset?.rulerHandle;
    if (!handleId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    endDragMoveInteraction();

    const { vw, vh } = getViewportSize();
    const normalized = normalizeSettings(currentSettings);
    const startLogicalW = normalized.width;
    const startLogicalH = normalized.height;
    const startDispW = Math.min(startLogicalW, vw);
    const startDispH = Math.min(startLogicalH, vh);

    resizing = true;
    resizeSession = {
      handle: handleId,
      startX: event.clientX,
      startY: event.clientY,
      startLogicalW,
      startLogicalH,
      startDispW,
      startDispH,
      startCx: pointerCenterX,
      startCy: pointerCenterY,
      vw,
      vh,
    };

    globalThis.addEventListener("mousemove", onResizePointerMove, true);
    globalThis.addEventListener("mouseup", onResizePointerEnd, true);
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

    const readingWrap = document.createElement("div");
    readingWrap.dataset.rulerPart = "reading-wrap";
    Object.assign(readingWrap.style, {
      position: "relative",
      flex: "0 0 auto",
      boxSizing: "border-box",
      pointerEvents: "none",
    });

    const readingStrip = document.createElement("div");
    readingStrip.dataset.rulerPart = "reading-strip";

    Object.assign(readingStrip.style, {
      position: "absolute",
      inset: "0",
      background: "transparent",
      boxShadow:
        "inset 0 1px rgba(255,255,255,0.24), inset 0 -1px rgba(255,255,255,0.24)",
      pointerEvents: "none",
    });

    const moveGrip = document.createElement("div");
    moveGrip.dataset.rulerPart = MOVE_GRIP_PART;
    moveGrip.setAttribute("aria-hidden", "true");
    Object.assign(moveGrip.style, {
      position: "absolute",
      inset: "0",
      zIndex: "1",
      cursor: "grab",
      pointerEvents: "auto",
      background: "transparent",
      touchAction: "none",
      userSelect: "none",
    });
    moveGrip.addEventListener("mousedown", onMoveGripMouseDown);

    const rightMask = document.createElement("div");
    rightMask.dataset.rulerPart = "right";

    const bottomMask = document.createElement("div");
    bottomMask.dataset.rulerPart = "bottom";

    Object.assign(topMask.style, { background: MASK_COLOR, flex: "0 0 auto" });
    Object.assign(middleRow.style, {
      flex: "0 0 auto",
      display: "flex",
      flexDirection: "row",
      width: "100%",
      alignItems: "stretch",
    });
    Object.assign(leftMask.style, {
      background: MASK_COLOR,
      flex: "0 0 auto",
      minWidth: "0",
    });
    Object.assign(rightMask.style, {
      background: MASK_COLOR,
      flex: "0 0 auto",
      minWidth: "0",
    });
    Object.assign(bottomMask.style, {
      background: MASK_COLOR,
      flex: "0 0 auto",
    });

    readingWrap.append(readingStrip, moveGrip);
    for (const handleId of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      readingWrap.append(createHandle(handleId));
    }

    middleRow.append(leftMask, readingWrap, rightMask);
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

  function applyLayout() {
    if (!currentSettings.enabled) {
      return;
    }

    const root = getRoot();
    const parts = getOverlayParts(root);
    if (!parts) {
      return;
    }

    const { vw, vh } = getViewportSize();
    const normalized = normalizeSettings(currentSettings);
    const effH = Math.min(normalized.height, vh);
    const effW = Math.min(normalized.width, vw);

    let cx = pointerCenterX;
    let cy = pointerCenterY;
    cx = Math.min(Math.max(cx, effW / 2), vw - effW / 2);
    cy = Math.min(Math.max(cy, effH / 2), vh - effH / 2);
    pointerCenterX = cx;
    pointerCenterY = cy;

    const topPx = cy - effH / 2;
    const bottomPx = vh - cy - effH / 2;
    const leftPx = cx - effW / 2;
    const rightPx = vw - cx - effW / 2;

    const { topMask, middleRow, leftMask, readingWrap, readingStrip, rightMask, bottomMask } =
      parts;

    topMask.style.height = `${Math.max(topPx, 0)}px`;
    middleRow.style.height = `${effH}px`;
    bottomMask.style.height = `${Math.max(bottomPx, 0)}px`;

    leftMask.style.flex = `0 0 ${Math.max(leftPx, 0)}px`;
    rightMask.style.flex = `0 0 ${Math.max(rightPx, 0)}px`;

    readingWrap.style.width = `${effW}px`;
    readingWrap.style.height = `${effH}px`;
    readingWrap.style.flex = `0 0 ${effW}px`;

    readingStrip.style.width = "100%";
    readingStrip.style.height = "100%";
  }

  function attachInteractionListeners() {
    globalThis.addEventListener("resize", onViewportResize, { passive: true });
    globalThis.addEventListener("keydown", onEscapeKey, true);
  }

  function applySettings(nextSettings) {
    const merged = {
      ...currentSettings,
      ...(nextSettings && typeof nextSettings === "object" ? nextSettings : {}),
    };
    const settings = normalizeSettings(merged);
    const turningOn = !wasEnabled && settings.enabled;
    wasEnabled = settings.enabled;
    currentSettings = settings;

    if (!settings.enabled) {
      endResizeInteraction();
      endDragMoveInteraction();
      clearPersistTimer();
      removeOverlay();
      return;
    }

    if (turningOn) {
      resetPointerCenter();
    }

    createRoot();
    applyLayout();
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

  attachInteractionListeners();
  readStoredDimensionsAndApply();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === QUERY_STATE_MESSAGE_TYPE) {
      sendResponse({ enabled: Boolean(currentSettings.enabled) });
      return;
    }
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
