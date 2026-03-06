// ==UserScript==
// @name         NitroClash Skinner
// @author       parasetanol
// @namespace    http://tampermonkey.net/
// @version      0.2.8
// @description  Replace game skins via URL params or skin selector menu
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

  const GITHUB_API =
    "https://api.github.com/repos/anilkaradeniz/tampermonkey-scripts/contents/skins";

  // param -> { folder, spriteKey in game's SpriteSource object }
  const SKIN_MAP = {
    field: { folder: "field", spriteKey: "playfield" },
    bg: { folder: "bg", spriteKey: "bgtile" },
    blue: { folder: "blue", spriteKey: "player-B" },
    red: { folder: "red", spriteKey: "player-R" },
    ball: { folder: "ball", spriteKey: "ballWFG" },
  };

  // Cookie names — diverse and specific to this script
  const COOKIE_KEYS = {
    field: "ncskinner_playfield_skin",
    bg: "ncskinner_background_skin",
    blue: "ncskinner_blueteam_skin",
    red: "ncskinner_redteam_skin",
    ball: "ncskinner_gameball_skin",
  };

  const CUSTOM_IMG_KEYS = {
    field: "ncskinner_custom_img_field",
    bg: "ncskinner_custom_img_bg",
    blue: "ncskinner_custom_img_blue",
    red: "ncskinner_custom_img_red",
    ball: "ncskinner_custom_img_ball",
  };

  const CUSTOM_SKIN_VALUE = "__custom__";
  const CUSTOM_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

  const NAME_COLOR_SELF_KEY = "ncskinner_namecolor_self";
  const NAME_COLOR_OTHERS_KEY = "ncskinner_namecolor_others";
  const PLAYER_BOOST_TINT_KEY = "ncskinner_boost_tint";
  const CUSTOM_PLAYER_COLOR_KEY = "ncskinner_custom_player_color";
  const PLAYER_TINT_BLUE_KEY = "ncskinner_player_tint_blue";
  const PLAYER_TINT_RED_KEY = "ncskinner_player_tint_red";

  const UI_MODE_KEY = "ncskinner_ui_mode";
  const UI_BG_OPACITY_KEY = "ncskinner_ui_bg_opacity";
  const UI_ADAPTIVE_RANGE_KEY = "ncskinner_ui_adaptive_range";

  // Display labels for the UI
  const CATEGORY_LABELS = {
    field: "Field",
    bg: "Background",
    blue: "Blue Team",
    red: "Red Team",
    ball: "Ball",
  };

  // ── Cookie helpers ──────────────────────────────────────────────────

  function setCookie(name, value) {
    const d = new Date();
    d.setTime(d.getTime() + 365 * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
  }

  // ── Build skin requests from URL params + cookies ───────────────────
  // URL params take priority over cookies (same override semantics)

  const params = new URLSearchParams(window.location.search);
  const skinRequests = {};

  for (const [param, cfg] of Object.entries(SKIN_MAP)) {
    const val = params.get(param) || getCookie(COOKIE_KEYS[param]);
    if (val) {
      let url;
      if (val === CUSTOM_SKIN_VALUE) {
        const dataUrl = localStorage.getItem(CUSTOM_IMG_KEYS[param]);
        if (!dataUrl) continue; // custom selected but image missing
        url = dataUrl;
      } else {
        url = `${SKIN_BASE}/${cfg.folder}/${val}.png`;
      }
      skinRequests[param] = {
        ...cfg,
        file: val,
        url,
        imageLoaded: false,
      };
    }
  }

  const hasSkins = Object.keys(skinRequests).length > 0;

  if (hasSkins) {
    console.debug("[NC-Skinner] Skin requests:", skinRequests);
  } else {
    console.debug("[NC-Skinner] No skins selected");
  }

  // ── Pre-load skin images ────────────────────────────────────────────

  for (const [param, skin] of Object.entries(skinRequests)) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      skin.imageLoaded = true;
      skin.image = img;
      console.debug(`[NC-Skinner] Pre-loaded ${param}=${skin.file}`);
    };
    img.onerror = (e) => {
      console.error(`[NC-Skinner] Failed to load ${skin.url}`, e);
    };
    img.src = skin.url;
  }

  // ── SpriteSource texture replacement ─────────────────────────────
  // The game holds all texture references in SpriteSource (accessible via
  // PIXI.loader.resources). When it creates sprites (e.g. on map rebuild,
  // team change, spectator switch), it reads from SpriteSource. By replacing
  // the textures there once, every future sprite creation uses our skins
  // automatically — no re-application or hooking needed.

  function applySkinSources() {
    if (
      typeof window.PIXI === "undefined" ||
      !PIXI.loader ||
      !PIXI.loader.resources
    ) {
      setTimeout(applySkinSources, 500);
      return;
    }
    const sheet = PIXI.loader.resources["img/spritesheet4.json"];
    if (!sheet || !sheet.textures) {
      setTimeout(applySkinSources, 500);
      return;
    }

    const spriteSource = sheet.textures;
    const pending = Object.entries(skinRequests).filter(
      ([, s]) => !s.imageLoaded,
    );
    if (pending.length > 0) {
      setTimeout(applySkinSources, 500);
      return;
    }

    for (const [param, skin] of Object.entries(skinRequests)) {
      spriteSource[skin.spriteKey] = PIXI.Texture.from(skin.image);
      console.debug(
        `[NC-Skinner] SpriteSource.${skin.spriteKey} = ${skin.file} (param=${param})`,
      );
    }
    console.debug("[NC-Skinner] All skin sources replaced");
    applyCustomPlayerColors();
  }

  // ── PIXI stage capture (for name recolor / boost tint / adaptive HUD) ──

  let pixiStage = null;

  function hookPIXI() {
    if (typeof window.PIXI === "undefined") {
      setTimeout(hookPIXI, 500);
      return;
    }

    const rendererTypes = [
      PIXI.WebGLRenderer && PIXI.WebGLRenderer.prototype,
      PIXI.CanvasRenderer && PIXI.CanvasRenderer.prototype,
    ].filter(Boolean);

    for (const proto of rendererTypes) {
      if (proto.__ncSkinnerHooked) continue;
      const origRender = proto.render;
      proto.render = function (stage, ...args) {
        if (stage && stage !== pixiStage) {
          pixiStage = stage;
        }
        return origRender.call(this, stage, ...args);
      };
      proto.__ncSkinnerHooked = true;
    }
    console.debug("[NC-Skinner] PIXI stage capture installed");
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

  // ── Player name recoloring ──────────────────────────────────────────

  const savedSelfColor = getCookie(NAME_COLOR_SELF_KEY) || "";
  const savedOthersColor = getCookie(NAME_COLOR_OTHERS_KEY) || "";
  let activeSelfColor = savedSelfColor;
  let activeOthersColor = savedOthersColor;

  let nameColorTimer = null;

  function scheduleNameRecolor() {
    if (nameColorTimer) return;
    nameColorTimer = setInterval(recolorNames, 500);
  }

  function recolorNames() {
    if (!pixiStage || typeof PIXI === "undefined") return;
    if (!activeSelfColor && !activeOthersColor) return;
    const queue = [pixiStage];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node instanceof PIXI.Text && node.text && node.style) {
        // Tag on first encounter based on original fill color
        if (!node.__ncsType) {
          const fill = (node.style.fill || "").toLowerCase();
          node.__ncsType = fill === "#ffffff" ? "self" : "other";
        }
        const target =
          node.__ncsType === "self" ? activeSelfColor : activeOthersColor;
        if (target && node.style.fill !== target) {
          node.style.fill = target;
        }
      }
      if (node.children) {
        for (const child of node.children) queue.push(child);
      }
    }
  }

  // ── Boost sprite tinting ───────────────────────────────────────────

  const savedPlayerBoostTint = getCookie(PLAYER_BOOST_TINT_KEY) || "";
  let activePlayerBoostTint = savedPlayerBoostTint;

  function hexToPixiTint(hex) {
    return parseInt(hex.replace("#", ""), 16);
  }

  let playerBoostTintTimer = null;

  function schedulePlayerBoostTint() {
    if (playerBoostTintTimer) return;
    playerBoostTintTimer = setInterval(recolorPlayerBoosts, 500);
  }

  function recolorPlayerBoosts() {
    if (!pixiStage || typeof PIXI === "undefined" || !activePlayerBoostTint)
      return;
    const tint = hexToPixiTint(activePlayerBoostTint);
    const queue = [pixiStage];
    while (queue.length > 0) {
      const node = queue.shift();
      const texName = getTextureName(node);
      if (texName.includes("player-boost") && node.tint !== tint) {
        node.tint = tint;
      }
      if (node.children) {
        for (const child of node.children) queue.push(child);
      }
    }
  }

  // ── Custom player color (grayscale bake + tint) ──────────────────

  const savedCustomPlayerColor = getCookie(CUSTOM_PLAYER_COLOR_KEY) || "";
  const savedPlayerTintBlue = getCookie(PLAYER_TINT_BLUE_KEY) || "#3b4f8f";
  const savedPlayerTintRed = getCookie(PLAYER_TINT_RED_KEY) || "#d37647";
  let activeCustomPlayerColor = savedCustomPlayerColor;
  let activePlayerTintBlue = savedPlayerTintBlue;
  let activePlayerTintRed = savedPlayerTintRed;

  function bakeGrayscaleTexture(texture) {
    const canvas = document.createElement("canvas");
    const frame = texture.frame;
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      texture.baseTexture.source,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      0,
      0,
      frame.width,
      frame.height,
    );
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let maxBrightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray;
      if (gray > maxBrightness) maxBrightness = gray;
    }
    if (maxBrightness > 0 && maxBrightness < 255) {
      const scale = 255 / maxBrightness;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        data[i] = Math.min(255, data[i] * scale);
        data[i + 1] = Math.min(255, data[i + 1] * scale);
        data[i + 2] = Math.min(255, data[i + 2] * scale);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return PIXI.Texture.from(canvas);
  }

  function applyCustomPlayerColors() {
    if (activeCustomPlayerColor !== "1") return;
    if (
      typeof window.PIXI === "undefined" ||
      !PIXI.loader ||
      !PIXI.loader.resources
    )
      return;
    const sheet = PIXI.loader.resources["img/spritesheet4.json"];
    if (!sheet || !sheet.textures) return;
    const spriteSource = sheet.textures;
    for (const key of ["player-B", "player-R"]) {
      if (spriteSource[key] && !spriteSource[key].__ncsBaked) {
        const baked = bakeGrayscaleTexture(spriteSource[key]);
        baked.textureCacheIds = [key];
        baked.__ncsBaked = true;
        spriteSource[key] = baked;
        console.debug(`[NC-Skinner] Baked grayscale for ${key}`);
      }
    }
  }

  let playerTintTimer = null;

  function schedulePlayerTint() {
    if (playerTintTimer) return;
    playerTintTimer = setInterval(recolorPlayers, 500);
  }

  function recolorPlayers() {
    if (!pixiStage || typeof PIXI === "undefined") return;
    if (activeCustomPlayerColor !== "1") return;
    applyCustomPlayerColors();
    const tintB = activePlayerTintBlue
      ? hexToPixiTint(activePlayerTintBlue)
      : 0xffffff;
    const tintR = activePlayerTintRed
      ? hexToPixiTint(activePlayerTintRed)
      : 0xffffff;
    const queue = [pixiStage];
    let i = 0;
    while (i < queue.length) {
      const node = queue[i++];
      const texName = getTextureName(node);
      if (texName === "player-B" && node.tint !== tintB) {
        node.tint = tintB;
      } else if (texName === "player-R" && node.tint !== tintR) {
        node.tint = tintR;
      }
      if (node.children) {
        for (const child of node.children) queue.push(child);
      }
    }
  }

  // ── HUD transparency (scoreboard + nitro bar) ─────────────────────

  const savedUiMode = getCookie(UI_MODE_KEY) || "opaque";
  const savedUiBgOpacity = parseInt(getCookie(UI_BG_OPACITY_KEY)) || 50;
  const savedUiAdaptiveRange = parseInt(getCookie(UI_ADAPTIVE_RANGE_KEY)) || 15;

  let activeUiMode = savedUiMode;
  let activeUiBgOpacity = savedUiBgOpacity;
  let activeUiAdaptiveRange = savedUiAdaptiveRange;

  let uiStyleEl = null;
  let uiRafId = null;

  function initUiStyle() {
    if (uiStyleEl) return;
    uiStyleEl = document.createElement("style");
    uiStyleEl.id = "ncskinner-ui-style";
    document.head.appendChild(uiStyleEl);
  }

  function applyUiMode() {
    initUiStyle();

    // Stop any running adaptive loop
    if (uiRafId) {
      cancelAnimationFrame(uiRafId);
      uiRafId = null;
    }

    // Reset inline opacity on both elements
    const sb = document.getElementById("inGameScore");
    const nb = document.getElementById("nitro-bar");
    if (sb) sb.style.opacity = "";
    if (nb) nb.style.opacity = "";

    uiStyleEl.textContent =
      `#inGameScore .blue { border-color: #132561 !important; }` +
      `#inGameScore .time { border-color: #000000 !important; }` +
      `#inGameScore .red  { border-color: #933D10 !important; }` +
      `#nitro-bar .box .borders { border-color: #dda620 !important; }`;

    if (activeUiMode === "opaque") {
      uiStyleEl.textContent += "";
    } else if (activeUiMode === "semitransparent") {
      const a = activeUiBgOpacity / 100;
      uiStyleEl.textContent +=
        `#inGameScore .blue { background-color: rgba(59,79,143,${a}) !important; }` +
        `#inGameScore .time { background-color: rgba(255,255,255,${a}) !important; }` +
        `#inGameScore .red  { background-color: rgba(211,118,71,${a}) !important; }` +
        `#nitro-bar .box .bar { background-color: rgba(255,221,85,${a}) !important; }`;
    } else if (activeUiMode === "adaptive") {
      uiStyleEl.textContent += "";
      uiRafId = requestAnimationFrame(adaptiveFrame);
    }
  }

  function pointRectDistance(px, py, rect) {
    const dx = Math.max(rect.left - px, 0, px - rect.right);
    const dy = Math.max(rect.top - py, 0, py - rect.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getGameObjectPositions() {
    if (!pixiStage || typeof PIXI === "undefined") return [];
    const positions = [];
    const queue = [pixiStage];
    while (queue.length > 0) {
      const node = queue.shift();
      const texName = getTextureName(node);
      if (
        texName &&
        node.visible !== false &&
        (texName.includes("ballWFG") ||
          texName.includes("player-B") ||
          texName.includes("player-R"))
      ) {
        try {
          positions.push(node.toGlobal(new PIXI.Point(0, 0)));
        } catch (_) {}
      }
      if (node.children) {
        for (const child of node.children) queue.push(child);
      }
    }
    return positions;
  }

  function getVisibleRect(el) {
    const children = el.children;
    if (!children || children.length === 0) return el.getBoundingClientRect();
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const child of children) {
      const r = child.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    if (left === Infinity) return el.getBoundingClientRect();
    return { left, top, right, bottom };
  }

  function applyAdaptiveOpacity(el, positions) {
    if (!el || el.style.display === "none") return;
    const rect = getVisibleRect(el);
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) return;
    if (positions.length > 0) {
      let minDist = Infinity;
      for (const pos of positions) {
        const d = pointRectDistance(pos.x, pos.y, rect);
        if (d < minDist) minDist = d;
      }
      const range = activeUiAdaptiveRange;
      el.style.opacity = String(range > 0 ? Math.min(minDist / range, 1) : 1);
    } else {
      el.style.opacity = "1";
    }
  }

  function adaptiveFrame() {
    const positions = getGameObjectPositions();
    applyAdaptiveOpacity(document.getElementById("inGameScore"), positions);
    applyAdaptiveOpacity(document.getElementById("nitro-bar"), positions);
    uiRafId = requestAnimationFrame(adaptiveFrame);
  }

  // ── Fetch available skins from GitHub (cached in cookie for 6 min) ──

  const CATALOG_CACHE_KEY = "ncskinner_catalog_cache";
  const CATALOG_CACHE_TS_KEY = "ncskinner_catalog_cachetime";
  const CATALOG_TTL = 6 * 60 * 1000; // 6 minutes

  function getCachedCatalog() {
    const ts = getCookie(CATALOG_CACHE_TS_KEY);
    if (!ts || Date.now() - Number(ts) > CATALOG_TTL) return null;
    const raw = getCookie(CATALOG_CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function cacheCatalog(catalog) {
    setCookie(CATALOG_CACHE_KEY, JSON.stringify(catalog));
    setCookie(CATALOG_CACHE_TS_KEY, String(Date.now()));
  }

  async function fetchSkinCatalog() {
    const cached = getCachedCatalog();
    if (cached) {
      console.debug("[NC-Skinner] Using cached skin catalog");
      return cached;
    }

    const catalog = {};
    const fetches = Object.entries(SKIN_MAP).map(async ([param, cfg]) => {
      try {
        const res = await fetch(`${GITHUB_API}/${cfg.folder}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const files = await res.json();
        catalog[param] = files
          .filter((f) => f.type === "file" && f.name.endsWith(".png"))
          .map((f) => f.name.replace(/\.png$/, ""));
      } catch (e) {
        console.error(`[NC-Skinner] Failed to fetch ${param} skins:`, e);
        catalog[param] = [];
      }
    });
    await Promise.all(fetches);
    cacheCatalog(catalog);
    console.debug("[NC-Skinner] Fetched & cached skin catalog");
    return catalog;
  }

  // ── Skin selector UI (main page only, mid-left, tabbed) ────────────

  function getCurrentSkin(param) {
    return getCookie(COOKIE_KEYS[param]) || null;
  }

  function injectStyles() {
    const css = document.createElement("style");
    css.textContent = `
      /* ── toggle button ── */
      #ncskinner-toggle {
        position: fixed;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 99999;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        color: #e94560;
        border: 2px solid #e94560;
        border-radius: 10px;
        padding: 10px 8px;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 1px;
        writing-mode: vertical-lr;
        text-orientation: mixed;
        transition: background 0.2s, color 0.2s, box-shadow 0.2s;
        user-select: none;
        box-shadow: 0 0 12px rgba(233,69,96,0.3);
      }
      #ncskinner-toggle:hover {
        background: #e94560;
        color: #fff;
        box-shadow: 0 0 20px rgba(233,69,96,0.6);
      }

      /* ── panel ── */
      #ncskinner-panel {
        position: fixed;
        right: 0;
        top: 0;
        z-index: 99998;
        background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
        border-left: 2px solid #0f3460;
        border-radius: 0;
        width: 40%;
        height: 100vh;
        font-family: 'Segoe UI', Arial, sans-serif;
        color: #eee;
        display: none;
        box-shadow: 0 8px 40px rgba(0,0,0,0.6);
        overflow: hidden;
      }
      #ncskinner-panel.ncskinner-open { display: flex; flex-direction: column; }

      /* ── header ── */
      .ncskinner-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid #0f3460;
      }
      .ncskinner-title {
        font-size: 14px;
        font-weight: bold;
        color: #e94560;
        letter-spacing: 1px;
      }
      .ncskinner-close {
        background: none;
        border: none;
        color: #a8b2d1;
        font-size: 18px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        font-family: inherit;
      }
      .ncskinner-close:hover { color: #e94560; }

      /* ── tabs ── */
      .ncskinner-tabs {
        display: flex;
        border-bottom: 1px solid #0f3460;
        padding: 0;
      }
      .ncskinner-tab {
        flex: 1;
        background: none;
        border: none;
        color: #a8b2d1;
        font-size: 11px;
        font-weight: bold;
        padding: 8px 4px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.15s, border-color 0.15s;
        font-family: inherit;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .ncskinner-tab:hover { color: #fff; }
      .ncskinner-tab.ncskinner-tab-active {
        color: #e94560;
        border-bottom-color: #e94560;
      }

      /* ── tab content ── */
      .ncskinner-body {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
      }
      .ncskinner-grid {
        display: none;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .ncskinner-grid.ncskinner-grid-active { display: grid; }

      /* ── skin card ── */
      .ncskinner-card {
        background: #0f3460;
        border: 2px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        text-align: center;
        padding: 6px;
        transition: border-color 0.15s, transform 0.1s, box-shadow 0.15s;
      }
      .ncskinner-card:hover {
        border-color: #e94560;
        transform: scale(1.04);
        box-shadow: 0 4px 16px rgba(233,69,96,0.25);
      }
      .ncskinner-card.ncskinner-card-sel {
        border-color: #e94560;
        background: linear-gradient(135deg, #0f3460 0%, #1a1a2e 100%);
        box-shadow: 0 0 12px rgba(233,69,96,0.35);
      }
      .ncskinner-card-img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: contain;
        border-radius: 4px;
        background: #16213e;
        display: block;
        filter: none !important;
        mix-blend-mode: normal !important;
        opacity: 1 !important;
        color-scheme: only light;
      }
      .ncskinner-card-name {
        font-size: 10px;
        color: #a8b2d1;
        margin-top: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ncskinner-card.ncskinner-card-sel .ncskinner-card-name { color: #e94560; }

      /* default card */
      .ncskinner-card-default {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 4px;
        background: #16213e;
        color: #a8b2d1;
        font-size: 20px;
      }

      /* custom upload card */
      .ncskinner-card-custom {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 4px;
        background: #16213e;
        color: #a8b2d1;
        font-size: 24px;
        border: 2px dashed #0f3460;
        transition: border-color 0.15s, color 0.15s;
      }
      .ncskinner-card:hover .ncskinner-card-custom {
        border-color: #e94560;
        color: #e94560;
      }
      .ncskinner-card.ncskinner-card-sel .ncskinner-card-custom {
        border-color: #e94560;
        color: #e94560;
      }
      .ncskinner-custom-file { display: none; }

      /* ── footer ── */
      .ncskinner-footer {
        padding: 8px 14px;
        border-top: 1px solid #0f3460;
        text-align: center;
      }
      .ncskinner-clear {
        background: none;
        color: #a8b2d1;
        border: 1px solid #a8b2d1;
        border-radius: 6px;
        padding: 5px 16px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
        transition: border-color 0.15s, color 0.15s;
      }
      .ncskinner-clear:hover {
        border-color: #e94560;
        color: #e94560;
      }

      /* ── names tab ── */
      .ncskinner-names-content {
        display: none;
        padding: 16px;
      }
      .ncskinner-names-content.ncskinner-grid-active { display: block; }
      .ncskinner-names-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }
      .ncskinner-names-label {
        font-size: 12px;
        color: #a8b2d1;
        flex: 1;
      }
      .ncskinner-color-input {
        width: 40px;
        height: 30px;
        border: 2px solid #0f3460;
        border-radius: 6px;
        background: #16213e;
        cursor: pointer;
        padding: 2px;
      }
      .ncskinner-color-input::-webkit-color-swatch-wrapper { padding: 0; }
      .ncskinner-color-input::-webkit-color-swatch { border: none; border-radius: 3px; }
      .ncskinner-color-input::-moz-color-swatch { border: none; border-radius: 3px; }
      .ncskinner-color-reset {
        background: none;
        color: #a8b2d1;
        border: 1px solid #a8b2d1;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
        transition: border-color 0.15s, color 0.15s;
      }
      .ncskinner-color-reset:hover {
        border-color: #e94560;
        color: #e94560;
      }
      .ncskinner-names-preview {
        margin-top: 10px;
        padding: 10px;
        background: #0f3460;
        border-radius: 8px;
        text-align: center;
        font-family: Arial, sans-serif;
        font-weight: bold;
        font-size: 14px;
      }

      /* ── HUD preview ── */
      .ncskinner-hud-preview {
        background: url(img/background.png) center/cover no-repeat;
        border-radius: 8px;
        padding: 12px 10px;
        margin-bottom: 14px;
        position: relative;
        min-height: 80px;
        overflow: hidden;
      }
      .ncskinner-hud-preview.ncskinner-pv-adaptive { cursor: crosshair; }
      .ncskinner-preview-sb {
        text-align: center;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-weight: 700;
        font-size: 16px;
        color: #fff;
      }
      .ncskinner-preview-sb span {
        display: inline-block;
        padding: 1px 8px 4px;
        vertical-align: middle;
      }
      .ncskinner-preview-sb .pv-blue {
        background-color: #3b4f8f;
        border: 2px solid #132561;
        border-radius: 6px;
        min-width: 24px;
      }
      .ncskinner-preview-sb .pv-time {
        background-color: #fff;
        border: 2px solid #000;
        color: #000;
        margin: 0 2px;
        min-width: 40px;
        font-size: 13px;
      }
      .ncskinner-preview-sb .pv-red {
        background-color: #d37647;
        border: 2px solid #8f390d;
        border-radius: 6px;
        min-width: 24px;
      }
      .ncskinner-preview-nb {
        position: absolute;
        bottom: 8px;
        left: 50%;
        transform: translateX(-50%);
        width: 40%;
        height: 16px;
      }
      .ncskinner-preview-nb-bar {
        background-color: #fd5;
        border-radius: 0 4px 4px 0;
        position: absolute;
        top: 0; left: 0;
        height: 100%;
        width: 65%;
      }
      .ncskinner-preview-nb-borders {
        border: 2px solid #a80;
        border-radius: 4px;
        position: absolute;
        top: -2px; left: -2px;
        width: 100%; height: 100%;
      }
      .ncskinner-preview-nb-text {
        position: absolute;
        right: 4px;
        top: 0;
        height: 100%;
        line-height: 16px;
        font-family: Arial, sans-serif;
        font-weight: 700;
        font-size: 9px;
        color: #fff;
        text-transform: uppercase;
      }

      /* ── UI tab ── */
      .ncskinner-ui-content {
        display: none;
        padding: 16px;
      }
      .ncskinner-ui-content.ncskinner-grid-active { display: block; }
      .ncskinner-ui-section {
        margin-bottom: 6px;
        font-size: 11px;
        color: #e94560;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .ncskinner-radio-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        cursor: pointer;
        font-size: 12px;
        color: #ccd6f6;
      }
      .ncskinner-radio-row input[type="radio"] { accent-color: #e94560; }
      .ncskinner-radio-label { flex: 1; }
      .ncskinner-radio-desc {
        color: #a8b2d1;
        font-size: 10px;
        margin-left: auto;
      }
      .ncskinner-slider-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px 0 8px 22px;
      }
      .ncskinner-slider-label {
        font-size: 11px;
        color: #a8b2d1;
        min-width: 100px;
      }
      .ncskinner-slider-row input[type="range"] {
        flex: 1;
        accent-color: #e94560;
      }
      .ncskinner-slider-value {
        font-size: 11px;
        color: #e94560;
        min-width: 36px;
        text-align: right;
      }

      /* ── save button ── */
      #ncskinner-save {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 100000;
        background: #e94560;
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 12px 28px;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 15px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 0.5px;
        box-shadow: 0 4px 20px rgba(233,69,96,0.5);
        transition: transform 0.15s, box-shadow 0.15s;
        display: none;
      }
      #ncskinner-save:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 28px rgba(233,69,96,0.7);
      }
      #ncskinner-save.ncskinner-save-visible { display: block; }
    `;
    document.head.appendChild(css);
  }

  function buildPanel(catalog) {
    const paramKeys = Object.keys(SKIN_MAP);

    // Snapshot of saved cookies at load time (to detect changes)
    const savedSkins = {};
    for (const param of paramKeys) {
      savedSkins[param] = getCurrentSkin(param) || "";
    }
    // Pending selections (starts matching saved)
    const pending = { ...savedSkins };
    // Pending custom images (base64 data URLs, written to localStorage on save)
    const pendingCustomImages = {};
    let pendingSelfColor = savedSelfColor;
    let pendingOthersColor = savedOthersColor;
    let pendingPlayerBoostTint = savedPlayerBoostTint;
    let pendingCustomPlayerColor = savedCustomPlayerColor;
    let pendingPlayerTintBlue = savedPlayerTintBlue;
    let pendingPlayerTintRed = savedPlayerTintRed;
    let pendingUiMode = savedUiMode;
    let pendingUiBgOpacity = savedUiBgOpacity;
    let pendingUiAdaptiveRange = savedUiAdaptiveRange;

    // Toggle button
    const toggle = document.createElement("button");
    toggle.id = "ncskinner-toggle";
    toggle.textContent = "SKINS";
    document.body.appendChild(toggle);

    // Save button (bottom-right, hidden until changes exist)
    const saveBtn = document.createElement("button");
    saveBtn.id = "ncskinner-save";
    saveBtn.textContent = "Save & Apply";
    document.body.appendChild(saveBtn);

    // Panel
    const panel = document.createElement("div");
    panel.id = "ncskinner-panel";

    // Header
    let html = '<div class="ncskinner-header">';
    html += '<span class="ncskinner-title">NC SKINNER</span>';
    html += '<button class="ncskinner-close">&times;</button>';
    html += "</div>";

    // Tabs
    html += '<div class="ncskinner-tabs">';
    paramKeys.forEach((param, i) => {
      html += `<button class="ncskinner-tab${i === 0 ? " ncskinner-tab-active" : ""}" data-tab="${param}">${CATEGORY_LABELS[param]}</button>`;
    });
    html += '<button class="ncskinner-tab" data-tab="colors">Colors</button>';
    html += '<button class="ncskinner-tab" data-tab="ui">UI</button>';
    html += "</div>";

    // Body with grids
    html += '<div class="ncskinner-body">';
    paramKeys.forEach((param, i) => {
      const skins = catalog[param] || [];
      const current = savedSkins[param];
      html += `<div class="ncskinner-grid${i === 0 ? " ncskinner-grid-active" : ""}" data-grid="${param}">`;

      // Default card
      html += `<div class="ncskinner-card${!current ? " ncskinner-card-sel" : ""}" data-param="${param}" data-skin="">`;
      html += '<div class="ncskinner-card-default">&olarr;</div>';
      html += '<div class="ncskinner-card-name">Default</div>';
      html += "</div>";

      // Custom upload card
      const existingCustom = localStorage.getItem(CUSTOM_IMG_KEYS[param]);
      const isCustomSel = current === CUSTOM_SKIN_VALUE;
      html += `<div class="ncskinner-card${isCustomSel ? " ncskinner-card-sel" : ""}" data-param="${param}" data-skin="${CUSTOM_SKIN_VALUE}" data-custom="1">`;
      if (existingCustom) {
        html += `<img class="ncskinner-card-img" src="${existingCustom}" alt="Custom" id="ncskinner-custom-preview-${param}">`;
      } else {
        html += `<div class="ncskinner-card-custom" id="ncskinner-custom-preview-${param}">&#x2b;</div>`;
      }
      html += '<div class="ncskinner-card-name">Custom</div>';
      html += `<input type="file" accept="image/*" class="ncskinner-custom-file" id="ncskinner-custom-file-${param}" data-param="${param}">`;
      html += "</div>";

      for (const skin of skins) {
        const thumbUrl = `${SKIN_BASE}/${SKIN_MAP[param].folder}/${skin}.png`;
        html += `<div class="ncskinner-card${current === skin ? " ncskinner-card-sel" : ""}" data-param="${param}" data-skin="${skin}">`;
        html += `<img class="ncskinner-card-img" src="${thumbUrl}" alt="${skin}" loading="lazy">`;
        html += `<div class="ncskinner-card-name">${skin}</div>`;
        html += "</div>";
      }

      if (skins.length === 0) {
        html +=
          '<div style="grid-column:1/-1;color:#a8b2d1;font-size:11px;text-align:center;padding:16px">No skins available</div>';
      }

      html += "</div>";
    });

    // Colors tab content
    html += '<div class="ncskinner-names-content" data-grid="colors">';

    // — Name colors section —
    html +=
      '<div style="margin-bottom:6px;font-size:11px;color:#e94560;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px">Name Colors</div>';
    html += '<div class="ncskinner-names-row">';
    html += '<span class="ncskinner-names-label">Your name</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-self-color" value="${savedSelfColor || "#ffffff"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-self-color-reset">Reset</button>';
    html += "</div>";
    // html += `<div class="ncskinner-names-preview" id="ncskinner-self-preview" style="color:${savedSelfColor || "#ffffff"}">YourName</div>`;
    html += '<div class="ncskinner-names-row" style="margin-top:16px">';
    html += '<span class="ncskinner-names-label">Other players</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-others-color" value="${savedOthersColor || "#000000"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-others-color-reset">Reset</button>';
    html += "</div>";
    // html += `<div class="ncskinner-names-preview" id="ncskinner-others-preview" style="color:${savedOthersColor || "#000000"}">OtherPlayer</div>`;

    // — Boost color section —
    html +=
      '<div style="margin-top:20px;margin-bottom:6px;font-size:11px;color:#e94560;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px">Player Boost Glow</div>';
    html += '<div class="ncskinner-names-row">';
    html += '<span class="ncskinner-names-label">Player boost color</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-player-boost-color" value="${savedPlayerBoostTint || "#ffffff"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-player-boost-color-reset">Reset</button>';
    html += "</div>";
    // html += `<div class="ncskinner-names-preview" id="ncskinner-player-boost-preview" style="color:${savedPlayerBoostTint || "#ffffff"}">Player Boost &#x25CF;</div>`;

    // — Custom player color section —
    html +=
      '<div style="margin-top:20px;margin-bottom:6px;font-size:11px;color:#e94560;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px">Custom Player Color</div>';
    html += '<div class="ncskinner-names-row">';
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="ncskinner-custom-player-color-cb"${savedCustomPlayerColor === "1" ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Enable custom player color</span></label>`;
    html += "</div>";
    const cpHidden =
      savedCustomPlayerColor !== "1" ? ' style="display:none"' : "";
    html += `<div id="ncskinner-custom-player-color-rows"${cpHidden}>`;
    html += '<div class="ncskinner-names-row" style="margin-top:8px">';
    html += '<span class="ncskinner-names-label">Blue team</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-player-tint-blue" value="${savedPlayerTintBlue || "#3b4f8f"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-player-tint-blue-reset">Reset</button>';
    html += "</div>";
    html += '<div class="ncskinner-names-row" style="margin-top:8px">';
    html += '<span class="ncskinner-names-label">Red team</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-player-tint-red" value="${savedPlayerTintRed || "#d37647"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-player-tint-red-reset">Reset</button>';
    html += "</div>";
    html += "</div>";

    html += "</div>";

    // UI tab content
    html += '<div class="ncskinner-ui-content" data-grid="ui">';
    html += '<div class="ncskinner-ui-section">HUD Display</div>';

    html += '<div class="ncskinner-hud-preview">';
    html +=
      '<div class="ncskinner-preview-sb"><span class="pv-blue">3</span><span class="pv-time">2:45</span><span class="pv-red">1</span></div>';
    html +=
      '<div class="ncskinner-preview-nb"><div class="ncskinner-preview-nb-bar"></div><div class="ncskinner-preview-nb-borders"></div><div class="ncskinner-preview-nb-text">Nitro</div></div>';
    html += "</div>";

    html += `<label class="ncskinner-radio-row"><input type="radio" name="ncskinner-sb-mode" value="opaque"${savedUiMode === "opaque" ? " checked" : ""}><span class="ncskinner-radio-label">Opaque</span><span class="ncskinner-radio-desc">Default fully opaque</span></label>`;

    html += `<label class="ncskinner-radio-row"><input type="radio" name="ncskinner-sb-mode" value="semitransparent"${savedUiMode === "semitransparent" ? " checked" : ""}><span class="ncskinner-radio-label">Semi-transparent</span><span class="ncskinner-radio-desc">BG fades, text stays</span></label>`;
    html += `<div class="ncskinner-slider-row" id="ncskinner-sb-opacity-row" style="${savedUiMode === "semitransparent" ? "" : "display:none"}">`;
    html += '<span class="ncskinner-slider-label">BG Opacity</span>';
    html += `<input type="range" min="0" max="100" value="${savedUiBgOpacity}" id="ncskinner-sb-opacity-slider">`;
    html += `<span class="ncskinner-slider-value" id="ncskinner-sb-opacity-value">${savedUiBgOpacity}%</span>`;
    html += "</div>";

    html += `<label class="ncskinner-radio-row"><input type="radio" name="ncskinner-sb-mode" value="adaptive"${savedUiMode === "adaptive" ? " checked" : ""}><span class="ncskinner-radio-label">Adaptive</span><span class="ncskinner-radio-desc">Fades near game objects</span></label>`;
    html += `<div class="ncskinner-slider-row" id="ncskinner-sb-transition-row" style="${savedUiMode === "adaptive" ? "" : "display:none"}">`;
    html += '<span class="ncskinner-slider-label">Transition Range</span>';
    html += `<input type="range" min="1" max="100" value="${savedUiAdaptiveRange}" id="ncskinner-sb-transition-slider">`;
    html += `<span class="ncskinner-slider-value" id="ncskinner-sb-transition-value">${savedUiAdaptiveRange}px</span>`;
    html += "</div>";

    html += "</div>";

    html += "</div>";

    // Footer
    html +=
      '<div class="ncskinner-footer"><button class="ncskinner-clear">Clear All</button></div>';

    panel.innerHTML = html;
    document.body.appendChild(panel);

    // ── Helpers ──

    function hasChanges() {
      return (
        paramKeys.some((p) => pending[p] !== savedSkins[p]) ||
        pendingSelfColor !== savedSelfColor ||
        pendingOthersColor !== savedOthersColor ||
        pendingPlayerBoostTint !== savedPlayerBoostTint ||
        pendingCustomPlayerColor !== savedCustomPlayerColor ||
        pendingPlayerTintBlue !== savedPlayerTintBlue ||
        pendingPlayerTintRed !== savedPlayerTintRed ||
        pendingUiMode !== savedUiMode ||
        pendingUiBgOpacity !== savedUiBgOpacity ||
        pendingUiAdaptiveRange !== savedUiAdaptiveRange
      );
    }

    function updateSaveBtn() {
      saveBtn.classList.toggle("ncskinner-save-visible", hasChanges());
    }

    // ── Events ──

    // Toggle open / close
    toggle.addEventListener("click", () =>
      panel.classList.toggle("ncskinner-open"),
    );
    panel
      .querySelector(".ncskinner-close")
      .addEventListener("click", () =>
        panel.classList.remove("ncskinner-open"),
      );

    // Tab switching (works for both skin grids and names content)
    const tabs = panel.querySelectorAll(".ncskinner-tab");
    const allPanes = panel.querySelectorAll(
      ".ncskinner-grid, .ncskinner-names-content, .ncskinner-ui-content",
    );
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("ncskinner-tab-active"));
        allPanes.forEach((p) => p.classList.remove("ncskinner-grid-active"));
        tab.classList.add("ncskinner-tab-active");
        panel
          .querySelector(`[data-grid="${tab.dataset.tab}"]`)
          .classList.add("ncskinner-grid-active");
      });
    });

    // Skin card click — update pending selection (no reload)
    panel.addEventListener("click", (e) => {
      const card = e.target.closest(".ncskinner-card");
      if (!card) return;

      const param = card.dataset.param;
      const skin = card.dataset.skin;

      // Custom card click — open file picker instead of selecting immediately
      if (card.dataset.custom === "1") {
        const fileInput = panel.querySelector(
          `#ncskinner-custom-file-${param}`,
        );
        if (fileInput) fileInput.click();
        return;
      }

      if (skin === pending[param]) return;

      pending[param] = skin;

      card.parentElement
        .querySelectorAll(".ncskinner-card")
        .forEach((c) => c.classList.remove("ncskinner-card-sel"));
      card.classList.add("ncskinner-card-sel");

      updateSaveBtn();
    });

    // Custom skin file upload handlers
    panel.querySelectorAll(".ncskinner-custom-file").forEach((fileInput) => {
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const param = fileInput.dataset.param;

        if (file.size > CUSTOM_MAX_BYTES) {
          alert(
            `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 3 MB.`,
          );
          fileInput.value = "";
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          pendingCustomImages[param] = dataUrl;
          pending[param] = CUSTOM_SKIN_VALUE;

          // Update the preview in the card
          const previewEl = panel.querySelector(
            `#ncskinner-custom-preview-${param}`,
          );
          if (previewEl) {
            if (previewEl.tagName === "IMG") {
              previewEl.src = dataUrl;
            } else {
              // Replace the placeholder div with an img
              const img = document.createElement("img");
              img.className = "ncskinner-card-img";
              img.id = `ncskinner-custom-preview-${param}`;
              img.src = dataUrl;
              img.alt = "Custom";
              previewEl.replaceWith(img);
            }
          }

          // Select the custom card
          const grid = panel.querySelector(
            `.ncskinner-grid[data-grid="${param}"]`,
          );
          grid
            .querySelectorAll(".ncskinner-card")
            .forEach((c) => c.classList.remove("ncskinner-card-sel"));
          grid
            .querySelector(`[data-skin="${CUSTOM_SKIN_VALUE}"]`)
            .classList.add("ncskinner-card-sel");

          updateSaveBtn();
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
      });
    });

    // Name color pickers — self
    const selfColorInput = panel.querySelector("#ncskinner-self-color");
    const selfPreview = panel.querySelector("#ncskinner-self-preview");
    const selfReset = panel.querySelector("#ncskinner-self-color-reset");

    selfColorInput.addEventListener("input", () => {
      pendingSelfColor = selfColorInput.value;
      if (selfPreview) selfPreview.style.color = pendingSelfColor;
      activeSelfColor = pendingSelfColor;
      updateSaveBtn();
    });

    selfReset.addEventListener("click", () => {
      pendingSelfColor = "";
      selfColorInput.value = "#ffffff";
      if (selfPreview) selfPreview.style.color = "#ffffff";
      activeSelfColor = "";
      updateSaveBtn();
    });

    // Name color pickers — others
    const othersColorInput = panel.querySelector("#ncskinner-others-color");
    const othersPreview = panel.querySelector("#ncskinner-others-preview");
    const othersReset = panel.querySelector("#ncskinner-others-color-reset");

    othersColorInput.addEventListener("input", () => {
      pendingOthersColor = othersColorInput.value;
      if (othersPreview) othersPreview.style.color = pendingOthersColor;
      activeOthersColor = pendingOthersColor;
      updateSaveBtn();
    });

    othersReset.addEventListener("click", () => {
      pendingOthersColor = "";
      othersColorInput.value = "#000000";
      if (othersPreview) othersPreview.style.color = "#000000";
      activeOthersColor = "";
      updateSaveBtn();
    });

    // Boost color picker
    const boostColorInput = panel.querySelector(
      "#ncskinner-player-boost-color",
    );
    const boostPreview = panel.querySelector("#ncskinner-player-boost-preview");
    const boostReset = panel.querySelector(
      "#ncskinner-player-boost-color-reset",
    );

    boostColorInput.addEventListener("input", () => {
      pendingPlayerBoostTint = boostColorInput.value;
      if (boostPreview) boostPreview.style.color = pendingPlayerBoostTint;
      activePlayerBoostTint = pendingPlayerBoostTint;
      updateSaveBtn();
    });

    boostReset.addEventListener("click", () => {
      pendingPlayerBoostTint = "";
      boostColorInput.value = "#ffffff";
      if (boostPreview) boostPreview.style.color = "#ffffff";
      activePlayerBoostTint = "";
      updateSaveBtn();
    });

    // Custom player color
    const cpCb = panel.querySelector("#ncskinner-custom-player-color-cb");
    const cpRows = panel.querySelector("#ncskinner-custom-player-color-rows");
    const cpBlueInput = panel.querySelector("#ncskinner-player-tint-blue");
    const cpRedInput = panel.querySelector("#ncskinner-player-tint-red");
    const cpBlueReset = panel.querySelector(
      "#ncskinner-player-tint-blue-reset",
    );
    const cpRedReset = panel.querySelector("#ncskinner-player-tint-red-reset");

    cpCb.addEventListener("change", () => {
      pendingCustomPlayerColor = cpCb.checked ? "1" : "";
      cpRows.style.display = cpCb.checked ? "" : "none";
      activeCustomPlayerColor = pendingCustomPlayerColor;
      updateSaveBtn();
    });

    cpBlueInput.addEventListener("input", () => {
      pendingPlayerTintBlue = cpBlueInput.value;
      activePlayerTintBlue = pendingPlayerTintBlue;
      updateSaveBtn();
    });

    cpRedInput.addEventListener("input", () => {
      pendingPlayerTintRed = cpRedInput.value;
      activePlayerTintRed = pendingPlayerTintRed;
      updateSaveBtn();
    });

    cpBlueReset.addEventListener("click", () => {
      pendingPlayerTintBlue = "";
      cpBlueInput.value = "#3b4f8f";
      activePlayerTintBlue = "";
      updateSaveBtn();
    });

    cpRedReset.addEventListener("click", () => {
      pendingPlayerTintRed = "";
      cpRedInput.value = "#d37647";
      activePlayerTintRed = "";
      updateSaveBtn();
    });

    // HUD preview updater
    const pvBlue = panel.querySelector(".pv-blue");
    const pvTime = panel.querySelector(".pv-time");
    const pvRed = panel.querySelector(".pv-red");
    const pvSb = panel.querySelector(".ncskinner-preview-sb");
    const pvNbBar = panel.querySelector(".ncskinner-preview-nb-bar");
    const pvNbBorders = panel.querySelector(".ncskinner-preview-nb-borders");
    const pvNb = panel.querySelector(".ncskinner-preview-nb");
    const pvContainer = panel.querySelector(".ncskinner-hud-preview");

    function updateHudPreview() {
      pvContainer.classList.toggle(
        "ncskinner-pv-adaptive",
        pendingUiMode === "adaptive",
      );
      // Border colors always match in-game overrides
      pvBlue.style.borderColor = "#132561";
      pvTime.style.borderColor = "#000000";
      pvRed.style.borderColor = "#933D10";
      pvNbBorders.style.borderColor = "#dda620";
      if (pendingUiMode === "opaque") {
        pvBlue.style.backgroundColor = "#3b4f8f";
        pvTime.style.backgroundColor = "#fff";
        pvRed.style.backgroundColor = "#d37647";
        pvNbBar.style.backgroundColor = "#fd5";
        pvSb.style.opacity = "";
        pvNb.style.opacity = "";
      } else if (pendingUiMode === "semitransparent") {
        const a = pendingUiBgOpacity / 100;
        pvBlue.style.backgroundColor = `rgba(59,79,143,${a})`;
        pvTime.style.backgroundColor = `rgba(255,255,255,${a})`;
        pvRed.style.backgroundColor = `rgba(211,118,71,${a})`;
        pvNbBar.style.backgroundColor = `rgba(255,221,85,${a})`;
        pvSb.style.opacity = "";
        pvNb.style.opacity = "";
      } else if (pendingUiMode === "adaptive") {
        pvBlue.style.backgroundColor = "#3b4f8f";
        pvTime.style.backgroundColor = "#fff";
        pvRed.style.backgroundColor = "#d37647";
        pvNbBar.style.backgroundColor = "#fd5";
        pvSb.style.opacity = "1";
        pvNb.style.opacity = "1";
      }
    }
    updateHudPreview();

    // Live adaptive preview — mouse acts as a game object
    function pvAdaptiveOpacity(el, mx, my) {
      const rect = getVisibleRect(el);
      const dx = Math.max(rect.left - mx, 0, mx - rect.right);
      const dy = Math.max(rect.top - my, 0, my - rect.bottom);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const range = pendingUiAdaptiveRange;
      el.style.opacity = String(range > 0 ? Math.min(dist / range, 1) : 1);
    }

    pvContainer.addEventListener("mousemove", (e) => {
      if (pendingUiMode !== "adaptive") return;
      pvAdaptiveOpacity(pvSb, e.clientX, e.clientY);
      pvAdaptiveOpacity(pvNb, e.clientX, e.clientY);
    });

    pvContainer.addEventListener("mouseleave", () => {
      if (pendingUiMode !== "adaptive") return;
      pvSb.style.opacity = "1";
      pvNb.style.opacity = "1";
    });

    // HUD mode radios
    const sbRadios = panel.querySelectorAll('input[name="ncskinner-sb-mode"]');
    const sbOpacityRow = panel.querySelector("#ncskinner-sb-opacity-row");
    const sbOpacitySlider = panel.querySelector("#ncskinner-sb-opacity-slider");
    const sbOpacityValue = panel.querySelector("#ncskinner-sb-opacity-value");
    const sbTransitionRow = panel.querySelector("#ncskinner-sb-transition-row");
    const sbTransitionSlider = panel.querySelector(
      "#ncskinner-sb-transition-slider",
    );
    const sbTransitionValue = panel.querySelector(
      "#ncskinner-sb-transition-value",
    );

    sbRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        pendingUiMode = radio.value;
        activeUiMode = radio.value;
        sbOpacityRow.style.display =
          radio.value === "semitransparent" ? "" : "none";
        sbTransitionRow.style.display =
          radio.value === "adaptive" ? "" : "none";
        applyUiMode();
        updateHudPreview();
        updateSaveBtn();
      });
    });

    sbOpacitySlider.addEventListener("input", () => {
      const v = parseInt(sbOpacitySlider.value);
      pendingUiBgOpacity = v;
      activeUiBgOpacity = v;
      sbOpacityValue.textContent = v + "%";
      applyUiMode();
      updateHudPreview();
      updateSaveBtn();
    });

    sbTransitionSlider.addEventListener("input", () => {
      const v = parseInt(sbTransitionSlider.value);
      pendingUiAdaptiveRange = v;
      activeUiAdaptiveRange = v;
      sbTransitionValue.textContent = v + "px";
      updateHudPreview();
      updateSaveBtn();
    });

    // Clear all — reset pending to defaults
    panel.querySelector(".ncskinner-clear").addEventListener("click", () => {
      for (const param of paramKeys) {
        pending[param] = "";
        delete pendingCustomImages[param];
        const grid = panel.querySelector(
          `.ncskinner-grid[data-grid="${param}"]`,
        );
        grid
          .querySelectorAll(".ncskinner-card")
          .forEach((c) => c.classList.remove("ncskinner-card-sel"));
        grid
          .querySelector('.ncskinner-card[data-skin=""]')
          .classList.add("ncskinner-card-sel");
      }
      pendingSelfColor = "";
      selfColorInput.value = "#ffffff";
      if (selfPreview) selfPreview.style.color = "#ffffff";
      activeSelfColor = "";
      pendingOthersColor = "";
      othersColorInput.value = "#000000";
      if (othersPreview) othersPreview.style.color = "#000000";
      activeOthersColor = "";
      pendingPlayerBoostTint = "";
      boostColorInput.value = "#ffffff";
      if (boostPreview) boostPreview.style.color = "#ffffff";
      activePlayerBoostTint = "";
      pendingCustomPlayerColor = "";
      cpCb.checked = false;
      cpRows.style.display = "none";
      activeCustomPlayerColor = "";
      pendingPlayerTintBlue = "";
      cpBlueInput.value = "#3b4f8f";
      activePlayerTintBlue = "";
      pendingPlayerTintRed = "";
      cpRedInput.value = "#d37647";
      activePlayerTintRed = "";
      pendingUiMode = "opaque";
      activeUiMode = "opaque";
      pendingUiBgOpacity = 50;
      activeUiBgOpacity = 50;
      pendingUiAdaptiveRange = 30;
      activeUiAdaptiveRange = 30;
      panel.querySelector(
        'input[name="ncskinner-sb-mode"][value="opaque"]',
      ).checked = true;
      sbOpacityRow.style.display = "none";
      sbOpacitySlider.value = "50";
      sbOpacityValue.textContent = "50%";
      sbTransitionRow.style.display = "none";
      sbTransitionSlider.value = "30";
      sbTransitionValue.textContent = "30px";
      applyUiMode();
      updateHudPreview();
      updateSaveBtn();
    });

    // Save — commit cookies, write custom images to localStorage, and reload
    saveBtn.addEventListener("click", () => {
      for (const param of paramKeys) {
        if (pending[param]) {
          setCookie(COOKIE_KEYS[param], pending[param]);
          // Save pending custom image to localStorage
          if (
            pending[param] === CUSTOM_SKIN_VALUE &&
            pendingCustomImages[param]
          ) {
            localStorage.setItem(
              CUSTOM_IMG_KEYS[param],
              pendingCustomImages[param],
            );
          }
        } else {
          deleteCookie(COOKIE_KEYS[param]);
        }
      }
      if (pendingSelfColor) {
        setCookie(NAME_COLOR_SELF_KEY, pendingSelfColor);
      } else {
        deleteCookie(NAME_COLOR_SELF_KEY);
      }
      if (pendingOthersColor) {
        setCookie(NAME_COLOR_OTHERS_KEY, pendingOthersColor);
      } else {
        deleteCookie(NAME_COLOR_OTHERS_KEY);
      }
      if (pendingPlayerBoostTint) {
        setCookie(PLAYER_BOOST_TINT_KEY, pendingPlayerBoostTint);
      } else {
        deleteCookie(PLAYER_BOOST_TINT_KEY);
      }
      if (pendingCustomPlayerColor === "1") {
        setCookie(CUSTOM_PLAYER_COLOR_KEY, "1");
      } else {
        deleteCookie(CUSTOM_PLAYER_COLOR_KEY);
      }
      if (pendingPlayerTintBlue) {
        setCookie(PLAYER_TINT_BLUE_KEY, pendingPlayerTintBlue);
      } else {
        deleteCookie(PLAYER_TINT_BLUE_KEY);
      }
      if (pendingPlayerTintRed) {
        setCookie(PLAYER_TINT_RED_KEY, pendingPlayerTintRed);
      } else {
        deleteCookie(PLAYER_TINT_RED_KEY);
      }
      setCookie(UI_MODE_KEY, pendingUiMode);
      setCookie(UI_BG_OPACITY_KEY, String(pendingUiBgOpacity));
      setCookie(UI_ADAPTIVE_RANGE_KEY, String(pendingUiAdaptiveRange));
      window.location.reload();
    });

    return { toggle, panel, saveBtn };
  }

  // Show the skin changer only on the main page (#homepage visible)
  function watchMainPage(toggle, panel, saveBtn) {
    function update() {
      const hp = document.getElementById("homepage");
      const visible =
        hp && hp.style.display !== "none" && hp.offsetParent !== null;
      toggle.style.display = visible ? "" : "none";
      if (!visible) {
        panel.classList.remove("ncskinner-open");
        saveBtn.classList.remove("ncskinner-save-visible");
      }
    }
    update();
    setInterval(update, 500);
  }

  async function initUI() {
    if (!document.body) {
      await new Promise((r) =>
        document.addEventListener("DOMContentLoaded", r),
      );
    }
    injectStyles();
    const catalog = await fetchSkinCatalog();
    const { toggle, panel, saveBtn } = buildPanel(catalog);
    watchMainPage(toggle, panel, saveBtn);
    applyUiMode();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  hookPIXI();
  applySkinSources();
  scheduleNameRecolor();
  schedulePlayerBoostTint();
  schedulePlayerTint();
  initUI();
})();
