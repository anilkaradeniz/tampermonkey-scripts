// ==UserScript==
// @name         NitroClash PIXI/Planck Hook (Option 4 - External Observer)
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Hooks into Planck.js to detect ball-player, player-player, and ball-wall collisions. Shows overlay.
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

  const COLLISION_THRESHOLD = 0.001;
  const EVENT_LINGER_MS = 3000; // How long touch events stay visible in the overlay

  // ============================================================
  // Physics helpers (ported from physics_base.py)
  // ============================================================

  function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1,
      dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(
      0,
      Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq),
    );
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // ============================================================
  // Planck world capture
  // ============================================================

  let planckWorld = null;
  let hooked = false;

  function hookPlanck() {
    if (hooked) return;
    if (typeof window.planck === "undefined") {
      setTimeout(hookPlanck, 500);
      return;
    }

    console.log("[NC-Hook] planck.js detected, installing hooks...");
    const origStep = window.planck.World.prototype.step;
    window.planck.World.prototype.step = function (...args) {
      if (!planckWorld) {
        planckWorld = this;
        console.log("[NC-Hook] Captured planck World instance");
      }
      return origStep.apply(this, args);
    };
    hooked = true;
  }

  // ============================================================
  // Extract wall segments from static bodies (planck.Chain fixtures)
  // Cached per world — rebuilt when world changes or walls empty.
  // ============================================================

  let cachedWallSegments = [];
  let wallsExtractedForWorld = null;

  function extractWallSegments() {
    if (!planckWorld) return [];
    if (
      wallsExtractedForWorld === planckWorld &&
      cachedWallSegments.length > 0
    ) {
      return cachedWallSegments;
    }

    const segments = [];
    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (body.isDynamic()) continue; // walls are static

      for (
        let fixture = body.getFixtureList();
        fixture;
        fixture = fixture.getNext()
      ) {
        const shape = fixture.getShape();
        if (!shape) continue;
        const type = shape.getType();

        if (type === "chain") {
          // planck.Chain: m_vertices is the array of Vec2, or use getChildEdge
          const verts = shape.m_vertices;
          if (verts && verts.length >= 2) {
            for (let i = 0; i < verts.length - 1; i++) {
              segments.push({
                x1: verts[i].x,
                y1: verts[i].y,
                x2: verts[i + 1].x,
                y2: verts[i + 1].y,
              });
            }
          }
        } else if (type === "edge") {
          // planck.Edge: m_vertex1, m_vertex2
          if (shape.m_vertex1 && shape.m_vertex2) {
            segments.push({
              x1: shape.m_vertex1.x,
              y1: shape.m_vertex1.y,
              x2: shape.m_vertex2.x,
              y2: shape.m_vertex2.y,
            });
          }
        }
      }
    }

    cachedWallSegments = segments;
    wallsExtractedForWorld = planckWorld;
    if (segments.length > 0) {
      console.log(
        `[NC-Hook] Extracted ${segments.length} wall segments from Planck world`,
      );
    }
    return segments;
  }

  // ============================================================
  // Classify dynamic bodies by fixture radius.
  // Player radius is read from players; ball radius from the ball.
  // ============================================================

  function classifyBodies() {
    if (!planckWorld) return null;

    const circles = [];

    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic()) continue;
      const fixture = body.getFixtureList();
      if (!fixture) continue;
      const shape = fixture.getShape();
      if (!shape || shape.getType() !== "circle") continue;

      circles.push({
        radius: shape.getRadius(),
        pos: body.getPosition(),
        vel: body.getLinearVelocity(),
      });
    }

    if (circles.length === 0) return null;

    // The ball has a unique radius different from players.
    // Find the most common radius (players) — the outlier is the ball.
    const radiusCounts = {};
    for (const c of circles) {
      const key = c.radius.toFixed(6);
      radiusCounts[key] = (radiusCounts[key] || 0) + 1;
    }
    // Most frequent radius = player radius
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
    const balls = [];

    for (const c of circles) {
      if (Math.abs(c.radius - playerRadius) < 0.01) {
        players.push(c);
      } else {
        balls.push(c);
      }
    }

    return { players, balls, playerRadius };
  }

  // ============================================================
  // Collision detection (mirrors preprocess_frame_physics)
  // ============================================================

  function detectCollisions(players, balls, playerRadius) {
    const events = [];
    if (balls.length === 0) return events;

    const ball = balls[0];
    const ballRadius = ball.radius;
    const bx = ball.pos.x,
      by = ball.pos.y;
    const teamSize = Math.floor(players.length / 2);

    // Ball-player collisions
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const dist =
        Math.hypot(p.pos.x - bx, p.pos.y - by) - ballRadius - playerRadius;
      if (dist < COLLISION_THRESHOLD) {
        const team = i < teamSize ? "Blue" : "Red";
        const idx = i < teamSize ? i : i - teamSize;
        events.push(`Ball <> ${team} P${idx}`);
      }
    }

    // Player-player collisions
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const dist =
          Math.hypot(
            players[i].pos.x - players[j].pos.x,
            players[i].pos.y - players[j].pos.y,
          ) -
          2 * playerRadius;
        if (dist < COLLISION_THRESHOLD) {
          const teamI = i < teamSize ? "Blue" : "Red";
          const idxI = i < teamSize ? i : i - teamSize;
          const teamJ = j < teamSize ? "Blue" : "Red";
          const idxJ = j < teamSize ? j : j - teamSize;
          events.push(`${teamI} P${idxI} <> ${teamJ} P${idxJ}`);
        }
      }
    }

    // Ball-wall collisions (from Planck chain fixtures)
    const wallSegments = extractWallSegments();
    for (let i = 0; i < wallSegments.length; i++) {
      const s = wallSegments[i];
      const dist =
        pointToSegmentDistance(bx, by, s.x1, s.y1, s.x2, s.y2) - ballRadius;
      if (dist < COLLISION_THRESHOLD) {
        events.push(`Ball <> Wall`);
        break;
      }
    }

    // Player-wall collisions
    for (let i = 0; i < players.length; i++) {
      const px = players[i].pos.x,
        py = players[i].pos.y;
      for (let j = 0; j < wallSegments.length; j++) {
        const s = wallSegments[j];
        const dist =
          pointToSegmentDistance(px, py, s.x1, s.y1, s.x2, s.y2) - playerRadius;
        if (dist < COLLISION_THRESHOLD) {
          const team = i < teamSize ? "Blue" : "Red";
          const idx = i < teamSize ? i : i - teamSize;
          events.push(`${team} P${idx} <> Wall`);
          break; // one wall hit per player is enough
        }
      }
    }

    return events;
  }

  // ============================================================
  // Event log — keeps recent touch events visible for a few seconds
  // ============================================================

  const eventLog = [];
  let prevCollisionSet = new Set();

  function logNewEvents(collisions) {
    const now = Date.now();
    const currentSet = new Set(collisions);

    for (const c of collisions) {
      if (!prevCollisionSet.has(c)) {
        eventLog.push({ text: c, timestamp: now });
      }
    }
    prevCollisionSet = currentSet;

    while (
      eventLog.length > 0 &&
      now - eventLog[0].timestamp > EVENT_LINGER_MS
    ) {
      eventLog.shift();
    }
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
  // Main loop — runs every frame via requestAnimationFrame
  // ============================================================

  function tick() {
    requestAnimationFrame(tick);
    ensureOverlay();
    if (!overlayEl) return;

    const result = classifyBodies();
    if (!result || (result.players.length === 0 && result.balls.length === 0)) {
      overlayEl.textContent = "[NC-Hook] No game active";
      return;
    }

    const { players, balls, playerRadius } = result;
    const teamSize = Math.floor(players.length / 2);
    const ball = balls[0];

    const lines = [];

    if (ball) {
      const spd = Math.hypot(ball.vel.x, ball.vel.y) * 5;
      lines.push(
        `Ball r=${ball.radius.toFixed(3)}  (${ball.pos.x.toFixed(1)}, ${ball.pos.y.toFixed(1)})  ${spd.toFixed(0)} km/h`,
      );
    }

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const team = i < teamSize ? "B" : "R";
      const idx = i < teamSize ? i : i - teamSize;
      const spd = Math.hypot(p.vel.x, p.vel.y) * 5;
      lines.push(
        `${team}${idx}    (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)})  ${spd.toFixed(0)} km/h`,
      );
    }

    // Detect collisions and log new ones
    const collisions = detectCollisions(players, balls, playerRadius);
    logNewEvents(collisions);

    if (eventLog.length > 0) {
      const now = Date.now();
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
