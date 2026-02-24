// ==UserScript==
// @name         NitroClash PIXI/Planck Hook (Option 4 - External Observer)
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Hooks into Planck.js to detect ball-player, player-player, and ball-wall collisions. Shows overlay.
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // Constants (from physics_base.py)
  // ============================================================

  const PLAYER_RADIUS = 0.6103515625;
  const BALL_RADIUS = 0.9765625;
  const COLLISION_THRESHOLD = 0.001;
  const EVENT_LINGER_MS = 3000; // How long touch events stay visible in the overlay

  // Wall segments - flat coordinate pairs from MAP_BORDERS
  const MAP_BORDERS = [
    [4.345703,23.4375,7.8125,23.4375,8.747321,23.065054,9.35389,22.033329,9.3727455,21.784855,9.375,15.625,9.419886,14.341579,9.554507,13.087652,9.77882,11.872826,10.092774,10.70671,10.496322,9.598909,10.989413,8.559029,11.572,7.5966754,12.244037,6.721461,13.005472,5.942987,13.856259,5.270861,14.796352,4.7146916,15.825697,4.284084,16.944252,3.988645,18.151962,3.8379812,18.762207,3.819908,34.470215,3.9541852,50.3125,3.880943],
    [95.6543,23.4375,92.1875,23.4375,91.252686,23.065052,90.64611,22.033329,90.62726,21.784855,90.625,15.625,90.58011,14.341579,90.44549,13.087652,90.221176,11.872826,89.90722,10.70671,89.50368,9.598909,89.01059,8.559029,88.427986,7.5966754,87.75597,6.721461,86.99453,5.942987,86.14373,5.270861,85.20364,4.7146916,84.17429,4.284084,83.05575,3.988645,81.84804,3.8379812,81.23779,3.819908,65.529785,3.9541852,49.6875,3.880943],
    [4.345703,32.8125,7.8125,32.8125,8.747321,33.18495,9.35389,34.21667,9.3727455,34.465145,9.375,40.625,9.419886,41.90842,9.554507,43.162342,9.77882,44.377174,10.0927725,45.543278,10.49632,46.651093,10.989413,47.690975,11.572,48.65332,12.244035,49.528538,13.005472,50.30701,13.856258,50.979137,14.796349,51.535305,15.825697,51.965916,16.94425,52.261356,18.151962,52.412018,18.762207,52.430096,34.470215,52.29581,50.3125,52.369057],
    [95.6543,32.8125,92.1875,32.8125,91.252686,33.18495,90.64611,34.21667,90.62726,34.465145,90.625,40.625,90.58011,41.90842,90.44549,43.162342,90.221176,44.377174,89.90721,45.543278,89.50368,46.651093,89.01059,47.690975,88.42799,48.65332,87.75596,49.528538,86.99452,50.30701,86.14374,50.979137,85.20364,51.535305,84.1743,51.965916,83.05575,52.261356,81.84804,52.412018,81.23779,52.430096,65.529785,52.29581,49.6875,52.369057],
    [4.375,23.4375,4.375,32.8125],
    [95.50781,23.4375,95.50781,32.8125],
  ];

  // Parse into line segments: [{x1,y1,x2,y2}, ...]
  const WALL_SEGMENTS = [];
  for (const border of MAP_BORDERS) {
    for (let i = 0; i < border.length - 2; i += 2) {
      WALL_SEGMENTS.push({ x1: border[i], y1: border[i+1], x2: border[i+2], y2: border[i+3] });
    }
  }

  // ============================================================
  // Physics helpers (ported from physics_base.py)
  // ============================================================

  function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function ballToPlayerDist(bx, by, px, py) {
    return Math.hypot(px - bx, py - by) - BALL_RADIUS - PLAYER_RADIUS;
  }

  function playerToPlayerDist(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2) - 2 * PLAYER_RADIUS;
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
  // Classify bodies by fixture radius
  // ============================================================

  function classifyBodies() {
    if (!planckWorld) return null;

    const players = [];
    const balls = [];

    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic()) continue;
      const fixture = body.getFixtureList();
      if (!fixture) continue;
      const shape = fixture.getShape();
      if (!shape || shape.getType() !== "circle") continue;

      const radius = shape.getRadius();
      const pos = body.getPosition();
      const vel = body.getLinearVelocity();

      if (Math.abs(radius - PLAYER_RADIUS) < 0.05) {
        players.push({ pos, vel, radius });
      } else if (Math.abs(radius - BALL_RADIUS) < 0.2) {
        balls.push({ pos, vel, radius });
      }
    }

    return { players, balls };
  }

  // ============================================================
  // Collision detection (mirrors preprocess_frame_physics)
  // ============================================================

  function detectCollisions(players, balls) {
    const events = [];
    if (balls.length === 0) return events;

    const ball = balls[0];
    const bx = ball.pos.x, by = ball.pos.y;
    const teamSize = Math.floor(players.length / 2);

    // Ball-player collisions
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const dist = ballToPlayerDist(bx, by, p.pos.x, p.pos.y);
      if (dist < COLLISION_THRESHOLD) {
        const team = i < teamSize ? "Blue" : "Red";
        const idx = i < teamSize ? i : i - teamSize;
        events.push(`Ball <> ${team} P${idx}`);
      }
    }

    // Player-player collisions
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const dist = playerToPlayerDist(
          players[i].pos.x, players[i].pos.y,
          players[j].pos.x, players[j].pos.y
        );
        if (dist < COLLISION_THRESHOLD) {
          const teamI = i < teamSize ? "Blue" : "Red";
          const idxI = i < teamSize ? i : i - teamSize;
          const teamJ = j < teamSize ? "Blue" : "Red";
          const idxJ = j < teamSize ? j : j - teamSize;
          events.push(`${teamI} P${idxI} <> ${teamJ} P${idxJ}`);
        }
      }
    }

    // Ball-wall collisions
    for (let i = 0; i < WALL_SEGMENTS.length; i++) {
      const s = WALL_SEGMENTS[i];
      const dist = pointToSegmentDistance(bx, by, s.x1, s.y1, s.x2, s.y2) - BALL_RADIUS;
      if (dist < COLLISION_THRESHOLD) {
        events.push(`Ball <> Wall`);
        break; // one "Ball <> Wall" is enough for the overlay
      }
    }

    return events;
  }

  // ============================================================
  // Event log — keeps recent touch events visible for a few seconds
  // ============================================================

  // Each entry: { text: string, timestamp: number }
  const eventLog = [];
  // Track which collisions were active last frame so we only log new ones
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

    // Prune old entries
    while (eventLog.length > 0 && now - eventLog[0].timestamp > EVENT_LINGER_MS) {
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

    const { players, balls } = result;
    const teamSize = Math.floor(players.length / 2);
    const ball = balls[0];

    // Build position lines
    const lines = [];

    if (ball) {
      const spd = Math.hypot(ball.vel.x, ball.vel.y) * 5;
      lines.push(`Ball  (${ball.pos.x.toFixed(1)}, ${ball.pos.y.toFixed(1)})  ${spd.toFixed(0)} km/h`);
    }

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const team = i < teamSize ? "B" : "R";
      const idx = i < teamSize ? i : i - teamSize;
      const spd = Math.hypot(p.vel.x, p.vel.y) * 5;
      lines.push(`${team}${idx}    (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)})  ${spd.toFixed(0)} km/h`);
    }

    // Detect collisions and log new ones
    const collisions = detectCollisions(players, balls);
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
