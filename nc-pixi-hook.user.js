// ==UserScript==
// @name         NitroClash PIXI/Planck Hook (Option 4 - External Observer)
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Hooks into PIXI and Planck.js globals to observe player and ball positions without modifying the game script.
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // How often to print positions (ms)
  const PRINT_INTERVAL = 2000;

  // Game constants (from the script's map config)
  const PLAYER_RADIUS = 0.6103515625;
  const BALL_RADIUS_DEFAULT = 100 / 81.92 / 1.5; // ~0.814

  // ============================================================
  // Strategy: Hook into Planck.js World.step() to get a reference
  // to the physics world, then enumerate all bodies to find
  // players and the ball based on their fixture shapes/sizes.
  // ============================================================

  let planckWorld = null;
  let hooked = false;

  function hookPlanck() {
    if (hooked) return;

    // Wait for planck to be available on window
    if (typeof window.planck === "undefined") {
      setTimeout(hookPlanck, 500);
      return;
    }

    console.log("[NC-Hook] planck.js detected, installing hooks...");

    // Hook World.prototype.step to capture the world instance
    const origStep = window.planck.World.prototype.step;
    window.planck.World.prototype.step = function (...args) {
      if (!planckWorld) {
        planckWorld = this;
        console.log("[NC-Hook] Captured planck World instance");
      }
      return origStep.apply(this, args);
    };

    hooked = true;
    console.log("[NC-Hook] Hooks installed. Waiting for game to start...");
  }

  // ============================================================
  // Classify bodies by their fixture radius
  // ============================================================

  function classifyBodies() {
    if (!planckWorld) return null;

    const players = [];
    const balls = [];
    const other = [];

    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (!body.isDynamic()) continue;

      const fixture = body.getFixtureList();
      if (!fixture) continue;

      const shape = fixture.getShape();
      if (!shape) continue;

      const type = shape.getType();
      const pos = body.getPosition();
      const vel = body.getLinearVelocity();

      if (type === "circle") {
        const radius = shape.getRadius();

        // Classify by radius: players have PLAYER_RADIUS, ball has BALL_RADIUS
        if (Math.abs(radius - PLAYER_RADIUS) < 0.05) {
          players.push({ body, pos, vel, radius });
        } else if (radius > 0.5 && radius < 1.5) {
          // Ball radius varies by game mode but is roughly 0.8-1.0
          balls.push({ body, pos, vel, radius });
        } else {
          other.push({ body, pos, vel, radius, type });
        }
      }
    }

    return { players, balls, other };
  }

  // ============================================================
  // Periodically print positions
  // ============================================================

  function startPositionLogger() {
    setInterval(() => {
      const result = classifyBodies();
      if (!result) {
        console.log("[NC-Hook] No planck world yet...");
        return;
      }

      const { players, balls } = result;

      if (players.length === 0 && balls.length === 0) {
        console.log("[NC-Hook] No dynamic bodies found (not in a game?)");
        return;
      }

      const teamSize = Math.floor(players.length / 2);

      console.group(`[NC-Hook] Positions (${players.length} players, ${balls.length} ball(s))`);

      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const team = i < teamSize ? "Team A" : "Team B";
        const idx = i < teamSize ? i : i - teamSize;
        console.log(
          `  Player ${idx} (${team}): pos(${p.pos.x.toFixed(2)}, ${p.pos.y.toFixed(2)}) vel(${p.vel.x.toFixed(2)}, ${p.vel.y.toFixed(2)})`
        );
      }

      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        console.log(
          `  Ball: pos(${b.pos.x.toFixed(2)}, ${b.pos.y.toFixed(2)}) vel(${b.vel.x.toFixed(2)}, ${b.vel.y.toFixed(2)})`
        );
      }

      console.groupEnd();
    }, PRINT_INTERVAL);
  }

  // ============================================================
  // Also hook PIXI to get sprite-level info (optional extra data)
  // ============================================================

  function hookPIXI() {
    if (typeof window.PIXI === "undefined") {
      setTimeout(hookPIXI, 500);
      return;
    }

    console.log("[NC-Hook] PIXI.js detected (v" + (PIXI.VERSION || "unknown") + ")");

    // We can also hook PIXI.Application or the ticker to get render-time data.
    // For now we rely on the Planck physics bodies which give us the authoritative
    // positions. PIXI sprites interpolate from these, so Planck is more accurate.
  }

  // ============================================================
  // Bootstrap
  // ============================================================

  hookPlanck();
  hookPIXI();
  startPositionLogger();

  console.log("[NC-Hook] NitroClash PIXI/Planck observer loaded.");
})();
