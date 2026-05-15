importScripts("rulerSettings.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["enabled", "height", "width"], (storedSettings) => {
    const settings = globalThis.RulerSettings.normalizeSettings(storedSettings);

    chrome.storage.sync.set(settings);
  });
});
