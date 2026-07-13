// ==UserScript==
// @name         NitroClash — Custom Server
// @namespace    nc-custom-server
// @version      2.2.2
// @description  Redirects NitroClash matchmaking and game WebSocket to custom server
// @author       parasetanol
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/nc-custom-server-spikeless.user.js
// @downloadURL  https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/nc-custom-server-spikeless.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ===================== SERVER ADDRESSES — EDIT HERE =====================
  const LOCAL_HTTP_HOST = "ncserver.parasetanol.com";
  const LOCAL_WS_HOST = "ncserver.parasetanol.com";
  const LOCAL_WS_PORT = 8443;
  // ========================================================================

  // ===================== MOVEMENT-SPIKE MITIGATION ========================
  // The stock client runs a full local physics prediction and reconciles it
  // against an authoritative state snapshot (opcode 5) that the server sends
  // EVERY tick (60/s). On each snapshot the client hard-sets all bodies to the
  // server state and fast-forwards `se - re` ticks WITHOUT re-applying inputs
  // (it coasts on damping). While a player is thrusting/boosting that coasted
  // reprojection lands short of the true position → the one-frame "spike".
  //
  // The real fix (replay inputs during catch-up) lives inside the client's
  // module closure and can't be reached from here. What we CAN do is deliver
  // fewer opcode-5 frames to the client: it then reprojects less often and
  // leans on its (correct) forward prediction in between, so spikes get rarer.
  // `se - re` does not grow when we drop a frame (both counters keep advancing),
  // so per-correction magnitude is unchanged — only the frequency drops.
  //
  // STATE_FRAME_INTERVAL: deliver 1 of every N opcode-5 frames (1 = disabled,
  // passthrough; 2 ≈ 30 Hz corrections; 3 ≈ 20 Hz). State-change frames always
  // pass through regardless, so match/countdown/goal transitions aren't delayed.
  const STATE_FRAME_INTERVAL = 2;
  // Opcode byte for the authoritative per-tick state snapshot.
  const STATE_OPCODE = 5;
  // ========================================================================

  // Opcode the custom server uses to tell us which mode a spectator is watching
  // (server sends [200] + UTF-8 label on each spectate attach). The stock client
  // has no case for it, so we consume + swallow it and paint a small overlay.
  const SPEC_LABEL_OPCODE = 200;

  const MATCHMAKING_ORIGIN = `https://${LOCAL_HTTP_HOST}`;
  const LOCAL_WS = `${LOCAL_WS_HOST}:${LOCAL_WS_PORT}`;
  // Only redirect these HTTP paths (matchmaking endpoints)
  const REDIRECT_PATHS = ["/servers", "/", "/login"];
  // Match both http and https — Chrome upgrades http://s.nitroclash.io via HSTS
  const REAL_ORIGINS = ["https://s.nitroclash.io", "http://s.nitroclash.io"];
  // Any WS host containing these strings gets redirected to LOCAL_WS
  const REAL_WS_PATTERNS = ["nitroclash.io", "tourney.nitroclash.io"];

  const win = unsafeWindow;

  // -------------------------------------------------------------------------
  // Helper: rewrite a URL string if it matches the real matchmaking origin
  // -------------------------------------------------------------------------
  function rewriteHTTP(url) {
    if (typeof url !== "string") return null;
    for (const origin of REAL_ORIGINS) {
      if (url.startsWith(origin)) {
        const path = url.slice(origin.length).split("?")[0];
        if (!REDIRECT_PATHS.includes(path)) return null;
        return MATCHMAKING_ORIGIN + url.slice(origin.length);
      }
    }
    return null;
  }

  // Helper: decide if a WS host should be redirected
  function rewriteWS(url) {
    if (typeof url !== "string") return null;
    // Real NC servers → custom game server (or party server for /team path)
    for (const pat of REAL_WS_PATTERNS) {
      if (url.includes(pat)) {
        if (url.includes("/team")) {
          return `wss://${LOCAL_HTTP_HOST}/team`;
        }
        return "wss://" + LOCAL_WS;
      }
    }
    // ut() turns "host:port" into "wss://host/port" when on HTTPS.
    // Fix the slash→colon for our own server and localhost.
    const slashPort = /^wss?:\/\/(localhost|(?:.*?))\/(\d+)(\/.*)?$/;
    const m = url.match(slashPort);
    if (m) {
      const host = m[1];
      const port = m[2];
      const path = m[3] || "";
      if (host === "localhost") return `ws://localhost:${port}${path}`;
      if (host === LOCAL_WS_HOST) return `wss://${host}:${port}${path}`;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Helper: offset game mode based on the SELECTED server's region code.
  //
  // Keyed off the option's value (the remapped region code), NOT its dropdown
  // index — the game may render the region options in any order, so an
  // index-based offset (old approach: selectedIndex*5) would break if "Bots"
  // didn't land where we expect. A value→offset map is order-independent.
  // Codes must match KEY_REMAP below: Default=USE1, Tennis=USW1, Bots=EU1.
  // -------------------------------------------------------------------------
  const OFFSET_BY_CODE = { USE1: 0, USW1: 5, EU1: 10 };

  // ===================== GLOBAL SPECTATE (Train button) ===================
  // When the user picks "Train" and clicks Spectate, we turn the request into
  // a "watch everything" spectate: cycle through every live room on the server
  // regardless of mode (1v1/2v2/3v3/5v5/classic) or server type (default/
  // tennis/bots). Two flags coordinate the nitroclash hooks (installed below)
  // with wrapSend: `selectedMode` tracks the last game-mode button chosen, and
  // `globalSpectate` marks the current spectate session as global so wrapSend
  // stamps the outbound frame with the 0xFF sentinel.
  const TRAIN_MODE = 5; // the "Train" game-mode button id
  const NEUTRAL_MODE = 1; // any non-Train mode; selecting it clears the client's
  //                          internal train flag so it sizes rooms per-room
  let selectedMode = -1;
  let globalSpectate = false;
  // True for the current game socket if we joined as a spectator (opcode 7/1),
  // false once a normal play-join (opcode 1) is sent. Gates the client-side
  // map-data overlay fallback so it never shows while actually playing.
  let spectating = false;
  // ========================================================================

  // Client-facing mode ids (0-4) → label. The server maps tennis/bots onto
  // these, so this is a best-effort fallback; the opcode-200 label frame from
  // the server refines it (e.g. "Tennis 1v1", "Bots — 3v3") when available.
  function clientModeLabel(m) {
    return (
      { 0: "Classic", 1: "3v3", 2: "2v2", 3: "1v1", 4: "5v5" }[m] || "Mode " + m
    );
  }

  // -------------------------------------------------------------------------
  // Spectate overlay — a small caption showing the mode currently being
  // watched. Fed by opcode-200 label frames from the server (see installInbound).
  // -------------------------------------------------------------------------
  let specOverlay = null;
  function getSpecOverlay() {
    if (specOverlay) return specOverlay;
    const el = document.createElement("div");
    el.id = "nc-spectate-mode";
    Object.assign(el.style, {
      position: "fixed",
      top: "34px",
      right: "8px",
      zIndex: "999999",
      background: "#1a1a2e",
      color: "#ffd166",
      border: "1px solid #ffd166",
      borderRadius: "4px",
      padding: "3px 8px",
      fontSize: "11px",
      fontFamily: "monospace",
      fontWeight: "bold",
      letterSpacing: "1px",
      pointerEvents: "none",
      userSelect: "none",
      display: "none",
    });
    (document.body || document.documentElement).appendChild(el);
    specOverlay = el;
    return el;
  }
  function showSpectateMode(label) {
    const el = getSpecOverlay();
    el.textContent = (globalSpectate ? "👁 ALL · " : "👁 ") + label;
    el.style.display = "block";
  }
  function hideSpectateMode() {
    if (specOverlay) specOverlay.style.display = "none";
  }
  // -------------------------------------------------------------------------

  function getSelectedOffset() {
    const sel = document.getElementById("server");
    if (!sel) return 0;
    const opt = sel.options[sel.selectedIndex];
    return (opt && OFFSET_BY_CODE[opt.value]) || 0;
  }

  function applyModeOffset(url) {
    try {
      const u = new URL(url);
      if (u.pathname !== "/" || !u.searchParams.has("m")) return null;
      const offset = getSelectedOffset();
      if (offset === 0) return null;
      const newMode = parseInt(u.searchParams.get("m") || "1") + offset;
      u.searchParams.set("m", String(newMode));
      console.log(`[nc-custom] mode offset +${offset} → m=${newMode}`);
      return u.toString();
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // 1. XMLHttpRequest intercept
  // -------------------------------------------------------------------------
  const NativeXHR = win.XMLHttpRequest;
  const nativeOpen = NativeXHR.prototype.open;

  NativeXHR.prototype.open = function (method, url, async, user, pass) {
    let finalUrl = rewriteHTTP(url) || url;
    const offsetUrl = applyModeOffset(finalUrl);
    if (offsetUrl) finalUrl = offsetUrl;

    // -----------------------------------------------------------------------
    // Fix: exponential error/toast storm when the server is unreachable.
    // The game's server-list poll (ft → GET /servers) reschedules ITSELF from
    // BOTH its onreadystatechange(readyState===4) branch AND its onerror
    // handler. On a connection failure the browser fires *both* events for the
    // same request, so every failed poll spawns TWO retries → 1,2,4,8,… every
    // 3s (and every onerror also pushes a bottom-left "error" toast). We can't
    // touch the game's closure, so we neutralize onerror for this one request:
    // the onreadystatechange path still reschedules exactly once (steady 3s
    // retry) and the duplicate retry + toast spam are gone.
    const isServersPoll =
      typeof method === "string" &&
      method.toUpperCase() === "GET" &&
      /\/servers(\?|$)/.test(finalUrl);

    let ret;
    if (finalUrl !== url) {
      console.log(`[nc-custom] XHR ${method} redirect: ${url} → ${finalUrl}`);
      ret = nativeOpen.call(this, method, finalUrl, async ?? true, user, pass);
    } else {
      ret = nativeOpen.call(this, method, url, async, user, pass);
    }

    if (isServersPoll) {
      // Clear the game's already-assigned onerror (set before open) via the
      // native setter so the internal handler slot is emptied, then swallow
      // any later re-assignment as belt-and-suspenders.
      try {
        this.onerror = null;
        Object.defineProperty(this, "onerror", {
          configurable: true,
          get() {
            return null;
          },
          set() {},
        });
      } catch (e) {}
    }
    return ret;
  };

  // -------------------------------------------------------------------------
  // 2. fetch intercept
  // -------------------------------------------------------------------------
  const nativeFetch = win.fetch;
  win.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    let finalUrl = rewriteHTTP(url) || url;
    const offsetUrl = applyModeOffset(finalUrl);
    if (offsetUrl) finalUrl = offsetUrl;
    if (finalUrl !== url) {
      console.log(`[nc-custom] fetch redirect: ${url} → ${finalUrl}`);
      const newInput =
        typeof input === "string" ? finalUrl : new Request(finalUrl, input);
      return nativeFetch.call(this, newInput, init);
    }
    return nativeFetch.call(this, input, init);
  };

  // -------------------------------------------------------------------------
  // 3. WebSocket intercept — safety net so game WS always hits localhost:8000
  //    even if matchmaking returned a real server address
  // -------------------------------------------------------------------------
  const NativeWS = win.WebSocket;
  const nativeOnMessageSetter = Object.getOwnPropertyDescriptor(
    NativeWS.prototype,
    "onmessage",
  ).set;

  // -------------------------------------------------------------------------
  // Inbound game-socket wrapper. Two jobs:
  //   1. Consume opcode-200 spectate-label frames (paint the mode overlay) and
  //      swallow them so they never reach the game.
  //   2. Throttle opcode-5 (state snapshot) frames to reduce reconciliation-
  //      reprojection frequency (see MOVEMENT-SPIKE notes): deliver only 1 of
  //      every STATE_FRAME_INTERVAL, but always pass state-change frames.
  // Both message-delivery paths the client might use (onmessage property and
  // addEventListener) are wrapped; every other opcode is delivered untouched.
  // -------------------------------------------------------------------------
  const textDecoder = new win.TextDecoder();
  function installInbound(ws) {
    let count = 0;
    let lastState = -1;
    let dropped = 0;
    // Decide ONCE PER FRAME, cached by the message's data buffer. wrap() below is
    // applied to EVERY "message" listener on the socket — the game's own handler
    // plus any other userscript that also listens (e.g. the skinner's sound hook).
    // The old code did count++ inside shouldDeliver per listener call, so with N
    // listeners `count` advanced N× per frame and the game's listener got pinned to
    // one parity of `count % INTERVAL` — with 2 listeners it NEVER hit the keep
    // slot, so the game received zero state frames and froze on pure prediction
    // (the "only works when another userscript is also loaded" heisenbug). All
    // listeners receive the same ArrayBuffer instance for a given frame, so keying
    // the decision on `data` makes the throttle count once per frame and deliver
    // identically to every listener.
    const decided = new WeakMap();

    function shouldDeliver(data) {
      try {
        // Client uses binaryType "arraybuffer" (it wraps frames in a DataView).
        // Non-ArrayBuffer (e.g. text/Blob) → u[0] is undefined → delivered.
        if (data && typeof data === "object" && decided.has(data)) {
          return decided.get(data);
        }
        const u = new Uint8Array(data);
        let deliver;
        if (u[0] === SPEC_LABEL_OPCODE) {
          // Spectate mode label — paint the overlay and swallow the frame.
          try {
            const label = textDecoder.decode(u.subarray(1));
            console.log("[nc-custom] spectate label:", label);
            showSpectateMode(label);
          } catch (e) {}
          deliver = false;
        } else if (spectating && u[0] === 2) {
          // Map data (opcode 2), delivered to the client as usual. Its last
          // byte is the client-facing game mode — use it as a fallback overlay
          // label so the mode shows even if the server label frame isn't sent.
          try {
            showSpectateMode(clientModeLabel(u[u.length - 1]));
          } catch (e) {}
          deliver = true;
        } else if (STATE_FRAME_INTERVAL > 1 && u[0] === STATE_OPCODE) {
          const state = u[1]; // game-state byte; always pass on transitions
          count++;
          if (state !== lastState) {
            lastState = state;
            deliver = true;
          } else if (count % STATE_FRAME_INTERVAL === 0) {
            deliver = true;
          } else {
            dropped++;
            deliver = false;
          }
        } else {
          deliver = true;
        }
        if (data && typeof data === "object") decided.set(data, deliver);
        return deliver;
      } catch (e) {
        return true; // never drop on parse failure
      }
    }

    function wrap(listener) {
      return function (ev) {
        if (shouldDeliver(ev.data)) return listener.call(this, ev);
      };
    }

    const nativeAdd = ws.addEventListener.bind(ws);
    ws.addEventListener = function (type, listener, opts) {
      if (type === "message" && typeof listener === "function") {
        return nativeAdd(type, wrap(listener), opts);
      }
      return nativeAdd(type, listener, opts);
    };

    let _onmessage = null;
    Object.defineProperty(ws, "onmessage", {
      configurable: true,
      get() {
        return _onmessage;
      },
      set(fn) {
        _onmessage = fn;
        nativeOnMessageSetter.call(
          ws,
          typeof fn === "function" ? wrap(fn) : fn,
        );
      },
    });

    // Hide the spectate overlay when this game socket closes (left spectating).
    ws.addEventListener("close", () => {
      spectating = false;
      hideSpectateMode();
    });

    console.log(
      `[nc-custom] inbound wrapper active (label frames + state throttle 1/${STATE_FRAME_INTERVAL})`,
    );
  }

  // View outgoing binary as a mutable Uint8Array (in place), or null if it's a
  // string/Blob we shouldn't touch.
  function asBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data))
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  // Wrap send() so the spectate frame gets the same mode offset the matchmake
  // HTTP request gets. The client builds the spectate frame (opcode 7, sub 1)
  // from the base game-mode button — the +offset lives only in this userscript,
  // so without this the server sees mode 0-5 and replies "no game." For Bots
  // (offset +10) button N thus watches manager mode 10+N (one all-bot lobby per
  // Default mode), matching the +offset the matchmake request already applies.
  function wrapSend(socket) {
    const nativeSend = socket.send.bind(socket);
    socket.send = function (data) {
      try {
        const b = asBytes(data);
        // Track whether this socket is a spectate session, from what's sent:
        // opcode 7/1 = spectate join, opcode 1 = normal play join.
        if (b && b.length >= 1) {
          if (b[0] === 7 && b[1] === 1) spectating = true;
          else if (b[0] === 1) spectating = false;
        }
        if (b && b.length >= 3 && b[0] === 7 && b[1] === 1) {
          if (globalSpectate) {
            // Global spectate (Train button): send 0xFF, which the server reads
            // as int8 -1 = "watch every live room across all modes/server-types"
            // (see GLOBAL_SPEC_MODE). Skip the dropdown offset entirely — global
            // spans all server types, so no single offset applies.
            b[2] = 0xff;
            console.log("[nc-custom] global spectate frame → mode 0xFF (-1)");
          } else {
            const offset = getSelectedOffset();
            if (offset) {
              b[2] = b[2] + offset;
              console.log(
                `[nc-custom] spectate mode offset +${offset} → ${b[2]}`,
              );
            }
          }
        }
      } catch (e) {}
      return nativeSend(data);
    };
    return socket;
  }

  function PatchedWebSocket(url, protocols) {
    const redirected = rewriteWS(url);
    const finalUrl = redirected || url;
    if (redirected)
      console.log(`[nc-custom] WS redirect: ${url} → ${redirected}`);
    const ws =
      protocols !== undefined
        ? new NativeWS(finalUrl, protocols)
        : new NativeWS(finalUrl);
    // Offset outbound spectate frames (opcode 7/1) to match the matchmake offset.
    wrapSend(ws);
    // Only the game socket carries the state stream + spectate labels; skip /team.
    if (redirected && !/\/team(\/|$)/.test(redirected)) installInbound(ws);
    return ws;
  }

  // Copy static properties (OPEN, CLOSED, etc.) and prototype
  PatchedWebSocket.prototype = NativeWS.prototype;
  PatchedWebSocket.CONNECTING = NativeWS.CONNECTING;
  PatchedWebSocket.OPEN = NativeWS.OPEN;
  PatchedWebSocket.CLOSING = NativeWS.CLOSING;
  PatchedWebSocket.CLOSED = NativeWS.CLOSED;
  win.WebSocket = PatchedWebSocket;

  // -------------------------------------------------------------------------
  // 3b. Global spectate hooks on window.nitroclash
  //
  // The blocker: the "Train" button sets the client's internal train flag
  // (Ve = 5 == Ge). While that flag is set the client's map-data handler forces
  // a fixed 2-player layout and IGNORES the per-room game-mode byte the server
  // sends — so a Train-spectator can never be sized to the room it's watching
  // (it "bugs out" on anything bigger than 1v1). That flag lives inside the
  // game's module closure, but selectMode() is the ONLY thing that sets it and
  // it's exposed on window.nitroclash. So we wrap clickSpectate: when Train is
  // the selected mode, flip to a normal mode first (clearing the train flag),
  // then let the spectate proceed. With the flag clear, the client honors the
  // mode byte the server sends for each room and re-sizes as you cycle. The
  // outbound frame is stamped 0xFF by wrapSend → server watches all rooms.
  //
  // nitroclash is created by the (replaced) game script after document-start,
  // so poll until it exists, then wrap each function exactly once.
  // -------------------------------------------------------------------------
  function installGlobalSpectate() {
    const nc = win.nitroclash;
    if (!nc || nc.__ncGlobalSpecWrapped) return !!nc;

    if (typeof nc.selectMode === "function") {
      const origSelect = nc.selectMode;
      nc.selectMode = function (m) {
        selectedMode = m;
        return origSelect.apply(this, arguments);
      };
    }

    if (typeof nc.clickSpectate === "function") {
      const origSpectate = nc.clickSpectate;
      nc.clickSpectate = function () {
        globalSpectate = selectedMode === TRAIN_MODE;
        if (globalSpectate) {
          // Clear the client train flag so it sizes each room from the server's
          // per-room mode byte. Guarded — selectMode is a no-op mid-party.
          try {
            nc.selectMode(NEUTRAL_MODE);
          } catch (e) {}
          console.log("[nc-custom] global spectate: Train → watch all rooms");
        }
        return origSpectate.apply(this, arguments);
      };
    }

    nc.__ncGlobalSpecWrapped = true;
    console.log("[nc-custom] global-spectate hooks installed");
    return true;
  }

  if (!installGlobalSpectate()) {
    const specHookTimer = setInterval(() => {
      if (installGlobalSpectate()) clearInterval(specHookTimer);
    }, 50);
  }

  // -------------------------------------------------------------------------
  // 4. Patch the game's region display-name map (ze) to add custom regions.
  //    ze is a local var inside the game IIFE, so we can't access it directly.
  //    Instead, we hook JSON.parse to intercept the /servers response and
  //    inject a "name" field, then hook the <select> element so that when
  //    the game populates the dropdown we fix up any missing display names.
  // -------------------------------------------------------------------------

  // Hook the server <select> — when the game populates options, fix labels
  // that came through as "undefined" because ze doesn't have our custom keys.
  // Re-query #server every call — the game rebuilds this element on some
  // re-renders, so a MutationObserver bound to a single instance fires once
  // and then goes dead. A cheap poll (2 options) is robust to that.
  function fixServerLabels() {
    const serverSelect = document.getElementById("server");
    if (!serverSelect) return;
    let changed = false;
    for (const opt of serverSelect.options) {
      // The game sets label to: ze[key] + " (" + playerCount + ")".
      // Since we remap our keys to real region codes (USE1/USW1), ze gives
      // the game's built-in names ("US East"/"US West"). Replace the leading
      // name with our captured custom name, preserving the " (count)" suffix.
      const custom = serverNameMap[opt.value];
      if (!custom) continue;
      const suffix = opt.textContent.match(/\s*\(.*\)\s*$/);
      const desired = custom + (suffix ? suffix[0] : "");
      if (opt.textContent !== desired) {
        opt.textContent = desired;
        changed = true;
      }
    }
    // Refresh the jQuery selectmenu widget so the visible button updates too.
    // Guard on `changed` so steady state is a no-op (no refresh churn).
    if (changed) {
      try {
        win.jQuery("#server").selectmenu("refresh");
      } catch (e) {}
    }
  }

  win.addEventListener("DOMContentLoaded", function () {
    // Expose the captured name map for console debugging. Must be assigned
    // here (deferred), not at IIFE top level — `serverNameMap` is declared
    // further down, so touching it synchronously would hit its TDZ and throw.
    win.__ncServerNames = serverNameMap;
    fixServerLabels();
    setInterval(fixServerLabels, 1000);
  });

  // Remap custom server keys → real client-recognized region codes.
  // Game's ze map only knows EU1/EU2/USE1/USW1/TOK1/SA1/TR; unknown keys are
  // silently dropped from the dropdown. Rename here so the game keeps them.
  // Order matters: the userscript's "mode offset = dropdownIndex * 5" trick
  // means slot 0 = default modes, slot 1 = +5 (tennis), etc.
  // NOTE: don't remap to "TR" — the game deletes l.TR in non-tournament mode
  // (scripts.js:44340 `delete l.TR`), so a TR-mapped entry is stripped before
  // it's ever pinged and never appears in the dropdown. Use USW1 instead.
  const KEY_REMAP = [
    ["Default", "USE1"],
    ["Tennis", "USW1"],
    // 3rd dropdown entry → mode offset +10. Watch-only all-bot "manager" mode
    // (server attaches you as a spectator on join). EU1 is a client-recognized
    // region code the game keeps; fixServerLabels renames it to "Bots".
    ["Bots", "EU1"],
  ];

  // Build a key→displayName map from /servers responses
  const serverNameMap = {};
  const nativeParse = win.JSON.parse;
  win.JSON.parse = function (text) {
    const result = nativeParse.apply(this, arguments);
    // Detect a /servers-shaped response: object with uri+name fields
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const keys = Object.keys(result);
      if (
        keys.length > 0 &&
        keys.every((k) => result[k] && result[k].uri && result[k].name)
      ) {
        for (const [from, to] of KEY_REMAP) {
          if (result[from] && !result[to]) {
            result[to] = result[from];
            delete result[from];
            console.log(`[nc-custom] Remapped server key: ${from} → ${to}`);
          }
        }
        for (const k of Object.keys(result)) {
          serverNameMap[k] =
            result[k].name.charAt(0).toUpperCase() + result[k].name.slice(1);
        }
        console.log("[nc-custom] Captured server names:", serverNameMap);
      }
    }
    return result;
  };

  // -------------------------------------------------------------------------
  // 5. Visual indicator
  // -------------------------------------------------------------------------
  win.addEventListener("DOMContentLoaded", function () {
    const badge = document.createElement("div");
    badge.id = "nc-custom-badge";
    badge.textContent = "⚙ CUSTOM SERVER";
    Object.assign(badge.style, {
      position: "fixed",
      top: "8px",
      right: "8px",
      zIndex: "999999",
      background: "#1a1a2e",
      color: "#00e5ff",
      border: "1px solid #00e5ff",
      borderRadius: "4px",
      padding: "3px 8px",
      fontSize: "11px",
      fontFamily: "monospace",
      fontWeight: "bold",
      letterSpacing: "1px",
      pointerEvents: "none",
      userSelect: "none",
    });
    document.body.appendChild(badge);
  });

  console.log("[nc-custom] v2.0 active — XHR + fetch + WebSocket patched");
  console.log(
    `[nc-custom]   HTTP: ${REAL_ORIGINS.join(" | ")} → ${MATCHMAKING_ORIGIN}`,
  );
  console.log(`[nc-custom]   WS:   *.nitroclash.io → ${LOCAL_WS}`);
})();
