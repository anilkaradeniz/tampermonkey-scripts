// ==UserScript==
// @name         NitroClash PIXI/Planck Hook (Option 4 - External Observer)
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Hooks into Planck.js contact events to detect collisions. Shows overlay + red circles at contact points.
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

  const EVENT_LINGER_MS = 3000; // How long contact markers + log entries stay visible
  const CONTACT_CIRCLE_RADIUS = 0.5; // Radius of the red circle in world units

  // ============================================================
  // Planck world capture + contact listener
  // ============================================================

  let planckWorld = null;
  let hooked = false;
  let contactListenerInstalled = false;

  // Active contacts: key -> true (while touching)
  const activeContacts = new Map();
  // Event log for overlay display
  const eventLog = [];
  // Contact point markers: { graphic, timestamp }
  const contactMarkers = [];

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
  // PIXI stage capture — hook renderer.render() to find the stage
  // and the game-world container A (where ball/player sprites live)
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

    // Hook both WebGL and Canvas renderer render() methods
    const rendererTypes = [
      PIXI.WebGLRenderer && PIXI.WebGLRenderer.prototype,
      PIXI.CanvasRenderer && PIXI.CanvasRenderer.prototype,
    ].filter(Boolean);

    for (const proto of rendererTypes) {
      const origRender = proto.render;
      proto.render = function (stage, ...args) {
        if (stage && stage !== pixiStage) {
          pixiStage = stage;
          gameWorldContainer = null; // reset — will re-discover
          console.log("[NC-Hook] Captured PIXI stage");
        }
        return origRender.call(this, stage, ...args);
      };
    }

    pixiHooked = true;
    console.log("[NC-Hook] PIXI renderer hooks installed");
  }

  // Find the game-world container A by looking for a child whose
  // position matches the ball's Planck position.
  function findGameWorldContainer() {
    if (gameWorldContainer) return gameWorldContainer;
    if (!pixiStage || !planckWorld) return null;

    // Get ball body position
    let ballPos = null;
    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic()) continue;
      const f = body.getFixtureList();
      if (!f) continue;
      const s = f.getShape();
      if (!s || s.getType() !== "circle") continue;
      // Ball is the non-player radius (fewer of them)
      ballPos = body.getPosition();
    }
    if (!ballPos) return null;

    // BFS through PIXI stage to find a Container that has a child
    // sprite at approximately the ball's world position
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
          // This child's parent is the game world container
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
  // Body classification — label a body as "Ball", "Blue P0", "Wall", etc.
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

  function contactKey(labelA, labelB) {
    return labelA < labelB
      ? `${labelA} <> ${labelB}`
      : `${labelB} <> ${labelA}`;
  }

  // ============================================================
  // Contact listener — begin/end + spawn red circles at contact points
  // ============================================================

  function getContactWorldPoint(contact) {
    // Try getWorldManifold for accurate contact point
    try {
      const wm = contact.getWorldManifold(null);
      if (wm && wm.points && wm.points.length > 0) {
        return { x: wm.points[0].x, y: wm.points[0].y };
      }
    } catch (_) {}

    // Fallback: midpoint between the two bodies
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

      // Spawn red circle at contact point
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
  // Classify bodies for position display (reuses label cache)
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

      entries.push({ label, pos, spd, radius });
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
      left: "50%",
      transform: "translateX(-50%)",
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

  function ensureOverlay() {
    if (!overlayEl || !document.body.contains(overlayEl)) {
      if (document.body) createOverlay();
    }
  }

  // ============================================================
  // Main loop — renders overlay + manages contact marker lifecycle
  // ============================================================

  function tick() {
    requestAnimationFrame(tick);
    ensureOverlay();
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
        `${e.label}${rStr}${pad}  (${e.pos.x.toFixed(1)}, ${e.pos.y.toFixed(1)})  ${e.spd.toFixed(0)} km/h`,
      );
    }

    if (activeContacts.size > 0) {
      lines.push("--- active ---");
      for (const key of activeContacts.keys()) {
        lines.push(key);
      }
    }

    // Prune old event log entries
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
        lines.push(`${e.text}  (${age}s ago)`);
      }
    }

    overlayEl.textContent = lines.join("\n");
  }

  // ============================================================
  // Bootstrap
  // ============================================================

  hookPlanck();
  hookPIXI();
  requestAnimationFrame(tick);
  console.log("[NC-Hook] NitroClash PIXI/Planck observer loaded.");
})();
