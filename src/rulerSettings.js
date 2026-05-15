(function attachRulerSettings(root) {
  "use strict";

  const MIN_HEIGHT = 40;
  const MAX_HEIGHT = 320;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 1600;
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    height: 120,
    width: 960,
  });

  function clampHeight(value) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) {
      return DEFAULT_SETTINGS.height;
    }
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, rounded));
  }

  function clampWidth(value) {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) {
      return DEFAULT_SETTINGS.width;
    }
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rounded));
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
      width:
        typeof source.width === "number"
          ? clampWidth(source.width)
          : DEFAULT_SETTINGS.width,
    };
  }

  function getOverlayGeometry(height, width) {
    const normalizedHeight = clampHeight(height);
    const normalizedWidth = clampWidth(width);
    const halfMaskHeight = `calc((100vh - ${normalizedHeight}px) / 2)`;

    return {
      topHeight: halfMaskHeight,
      readingHeight: `${normalizedHeight}px`,
      bottomHeight: halfMaskHeight,
      readingWidth: `min(${normalizedWidth}px, 100vw)`,
    };
  }

  const api = {
    DEFAULT_SETTINGS,
    MIN_HEIGHT,
    MAX_HEIGHT,
    MIN_WIDTH,
    MAX_WIDTH,
    clampHeight,
    clampWidth,
    normalizeSettings,
    getOverlayGeometry,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RulerSettings = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
