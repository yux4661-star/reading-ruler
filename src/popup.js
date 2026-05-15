(function initReadingRulerPopup() {
  "use strict";

  const MESSAGE_TYPE = "READING_RULER_SETTINGS_UPDATED";
  const QUERY_STATE_MESSAGE_TYPE = "READING_RULER_QUERY_STATE";
  /** Session pulse from content script when the user presses Esc on the page. */
  const SESSION_ESC_KEY = "readingRulerEscDismissed";
  /** Debounce sync writes — rapid drags hit chrome.storage.sync rate limits. */
  const DIMENSION_PERSIST_DEBOUNCE_MS = 450;
  const {
    DEFAULT_SETTINGS,
    MIN_HEIGHT,
    MAX_HEIGHT,
    MIN_WIDTH,
    MAX_WIDTH,
    normalizeSettings,
  } =
    globalThis.RulerSettings;

  const enabledInput = document.getElementById("enabled");
  const heightInput = document.getElementById("height");
  const heightValue = document.getElementById("heightValue");
  const widthInput = document.getElementById("width");
  const widthValue = document.getElementById("widthValue");
  const status = document.getElementById("status");
  const API_ERROR_STATUS = "设置保存失败，请稍后重试。";
  let latestRequestId = 0;
  let persistTimer = null;

  function isPromiseLike(value) {
    return Boolean(value) && typeof value.then === "function";
  }

  function storageGet(keys) {
    try {
      const maybePromise = chrome.storage.sync.get(keys);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fallback to callback style.
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.get(keys, (result) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageLocalGet(keys) {
    try {
      const maybePromise = chrome.storage.local.get(keys);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fallback to callback style.
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(items) {
    try {
      const maybePromise = chrome.storage.sync.set(items);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fallback to callback style.
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.set(items, () => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageLocalSet(items) {
    try {
      const maybePromise = chrome.storage.local.set(items);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fallback to callback style.
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(items, () => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function queryTabs(queryInfo) {
    try {
      const maybePromise = chrome.tabs.query(queryInfo);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fallback to callback style.
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.query(queryInfo, (tabs) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(tabs);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function sendTabMessage(tabId, message) {
    try {
      const maybePromise = chrome.tabs.sendMessage(tabId, message);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fallback to callback style.
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.sendMessage(tabId, message, () => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function sendTabMessageForResponse(tabId, message) {
    try {
      const maybePromise = chrome.tabs.sendMessage(tabId, message);
      if (isPromiseLike(maybePromise)) {
        return maybePromise;
      }
    } catch {
      // Fallback to callback style.
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const runtimeError = chrome.runtime?.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function setStatus(message, requestId) {
    if (requestId !== undefined && requestId !== latestRequestId) {
      return;
    }

    status.textContent = message;
  }

  function createRequestId() {
    latestRequestId += 1;
    return latestRequestId;
  }

  function isLatestRequest(requestId) {
    return requestId === latestRequestId;
  }

  function clearPersistTimer() {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  }

  function render(settings) {
    enabledInput.checked = settings.enabled;
    heightInput.min = String(MIN_HEIGHT);
    heightInput.max = String(MAX_HEIGHT);
    heightInput.value = String(settings.height);
    heightValue.textContent = String(settings.height);
    widthInput.min = String(MIN_WIDTH);
    widthInput.max = String(MAX_WIDTH);
    widthInput.value = String(settings.width);
    widthValue.textContent = String(settings.width);
  }

  function getSettingsFromForm() {
    return normalizeSettings({
      enabled: enabledInput.checked,
      height: Number(heightInput.value),
      width: Number(widthInput.value),
    });
  }

  async function getActiveTab() {
    const tabs = await queryTabs({
      active: true,
      currentWindow: true,
    });
    const [tab] = Array.isArray(tabs) ? tabs : [];
    return tab;
  }

  async function readEnabledFromActiveTab() {
    try {
      const tab = await getActiveTab();
      if (!tab?.id) {
        return null;
      }
      const response = await sendTabMessageForResponse(tab.id, {
        type: QUERY_STATE_MESSAGE_TYPE,
      });
      if (response && typeof response.enabled === "boolean") {
        return response.enabled;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function notifyActiveTab(settings, requestId) {
    let tab;

    try {
      tab = await getActiveTab();
    } catch {
      if (isLatestRequest(requestId)) {
        setStatus("已保存设置。若页面未立即变化，请刷新页面。", requestId);
      }
      return;
    }

    if (!isLatestRequest(requestId)) {
      return;
    }

    if (!tab?.id) {
      setStatus("已保存设置。当前标签页不可更新。", requestId);
      return;
    }

    try {
      await sendTabMessage(tab.id, {
        type: MESSAGE_TYPE,
        settings,
      });
      if (isLatestRequest(requestId)) {
        setStatus("已应用到当前页面。", requestId);
      }
    } catch {
      if (isLatestRequest(requestId)) {
        setStatus("已保存设置。若页面未立即变化，请刷新页面。", requestId);
      }
    }
  }

  async function persistDimensions(settings, requestId) {
    const payload = { height: settings.height, width: settings.width };
    try {
      await storageSet(payload);
    } catch {
      try {
        await storageLocalSet(payload);
      } catch {
        if (isLatestRequest(requestId)) {
          setStatus(API_ERROR_STATUS, requestId);
        }
      }
    }
  }

  function schedulePersistDimensions(requestId) {
    clearPersistTimer();
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistDimensions(getSettingsFromForm(), requestId);
    }, DIMENSION_PERSIST_DEBOUNCE_MS);
  }

  async function onEnabledChange() {
    const requestId = createRequestId();
    const settings = getSettingsFromForm();
    render(settings);
    clearPersistTimer();
    await notifyActiveTab(settings, requestId);
    await persistDimensions(settings, requestId);
  }

  function onSliderInput() {
    const requestId = createRequestId();
    const settings = getSettingsFromForm();
    render(settings);
    void notifyActiveTab(settings, requestId);
    schedulePersistDimensions(requestId);
  }

  async function initialize(storedSync, storedLocal) {
    const requestId = createRequestId();

    try {
      const settings = normalizeSettings({
        ...DEFAULT_SETTINGS,
        enabled: false,
        height: storedLocal.height ?? storedSync.height,
        width: storedLocal.width ?? storedSync.width,
      });
      render(settings);

      const enabledOnPage = await readEnabledFromActiveTab();
      const displaySettings = normalizeSettings({
        ...settings,
        ...(enabledOnPage === null ? {} : { enabled: enabledOnPage }),
      });
      render(displaySettings);

      if (enabledOnPage === true) {
        setStatus("阅读尺已在当前页面开启。", requestId);
      } else {
        setStatus("请手动开启阅读尺。", requestId);
      }
    } catch {
      setStatus(API_ERROR_STATUS, requestId);
    }
  }

  function attachSessionEscSync() {
    const sessionApi = chrome.storage?.session;
    if (!sessionApi?.onChanged?.addListener) {
      return;
    }

    sessionApi.onChanged.addListener((changes, areaName) => {
      if (areaName !== "session") {
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(changes, SESSION_ESC_KEY)) {
        return;
      }

      enabledInput.checked = false;
      setStatus("页面已按 Esc 关闭阅读尺。");
    });
  }

  attachSessionEscSync();

  Promise.all([
    storageGet(["height", "width"]).catch(() => ({})),
    storageLocalGet(["height", "width"]).catch(() => ({})),
  ])
    .then(([storedSync, storedLocal]) => initialize(storedSync, storedLocal))
    .catch(() => {
      const requestId = createRequestId();
      setStatus(API_ERROR_STATUS, requestId);
    });

  enabledInput.addEventListener("change", () => onEnabledChange());
  heightInput.addEventListener("input", onSliderInput);
  widthInput.addEventListener("input", onSliderInput);
})();
