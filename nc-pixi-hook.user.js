// ==UserScript==
// @name         NitroClash PIXI/Planck Hook (Option 4 - External Observer)
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  Hooks into Planck.js contacts + WebSocket game events (goals, kickoffs, actions). Two overlays.
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // Constants
  // ============================================================

  const EVENT_LINGER_MS = 7000; // How long contact markers + log entries stay visible
  const CONTACT_CIRCLE_RADIUS = 0.5; // Radius of the red circle in world units

  // ============================================================
  // Planck world capture + contact listener
  // ============================================================

  let planckWorld = null;
  let hooked = false;
  let contactListenerInstalled = false;

  const activeContacts = new Map();
  const eventLog = [];
  const contactMarkers = [];

  // ============================================================
  // Game events from WebSocket
  // ============================================================

  const ACTION_NAMES = [
    "Goal",
    "Assist",
    "Save",
    "Long Goal",
    "OT Goal",
    "Hat Trick",
    "Shot On Goal",
    "Center Ball",
    "Clear Ball",
    "First Touch",
    "Victory",
  ];

  const gameEventLog = [];
  const wsIndexToBody = new Map(); // WS player index → Planck body

  function hookPlanck() {
    if (hooked) return;
    if (typeof window.planck === "undefined") {
      setTimeout(hookPlanck, 500);
      return;
    }

    console.log("[NC-Hook] planck.js detected, installing hooks...");
    const origStep = window.planck.World.prototype.step;
    window.planck.World.prototype.step = function (...args) {
      if (!planckWorld || planckWorld !== this) {
        planckWorld = this;
        contactListenerInstalled = false;
        console.log("[NC-Hook] Captured planck World instance");
      }
      if (!contactListenerInstalled) {
        installContactListener();
      }
      return origStep.apply(this, args);
    };
    hooked = true;
  }

  // ============================================================
  // PIXI stage capture
  // ============================================================

  let pixiStage = null;
  let gameWorldContainer = null;
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
          gameWorldContainer = null;
          console.log("[NC-Hook] Captured PIXI stage");
        }
        return origRender.call(this, stage, ...args);
      };
    }

    pixiHooked = true;
    console.log("[NC-Hook] PIXI renderer hooks installed");
  }

  function findGameWorldContainer() {
    if (gameWorldContainer) return gameWorldContainer;
    if (!pixiStage || !planckWorld) return null;

    let ballPos = null;
    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic()) continue;
      const f = body.getFixtureList();
      if (!f) continue;
      const s = f.getShape();
      if (!s || s.getType() !== "circle") continue;
      ballPos = body.getPosition();
    }
    if (!ballPos) return null;

    const queue = [pixiStage];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node.children) continue;
      for (const child of node.children) {
        if (
          child.visible !== false &&
          typeof child.x === "number" &&
          Math.abs(child.x - ballPos.x) < 2 &&
          Math.abs(child.y - ballPos.y) < 2
        ) {
          gameWorldContainer = node;
          console.log("[NC-Hook] Found game world PIXI container");
          return gameWorldContainer;
        }
        if (child.children && child.children.length > 0) {
          queue.push(child);
        }
      }
    }
    return null;
  }

  // ============================================================
  // Player name resolution — find PIXI.Text objects in the stage
  // and match them to Planck body positions
  // ============================================================

  // body -> display name string (refreshed each frame in tick)
  const bodyNameCache = new Map();
  const idNameCache = new Map(); // internal ID label (e.g. "Blue P0") → display name (e.g. "Alice")
  // body that belongs to the local player
  let localPlayerBody = null;

  function refreshPlayerNames() {
    bodyNameCache.clear();
    localPlayerBody = null;
    if (!pixiStage || !planckWorld) return;

    // Collect all PIXI.Text nodes from the stage tree
    const textNodes = [];
    const queue = [pixiStage];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node.children) continue;
      for (const child of node.children) {
        // PIXI.Text instances have a .text property and a .style with fontFamily
        if (
          child.text != null &&
          typeof child.text === "string" &&
          child.text.length > 0 &&
          child.style &&
          child.style.fontFamily
        ) {
          textNodes.push(child);
        }
        if (child.children && child.children.length > 0) {
          queue.push(child);
        }
      }
    }

    if (textNodes.length === 0) return;

    // Match each player body to the nearest PIXI.Text by position
    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic()) continue;
      const label = bodyLabelCache.get(body);
      if (!label || label === "Ball" || label === "Wall" || label === "?")
        continue;

      const pos = body.getPosition();
      let bestDist = Infinity;
      let bestNode = null;

      for (const tn of textNodes) {
        const dx = tn.x - pos.x;
        const dy = tn.y - pos.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestNode = tn;
        }
      }

      // Only accept if reasonably close (nametags are right above the player)
      if (bestNode && bestDist < 25) {
        // ~5 world units
        bodyNameCache.set(body, bestNode.text);
        idNameCache.set(label, bestNode.text);

        // The local player's nametag has fill = "#ffffff" (white), others are "#000000"
        const fill = bestNode.style && bestNode.style.fill;
        if (fill === "#ffffff" || fill === 0xffffff || fill === "white") {
          localPlayerBody = body;
        }
      }
    }
  }

  // ============================================================
  // Body classification — internal IDs for logic
  // ============================================================

  let bodyLabelCache = new Map();
  let lastBodyCount = -1;

  function rebuildBodyLabels() {
    if (!planckWorld) return;

    const circles = [];
    let bodyCount = 0;

    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      bodyCount++;
      if (!body.isDynamic()) continue;
      const fixture = body.getFixtureList();
      if (!fixture) continue;
      const shape = fixture.getShape();
      if (!shape || shape.getType() !== "circle") continue;
      circles.push({ body, radius: shape.getRadius() });
    }

    if (bodyCount === lastBodyCount) return;
    lastBodyCount = bodyCount;
    bodyLabelCache = new Map();

    if (circles.length === 0) return;

    const radiusCounts = {};
    for (const c of circles) {
      const key = c.radius.toFixed(6);
      radiusCounts[key] = (radiusCounts[key] || 0) + 1;
    }
    let playerRadiusKey = null;
    let maxCount = 0;
    for (const [key, count] of Object.entries(radiusCounts)) {
      if (count > maxCount) {
        maxCount = count;
        playerRadiusKey = key;
      }
    }
    const playerRadius = parseFloat(playerRadiusKey);

    const players = [];
    for (const c of circles) {
      if (Math.abs(c.radius - playerRadius) < 0.01) {
        players.push(c.body);
      } else {
        bodyLabelCache.set(c.body, "Ball");
      }
    }

    // Order is interleaved: blue0, red0, blue1, red1, ...
    for (let i = 0; i < players.length; i++) {
      const team = i % 2 === 0 ? "Blue" : "Red";
      const idx = Math.floor(i / 2);
      bodyLabelCache.set(players[i], `${team} P${idx}`);
    }

    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic() && !bodyLabelCache.has(body)) {
        bodyLabelCache.set(body, "Wall");
      }
    }
  }

  function labelBody(body) {
    return bodyLabelCache.get(body) || "?";
  }

  // Display label: use player name if available, fall back to ID. Append (You) for local player.
  function displayLabel(body) {
    const label = labelBody(body);
    if (label === "Ball" || label === "Wall" || label === "?") return label;
    const name = bodyNameCache.get(body);
    const base = name || label;
    return body === localPlayerBody ? `${base} (You)` : base;
  }

  function contactKey(labelA, labelB) {
    return labelA < labelB
      ? `${labelA} <> ${labelB}`
      : `${labelB} <> ${labelA}`;
  }

  // Build a display key using names, from the internal key
  function displayKey(internalKey) {
    // internalKey is "LabelA <> LabelB" using internal IDs
    // Look up each body's display name
    const parts = internalKey.split(" <> ");
    const displayParts = parts.map((idLabel) => {
      // Find body with this label
      for (const [body, label] of bodyLabelCache.entries()) {
        if (label === idLabel) {
          return displayLabel(body);
        }
      }
      return idLabel;
    });
    return displayParts.join(" <> ");
  }

  // ============================================================
  // Contact listener — begin/end + spawn red circles at contact points
  // ============================================================

  function getContactWorldPoint(contact) {
    try {
      const wm = contact.getWorldManifold(null);
      if (wm && wm.points && wm.points.length > 0) {
        return { x: wm.points[0].x, y: wm.points[0].y };
      }
    } catch (_) {}

    const bodyA = contact.getFixtureA().getBody();
    const bodyB = contact.getFixtureB().getBody();
    const posA = bodyA.getPosition();
    const posB = bodyB.getPosition();
    return { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
  }

  function spawnContactCircle(x, y) {
    const container = findGameWorldContainer();
    if (!container || typeof PIXI === "undefined") return;

    const g = new PIXI.Graphics();
    g.beginFill(0xff0000, 0.6);
    g.drawCircle(0, 0, CONTACT_CIRCLE_RADIUS);
    g.endFill();
    g.x = x;
    g.y = y;
    container.addChild(g);

    contactMarkers.push({ graphic: g, timestamp: Date.now() });
  }

  function installContactListener() {
    if (!planckWorld || contactListenerInstalled) return;

    planckWorld.on("begin-contact", function (contact) {
      const bodyA = contact.getFixtureA().getBody();
      const bodyB = contact.getFixtureB().getBody();
      rebuildBodyLabels();
      const labelA = labelBody(bodyA);
      const labelB = labelBody(bodyB);
      const key = contactKey(labelA, labelB);

      activeContacts.set(key, true);
      eventLog.push({ text: key, timestamp: Date.now() });

      const pt = getContactWorldPoint(contact);
      spawnContactCircle(pt.x, pt.y);
    });

    planckWorld.on("end-contact", function (contact) {
      const bodyA = contact.getFixtureA().getBody();
      const bodyB = contact.getFixtureB().getBody();
      const labelA = labelBody(bodyA);
      const labelB = labelBody(bodyB);
      const key = contactKey(labelA, labelB);

      activeContacts.delete(key);
    });

    contactListenerInstalled = true;
    console.log("[NC-Hook] Contact listeners installed on Planck world");
  }

  // ============================================================
  // Boundary brake rules — force brake when player violates zones
  // ============================================================

  const boundaryRules = {
    circle: { enabled: true, cx: 50, cy: 28.125, radius: 40 - 28.125 },
    halfline: { enabled: true, x: 50 },
  };

  // Returns true (force brake), false (force release), or null (no opinion).
  function checkCircleBoundary(px, py, angle) {
    const c = boundaryRules.circle;
    if (!c.enabled) return null;

    const dx = c.cx - px;
    const dy = c.cy - py;
    const distSq = dx * dx + dy * dy;
    if (distSq >= c.radius * c.radius) return null; // outside — pass through

    // Dot product of aim direction with player→center vector
    const dot = Math.cos(angle) * dx + Math.sin(angle) * dy;
    return dot > 0; // true = aiming inward → brake, false = aiming outward → release
  }

  // Returns true (force brake), false (force release), or null (no opinion).
  function checkHalflineBoundary(px, py, angle) {
    const h = boundaryRules.halfline;
    if (!h.enabled) return null;
    if (!localPlayerBody) return null;

    const label = bodyLabelCache.get(localPlayerBody);
    if (!label) return null;

    const isBlue = label.startsWith("Blue");
    const inViolation = isBlue ? px > h.x : px < h.x;
    if (!inViolation) return null;

    const aimX = Math.cos(angle);
    const aimingDeeper = isBlue ? aimX > 0 : aimX < 0;
    return aimingDeeper; // true = going deeper → brake, false = retreating → release
  }

  // Set by the send hook so the overlay can reflect current state
  let lastBrakeOverride = false;

  // Combine all active boundary rules. Returns the brake value to send.
  function applyBoundaryBrake(angle, originalBrake) {
    if (!localPlayerBody) return originalBrake;

    const pos = localPlayerBody.getPosition();
    const checks = [
      checkCircleBoundary(pos.x, pos.y, angle),
      checkHalflineBoundary(pos.x, pos.y, angle),
    ];

    // Any boundary forcing brake wins
    for (const c of checks) {
      if (c === true) return true;
    }
    // Any boundary actively releasing (player aiming to escape) → release
    for (const c of checks) {
      if (c === false) return false;
    }
    // No boundary has an opinion — pass through original input
    return originalBrake;
  }

  // ============================================================
  // WebSocket hook — intercept game events from server
  // ============================================================

  // Build WS player index → Planck body mapping using positions from type 7 message.
  // Our addEventListener fires AFTER the game's handler, so bodies already have
  // the positions from the binary data — we match by reading the same floats.
  function buildWsIndexMapping(d) {
    wsIndexToBody.clear();
    if (!planckWorld) return;
    rebuildBodyLabels();

    // Collect player bodies (not ball, not wall)
    const playerBodies = [];
    for (const [body, label] of bodyLabelCache.entries()) {
      if (label !== "Ball" && label !== "Wall" && label !== "?") {
        playerBodies.push(body);
      }
    }
    if (playerBodies.length === 0) return;

    const numPlayers = playerBodies.length;
    for (let t = 0; t < numPlayers; t++) {
      const off = 15 + 29 * t;
      if (off + 8 > d.byteLength) break;
      const wx = d.getFloat32(off);
      const wy = d.getFloat32(off + 4);

      let bestBody = null;
      let bestDist = Infinity;
      for (const body of playerBodies) {
        const pos = body.getPosition();
        const dx = pos.x - wx;
        const dy = pos.y - wy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestBody = body;
        }
      }
      if (bestBody && bestDist < 1) {
        wsIndexToBody.set(t, bestBody);
      }
    }
    console.log(
      "[NC-Hook] WS index→body mapping:",
      wsIndexToBody.size,
      "players",
    );
  }

  function resolvePlayerIndex(idx) {
    if (idx === 255) return null;
    const body = wsIndexToBody.get(idx);
    if (body) return displayLabel(body);
    console.log(`[NC-Hook] cache`, bodyLabelCache);

    return `P${idx} - ${bodyLabelCache.values()[idx]}`;
  }

  function handleGameMessage(d) {
    const type = d.getUint8(0);
    const now = Date.now();

    switch (type) {
      case 7: {
        // Game start — match WS player indices to Planck bodies by position
        buildWsIndexMapping(d);
        break;
      }
      case 6: {
        // Goal scored
        if (d.byteLength < 12) break;
        const team = d.getUint8(5);
        const scorerIdx = d.getUint8(6);
        const assistIdx = d.getUint8(7);
        const speed = Math.ceil(d.getFloat32(8) * 5);
        const teamName = team === 0 ? "Blue" : "Red";
        const scorer = resolvePlayerIndex(scorerIdx);
        let text = `GOAL! ${scorer} (${teamName}) ${speed} km/h`;
        const assister = resolvePlayerIndex(assistIdx);
        if (assister) text += ` [assist: ${assister}]`;
        gameEventLog.push({ text, timestamp: now });
        break;
      }
      case 9: {
        // Kickoff / restart
        if (d.byteLength < 5) break;
        const turn = d.getInt32(1);
        const text = turn === 0 ? "MATCH START" : "KICKOFF";
        gameEventLog.push({ text, timestamp: now });
        break;
      }
      case 15: {
        // Player action
        if (d.byteLength < 5) break;
        const playerIdx = d.getUint8(1);
        const actionType = d.getUint8(2);
        const points = d.getInt16(3);
        // Skip Goal/Assist — type 6 already provides richer info
        if (actionType === 0 || actionType === 1) break;
        const player = resolvePlayerIndex(playerIdx);
        const action = ACTION_NAMES[actionType] || `Action(${actionType})`;
        let text = `${action}: ${player}`;
        if (points) text += ` (+${points}pts)`;
        gameEventLog.push({ text, timestamp: now });
        break;
      }
      case 8:
      case 14: {
        // Match end
        if (d.byteLength < 5) break;
        const blueScore = d.getInt16(1);
        const redScore = d.getInt16(3);
        const text = `MATCH OVER — Blue ${blueScore} : ${redScore} Red`;
        gameEventLog.push({ text, timestamp: now });
        break;
      }
    }
  }

  function hookWebSocket() {
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (...args) {
      if (!this._ncHooked) {
        this._ncHooked = true;
        this.addEventListener("message", function (e) {
          if (!(e.data instanceof ArrayBuffer) || e.data.byteLength < 1) return;
          try {
            handleGameMessage(new DataView(e.data));
          } catch (_) {}
        });
        console.log("[NC-Hook] WebSocket intercepted for game events");
      }

      // Intercept outgoing input messages (type 2, 12 bytes)
      const data = args[0];
      if (data instanceof ArrayBuffer && data.byteLength === 12) {
        const view = new DataView(data);
        if (view.getUint8(0) === 2) {
          const angle = view.getFloat32(1);
          const flags = view.getUint8(5);
          const boost = (flags & 1) !== 0;
          const brake = (flags & 2) !== 0;
          const newBrake = applyBoundaryBrake(angle, brake);
          lastBrakeOverride = newBrake && !brake; // true only when we forced brake on
          if (newBrake !== brake) {
            view.setUint8(5, (boost ? 1 : 0) + (newBrake ? 2 : 0));
          }
        }
      }

      return origSend.apply(this, args);
    };
  }

  // ============================================================
  // Classify bodies for position display
  // ============================================================

  function getPositions() {
    if (!planckWorld) return null;
    rebuildBodyLabels();

    const entries = [];
    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic()) continue;
      const label = labelBody(body);
      if (label === "?") continue;
      const pos = body.getPosition();
      const vel = body.getLinearVelocity();
      const spd = Math.hypot(vel.x, vel.y) * 5;

      let radius = null;
      const fixture = body.getFixtureList();
      if (fixture) {
        const shape = fixture.getShape();
        if (shape && shape.getType() === "circle") radius = shape.getRadius();
      }

      const display = displayLabel(body);
      entries.push({ label, display, pos, spd, radius });
    }

    return entries;
  }

  // ============================================================
  // Overlay
  // ============================================================

  let overlayEl = null;

  function createOverlay() {
    overlayEl = document.createElement("div");
    overlayEl.id = "nc-hook-overlay";
    Object.assign(overlayEl.style, {
      position: "fixed",
      top: "4px",
      left: "4px",
      // transform: "translateX(-50%)",
      zIndex: "999999",
      background: "rgba(0,0,0,0.7)",
      color: "#0f0",
      fontFamily: "monospace",
      fontSize: "13px",
      padding: "4px 12px",
      borderRadius: "4px",
      pointerEvents: "none",
      whiteSpace: "pre",
      lineHeight: "1.4",
    });
    overlayEl.textContent = "[NC-Hook] Waiting for game...";
    document.body.appendChild(overlayEl);
  }

  let eventsOverlayEl = null;

  function createEventsOverlay() {
    eventsOverlayEl = document.createElement("div");
    eventsOverlayEl.id = "nc-events-overlay";
    Object.assign(eventsOverlayEl.style, {
      position: "fixed",
      top: "4px",
      right: "4px",
      zIndex: "999999",
      background: "rgba(0,0,0,0.7)",
      color: "#ff0",
      fontFamily: "monospace",
      fontSize: "13px",
      padding: "4px 12px",
      borderRadius: "4px",
      pointerEvents: "none",
      whiteSpace: "pre",
      lineHeight: "1.4",
    });
    document.body.appendChild(eventsOverlayEl);
  }

  let brakeOverlayEl = null;

  function createBrakeOverlay() {
    brakeOverlayEl = document.createElement("div");
    brakeOverlayEl.id = "nc-brake-overlay";
    Object.assign(brakeOverlayEl.style, {
      position: "fixed",
      top: "4px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "999999",
      background: "rgba(200,0,0,0.85)",
      color: "#fff",
      fontFamily: "monospace",
      fontWeight: "bold",
      fontSize: "18px",
      padding: "6px 18px",
      borderRadius: "4px",
      pointerEvents: "none",
      display: "none",
    });
    brakeOverlayEl.textContent = "SHOULD BRAKE";
    document.body.appendChild(brakeOverlayEl);
  }

  function ensureOverlay() {
    if (!overlayEl || !document.body.contains(overlayEl)) {
      if (document.body) createOverlay();
    }
    if (!eventsOverlayEl || !document.body.contains(eventsOverlayEl)) {
      if (document.body) createEventsOverlay();
    }
    if (!brakeOverlayEl || !document.body.contains(brakeOverlayEl)) {
      if (document.body) createBrakeOverlay();
    }
  }

  // ============================================================
  // Main loop — renders overlay + manages contact marker lifecycle
  // ============================================================

  function tick() {
    requestAnimationFrame(tick);
    ensureOverlay();
    if (brakeOverlayEl) {
      brakeOverlayEl.style.display = lastBrakeOverride ? "" : "none";
    }
    if (!overlayEl) return;

    const now = Date.now();

    // Expire old contact markers
    while (
      contactMarkers.length > 0 &&
      now - contactMarkers[0].timestamp > EVENT_LINGER_MS
    ) {
      const old = contactMarkers.shift();
      if (old.graphic.parent) {
        old.graphic.parent.removeChild(old.graphic);
      }
      old.graphic.destroy();
    }

    // Fade markers as they age
    for (const m of contactMarkers) {
      const age = now - m.timestamp;
      m.graphic.alpha = Math.max(0, 1 - age / EVENT_LINGER_MS);
    }

    // Refresh player names from PIXI.Text nodes each frame
    refreshPlayerNames();

    // Expire old game events + render game events overlay
    while (
      gameEventLog.length > 0 &&
      now - gameEventLog[0].timestamp > EVENT_LINGER_MS
    ) {
      gameEventLog.shift();
    }
    if (eventsOverlayEl) {
      if (gameEventLog.length > 0) {
        const gLines = ["--- game events ---"];
        for (const ge of gameEventLog) {
          const age = ((now - ge.timestamp) / 1000).toFixed(1);
          gLines.push(`${ge.text}  (${age}s ago)`);
        }
        eventsOverlayEl.textContent = gLines.join("\n");
        eventsOverlayEl.style.display = "";
      } else {
        eventsOverlayEl.style.display = "none";
      }
    }

    const entries = getPositions();
    if (!entries || entries.length === 0) {
      overlayEl.textContent = "[NC-Hook] No game active";
      return;
    }

    const lines = [];

    for (const e of entries) {
      const rStr =
        e.label === "Ball" && e.radius ? ` r=${e.radius.toFixed(3)}` : "";
      const pad = e.label === "Ball" ? " " : "";
      lines.push(
        `${e.display}${rStr}${pad}  (${e.pos.x.toFixed(1)}, ${e.pos.y.toFixed(1)})  ${e.spd.toFixed(0)} km/h`,
      );
    }

    if (activeContacts.size > 0) {
      lines.push("--- active ---");
      for (const key of activeContacts.keys()) {
        lines.push(displayKey(key));
      }
    }

    while (
      eventLog.length > 0 &&
      now - eventLog[0].timestamp > EVENT_LINGER_MS
    ) {
      eventLog.shift();
    }
    if (eventLog.length > 0) {
      lines.push("--- recent contacts ---");
      for (const e of eventLog) {
        const age = ((now - e.timestamp) / 1000).toFixed(1);
        lines.push(`${displayKey(e.text)}  (${age}s ago)`);
      }
    }

    overlayEl.textContent = lines.join("\n");
  }

  // ============================================================
  // Bootstrap
  // ============================================================

  hookWebSocket();
  hookPlanck();
  hookPIXI();
  requestAnimationFrame(tick);

  // Expose boundary config for console control
  window.ncBoundary = boundaryRules;

  console.log("[NC-Hook] NitroClash PIXI/Planck observer loaded.");
  console.log("[NC-Hook] Boundary rules: window.ncBoundary");
  console.log(
    "[NC-Hook]   Circle:   ncBoundary.circle = { enabled, cx, cy, radius }",
  );
  console.log("[NC-Hook]   Halfline: ncBoundary.halfline = { enabled, x }");
})();
