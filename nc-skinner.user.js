// ==UserScript==
// @name         NitroClash Skinner
// @author       parasetanol
// @namespace    http://tampermonkey.net/
// @version      0.2.13
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
  const PHYSICS_SOUNDS_KEY = "ncskinner_physics_sounds";
  const MASTER_SOUND_KEY = "ncskinner_master_sound";
  const MATCH_START_SOUND_KEY = "ncskinner_match_start_sound";
  const GOAL_SOUND_KEY = "ncskinner_goal_sound";
  const BOOST_SOUND_KEY = "ncskinner_boost_sound";
  const CURSOR_COLOR_KEY = "ncskinner_cursor_color";
  const CHAT_COLOR_KEY = "ncskinner_chat_color";
  const FPS_COLOR_KEY = "ncskinner_fps_color";
  const OVERLAY_COLOR_KEY = "ncskinner_overlay_color";
  const HIDE_MUTED_CHATS_KEY = "ncskinner_hide_muted_chats";

  // ── Sound settings ──────────────────────────────────────────────────
  // Delta-velocity threshold (km/h) below which we assume it's friction, not a collision.
  // Friction causes gradual same-direction deceleration; a collision flips/changes direction sharply.
  const SOUND_THRESHOLD_KMH = 20;
  // Delta velocity (km/h) that maps to full volume (1.0). Anything above is clamped to 1.0.
  const SOUND_MAX_KMH = 600;
  // Minimum ms between repeated sounds to prevent burst-firing on sustained contact.
  const SOUND_COOLDOWN_BALL_MS = 80;
  const SOUND_COOLDOWN_PLAYER_MS = 100;
  const SOUND_COOLDOWN_BOOST_MS = 300;

  // ── Sound system (Web Audio API) ────────────────────────────────────
  // Paste your MP3 as a base64 data URL below. To convert an MP3:
  //   python3 -c "import base64; print('data:audio/mpeg;base64,' + base64.b64encode(open('hit.mp3','rb').read()).decode())"
  // or use an online tool like base64.guru/converter/encode/audio
  const SOUND_DATA = {
    matchStart: "REPLACE_WITH_matchStart",
    goalExplosion: "REPLACE_WITH_goalExplosion",
    playerBoost: "REPLACE_WITH_playerBoost",
    ballHit:
      "data:audio/mpeg;base64,SUQzAwAAAAAAHlRZRVIAAAAFAAAAMjAyNlRFTkMAAAAFAAAATEFNRf/6oGzx6AAAA88z1VU8YAoAAA0goAABGyVxUVnHgBAAADSDAAAAgAAMlQplPV9wDkFsE0OBFhHAkAuBcFArGR5Q3DgYt/R34iIiHXcOBu7oiIhREd3d3AwN0QIAIiIju7u7uZREREQj/67iwAAAEAAADDw8PDwAgAACMPDw8eAO/0YeHh4eAAAAAAYeHh48AAAByMPDw8PAAAAEbjh5/gAACoDVbbbbbckkkhh4zGxIgbE5RwxGmr9iJLQ0YWTCQFGgkYPCyc7KSYMhUImIQUCQMj6/ICyGqKKP+BpoISYA1FsA/QWJ+W0FCYI4l0zm8bpBXz6MLKYwRwIskLZIW9C4DEh0fOjkJEf50EnOU5jqbY7xbhVw+zUkC6XCLwkWU3oLFRwVyqxBi4/quWxTuEZRta0xnKrITEuEdlhgesHG623qNpdH6n3aHKpOPk7Pps8PKlgzQXnxbG7f4zqkCc7oayytmHatZU7I3Rnr37mXWoNEhEILO+RrMfV+LjmS1iIztEnoMaHDpDBbwI8wZAG1MGWBKzAggBYwKMDSMCEAWRkAUMAdAEi+T2QS8N+sb78ZiPL8hb05VAs4RqicuqmUvqufX9s21B34L2NA/zCv4MlZJYjDNGmrFl1m0+a/edQc2xi+vaW1rb3mtMU3mLXG86xPv7xe1tYtjOoXtJB1v/Mn/zSd7Bi6X//6omxLsUiA9bVgxQd94AAAAA0g4AABFlGTGa4wcegAADSAAAAEVjnmbNvCrqsGb6rm+vbes/Gd/Wtb3nX9vnP+f4IKqe1IZX3WMHgAGWRyS2QkM5j4Dm6uM/gMywGjPYcMeBEBBsOHA8NyEFmBBIUAswuCjBQNGACXoGgEkcotAyKTDQVCgXAWGs6A0WRPA4DIQhxLofFkUkw+EYkpR9UikmRiNVegRjyeYIy1OaRj05x9Rea6Vr0VRJ1NV0vk7G1MnR82pghd5c1G7qSt1VDTYMarLY1Ly9j1aUuqqiapAIQVt5eXOWHxsypHGtE4IcocOBjUlbpGVWicJgsKqkxBTUUzLjk5LjWqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqoFRqkk03HBJSyEMmB+OgnJEa4ZCQkNRYkaFKDQVbxRHv/+L/+Lfs62mhUVFDQ/6hf/9TP/rFJMQU1FMy45OS41qqqqqqqqqqqqqqqqqqqqqqr/+qBsiFcoj/GuBUdR7EgcAAANIAAAAQAAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    playerHit:
      "data:audio/mpeg;base64,SUQzAwAAAAAAHlRZRVIAAAAFAAAAMjAyNlRFTkMAAAAFAAAATEFNRf/6oGxcvwAAAygE1W0kYAoAAA0goAABHBFxR7ncgAgAADSDAAAAAAAIGTjkklwJgmK3kABAAAYJIAAZmGCP8ADzw8PSCOAAAHv/8AAAM9/h4eGADvgB4e/8AAR+AeHh4eGAAAAAAeHh4ekABHyB4ef+AAAAAh4eHh4YAABnh4eHn/8AAEB4e//wAAAAAAoQAlElJtKRxySyQypVU3rKc3CAY45Cw8n8YhO4HEAYxgCZRh+YUBQEBkDAHEgkVpMMwcMAwECAfhB3NllxI++5CSLUnIYGkIwFZrcVrrmed/2wTlG0CWx92oEn7zcLEhjEtedr8M5SiLOK8Mrh5+4Di8ORvlJMRyjyi8qnN3p7c1NVI3II32TymddCVyzGV2bkoxu7y1j8snLG7+Fehwxwt5ZU01fs/Y+rnT5517WFbG7zCpWzqXcpm7WxwrTGW6ezcs451u8x59TLf4/3v7xyzu/n/3KwUOjEwbdevXUAy3XSyS2y3GJohDFAKpqwV/V4LDLJfWDFMl3uVKn9oPB4AUQgbSVqzSHNCorr4tDC3barr66397RB31yO1HJfV1E11ddwzTXNcqrX3bNldLUrXW12U4zr1nvjj8nKinwVW0TA0p55bjqK3mfnYaiUAWqSUnG4zhSXGM1kDQxMAPAKDaehAa0QFRidq5THhEvUjS/DNxUEsdpq9Wcu2//6omwqPU8A835G2m9pAAwAAA0g4AABFfFTLU9pg6gAADSAAAAEBX6CYE1I0uGItOlhOUkkwsXesjWt7GdFRdZ1lSugbjOm1rtmD5a1ejNGi0cxvKTk4s0y6oWwu3TIfMrqmq6LHTmD9axVFeBsrHjTzNehafyBlaptTz15bBd7X1sM0pRd9auxMsz7NYo4aWtPfBb+n4lqyNYNXjHLzUr0ivqLuq/W1UxBTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUApOSSWy3WOGg2NYYaQCp7VjWJmFl5RACqVNVayulVl7NeW84zLoMAy4DJkBUxC4rqCUAk4mMSOOOI0mimnHRQzQ5kFes0sig1Jq1bi6MVbpuW1uT8HzydTau8xil53u5XKL00kZc7J/I3BL+PlSa2AEhOOeDIlSLNgVfUy8WRKm0Oc8VITyKFqJgAOyyRvWwko3g4U8ubU4wo0BlFIMArOMABHhrqlmm4t0QDOGj7ZYDIpa0ppzQqRiUROJrLEyqgqaQsotyV0iQNillUUqNfFnkJ5pVJpE9CyqzKcaRPQpEyaFVE9VnJNS1Z6rpA0FRLlfDpYSgJQc4aiXiWqSEVgLB2HZYeWHKDvOh2VdEpGGlMQU1FMy45OS41VVVVVVVVVVVVVVVVVVVVVVX/+qBsmmeWAPRNQExr2UhoAAANIAAAARDkvyGu6SHgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUBIiRGZ4//4H/EZGjo83lhjMExURmRkVFXKQPFRUWNPFRRpoeKixIChUUEhp6///+puoWFUmQkLsMxYVZ8FhYVTEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVX/+qJsVPktD/IACMP4IRgMAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",
  };

  const _soundAudioCtx = new (
    window.AudioContext || window.webkitAudioContext
  )();
  const _soundBuffers = {};

  (async function loadSounds() {
    for (const [name, dataUrl] of Object.entries(SOUND_DATA)) {
      if (dataUrl.includes("REPLACE_WITH")) continue;
      try {
        const resp = await fetch(dataUrl);
        const arrayBuf = await resp.arrayBuffer();
        _soundBuffers[name] = await _soundAudioCtx.decodeAudioData(arrayBuf);
        console.debug(`[NC-Skinner] Loaded sound: ${name}`);
      } catch (e) {
        console.warn(`[NC-Skinner] Failed to load sound "${name}":`, e);
      }
    }
  })();

  // volume: 0.0 – 1.0, pan: -1.0 (left) – 1.0 (right)
  function playSound(name, volume, pan = 0, id = null) {
    console.debug(
      `[NC-Skinner] Playing sound ${id}: ${name} (vol=${volume}, pan=${pan})`,
    );
    const buffer = _soundBuffers[name];
    if (!buffer) return;
    if (_soundAudioCtx.state === "suspended") _soundAudioCtx.resume();
    const source = _soundAudioCtx.createBufferSource();
    source.buffer = buffer;
    const gain = _soundAudioCtx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    const panner = _soundAudioCtx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain);
    gain.connect(panner);
    panner.connect(_soundAudioCtx.destination);
    source.start();
  }

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
  const savedMasterSound = getCookie(MASTER_SOUND_KEY) === "1";
  const savedPhysicsSounds = getCookie(PHYSICS_SOUNDS_KEY) === "1";
  const savedMatchStartSound = getCookie(MATCH_START_SOUND_KEY) === "1";
  const savedGoalSound = getCookie(GOAL_SOUND_KEY) === "1";
  const savedBoostSound = getCookie(BOOST_SOUND_KEY) === "1";
  const savedCursorColor = getCookie(CURSOR_COLOR_KEY) || "";
  const savedChatColor = getCookie(CHAT_COLOR_KEY) || "";
  const savedFpsColor = getCookie(FPS_COLOR_KEY) || "";
  const savedOverlayColor = getCookie(OVERLAY_COLOR_KEY) || "";
  const savedHideMutedChats = getCookie(HIDE_MUTED_CHATS_KEY) === "1";

  let activeUiMode = savedUiMode;
  let activeUiBgOpacity = savedUiBgOpacity;
  let activeUiAdaptiveRange = savedUiAdaptiveRange;
  let activePhysicsSounds = savedPhysicsSounds;
  let activeMasterSound = savedMasterSound;
  let activeMatchStartSound = savedMatchStartSound;
  let activeGoalSound = savedGoalSound;
  let activeBoostSound = savedBoostSound;
  let activeCursorColor = savedCursorColor;
  let activeChatColor = savedChatColor;
  let activeFpsColor = savedFpsColor;
  let activeOverlayColor = savedOverlayColor;
  let activeHideMutedChats = savedHideMutedChats;

  let uiStyleEl = null;
  let cursorStyleEl = null;

  function buildCursorSvg(color) {
    // 32×32 crosshair cursor with center at 16,16
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
      `<line x1="16" y1="2" x2="16" y2="12" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
      `<line x1="16" y1="20" x2="16" y2="30" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
      `<line x1="2" y1="16" x2="12" y2="16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
      `<line x1="20" y1="16" x2="30" y2="16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
      `<circle cx="16" cy="16" r="4" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `</svg>`
    );
  }

  function applyCursorColor() {
    if (!cursorStyleEl) {
      cursorStyleEl = document.createElement("style");
      cursorStyleEl.id = "ncskinner-cursor-style";
      document.head.appendChild(cursorStyleEl);
    }
    if (activeCursorColor) {
      const svg = buildCursorSvg(activeCursorColor);
      const dataUrl = "data:image/svg+xml," + encodeURIComponent(svg);
      cursorStyleEl.textContent = `canvas { cursor: url('${dataUrl}') 16 16, crosshair !important; }`;
    } else {
      cursorStyleEl.textContent = "";
    }
  }
  // ── Chat / FPS / Overlay color injection ──────────────────────────
  let chatStyleEl = null;
  let overlayStyleEl = null;

  function applyChatColor() {
    if (!chatStyleEl) {
      chatStyleEl = document.createElement("style");
      chatStyleEl.id = "ncskinner-chat-style";
      document.head.appendChild(chatStyleEl);
    }
    if (activeChatColor) {
      chatStyleEl.textContent =
        `#chat-history div, #chat-history div > span:not(.name),` +
        `#chat-history .system, #chat-history .info, #chat-history .admin,` +
        `#team-chat-history div, #team-chat-history span` +
        `{ color: ${activeChatColor} !important; }`;
    } else {
      chatStyleEl.textContent = "";
    }
  }

  function applyFpsColor() {
    if (!pixiStage || typeof PIXI === "undefined") return;
    const queue = [pixiStage];
    while (queue.length > 0) {
      const node = queue.shift();
      if (
        node instanceof PIXI.Text &&
        node.style &&
        node.style.fontSize <= 10 &&
        node.text &&
        (node.text.includes("fps") || node.text.includes("ping"))
      ) {
        const target = activeFpsColor || "#000000";
        if (node.style.fill !== target) node.style.fill = target;
      }
      if (node.children) {
        for (const child of node.children) queue.push(child);
      }
    }
  }

  let fpsColorTimer = null;
  function scheduleFpsColor() {
    if (fpsColorTimer) return;
    fpsColorTimer = setInterval(applyFpsColor, 500);
  }

  function applyOverlayColor() {
    if (!overlayStyleEl) {
      overlayStyleEl = document.createElement("style");
      overlayStyleEl.id = "ncskinner-overlay-style";
      document.head.appendChild(overlayStyleEl);
    }
    if (activeOverlayColor) {
      overlayStyleEl.textContent =
        `#goal, #goal *, #countdown, #countdown *, #sudden-death, #sudden-death *` +
        `{ color: ${activeOverlayColor} !important; }`;
    } else {
      overlayStyleEl.textContent = "";
    }
  }

  let mutedChatStyleEl = null;

  function applyHideMutedChats() {
    if (!mutedChatStyleEl) {
      mutedChatStyleEl = document.createElement("style");
      mutedChatStyleEl.id = "ncskinner-muted-chat-style";
      document.head.appendChild(mutedChatStyleEl);
    }
    mutedChatStyleEl.textContent = activeHideMutedChats
      ? `#chat-history .info { display: none !important; }`
      : "";
  }

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
      // The game's va(e) sets lastPhysicsPosition on every physics-driven sprite
      // (players via me[t] and ball via H), regardless of texture. This works
      // even when custom skins replace the original texture names.
      if (node.lastPhysicsPosition) {
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
        margin-top: auto;
        flex-shrink: 0;
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
    let pendingMasterSound = savedMasterSound;
    let pendingPhysicsSounds = savedPhysicsSounds;
    let pendingMatchStartSound = savedMatchStartSound;
    let pendingGoalSound = savedGoalSound;
    let pendingBoostSound = savedBoostSound;
    let pendingCursorColor = savedCursorColor;
    let pendingChatColor = savedChatColor;
    let pendingFpsColor = savedFpsColor;
    let pendingOverlayColor = savedOverlayColor;
    let pendingHideMutedChats = savedHideMutedChats;

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
    html +=
      '<button class="ncskinner-tab" data-tab="colors">In-Game Colors</button>';
    html += '<button class="ncskinner-tab" data-tab="ui">UI & Sounds</button>';
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

    // — Text Colors section —
    html +=
      '<div style="margin-top:20px;margin-bottom:6px;font-size:11px;color:#e94560;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px">Text Colors</div>';
    html += '<div class="ncskinner-names-row">';
    html += '<span class="ncskinner-names-label">Chat text</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-chat-color" value="${savedChatColor || "#ffffff"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-chat-color-reset">Reset</button>';
    html += "</div>";
    html += '<div class="ncskinner-names-row" style="margin-top:8px">';
    html += '<span class="ncskinner-names-label">FPS / ping</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-fps-color" value="${savedFpsColor || "#000000"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-fps-color-reset">Reset</button>';
    html += "</div>";
    html += '<div class="ncskinner-names-row" style="margin-top:8px">';
    html += '<span class="ncskinner-names-label">Overlays</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-overlay-color" value="${savedOverlayColor || "#ffffff"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-overlay-color-reset">Reset</button>';
    html += "</div>";

    // — Cursor section (moved from UI tab) —
    html +=
      '<div style="margin-top:20px;margin-bottom:6px;font-size:11px;color:#e94560;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px">Cursor</div>';
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="ncskinner-cursor-color-cb"${savedCursorColor ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Enable custom cursor</span></label>`;
    html += `<div id="ncskinner-cursor-color-row" class="ncskinner-names-row" style="margin-top:8px${savedCursorColor ? "" : ";display:none"}">`;
    html += '<span class="ncskinner-names-label">Crosshair color</span>';
    html += `<input type="color" class="ncskinner-color-input" id="ncskinner-cursor-color" value="${savedCursorColor || "#ff0000"}">`;
    html +=
      '<button class="ncskinner-color-reset" id="ncskinner-cursor-color-reset">Reset</button>';
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

    html += '<div class="ncskinner-ui-section">Sounds</div>';
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="ncskinner-master-sound-cb"${savedMasterSound ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Enable sounds</span></label>`;
    html += `<div id="ncskinner-sound-subsettings" style="${savedMasterSound ? "" : "display:none"}">`;
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-left:1rem"><input type="checkbox" id="ncskinner-physics-sounds-cb"${savedPhysicsSounds ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Enable physics sounds</span></label>`;
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-left:1rem"><input type="checkbox" disabled id="ncskinner-match-start-sound-cb"${savedMatchStartSound ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Match start notification</span></label>`;
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-left:1rem"><input type="checkbox" disabled id="ncskinner-goal-sound-cb"${savedGoalSound ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Goal explosion</span></label>`;
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-left:1rem"><input type="checkbox" disabled id="ncskinner-boost-sound-cb"${savedBoostSound ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Player boosting</span></label>`;
    html += `</div>`;

    html += '<div class="ncskinner-ui-section">Chat</div>';
    html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="ncskinner-hide-muted-cb"${savedHideMutedChats ? " checked" : ""}><span class="ncskinner-names-label" style="margin:0">Hide muted player messages</span></label>`;

    html += "</div>"; // close ui-content

    html += "</div>"; // close body

    // Footer
    html +=
      '<div class="ncskinner-footer"><button class="ncskinner-clear">Clear All Settings</button></div>';

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
        pendingUiAdaptiveRange !== savedUiAdaptiveRange ||
        pendingMasterSound !== savedMasterSound ||
        pendingPhysicsSounds !== savedPhysicsSounds ||
        pendingMatchStartSound !== savedMatchStartSound ||
        pendingGoalSound !== savedGoalSound ||
        pendingBoostSound !== savedBoostSound ||
        pendingCursorColor !== savedCursorColor ||
        pendingChatColor !== savedChatColor ||
        pendingFpsColor !== savedFpsColor ||
        pendingOverlayColor !== savedOverlayColor ||
        pendingHideMutedChats !== savedHideMutedChats
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

    const masterSoundCb = panel.querySelector("#ncskinner-master-sound-cb");
    const soundSubsettings = panel.querySelector(
      "#ncskinner-sound-subsettings",
    );
    masterSoundCb.addEventListener("change", () => {
      pendingMasterSound = masterSoundCb.checked;
      activeMasterSound = masterSoundCb.checked;
      soundSubsettings.style.display = masterSoundCb.checked ? "" : "none";
      updateSaveBtn();
    });

    const physicsSoundsCb = panel.querySelector("#ncskinner-physics-sounds-cb");
    physicsSoundsCb.addEventListener("change", () => {
      pendingPhysicsSounds = physicsSoundsCb.checked;
      activePhysicsSounds = physicsSoundsCb.checked;
      updateSaveBtn();
    });

    const matchStartSoundCb = panel.querySelector(
      "#ncskinner-match-start-sound-cb",
    );
    matchStartSoundCb.addEventListener("change", () => {
      pendingMatchStartSound = matchStartSoundCb.checked;
      activeMatchStartSound = matchStartSoundCb.checked;
      updateSaveBtn();
    });

    const goalSoundCb = panel.querySelector("#ncskinner-goal-sound-cb");
    goalSoundCb.addEventListener("change", () => {
      pendingGoalSound = goalSoundCb.checked;
      activeGoalSound = goalSoundCb.checked;
      updateSaveBtn();
    });

    const boostSoundCb = panel.querySelector("#ncskinner-boost-sound-cb");
    boostSoundCb.addEventListener("change", () => {
      pendingBoostSound = boostSoundCb.checked;
      activeBoostSound = boostSoundCb.checked;
      updateSaveBtn();
    });

    const cursorColorCb = panel.querySelector("#ncskinner-cursor-color-cb");
    const cursorColorRow = panel.querySelector("#ncskinner-cursor-color-row");
    const cursorColorInput = panel.querySelector("#ncskinner-cursor-color");
    const cursorColorReset = panel.querySelector(
      "#ncskinner-cursor-color-reset",
    );

    cursorColorCb.addEventListener("change", () => {
      if (cursorColorCb.checked) {
        pendingCursorColor = cursorColorInput.value;
        activeCursorColor = cursorColorInput.value;
        cursorColorRow.style.display = "";
      } else {
        pendingCursorColor = "";
        activeCursorColor = "";
        cursorColorRow.style.display = "none";
      }
      applyCursorColor();
      updateSaveBtn();
    });

    cursorColorInput.addEventListener("input", () => {
      if (cursorColorCb.checked) {
        pendingCursorColor = cursorColorInput.value;
        activeCursorColor = cursorColorInput.value;
        applyCursorColor();
        updateSaveBtn();
      }
    });

    cursorColorReset.addEventListener("click", () => {
      cursorColorInput.value = "#ff0000";
      if (cursorColorCb.checked) {
        pendingCursorColor = "#ff0000";
        activeCursorColor = "#ff0000";
        applyCursorColor();
      }
      updateSaveBtn();
    });

    // Chat color picker
    const chatColorInput = panel.querySelector("#ncskinner-chat-color");
    const chatColorReset = panel.querySelector("#ncskinner-chat-color-reset");

    chatColorInput.addEventListener("input", () => {
      pendingChatColor = chatColorInput.value;
      activeChatColor = chatColorInput.value;
      applyChatColor();
      updateSaveBtn();
    });

    chatColorReset.addEventListener("click", () => {
      pendingChatColor = "";
      chatColorInput.value = "#ffffff";
      activeChatColor = "";
      applyChatColor();
      updateSaveBtn();
    });

    // FPS color picker
    const fpsColorInput = panel.querySelector("#ncskinner-fps-color");
    const fpsColorReset = panel.querySelector("#ncskinner-fps-color-reset");

    fpsColorInput.addEventListener("input", () => {
      pendingFpsColor = fpsColorInput.value;
      activeFpsColor = fpsColorInput.value;
      scheduleFpsColor();
      applyFpsColor();
      updateSaveBtn();
    });

    fpsColorReset.addEventListener("click", () => {
      pendingFpsColor = "";
      fpsColorInput.value = "#000000";
      activeFpsColor = "";
      applyFpsColor();
      updateSaveBtn();
    });

    // Overlay color picker
    const overlayColorInput = panel.querySelector("#ncskinner-overlay-color");
    const overlayColorReset = panel.querySelector(
      "#ncskinner-overlay-color-reset",
    );

    overlayColorInput.addEventListener("input", () => {
      pendingOverlayColor = overlayColorInput.value;
      activeOverlayColor = overlayColorInput.value;
      applyOverlayColor();
      updateSaveBtn();
    });

    overlayColorReset.addEventListener("click", () => {
      pendingOverlayColor = "";
      overlayColorInput.value = "#ffffff";
      activeOverlayColor = "";
      applyOverlayColor();
      updateSaveBtn();
    });

    // Hide muted chats
    const hideMutedCb = panel.querySelector("#ncskinner-hide-muted-cb");
    hideMutedCb.addEventListener("change", () => {
      pendingHideMutedChats = hideMutedCb.checked;
      activeHideMutedChats = hideMutedCb.checked;
      applyHideMutedChats();
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
      pendingMasterSound = true;
      activeMasterSound = true;
      masterSoundCb.checked = true;
      soundSubsettings.style.display = "";
      pendingPhysicsSounds = true;
      activePhysicsSounds = true;
      physicsSoundsCb.checked = true;
      pendingMatchStartSound = true;
      activeMatchStartSound = true;
      matchStartSoundCb.checked = true;
      pendingGoalSound = true;
      activeGoalSound = true;
      goalSoundCb.checked = true;
      pendingBoostSound = true;
      activeBoostSound = true;
      boostSoundCb.checked = true;
      pendingCursorColor = "";
      activeCursorColor = "";
      cursorColorCb.checked = false;
      cursorColorRow.style.display = "none";
      cursorColorInput.value = "#ff0000";
      applyCursorColor();
      pendingChatColor = "";
      activeChatColor = "";
      chatColorInput.value = "#ffffff";
      applyChatColor();
      pendingFpsColor = "";
      activeFpsColor = "";
      fpsColorInput.value = "#000000";
      applyFpsColor();
      pendingOverlayColor = "";
      activeOverlayColor = "";
      overlayColorInput.value = "#ffffff";
      applyOverlayColor();
      pendingHideMutedChats = false;
      activeHideMutedChats = false;
      hideMutedCb.checked = false;
      applyHideMutedChats();
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
      setCookie(MASTER_SOUND_KEY, pendingMasterSound ? "1" : "0");
      setCookie(PHYSICS_SOUNDS_KEY, pendingPhysicsSounds ? "1" : "0");
      setCookie(MATCH_START_SOUND_KEY, pendingMatchStartSound ? "1" : "0");
      setCookie(GOAL_SOUND_KEY, pendingGoalSound ? "1" : "0");
      setCookie(BOOST_SOUND_KEY, pendingBoostSound ? "1" : "0");
      if (pendingCursorColor) {
        setCookie(CURSOR_COLOR_KEY, pendingCursorColor);
      } else {
        deleteCookie(CURSOR_COLOR_KEY);
      }
      if (pendingChatColor) {
        setCookie(CHAT_COLOR_KEY, pendingChatColor);
      } else {
        deleteCookie(CHAT_COLOR_KEY);
      }
      if (pendingFpsColor) {
        setCookie(FPS_COLOR_KEY, pendingFpsColor);
      } else {
        deleteCookie(FPS_COLOR_KEY);
      }
      if (pendingOverlayColor) {
        setCookie(OVERLAY_COLOR_KEY, pendingOverlayColor);
      } else {
        deleteCookie(OVERLAY_COLOR_KEY);
      }
      setCookie(HIDE_MUTED_CHATS_KEY, pendingHideMutedChats ? "1" : "0");
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
    applyCursorColor();
    applyChatColor();
    applyOverlayColor();
    applyHideMutedChats();
    if (savedFpsColor) scheduleFpsColor();
  }

  // ── Game body resolution ─────────────────────────────────────────────
  // Uses lastPhysicsPosition (written by the game's own draw loop onto each
  // sprite) as the authoritative bridge between PIXI sprites and Planck bodies.
  // No physics-value heuristics — identity comes from stable asset names.

  let _soundPlanckWorld = null;
  let _soundPrevBallVel = null;
  let _soundBodies = null; // { ball: Body, blue: Body[], red: Body[] }
  let _soundPrevPlayerVels = new Map(); // Body -> { x, y }
  let _soundPrevBoostStates = new Map(); // player index -> bool
  let _lastBallHitSound = 0;
  let _lastPlayerHitSound = new Map(); // Body -> DOMHighResTimeStamp
  let _lastBoostSound = new Map(); // player index -> DOMHighResTimeStamp

  function bodyPan(body) {
    if (!pixiStage) return 0;
    const screenX = body.getPosition().x * pixiStage.scale.x + pixiStage.x;
    return (screenX - window.innerWidth / 2) / (window.innerWidth / 2);
  }

  // Returns a 0.0–1.0 multiplier based on distance from camera center in game units.
  // 1.0 at center, linearly falling to 0.0 at 80 units.
  function bodyProximityVolume(body) {
    if (!pixiStage) return 1;
    const pos = body.getPosition();
    const gameCX = (window.innerWidth / 2 - pixiStage.x) / pixiStage.scale.x;
    const gameCY = (window.innerHeight / 2 - pixiStage.y) / pixiStage.scale.y;
    return Math.max(0, 1 - Math.hypot(pos.x - gameCX, pos.y - gameCY) / 80);
  }

  (function hookPlanckForSound() {
    if (typeof window.planck === "undefined") {
      setTimeout(hookPlanckForSound, 500);
      return;
    }
    const origStep = window.planck.World.prototype.step;
    window.planck.World.prototype.step = function (...args) {
      if (_soundPlanckWorld !== this) {
        _soundPlanckWorld = this;
        _soundBodies = null;
        _soundPrevBallVel = null;
        _soundPrevPlayerVels = new Map();
        _soundNaturalPlayerAccel = new Map();
        _soundPrevBoostStates = new Map();
        _lastBallHitSound = 0;
        _lastPlayerHitSound = new Map();
        _lastBoostSound = new Map();
      }
      return origStep.apply(this, args);
    };
  })();

  // Debug helper — call window._ncDebugSound() in the console during a match
  window._ncDebugSound = function () {
    if (!pixiStage) {
      console.log("no pixiStage");
      return;
    }
    const queue = [pixiStage];
    while (queue.length) {
      const node = queue.shift();
      if (node.lastPhysicsPosition) {
        const tex = getTextureName(node);
        const childTexes = (node.children || [])
          .map(getTextureName)
          .filter(Boolean);
        console.log("lastPhysicsPosition node:", {
          tex,
          childTexes,
          pos: node.lastPhysicsPosition,
        });
      }
      if (node.children) for (const c of node.children) queue.push(c);
    }
    console.log("_soundBodies:", _soundBodies);
  };

  // Walk PIXI stage for sprites with lastPhysicsPosition (set by game each frame),
  // then match each to the nearest dynamic Planck body by exact position.
  function resolveGameBodies() {
    if (!pixiStage || !_soundPlanckWorld || typeof PIXI === "undefined")
      return null;
    // Build sets of known texture names per type, including custom skin URLs.
    const blueTex = new Set(["player-B"]);
    const redTex = new Set(["player-R"]);
    const ballTex = new Set(["ballWFG"]);
    if (skinRequests.blue) blueTex.add(skinRequests.blue.url);
    if (skinRequests.red) redTex.add(skinRequests.red.url);
    if (skinRequests.ball) ballTex.add(skinRequests.ball.url);
    const entries = [];
    const queue = [pixiStage];
    while (queue.length) {
      const node = queue.shift();
      if (node.lastPhysicsPosition) {
        const tex = getTextureName(node);
        const entry = {
          bx: node.lastPhysicsPosition.x,
          by: node.lastPhysicsPosition.y,
        };
        if (ballTex.has(tex) || tex.includes("ballWFG"))
          entries.push({ ...entry, type: "ball" });
        else if (blueTex.has(tex)) entries.push({ ...entry, type: "blue" });
        else if (redTex.has(tex)) entries.push({ ...entry, type: "red" });
      }
      if (node.children) for (const c of node.children) queue.push(c);
    }
    if (entries.length === 0) return null;
    const result = { ball: null, blue: [], red: [] };
    const used = new Set();
    for (const e of entries) {
      let best = null,
        bestDist = 0.01; // tolerance: float safety only
      for (let b = _soundPlanckWorld.getBodyList(); b; b = b.getNext()) {
        if (!b.isDynamic() || used.has(b)) continue;
        const pos = b.getPosition();
        const dist = Math.hypot(pos.x - e.bx, pos.y - e.by);
        if (dist < bestDist) {
          bestDist = dist;
          best = b;
        }
      }
      if (!best) continue;
      used.add(best);
      if (e.type === "ball") result.ball = best;
      else if (e.type === "blue") result.blue.push(best);
      else if (e.type === "red") result.red.push(best);
    }
    return result.ball ? result : null;
  }

  (function soundTick() {
    requestAnimationFrame(soundTick);
    if (!activeMasterSound) return;
    if (!_soundPlanckWorld) return;
    try {
      if (!_soundBodies) _soundBodies = resolveGameBodies();
      if (!_soundBodies?.ball) {
        _soundPrevBallVel = null;
        return;
      }
      if (activePhysicsSounds) {
        const vel = _soundBodies.ball.getLinearVelocity();
        if (_soundPrevBallVel) {
          const bK = 1 / (1 + _soundBodies.ball.getLinearDamping() / 60);
          const deltaKmh =
            Math.hypot(
              vel.x - _soundPrevBallVel.x * bK,
              vel.y - _soundPrevBallVel.y * bK,
            ) * 5;
          if (deltaKmh >= SOUND_THRESHOLD_KMH) {
            // const now = performance.now();
            // if (now - _lastBallHitSound >= SOUND_COOLDOWN_BALL_MS) {
            //   _lastBallHitSound = now;
            const proxVol = bodyProximityVolume(_soundBodies.ball);
            if (proxVol > 0)
              playSound(
                "ballHit",
                Math.min(1, deltaKmh / SOUND_MAX_KMH) * proxVol,
                bodyPan(_soundBodies.ball),
              );
            // }
          }
        }
        _soundPrevBallVel = { x: vel.x, y: vel.y };
        let i = 0;
        for (const body of [..._soundBodies.blue, ..._soundBodies.red]) {
          const pvel = body.getLinearVelocity();
          const prev = _soundPrevPlayerVels.get(body);
          if (prev) {
            const pK = 1 / (1 + body.getLinearDamping() / 60);
            const deltaKmh =
              Math.hypot(pvel.x - prev.x * pK, pvel.y - prev.y * pK) * 5;
            if (deltaKmh >= SOUND_THRESHOLD_KMH) {
              const now = performance.now();
              const lastHit = _lastPlayerHitSound.get(body) ?? 0;
              if (now - lastHit >= SOUND_COOLDOWN_PLAYER_MS) {
                const proxVol = bodyProximityVolume(body);
                if (proxVol > 0) {
                  _lastPlayerHitSound.set(body, now);
                  playSound(
                    "playerHit",
                    (Math.min(1, (2 * deltaKmh) / SOUND_MAX_KMH) / 4) * proxVol,
                    bodyPan(body),
                    i++,
                  );
                }
              }
            }
          }
          _soundPrevPlayerVels.set(body, { x: pvel.x, y: pvel.y });
        }
      }
    } catch (_) {}
  })();

  // ── WebSocket hook for event sounds ────────────────────────────────

  function handleSoundMessage(d) {
    if (!activeMasterSound) return;
    const type = d.getUint8(0);
    if (type === 9) {
      if (d.byteLength >= 5 && d.getInt32(1) === 0 && activeMatchStartSound) {
        playSound("matchStart", 1, 0);
      }
    } else if (type === 6) {
      if (activeGoalSound) {
        playSound("goalExplosion", 1, 0);
      }
    } else if (type === 5) {
      if (!activeBoostSound) return;
      const numPlayers = Math.floor((d.byteLength - 6) / 33);
      for (let n = 0; n < numPlayers; n++) {
        const flagOffset = 6 + 33 * n + 32;
        if (flagOffset >= d.byteLength) break;
        const flags = d.getUint8(flagOffset);
        const boosting = (flags & 1) !== 0;
        const prev = _soundPrevBoostStates.get(n) ?? false;
        if (boosting && !prev) {
          const now = performance.now();
          const lastBoost = _lastBoostSound.get(n) ?? 0;
          if (now - lastBoost >= SOUND_COOLDOWN_BOOST_MS) {
            _lastBoostSound.set(n, now);
            playSound("playerBoost", 0.7, 0);
          }
        }
        _soundPrevBoostStates.set(n, boosting);
      }
    }
  }

  function hookWebSocketForSounds() {
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (...args) {
      if (!this._ncSoundHooked) {
        this._ncSoundHooked = true;
        this.addEventListener("message", (e) => {
          if (!(e.data instanceof ArrayBuffer) || e.data.byteLength < 1) return;
          try {
            handleSoundMessage(new DataView(e.data));
          } catch (_) {}
        });
      }
      return origSend.apply(this, args);
    };
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  hookWebSocketForSounds();
  hookPIXI();
  applySkinSources();
  scheduleNameRecolor();
  schedulePlayerBoostTint();
  schedulePlayerTint();
  initUI();
})();
