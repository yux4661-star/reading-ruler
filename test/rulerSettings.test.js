const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const nodeTimers = require("node:timers");
const { setTimeout: sleep } = require("node:timers/promises");

const {
  DEFAULT_SETTINGS,
  clampHeight,
  clampWidth,
  normalizeSettings,
  getOverlayGeometry,
} = require("../src/rulerSettings.js");

function createElementMock(tagName, ownerDocument) {
  return {
    tagName,
    id: "",
    dataset: {},
    style: {},
    attributes: {},
    children: [],
    parentNode: null,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parentNode = this;
        this.children.push(node);
      }
    },
    remove() {
      if (!this.parentNode) {
        return;
      }

      this.parentNode.children = this.parentNode.children.filter(
        (child) => child !== this,
      );
      this.parentNode = null;
    },
    querySelector(selector) {
      const match = selector.match(/^\[data-ruler-part="([^"]+)"\]$/);

      if (!match) {
        return null;
      }

      return ownerDocument.findByRulerPart(this, match[1]);
    },
  };
}

function createDocumentMock() {
  const document = {
    documentElement: null,
    createElement(tagName) {
      return createElementMock(tagName, document);
    },
    getElementById(id) {
      return document.findById(document.documentElement, id);
    },
    findById(node, id) {
      if (!node) {
        return null;
      }
      if (node.id === id) {
        return node;
      }

      for (const child of node.children) {
        const result = document.findById(child, id);
        if (result) {
          return result;
        }
      }

      return null;
    },
    findByRulerPart(node, rulerPart) {
      if (!node) {
        return null;
      }
      if (node.dataset.rulerPart === rulerPart) {
        return node;
      }

      for (const child of node.children) {
        const result = document.findByRulerPart(child, rulerPart);
        if (result) {
          return result;
        }
      }

      return null;
    },
  };

  document.documentElement = document.createElement("html");

  return document;
}

function createContentScriptHarness(initialSettings = {}) {
  const source = fs.readFileSync(require.resolve("../src/content.js"), "utf8");
  const document = createDocumentMock();
  const messageListeners = [];
  const chromeStorageListeners = [];
  const windowEventListeners = { popstate: [], hashchange: [] };
  let storageGetKeys;
  const localSnapshot =
    initialSettings &&
    typeof initialSettings === "object" &&
    Object.prototype.hasOwnProperty.call(initialSettings, "local")
      ? initialSettings.local
      : {};
  const syncSnapshot =
    initialSettings &&
    typeof initialSettings === "object" &&
    Object.prototype.hasOwnProperty.call(initialSettings, "sync")
      ? initialSettings.sync
      : initialSettings;
  const navigationHref = { value: "https://fixture.test/page-a" };
  const sandbox = {
    document,
    location: {
      get href() {
        return navigationHref.value;
      },
      set href(next) {
        navigationHref.value = String(next);
      },
    },
    history: {
      pushState: (...args) => {
        navigationHref.value = `${navigationHref.value}/pushed`;
      },
      replaceState: (...args) => {
        navigationHref.value = `${navigationHref.value}/replaced`;
      },
    },
    addEventListener(type, listener) {
      if (type === "popstate" || type === "hashchange") {
        windowEventListeners[type].push(listener);
      }
    },
    RulerSettings: {
      normalizeSettings,
      getOverlayGeometry,
    },
    chrome: {
      storage: {
        sync: {
          get(keys, callback) {
            storageGetKeys = keys;
            callback(pickRequestedKeys(syncSnapshot, keys));
          },
        },
        local: {
          get(keys, callback) {
            callback(pickRequestedKeys(localSnapshot, keys));
          },
        },
        onChanged: {
          addListener(listener) {
            chromeStorageListeners.push(listener);
          },
        },
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListeners.push(listener);
          },
        },
      },
    },
  };

  vm.createContext(sandbox);

  return {
    document,
    sandbox,
    navigationHref,
    run() {
      vm.runInContext(source, sandbox);
    },
    get messageListener() {
      return messageListeners.at(-1);
    },
    get messageListeners() {
      return messageListeners;
    },
    get storageChangeListener() {
      return chromeStorageListeners.at(-1);
    },
    get storageGetKeys() {
      return storageGetKeys;
    },
    dispatchPopState() {
      for (const listener of windowEventListeners.popstate) {
        listener();
      }
    },
  };
}

function runContentScript(initialSettings = {}) {
  const harness = createContentScriptHarness(initialSettings);

  harness.run();

  return harness;
}

function createPopupElementMock(id) {
  const listeners = {};

  return {
    id,
    checked: false,
    min: "",
    max: "",
    value: "",
    textContent: "",
    addEventListener(eventName, listener) {
      listeners[eventName] = listener;
    },
    dispatchEvent(eventName) {
      return Promise.resolve(listeners[eventName]?.());
    },
  };
}

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function pickRequestedKeys(source, keys) {
  if (!Array.isArray(keys)) {
    return source;
  }

  return keys.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key];
    }
    return result;
  }, {});
}

function createPopupHarness(storedSettings = {}, tab = { id: 12 }, options = {}) {
  const source = fs.readFileSync(require.resolve("../src/popup.js"), "utf8");
  const elements = {
    enabled: createPopupElementMock("enabled"),
    height: createPopupElementMock("height"),
    heightValue: createPopupElementMock("heightValue"),
    width: createPopupElementMock("width"),
    widthValue: createPopupElementMock("widthValue"),
    status: createPopupElementMock("status"),
  };
  const storedLocal = options.storedLocal ?? {};
  const storageWrites = [];
  const localWrites = [];
  let persistedSettings;
  let storageSyncGetKeys;
  let storageLocalGetKeys;
  const sentMessages = [];
  const sandbox = {
    document: {
      getElementById(id) {
        return elements[id] ?? null;
      },
    },
    RulerSettings: {
      DEFAULT_SETTINGS,
      MIN_HEIGHT: 40,
      MAX_HEIGHT: 320,
      MIN_WIDTH: 240,
      MAX_WIDTH: 1600,
      normalizeSettings,
    },
    chrome: {
      storage: {
        sync: {
          get(keys, callback) {
            storageSyncGetKeys = keys;
            callback(pickRequestedKeys(storedSettings, keys));
          },
          async set(settings) {
            storageWrites.push(settings);
            if (options.storageSet) {
              await options.storageSet(settings, storageWrites.length - 1);
            }
            persistedSettings = settings;
          },
        },
        local: {
          get(keys, callback) {
            storageLocalGetKeys = keys;
            callback(pickRequestedKeys(storedLocal, keys));
          },
          async set(settings) {
            localWrites.push(settings);
            if (options.storageLocalSet) {
              await options.storageLocalSet(settings, localWrites.length - 1);
            }
          },
        },
      },
      tabs: {
        async query(queryInfo) {
          assert.equal(queryInfo.active, true);
          assert.equal(queryInfo.currentWindow, true);
          if (options.tabsQuery) {
            return options.tabsQuery(queryInfo);
          }
          return tab ? [tab] : [];
        },
        async sendMessage(tabId, message) {
          if (options.sendMessage) {
            await options.sendMessage(tabId, message);
          }
          sentMessages.push({ tabId, message });
        },
      },
    },
  };

  sandbox.setTimeout = nodeTimers.setTimeout;
  sandbox.clearTimeout = nodeTimers.clearTimeout;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  return {
    elements,
    storageWrites,
    localWrites,
    sentMessages,
    get persistedSettings() {
      return persistedSettings;
    },
    get storageSyncGetKeys() {
      return storageSyncGetKeys;
    },
    get storageLocalGetKeys() {
      return storageLocalGetKeys;
    },
  };
}

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
    width: 960,
  });
});

test("getOverlayGeometry derives centered mask sizes from height and width", () => {
  assert.deepEqual(getOverlayGeometry(120, 960), {
    topHeight: "calc((100vh - 120px) / 2)",
    readingHeight: "120px",
    bottomHeight: "calc((100vh - 120px) / 2)",
    readingWidth: "min(960px, 100vw)",
  });
});

test("clampWidth limits width to supported bounds", () => {
  assert.equal(clampWidth(100), 240);
  assert.equal(clampWidth(240), 240);
  assert.equal(clampWidth(900), 900);
  assert.equal(clampWidth(1600), 1600);
  assert.equal(clampWidth(3000), 1600);
});

test("CommonJS require does not expose RulerSettings globally", () => {
  const modulePath = require.resolve("../src/rulerSettings.js");

  delete require.cache[modulePath];
  delete globalThis.RulerSettings;

  const rulerSettings = require(modulePath);

  assert.equal(globalThis.RulerSettings, undefined);
  assert.equal(typeof rulerSettings.normalizeSettings, "function");
});

test("browser script loading exposes RulerSettings globally", () => {
  const source = fs.readFileSync(require.resolve("../src/rulerSettings.js"), "utf8");
  const sandbox = {};

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  assert.equal(typeof sandbox.RulerSettings.normalizeSettings, "function");
  const normalized = sandbox.RulerSettings.normalizeSettings({ height: 99.6 });

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.height, 100);
});

test("content script keeps stored size but defaults to disabled on load", () => {
  const { document, storageGetKeys, messageListener } = runContentScript({
    enabled: true,
    height: 120,
    width: 960,
  });

  assert.deepEqual(Array.from(storageGetKeys), ["height", "width"]);
  assert.equal(typeof messageListener, "function");
  assert.equal(document.getElementById("reading-ruler-extension-overlay"), null);

  messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: true },
  });

  const root = document.getElementById("reading-ruler-extension-overlay");
  assert.equal(root.attributes["aria-hidden"], "true");
  assert.equal(root.dataset.readingRulerExtension, "true");
  assert.equal(root.style.position, "fixed");
  assert.equal(root.style.inset, "0");
  assert.equal(root.style.zIndex, "2147483647");
  assert.equal(root.style.pointerEvents, "none");
  assert.equal(root.style.display, "flex");
  assert.equal(root.style.flexDirection, "column");
  assert.deepEqual(
    root.children.map((child) => child.dataset.rulerPart),
    ["top", "middle-row", "bottom"],
  );

  const [topMask, middleRow, bottomMask] = root.children;
  const [leftMask, readingStrip, rightMask] = middleRow.children;

  assert.equal(topMask.style.background, "rgba(0, 0, 0, 0.42)");
  assert.equal(topMask.style.height, "calc((100vh - 120px) / 2)");
  assert.equal(leftMask.style.background, "rgba(0, 0, 0, 0.42)");
  assert.equal(readingStrip.style.background, "transparent");
  assert.equal(readingStrip.style.height, "120px");
  assert.equal(readingStrip.style.width, "min(960px, 100vw)");
  assert.equal(rightMask.style.background, "rgba(0, 0, 0, 0.42)");
  assert.equal(
    readingStrip.style.boxShadow,
    "inset 0 1px rgba(255,255,255,0.24), inset 0 -1px rgba(255,255,255,0.24)",
  );
  assert.equal(bottomMask.style.background, "rgba(0, 0, 0, 0.42)");
  assert.equal(bottomMask.style.height, "calc((100vh - 120px) / 2)");
});

test("content script updates and removes the overlay from runtime messages", () => {
  const { document, messageListener } = runContentScript({
    enabled: false,
    height: 120,
    width: 960,
  });

  assert.equal(document.getElementById("reading-ruler-extension-overlay"), null);

  messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: true, height: 180, width: 800 },
  });

  const root = document.getElementById("reading-ruler-extension-overlay");

  assert.equal(document.documentElement.children.length, 1);
  assert.equal(root.children[0].style.height, "calc((100vh - 180px) / 2)");
  assert.equal(root.children[1].style.height, "180px");
  assert.equal(root.children[1].children[1].style.height, "180px");
  assert.equal(root.children[1].children[1].style.width, "min(800px, 100vw)");
  assert.equal(root.children[2].style.height, "calc((100vh - 180px) / 2)");

  messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: true, height: 320, width: 1200 },
  });

  assert.equal(document.documentElement.children.length, 1);
  assert.equal(root.children[1].style.height, "320px");
  assert.equal(root.children[1].children[1].style.height, "320px");
  assert.equal(root.children[1].children[1].style.width, "min(1200px, 100vw)");

  messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: false, height: 320, width: 1200 },
  });

  assert.equal(document.getElementById("reading-ruler-extension-overlay"), null);
});

test("content script keeps enabled state when storage emits partial updates", () => {
  const { document, messageListener, storageChangeListener } = runContentScript({
    enabled: true,
    height: 120,
    width: 960,
  });

  assert.equal(document.getElementById("reading-ruler-extension-overlay"), null);

  storageChangeListener(
    {
      height: { oldValue: 120, newValue: 120 },
      width: { oldValue: 960, newValue: 960 },
    },
    "sync",
  );

  const rootBefore = document.getElementById("reading-ruler-extension-overlay");
  assert.equal(rootBefore, null);

  // Explicitly enable once, then partial updates must keep it enabled.
  messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: true, height: 120, width: 960 },
  });

  storageChangeListener(
    {
      width: { oldValue: 960, newValue: 700 },
    },
    "sync",
  );

  const rootAfterWidthChange = document.getElementById("reading-ruler-extension-overlay");
  assert.notEqual(rootAfterWidthChange, null);
  assert.equal(rootAfterWidthChange.children[1].children[1].style.width, "min(700px, 100vw)");

  storageChangeListener(
    {
      height: { oldValue: 120, newValue: 180 },
    },
    "sync",
  );

  const rootAfterHeightChange = document.getElementById("reading-ruler-extension-overlay");
  assert.notEqual(rootAfterHeightChange, null);
  assert.equal(rootAfterHeightChange.children[1].children[1].style.height, "180px");
  assert.equal(rootAfterHeightChange.children[1].children[1].style.width, "min(700px, 100vw)");
});

test("content script replaces conflicting same-id page elements", () => {
  const harness = createContentScriptHarness({
    enabled: true,
    height: 140,
    width: 700,
  });
  const conflictingElement = harness.document.createElement("main");

  conflictingElement.id = "reading-ruler-extension-overlay";
  harness.document.documentElement.append(conflictingElement);

  assert.doesNotThrow(() => harness.run());
  harness.messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: true, height: 140, width: 700 },
  });

  const root = harness.document.getElementById("reading-ruler-extension-overlay");

  assert.notEqual(root, conflictingElement);
  assert.equal(conflictingElement.parentNode, null);
  assert.equal(root.dataset.readingRulerExtension, "true");
  assert.deepEqual(
    root.children.map((child) => child.dataset.rulerPart),
    ["top", "middle-row", "bottom"],
  );
  assert.equal(root.children[1].style.height, "140px");
  assert.equal(root.children[1].children[1].style.height, "140px");
  assert.equal(root.children[1].children[1].style.width, "min(700px, 100vw)");
});

test("content script initializes only once in the same page context", () => {
  const harness = createContentScriptHarness({
    enabled: true,
    height: 120,
    width: 960,
  });

  harness.run();
  harness.run();
  harness.messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: true, height: 120, width: 960 },
  });

  assert.equal(harness.messageListeners.length, 1);
  assert.equal(
    harness.sandbox.__readingRulerExtensionContentInitialized,
    true,
  );
  assert.equal(
    harness.document.documentElement.children.filter(
      (child) => child.id === "reading-ruler-extension-overlay",
    ).length,
    1,
  );
});

test("content script disables ruler when SPA history changes URL", () => {
  const harness = createContentScriptHarness({
    height: 120,
    width: 960,
  });

  harness.run();
  harness.messageListener({
    type: "READING_RULER_SETTINGS_UPDATED",
    settings: { enabled: true, height: 120, width: 960 },
  });

  assert.notEqual(
    harness.document.getElementById("reading-ruler-extension-overlay"),
    null,
  );

  harness.sandbox.history.pushState({}, "", "");
  assert.equal(
    harness.document.getElementById("reading-ruler-extension-overlay"),
    null,
  );
});

test("popup renders stored settings and stays disabled on open", async () => {
  const harness = createPopupHarness({ enabled: true, height: 180, width: 860 });

  await flushAsyncWork();

  assert.deepEqual(Array.from(harness.storageSyncGetKeys), ["height", "width"]);
  assert.deepEqual(Array.from(harness.storageLocalGetKeys), ["height", "width"]);
  assert.equal(harness.elements.enabled.checked, false);
  assert.equal(harness.elements.height.min, "40");
  assert.equal(harness.elements.height.max, "320");
  assert.equal(harness.elements.height.value, "180");
  assert.equal(harness.elements.heightValue.textContent, "180");
  assert.equal(harness.elements.width.min, "240");
  assert.equal(harness.elements.width.max, "1600");
  assert.equal(harness.elements.width.value, "860");
  assert.equal(harness.elements.widthValue.textContent, "860");
  assert.deepEqual(toPlainJson(harness.sentMessages), []);
  assert.equal(harness.elements.status.textContent, "请手动开启阅读尺。");
});

test("popup shows saved status when there is no active tab", async () => {
  const harness = createPopupHarness({ enabled: true, height: 180, width: 860 }, null);

  await flushAsyncWork();

  assert.deepEqual(toPlainJson(harness.sentMessages), []);
  assert.equal(harness.elements.status.textContent, "请手动开启阅读尺。");
});

test("popup handles sendMessage rejection without an unhandled rejection", async () => {
  const harness = createPopupHarness({ enabled: true, height: 180, width: 860 }, { id: 12 }, {
    sendMessage() {
      throw new Error("cannot inject");
    },
  });

  await flushAsyncWork();
  harness.elements.enabled.checked = true;
  await harness.elements.enabled.dispatchEvent("change");

  assert.deepEqual(toPlainJson(harness.sentMessages), []);
  assert.equal(
    harness.elements.status.textContent,
    "已保存设置。若页面未立即变化，请刷新页面。",
  );
});

test("popup handles tabs.query failure with a friendly status", async () => {
  const harness = createPopupHarness({ enabled: true, height: 180, width: 860 }, { id: 12 }, {
    tabsQuery() {
      throw new Error("tabs unavailable");
    },
  });

  await flushAsyncWork();
  harness.elements.enabled.checked = true;
  await harness.elements.enabled.dispatchEvent("change");

  assert.deepEqual(toPlainJson(harness.sentMessages), []);
  assert.equal(
    harness.elements.status.textContent,
    "已保存设置。若页面未立即变化，请刷新页面。",
  );
});

test("popup handles storage.set failure with a friendly status", async () => {
  const harness = createPopupHarness({ enabled: false, height: 120, width: 960 }, { id: 12 }, {
    storageSet() {
      throw new Error("storage unavailable");
    },
  });

  await flushAsyncWork();
  harness.sentMessages.length = 0;
  harness.elements.enabled.checked = true;

  await harness.elements.enabled.dispatchEvent("change");

  assert.deepEqual(toPlainJson(harness.storageWrites), [
    { height: 120, width: 960 },
  ]);
  assert.deepEqual(toPlainJson(harness.localWrites), [{ height: 120, width: 960 }]);
  assert.deepEqual(toPlainJson(harness.sentMessages), [
    {
      tabId: 12,
      message: {
        type: "READING_RULER_SETTINGS_UPDATED",
        settings: { enabled: true, height: 120, width: 960 },
      },
    },
  ]);
  assert.equal(harness.elements.status.textContent, "已应用到当前页面。");
});

test("popup debounces sync storage while sending each slider update to the tab", async () => {
  const harness = createPopupHarness(
    { enabled: true, height: 120, width: 960 },
    { id: 12 },
    {},
  );

  await flushAsyncWork();
  harness.sentMessages.length = 0;
  harness.storageWrites.length = 0;
  harness.elements.enabled.checked = true;

  harness.elements.height.value = "180";
  await harness.elements.height.dispatchEvent("input");
  harness.elements.height.value = "240";
  await harness.elements.height.dispatchEvent("input");

  assert.equal(harness.storageWrites.length, 0);

  await sleep(600);

  assert.deepEqual(toPlainJson(harness.storageWrites), [
    { height: 240, width: 960 },
  ]);
  assert.deepEqual(toPlainJson(harness.sentMessages), [
    {
      tabId: 12,
      message: {
        type: "READING_RULER_SETTINGS_UPDATED",
        settings: { enabled: true, height: 240, width: 960 },
      },
    },
  ]);
  assert.equal(harness.elements.height.value, "240");
  assert.equal(harness.elements.heightValue.textContent, "240");
  assert.equal(harness.elements.status.textContent, "已应用到当前页面。");
});

test("popup persists only final dimensions after rapid slider input", async () => {
  const firstStorageWrite = createDeferred();
  const harness = createPopupHarness({ enabled: true, height: 120, width: 960 }, { id: 12 }, {
    storageSet(_settings, index) {
      if (index === 0) {
        return firstStorageWrite.promise;
      }
      return Promise.resolve();
    },
  });

  await flushAsyncWork();
  harness.sentMessages.length = 0;
  harness.storageWrites.length = 0;
  harness.elements.enabled.checked = true;

  harness.elements.height.value = "180";
  await harness.elements.height.dispatchEvent("input");
  harness.elements.height.value = "240";
  await harness.elements.height.dispatchEvent("input");

  await sleep(600);
  firstStorageWrite.resolve();
  await flushAsyncWork();

  assert.deepEqual(toPlainJson(harness.storageWrites), [{ height: 240, width: 960 }]);
  assert.deepEqual(toPlainJson(harness.persistedSettings), {
    height: 240,
    width: 960,
  });
});

test("popup saves normalized form changes before notifying the active tab", async () => {
  const harness = createPopupHarness({ enabled: false, height: 120, width: 960 });

  await flushAsyncWork();
  harness.sentMessages.length = 0;
  harness.elements.enabled.checked = true;
  harness.elements.height.value = "999";

  await harness.elements.height.dispatchEvent("input");

  assert.equal(harness.storageWrites.length, 0);
  await sleep(600);
  await flushAsyncWork();

  assert.deepEqual(toPlainJson(harness.storageWrites), [
    { height: 320, width: 960 },
  ]);
  assert.equal(harness.elements.height.value, "320");
  assert.equal(harness.elements.heightValue.textContent, "320");
  assert.deepEqual(toPlainJson(harness.sentMessages), [
    {
      tabId: 12,
      message: {
        type: "READING_RULER_SETTINGS_UPDATED",
        settings: { enabled: true, height: 320, width: 960 },
      },
    },
  ]);
  assert.equal(harness.elements.status.textContent, "已应用到当前页面。");
});
