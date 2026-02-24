// ==UserScript==
// @name         NitroClash PIXI/Planck Hook (Option 4 - External Observer)
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Hooks into Planck.js contact events to detect collisions. Shows overlay.
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

  const EVENT_LINGER_MS = 3000; // How long touch events stay visible in the overlay

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
  // Body classification — label a body as "Ball", "Blue P0", "Wall", etc.
  // ============================================================

  // Cache: body -> label (rebuilt when body list changes)
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

    // Most frequent radius = player, outlier = ball
    const radiusCounts = {};
    for (const c of circles) {
      const key = c.radius.toFixed(6);
      radiusCounts[key] = (radiusCounts[key] || 0) + 1;
    }
    let playerRadiusKey = null;
    let maxCount = 0;
    for (const [key, count] of Object.entries(radiusCounts)) {
      if (count > maxCount) { maxCount = count; playerRadiusKey = key; }
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

    const teamSize = Math.floor(players.length / 2);
    for (let i = 0; i < players.length; i++) {
      const team = i < teamSize ? "Blue" : "Red";
      const idx = i < teamSize ? i : i - teamSize;
      bodyLabelCache.set(players[i], `${team} P${idx}`);
    }

    // Label static bodies as "Wall"
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
    // Consistent ordering so "Ball <> Blue P0" == "Blue P0 <> Ball"
    return labelA < labelB ? `${labelA} <> ${labelB}` : `${labelB} <> ${labelA}`;
  }

  // ============================================================
  // Contact listener via Planck post-solve / begin-contact / end-contact
  // ============================================================

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
  // Main loop — renders overlay every frame
  // ============================================================

  function tick() {
    requestAnimationFrame(tick);
    ensureOverlay();
    if (!overlayEl) return;

    const entries = getPositions();
    if (!entries || entries.length === 0) {
      overlayEl.textContent = "[NC-Hook] No game active";
      return;
    }

    const lines = [];

    // Positions
    for (const e of entries) {
      const rStr = e.label === "Ball" && e.radius ? ` r=${e.radius.toFixed(3)}` : "";
      const pad = e.label === "Ball" ? " " : "";
      lines.push(
        `${e.label}${rStr}${pad}  (${e.pos.x.toFixed(1)}, ${e.pos.y.toFixed(1)})  ${e.spd.toFixed(0)} km/h`,
      );
    }

    // Active contacts (currently touching)
    if (activeContacts.size > 0) {
      lines.push("--- active ---");
      for (const key of activeContacts.keys()) {
        lines.push(key);
      }
    }

    // Recent contact events (with age)
    const now = Date.now();
    // Prune old entries
    while (eventLog.length > 0 && now - eventLog[0].timestamp > EVENT_LINGER_MS) {
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
  requestAnimationFrame(tick);
  console.log("[NC-Hook] NitroClash PIXI/Planck observer loaded.");
})();
