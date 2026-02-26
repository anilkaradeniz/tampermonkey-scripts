// ==UserScript==
// @name         NitroClash Skinner
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Replace game skins via URL params: field, bg, blue, red, ball
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/nc-skinner.user.js
// @downloadURL  https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/nc-skinner.user.js
// ==/UserScript==

(function () {
  "use strict";

  const SKIN_BASE =
    "https://raw.githubusercontent.com/anilkaradeniz/tampermonkey-scripts/refs/heads/master/skins";

  // param -> { folder, textureName match substring }
  const SKIN_MAP = {
    field: { folder: "field", match: "playfield" },
    bg: { folder: "bg", match: "bgtile" },
    blue: { folder: "blue", match: "player-B" },
    red: { folder: "red", match: "player-R" },
    ball: { folder: "ball", match: "ballWFG" },
  };

  // Parse query params
  const params = new URLSearchParams(window.location.search);
  const skinRequests = {};
  for (const [param, cfg] of Object.entries(SKIN_MAP)) {
    const val = params.get(param);
    if (val) {
      skinRequests[param] = {
        ...cfg,
        file: val,
        url: `${SKIN_BASE}/${cfg.folder}/${val}.png`,
        count: 0,
        texture: null,
        imageLoaded: false,
      };
    }
  }

  if (Object.keys(skinRequests).length === 0) {
    console.log("[NC-Skinner] No skin params found, skipping");
    return;
  }

  console.log("[NC-Skinner] Skin requests:", skinRequests);

  // Pre-load all skin images
  for (const [param, skin] of Object.entries(skinRequests)) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      skin.imageLoaded = true;
      skin.image = img;
      console.log(`[NC-Skinner] Pre-loaded ${param}=${skin.file}`);
    };
    img.onerror = (e) => {
      console.error(`[NC-Skinner] Failed to load ${skin.url}`, e);
    };
    img.src = skin.url;
  }

  // Hook PIXI renderer to capture the stage
  let pixiStage = null;
  let pixiHooked = false;

  function hookPIXI() {
    if (pixiHooked) return;
    if (typeof window.PIXI === "undefined") {
      setTimeout(hookPIXI, 500);
      return;
    }

    const rendererTypes = [
      PIXI.WebGLRenderer && PIXI.WebGLRenderer.prototype,
      PIXI.CanvasRenderer && PIXI.CanvasRenderer.prototype,
    ].filter(Boolean);

    for (const proto of rendererTypes) {
      const origRender = proto.render;
      proto.render = function (stage, ...args) {
        if (stage && stage !== pixiStage) {
          pixiStage = stage;
          resetApplied();
          scheduleSkinReplace();
          console.log("[NC-Skinner] Captured PIXI stage");
        }
        return origRender.call(this, stage, ...args);
      };
    }

    pixiHooked = true;
    console.log("[NC-Skinner] PIXI renderer hooks installed");
  }

  function resetApplied() {
    for (const skin of Object.values(skinRequests)) {
      skin.count = 0;
      skin.texture = null;
    }
  }

  // Periodically attempt skin replacement until all applied
  let replaceTimer = null;

  function scheduleSkinReplace() {
    if (replaceTimer) clearInterval(replaceTimer);
    replaceTimer = setInterval(() => {
      if (replaceSkins()) {
        clearInterval(replaceTimer);
        replaceTimer = null;
      }
    }, 500);
  }

  function getTextureName(node) {
    if (!node.texture) return "";
    return (
      (node.texture.textureCacheIds && node.texture.textureCacheIds[0]) ||
      (node.texture.baseTexture &&
        node.texture.baseTexture.textureCacheIds &&
        node.texture.baseTexture.textureCacheIds[0]) ||
      ""
    );
  }

  function replaceSkins() {
    if (!pixiStage || typeof PIXI === "undefined") return false;

    // Only process skins whose images have loaded
    const pending = Object.entries(skinRequests).filter(
      ([, s]) => s.imageLoaded,
    );
    if (pending.length === 0) return false;

    // Reset counts before each full walk
    for (const [, skin] of pending) skin.count = 0;

    // Walk the display tree — replace ALL matching nodes, not just the first
    const queue = [pixiStage];
    while (queue.length > 0) {
      const node = queue.shift();

      const texName = getTextureName(node);
      if (texName) {
        for (const [, skin] of pending) {
          if (texName.includes(skin.match)) {
            if (!skin.texture) {
              skin.texture = PIXI.Texture.from(skin.image);
            }
            node.texture = skin.texture;
            skin.count++;
          }
        }
      }

      if (node.children) {
        for (const child of node.children) {
          queue.push(child);
        }
      }
    }

    // Consider done when every requested skin matched at least one node
    const allApplied = pending.every(([, s]) => s.count > 0);
    if (allApplied) {
      for (const [param, skin] of pending) {
        console.log(
          `[NC-Skinner] Replaced ${skin.count}x ${skin.match} with ${skin.file} (param=${param})`,
        );
      }
    }
    return allApplied;
  }

  hookPIXI();
})();
