// ==UserScript==
// @name         NitroClash Skinner
// @author       parasetanol
// @namespace    http://tampermonkey.net/
// @version      0.2.2
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

  // param -> { folder, textureName match substring }
  const SKIN_MAP = {
    field: { folder: "field", match: "playfield" },
    bg: { folder: "bg", match: "bgtile" },
    blue: { folder: "blue", match: "player-B" },
    red: { folder: "red", match: "player-R" },
    ball: { folder: "ball", match: "ballWFG" },
  };

  // Cookie names — diverse and specific to this script
  const COOKIE_KEYS = {
    field: "ncskinner_playfield_skin",
    bg: "ncskinner_background_skin",
    blue: "ncskinner_blueteam_skin",
    red: "ncskinner_redteam_skin",
    ball: "ncskinner_gameball_skin",
  };

  const NAME_COLOR_SELF_KEY = "ncskinner_namecolor_self";
  const NAME_COLOR_OTHERS_KEY = "ncskinner_namecolor_others";
  const PLAYER_BOOST_TINT_KEY = "ncskinner_boost_tint";

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

  const hasSkins = Object.keys(skinRequests).length > 0;

  if (hasSkins) {
    console.log("[NC-Skinner] Skin requests:", skinRequests);
  } else {
    console.log("[NC-Skinner] No skins selected");
  }

  // ── Pre-load skin images ────────────────────────────────────────────

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

  // ── PIXI renderer hooks ────────────────────────────────────────────

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

    const pending = Object.entries(skinRequests).filter(
      ([, s]) => s.imageLoaded,
    );
    if (pending.length === 0) return false;

    for (const [, skin] of pending) skin.count = 0;

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
      console.log("[NC-Skinner] Using cached skin catalog");
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
    console.log("[NC-Skinner] Fetched & cached skin catalog");
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
    let pendingSelfColor = savedSelfColor;
    let pendingOthersColor = savedOthersColor;
    let pendingPlayerBoostTint = savedPlayerBoostTint;

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
        pendingPlayerBoostTint !== savedPlayerBoostTint
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
      ".ncskinner-grid, .ncskinner-names-content",
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

      if (skin === pending[param]) return;

      pending[param] = skin;

      card.parentElement
        .querySelectorAll(".ncskinner-card")
        .forEach((c) => c.classList.remove("ncskinner-card-sel"));
      card.classList.add("ncskinner-card-sel");

      updateSaveBtn();
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

    // Clear all — reset pending to defaults
    panel.querySelector(".ncskinner-clear").addEventListener("click", () => {
      for (const param of paramKeys) {
        pending[param] = "";
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
      selfPreview.style.color = "#ffffff";
      activeSelfColor = "";
      pendingOthersColor = "";
      othersColorInput.value = "#000000";
      othersPreview.style.color = "#000000";
      activeOthersColor = "";
      pendingPlayerBoostTint = "";
      boostColorInput.value = "#ffffff";
      boostPreview.style.color = "#ffffff";
      activePlayerBoostTint = "";
      updateSaveBtn();
    });

    // Save — commit cookies and reload
    saveBtn.addEventListener("click", () => {
      for (const param of paramKeys) {
        if (pending[param]) {
          setCookie(COOKIE_KEYS[param], pending[param]);
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
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  hookPIXI();
  scheduleNameRecolor();
  schedulePlayerBoostTint();
  initUI();
})();
