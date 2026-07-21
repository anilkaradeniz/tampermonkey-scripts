// ==UserScript==
// @name         NitroClash — Advanced Train Mode
// @namespace    nc-train-advanced
// @version      0.3.0
// @description  Hotkeys for the client-side train sandbox: place the ball, aim + set launch speed, replay the shot, place the headless opponent, mirror the setup across the field center (M), update parameters — speed/angle randomization + launch delay (G). Collapsible hotkey overlay.
// @author       parasetanol
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/nc-train-advanced.user.js
// @downloadURL  https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/nc-train-advanced.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ===================== TUNABLES — EDIT HERE =====================
  const SPEED_DIVISOR = 0.4; // launch speed = distance(ballPos, mouse) / this
  const FIELD_CENTER_X = 50; // field spans X=0..100 (goals); M mirrors the setup across this vertical line
  let launchDelayMs = 1000; // when a player launch (T) is armed, delay ALL launches on E (ms); part of a shared code
  const PLAYER_BRAKE_STRENGTH = 0.005; // game's brake counter-impulse factor (×1.5 in boosted modes); stationary opponents hold brake with this
  const GHOST_BALL_COLOR = 0x33ccff;
  const PLAYER_GHOST_COLOR = 0x66ff66;
  const ARROW_COLOR = 0xffcc00;
  const OPP_GHOST_COLOR = 0xff5555;
  const ARMED_BALL_COLOR = 0x33ccff;
  const ARMED_PLAYER_COLOR = 0x66ff66;
  const ARMED_ARROW_COLOR = 0xffcc00;
  const LINE_W = 0.2; // world-unit line width for arrows
  const ARROW_HEAD_LEN = 0.9; // world units
  const OVERLAY_START_COLLAPSED = false;
  // ================================================================

  const LOG = "[NC-Train]";
  const log = (...a) => console.log(LOG, ...a);

  // ============================================================
  // State
  // ============================================================
  const State = {
    IDLE: "IDLE",
    PLACING_BALL: "PLACING_BALL",
    AIMING: "AIMING",
    PLACING_PLAYER: "PLACING_PLAYER",
    AIMING_PLAYER: "AIMING_PLAYER",
    PLACING_OPP: "PLACING_OPP",
    AIMING_OPP: "AIMING_OPP",
    SETTINGS: "SETTINGS",
  };
  let state = State.IDLE;

  // Shot randomization (G menu). Variance V => launch offset drawn uniformly
  // from [-V, +V], re-rolled on every E. Speed in km/h (1 unit = 5 km/h,
  // i.e. 1 world-unit/sec ~= 5 km/h); angle in degrees. 0 = no randomization.
  let ballSpeedVarKmh = 0;
  let ballAngleVarDeg = 0;
  let playerSpeedVarKmh = 0;
  let playerAngleVarDeg = 0;
  const KMH_PER_WORLD_SPEED = 5; // 1 world-unit/sec ~= 5 km/h

  let ballBody = null;
  let localPlayerBody = null;
  let opponentBody = null;
  let taggedWorld = null;

  let ballRadius = 0.5;
  let playerRadius = 0.7;

  // Placement scratch
  let placedBallPos = null; // {x,y} set by click 1 of R
  let placedPlayerPos = null; // {x,y} set by click 1 of T
  let placedOppPos = null; // {x,y} set by a SHIFT-click in PLACING_OPP (aim step)
  let shiftHeld = false;

  // Armed shot (persists until re-armed): {ballPos:{x,y}, vel:{x,y}, aimTo:{x,y}}
  let armedShot = null;
  // Armed player launch (persists): {ballPos:{x,y}, vel:{x,y}, aimTo:{x,y}}
  let playerShot = null;
  // Opponent placement markers (persist): [{x,y}] for a stationary opponent, or
  // [{x,y, vel:{x,y}, aimTo:{x,y}}] for a launched one (SHIFT-click aim). Every
  // marker gets a synthetic body + player-R sprite, rebuilt on every E; the
  // game's native opponent (fe[1]) is left parked and unused.
  let oppMarkers = [];
  // Spawned opponents: [{ body, sprite, brake, launchVel }]. brake=true holds
  // position (stationary); launchVel!=null fires that velocity at launch time
  // and the body coasts (never brakes).
  let spawnedOpponents = [];
  // Pending delayed ball-launch timer id
  let ballLaunchTimer = null;
  // While true, the local player is pinned still (during the pre-launch delay)
  let launchPending = false;
  const OPP_REMOVE_RADIUS_FACTOR = 1.2; // click within this * playerRadius removes a marker

  // Mouse in client (viewport) pixels
  let mouseClientX = 0;
  let mouseClientY = 0;

  // ============================================================
  // Planck world capture (wrap World.prototype.step) + per-step pin
  // ============================================================
  let planckWorld = null;
  let planckHooked = false;

  function hookPlanck() {
    if (planckHooked) return;
    if (typeof window.planck === "undefined") {
      setTimeout(hookPlanck, 300);
      return;
    }
    const origStep = window.planck.World.prototype.step;
    window.planck.World.prototype.step = function (...args) {
      if (planckWorld !== this) {
        planckWorld = this;
        taggedWorld = null; // force re-tag against the new world
        // Old spawned bodies/sprites belonged to the previous world/stage.
        spawnedOpponents = [];
        log("captured planck World");
      }
      // Pin the local player still during the R flow. Runs after the game has
      // applied this tick's input impulses in its own loop, so zeroing here
      // wipes any motion before the world integrates it.
      if ((state !== State.IDLE || launchPending) && localPlayerBody) {
        localPlayerBody.setLinearVelocity(window.planck.Vec2(0, 0));
        localPlayerBody.setAngularVelocity(0);
      }
      // During the pre-launch delay, launched opponents are pinned still too, so
      // everything fires from rest on the same tick (mirrors the player pin).
      if (launchPending) {
        for (const o of spawnedOpponents) {
          if (!o.body || !o.launchVel) continue;
          o.body.setLinearVelocity(window.planck.Vec2(0, 0));
          o.body.setAngularVelocity(0);
        }
      }
      // Stationary opponents hold brake like the native opponent (fe[1]): each
      // step, apply a counter-impulse of PLAYER_BRAKE_STRENGTH × current
      // velocity at the center of mass — the same brake the game runs on braked
      // players. Bleeds off speed (~8.5%/frame) instead of snapping. Launched
      // opponents (brake=false) coast instead.
      for (const o of spawnedOpponents) {
        if (!o.body || !o.brake) continue;
        const brake = new window.planck.Vec2(o.body.getLinearVelocity());
        brake.mul(PLAYER_BRAKE_STRENGTH).mul(-1);
        o.body.applyLinearImpulse(brake, o.body.getPosition(), true);
      }
      return origStep.apply(this, args);
    };
    planckHooked = true;
    log("planck hooked");
  }

  // ============================================================
  // PIXI capture (stage + renderer) + game-world container lookup
  // ============================================================
  let pixiStage = null;
  let pixiRenderer = null;
  let gameWorldContainer = null;
  let pixiHooked = false;

  function hookPIXI() {
    if (pixiHooked) return;
    if (typeof window.PIXI === "undefined") {
      setTimeout(hookPIXI, 300);
      return;
    }
    const protos = [
      PIXI.WebGLRenderer && PIXI.WebGLRenderer.prototype,
      PIXI.CanvasRenderer && PIXI.CanvasRenderer.prototype,
    ].filter(Boolean);

    for (const proto of protos) {
      const origRender = proto.render;
      proto.render = function (stage, ...args) {
        pixiRenderer = this;
        if (stage && stage !== pixiStage) {
          pixiStage = stage;
          gameWorldContainer = null;
          log("captured PIXI stage");
        }
        return origRender.call(this, stage, ...args);
      };
    }
    pixiHooked = true;
    log("PIXI hooked");
  }

  // Locate the container whose local coordinate system equals planck world
  // units — a child sits at (roughly) the ball's world position.
  function findGameWorldContainer() {
    if (gameWorldContainer && gameWorldContainer.parent)
      return gameWorldContainer;
    gameWorldContainer = null;
    if (!pixiStage || !planckWorld || !ballBody) return null;

    const bp = ballBody.getPosition();
    const queue = [pixiStage];
    while (queue.length) {
      const node = queue.shift();
      if (!node.children) continue;
      for (const child of node.children) {
        if (
          child.visible !== false &&
          typeof child.x === "number" &&
          Math.abs(child.x - bp.x) < 2 &&
          Math.abs(child.y - bp.y) < 2
        ) {
          gameWorldContainer = node;
          return gameWorldContainer;
        }
        if (child.children && child.children.length) queue.push(child);
      }
    }
    return null;
  }

  // ============================================================
  // Opponent sprites (built from the game's own player texture)
  // ============================================================
  // The game keeps all textures in one spritesheet resource keyed by name
  // (same source nc-skinner.user.js swaps). "player-R" is the red opponent;
  // reading it directly avoids hunting the PIXI tree and inherits any active
  // skin for free.
  function getOpponentTexture() {
    if (typeof PIXI === "undefined" || !PIXI.loader || !PIXI.loader.resources)
      return null;
    const sheet = PIXI.loader.resources["img/spritesheet4.json"];
    const tex = sheet && sheet.textures && sheet.textures["player-R"];
    return tex && tex.valid ? tex : null;
  }

  function destroySpawnedOpponents() {
    for (const o of spawnedOpponents) {
      if (o.sprite && o.sprite.parent) o.sprite.parent.removeChild(o.sprite);
      if (o.sprite) o.sprite.destroy();
      if (o.body && planckWorld && bodyInWorld(o.body))
        planckWorld.destroyBody(o.body);
    }
    spawnedOpponents = [];
  }

  function spawnOpponentBody(marker) {
    const P = window.planck;
    const b = planckWorld.createBody({
      type: P.Body.DYNAMIC,
      angularDamping: 0.5,
      position: P.Vec2(marker.x, marker.y),
    });
    b.createFixture(new P.Circle(playerRadius), {
      density: 0.05,
      friction: 0.4,
      restitution: 0.8,
    });
    let sprite = null;
    const texture = getOpponentTexture();
    const layer = findGameWorldContainer();
    if (texture && layer) {
      sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      // Match the native player's on-field size (diameter = 2·playerRadius).
      sprite.width = sprite.height = playerRadius * 2;
      layer.addChild(sprite);
    }
    // Launched opponents coast (no brake); stationary ones hold position.
    const launchVel = marker.vel ? { x: marker.vel.x, y: marker.vel.y } : null;
    return { body: b, sprite, brake: !launchVel, launchVel };
  }

  // Keep each opponent sprite locked to its body every frame.
  function updateSpawnedSprites() {
    for (const o of spawnedOpponents) {
      if (!o.sprite || !o.body) continue;
      const p = o.body.getPosition();
      o.sprite.position.set(p.x, p.y);
      o.sprite.rotation = o.body.getAngle();
    }
  }

  // ============================================================
  // Body classification / tagging
  // ============================================================
  function tagBodies() {
    if (!planckWorld) return;
    // Re-tag if never tagged, world changed, or a tagged body vanished.
    const stillValid =
      taggedWorld === planckWorld &&
      ballBody &&
      localPlayerBody &&
      opponentBody &&
      bodyInWorld(ballBody) &&
      bodyInWorld(localPlayerBody) &&
      bodyInWorld(opponentBody);
    if (stillValid) return;

    const circles = [];
    for (let b = planckWorld.getBodyList(); b; b = b.getNext()) {
      if (!b.isDynamic()) continue;
      const f = b.getFixtureList();
      if (!f) continue;
      const s = f.getShape();
      if (!s || s.getType() !== "circle") continue;
      circles.push({ body: b, r: s.getRadius() });
    }
    if (circles.length < 3) return; // sandbox not ready (2 players + 1 ball)

    // Majority radius = players; the odd one out = ball.
    const counts = {};
    for (const c of circles) {
      const k = c.r.toFixed(5);
      counts[k] = (counts[k] || 0) + 1;
    }
    let pKey = null,
      max = 0;
    for (const k in counts)
      if (counts[k] > max) {
        max = counts[k];
        pKey = k;
      }
    const pR = parseFloat(pKey);

    const players = [];
    let ball = null;
    for (const c of circles) {
      if (Math.abs(c.r - pR) < 0.001) players.push(c);
      else ball = c;
    }
    if (!ball || players.length < 2) return;

    ballBody = ball.body;
    ballRadius = ball.r;
    playerRadius = pR;

    // Opponent spawns on the right (~0.97·W); local player on the left.
    players.sort((a, b) => a.body.getPosition().x - b.body.getPosition().x);
    localPlayerBody = players[0].body;
    opponentBody = players[players.length - 1].body;
    taggedWorld = planckWorld;
    log("tagged bodies", { ballRadius, playerRadius });
  }

  function bodyInWorld(target) {
    for (let b = planckWorld.getBodyList(); b; b = b.getNext())
      if (b === target) return true;
    return false;
  }

  // ============================================================
  // Coordinate mapping: viewport pixels -> world units
  // ============================================================
  function mouseToWorld() {
    const container = findGameWorldContainer();
    if (!container || !pixiRenderer || typeof PIXI === "undefined") return null;
    const global = new PIXI.Point();
    const im = pixiRenderer.plugins && pixiRenderer.plugins.interaction;
    if (im && im.mapPositionToPoint) {
      im.mapPositionToPoint(global, mouseClientX, mouseClientY);
    } else {
      // Fallback: map through the canvas rect + resolution.
      const canvas = pixiRenderer.view;
      const rect = canvas.getBoundingClientRect();
      const res = pixiRenderer.resolution || 1;
      global.x =
        ((mouseClientX - rect.left) * (canvas.width / rect.width)) / res;
      global.y =
        ((mouseClientY - rect.top) * (canvas.height / rect.height)) / res;
    }
    const local = container.toLocal(global);
    return { x: local.x, y: local.y };
  }

  // ============================================================
  // Train-mode gate
  // ============================================================
  // Latch the selected mode: read the menu tiles only while they exist (menu
  // present). Once a match starts and the menu is hidden/removed, keep the last
  // known value so the trainer stays enabled for a train match.
  let latchedTrain = false;
  function updateTrainLatch() {
    const tile = document.getElementById("gamemode-5");
    if (tile) {
      latchedTrain = tile.classList.contains("selected");
    } else {
      const sb = document.getElementById("server-block");
      if (sb) latchedTrain = sb.style.display === "none";
      // neither present -> keep previous latch
    }
  }
  function domTrainSelected() {
    return latchedTrain;
  }

  function trainerActive() {
    return !!(planckWorld && ballBody && latchedTrain);
  }

  // ============================================================
  // Rendering (PIXI graphics in world units)
  // ============================================================
  let liveGfx = null; // current placement/aiming visuals
  let armedGfx = null; // persistent armed-shot + opponent preview

  function ensureGfx() {
    const container = findGameWorldContainer();
    if (!container || typeof PIXI === "undefined") return null;
    if (!liveGfx || liveGfx.parent !== container) {
      if (liveGfx && liveGfx.parent) liveGfx.parent.removeChild(liveGfx);
      liveGfx = new PIXI.Graphics();
      container.addChild(liveGfx);
    }
    if (!armedGfx || armedGfx.parent !== container) {
      if (armedGfx && armedGfx.parent) armedGfx.parent.removeChild(armedGfx);
      armedGfx = new PIXI.Graphics();
      container.addChild(armedGfx);
    }
    // keep both on top
    container.setChildIndex(armedGfx, container.children.length - 1);
    container.setChildIndex(liveGfx, container.children.length - 1);
    return container;
  }

  function drawArrow(g, from, to, color, width, alpha) {
    g.lineStyle(width, color, alpha == null ? 1 : alpha);
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const ha = Math.PI / 7;
    g.moveTo(to.x, to.y);
    g.lineTo(
      to.x - ARROW_HEAD_LEN * Math.cos(ang - ha),
      to.y - ARROW_HEAD_LEN * Math.sin(ang - ha),
    );
    g.moveTo(to.x, to.y);
    g.lineTo(
      to.x - ARROW_HEAD_LEN * Math.cos(ang + ha),
      to.y - ARROW_HEAD_LEN * Math.sin(ang + ha),
    );
  }

  // A launch velocity with (effectively) no magnitude — drawn as a cross.
  function velIsZero(v) {
    return !v || Math.hypot(v.x, v.y) < 1e-6;
  }

  // Small X centered at `at` — marks a zero-speed (stationary) launch, drawn in
  // place of the aim arrow when the cursor sits inside the outline circle.
  function drawCross(g, at, color, width, alpha) {
    g.lineStyle(width, color, alpha == null ? 1 : alpha);
    const h = ARROW_HEAD_LEN * 0.5;
    g.moveTo(at.x - h, at.y - h);
    g.lineTo(at.x + h, at.y + h);
    g.moveTo(at.x - h, at.y + h);
    g.lineTo(at.x + h, at.y - h);
  }

  // Launch direction + speed from an aim origin and the current mouse world pos.
  // radius is the origin's outline-circle radius: distance is measured from the
  // edge of that circle (not its center), and a cursor inside the circle yields
  // zero speed (inside=true) so stationary objects are easy to place.
  function computeAim(origin, mouseW, radius) {
    const r = radius || 0;
    let dx = mouseW.x - origin.x;
    let dy = mouseW.y - origin.y;
    const dist = Math.hypot(dx, dy);
    const inside = dist <= r;
    const edgeDist = Math.max(0, dist - r);
    const speed = edgeDist / SPEED_DIVISOR;
    let dirx = 0,
      diry = 0;
    if (dist > 1e-6) {
      dirx = dx / dist;
      diry = dy / dist;
    }
    if (shiftHeld) {
      dirx = -dirx;
      diry = -diry;
    }
    // Arrow tip: keep the drawn length = mouse distance, in the (possibly
    // inverted) launch direction.
    const aimTo = { x: origin.x + dirx * dist, y: origin.y + diry * dist };
    return {
      speed,
      vel: { x: dirx * speed, y: diry * speed },
      aimTo,
      dist,
      inside,
    };
  }

  // Apply uniform speed + angle variance to a base launch velocity. speedVarKmh
  // is converted to world units (÷ KMH_PER_WORLD_SPEED); angleVarDeg is in
  // degrees. Returns a fresh {x,y}; the base vel is never mutated. A zero-speed
  // base has no direction to vary, so it is returned unchanged.
  function randomizeVel(vel, speedVarKmh, angleVarDeg) {
    const speed0 = Math.hypot(vel.x, vel.y);
    if (speed0 < 1e-6) return { x: vel.x, y: vel.y };
    const uniform = (x) => (Math.random() * 2 - 1) * x;
    const dSpeed = uniform(speedVarKmh) / KMH_PER_WORLD_SPEED;
    const newSpeed = Math.max(0, speed0 + dSpeed);
    const ang =
      Math.atan2(vel.y, vel.x) + uniform(angleVarDeg) * (Math.PI / 180);
    return { x: newSpeed * Math.cos(ang), y: newSpeed * Math.sin(ang) };
  }

  function redraw() {
    if (!ensureGfx()) return;
    liveGfx.clear();
    armedGfx.clear();

    // Persistent armed-shot preview
    if (armedShot) {
      armedGfx.lineStyle(LINE_W * 0.8, ARMED_BALL_COLOR, 0.45);
      armedGfx.drawCircle(armedShot.ballPos.x, armedShot.ballPos.y, ballRadius);
      if (velIsZero(armedShot.vel)) {
        drawCross(armedGfx, armedShot.ballPos, ARMED_ARROW_COLOR, LINE_W, 0.45);
      } else {
        drawArrow(
          armedGfx,
          armedShot.ballPos,
          armedShot.aimTo,
          ARMED_ARROW_COLOR,
          LINE_W,
          0.45,
        );
      }
    }
    // Persistent player-launch preview
    if (playerShot) {
      armedGfx.lineStyle(LINE_W * 0.8, ARMED_PLAYER_COLOR, 0.45);
      armedGfx.drawCircle(
        playerShot.ballPos.x,
        playerShot.ballPos.y,
        playerRadius,
      );
      if (velIsZero(playerShot.vel)) {
        drawCross(
          armedGfx,
          playerShot.ballPos,
          ARMED_ARROW_COLOR,
          LINE_W,
          0.45,
        );
      } else {
        drawArrow(
          armedGfx,
          playerShot.ballPos,
          playerShot.aimTo,
          ARMED_ARROW_COLOR,
          LINE_W,
          0.45,
        );
      }
    }
    // Persistent opponent markers; launched ones also show their aim arrow
    // (or a cross for a zero-speed launch).
    for (let i = 0; i < oppMarkers.length; i++) {
      const m = oppMarkers[i];
      armedGfx.lineStyle(LINE_W * 0.8, OPP_GHOST_COLOR, 0.55);
      armedGfx.drawCircle(m.x, m.y, playerRadius);
      if (m.vel && velIsZero(m.vel)) {
        drawCross(armedGfx, m, ARMED_ARROW_COLOR, LINE_W, 0.45);
      } else if (m.aimTo) {
        drawArrow(armedGfx, m, m.aimTo, ARMED_ARROW_COLOR, LINE_W, 0.45);
      }
    }

    const mouseW = mouseToWorld();

    if (state === State.PLACING_BALL && mouseW) {
      liveGfx.lineStyle(LINE_W, GHOST_BALL_COLOR, 0.9);
      liveGfx.beginFill(GHOST_BALL_COLOR, 0.2);
      liveGfx.drawCircle(mouseW.x, mouseW.y, ballRadius);
      liveGfx.endFill();
    } else if (state === State.AIMING && mouseW && placedBallPos) {
      // ghost ball fixed at placed pos, arrow to mouse
      liveGfx.lineStyle(LINE_W, GHOST_BALL_COLOR, 0.9);
      liveGfx.beginFill(GHOST_BALL_COLOR, 0.2);
      liveGfx.drawCircle(placedBallPos.x, placedBallPos.y, ballRadius);
      liveGfx.endFill();
      const aim = computeAim(placedBallPos, mouseW, ballRadius);
      if (aim.inside) drawCross(liveGfx, placedBallPos, ARROW_COLOR, LINE_W, 1);
      else drawArrow(liveGfx, placedBallPos, aim.aimTo, ARROW_COLOR, LINE_W, 1);
      setStatus(
        "AIMING — speed " +
          aim.speed.toFixed(2) +
          (shiftHeld ? "  [INVERTED]" : ""),
      );
    } else if (state === State.PLACING_PLAYER && mouseW) {
      liveGfx.lineStyle(LINE_W, PLAYER_GHOST_COLOR, 0.9);
      liveGfx.beginFill(PLAYER_GHOST_COLOR, 0.2);
      liveGfx.drawCircle(mouseW.x, mouseW.y, playerRadius);
      liveGfx.endFill();
    } else if (state === State.AIMING_PLAYER && mouseW && placedPlayerPos) {
      liveGfx.lineStyle(LINE_W, PLAYER_GHOST_COLOR, 0.9);
      liveGfx.beginFill(PLAYER_GHOST_COLOR, 0.2);
      liveGfx.drawCircle(placedPlayerPos.x, placedPlayerPos.y, playerRadius);
      liveGfx.endFill();
      const aim = computeAim(placedPlayerPos, mouseW, playerRadius);
      if (aim.inside)
        drawCross(liveGfx, placedPlayerPos, ARROW_COLOR, LINE_W, 1);
      else
        drawArrow(liveGfx, placedPlayerPos, aim.aimTo, ARROW_COLOR, LINE_W, 1);
      setStatus(
        "AIMING PLAYER — speed " +
          aim.speed.toFixed(2) +
          (shiftHeld ? "  [INVERTED]" : ""),
      );
    } else if (state === State.PLACING_OPP && mouseW) {
      // With SHIFT held the next click launches (never removes); otherwise red
      // when hovering an existing marker (click removes it).
      const removing = !shiftHeld && markerIndexNear(mouseW) !== -1;
      const col = removing ? 0xff2222 : OPP_GHOST_COLOR;
      liveGfx.lineStyle(LINE_W, col, 0.9);
      liveGfx.beginFill(col, removing ? 0.1 : 0.2);
      liveGfx.drawCircle(mouseW.x, mouseW.y, playerRadius);
      liveGfx.endFill();
    } else if (state === State.AIMING_OPP && mouseW && placedOppPos) {
      liveGfx.lineStyle(LINE_W, OPP_GHOST_COLOR, 0.9);
      liveGfx.beginFill(OPP_GHOST_COLOR, 0.2);
      liveGfx.drawCircle(placedOppPos.x, placedOppPos.y, playerRadius);
      liveGfx.endFill();
      const aim = computeAim(placedOppPos, mouseW, playerRadius);
      if (aim.inside) drawCross(liveGfx, placedOppPos, ARROW_COLOR, LINE_W, 1);
      else drawArrow(liveGfx, placedOppPos, aim.aimTo, ARROW_COLOR, LINE_W, 1);
      setStatus(
        "AIMING OPPONENT — speed " +
          aim.speed.toFixed(2) +
          (shiftHeld ? "  [INVERTED]" : ""),
      );
    }
  }

  // ============================================================
  // Actions
  // ============================================================
  function playShot() {
    if (!planckWorld) return;
    const P = window.planck;

    // Opponents: rebuild from markers (count resets every E). Every marker gets
    // a synthetic body so all opponents share identical physics; the native
    // opponent (fe[1]) stays parked and unused.
    destroySpawnedOpponents();
    for (let i = 0; i < oppMarkers.length; i++) {
      spawnedOpponents.push(spawnOpponentBody(oppMarkers[i]));
    }
    // Launched opponents fire with the ball: on the delayed tick if a player
    // launch is armed, otherwise immediately (the delay is the player's alone).
    const launchedOpps = spawnedOpponents.filter((o) => o.launchVel);

    // Positions reset now (t=0), velocities zeroed so bodies sit still.
    if (playerShot && localPlayerBody) {
      localPlayerBody.setTransform(
        P.Vec2(playerShot.ballPos.x, playerShot.ballPos.y),
        localPlayerBody.getAngle(),
      );
      localPlayerBody.setLinearVelocity(P.Vec2(0, 0));
      localPlayerBody.setAngularVelocity(0);
      localPlayerBody.setAwake(true);
    }
    if (armedShot && ballBody) {
      ballBody.setTransform(
        P.Vec2(armedShot.ballPos.x, armedShot.ballPos.y),
        ballBody.getAngle(),
      );
      ballBody.setLinearVelocity(P.Vec2(0, 0));
      ballBody.setAngularVelocity(0);
      ballBody.setAwake(true);
    }

    // Apply launch velocities. When a player launch is armed, ALL launches
    // (player, ball, opponents) are delayed by launchDelayMs; otherwise
    // everything launches immediately.
    if (ballLaunchTimer) {
      clearTimeout(ballLaunchTimer);
      ballLaunchTimer = null;
    }
    const pShot = playerShot;
    const bShot = armedShot;
    const launch = () => {
      ballLaunchTimer = null;
      launchPending = false; // release the player/opponent pins before velocity
      if (pShot && playerShot === pShot && localPlayerBody) {
        const v = randomizeVel(pShot.vel, playerSpeedVarKmh, playerAngleVarDeg);
        localPlayerBody.setLinearVelocity(P.Vec2(v.x, v.y));
        localPlayerBody.setAngularVelocity(0);
        localPlayerBody.setAwake(true);
      }
      if (bShot && armedShot === bShot && ballBody) {
        const v = randomizeVel(bShot.vel, ballSpeedVarKmh, ballAngleVarDeg);
        ballBody.setLinearVelocity(P.Vec2(v.x, v.y));
        ballBody.setAngularVelocity(0);
        ballBody.setAwake(true);
      }
      for (const o of launchedOpps) {
        if (!o.body || !bodyInWorld(o.body)) continue; // re-played E stales these
        o.body.setLinearVelocity(P.Vec2(o.launchVel.x, o.launchVel.y));
        o.body.setAngularVelocity(0);
        o.body.setAwake(true);
      }
    };
    if (pShot) {
      launchPending = true; // freeze player + launched opponents during the delay
      ballLaunchTimer = setTimeout(launch, launchDelayMs);
    } else {
      launch(); // no player armed: ball + any launched opponents fire immediately
    }
  }

  // Mirror the whole armed setup across the field's vertical center line
  // (x -> 2·C - x, y unchanged; vel.x flips). E then launches from the
  // mirrored positions. This is an involution, so pressing M again restores
  // the original setup. Independent of the setup codec.
  function mirrorSetup() {
    const C = FIELD_CENTER_X;
    const mirrorShot = (s) => {
      if (!s) return null;
      const ballPos = { x: 2 * C - s.ballPos.x, y: s.ballPos.y };
      const vel = { x: -s.vel.x, y: s.vel.y };
      return { ballPos, vel, aimTo: aimToFrom(ballPos, vel) };
    };
    armedShot = mirrorShot(armedShot);
    playerShot = mirrorShot(playerShot);
    oppMarkers = oppMarkers.map((m) => {
      const x = 2 * C - m.x;
      if (!m.vel) return { x, y: m.y };
      // Launched opponent: flip vel.x like a shot, keep the marker launchable.
      const vel = { x: -m.vel.x, y: m.vel.y };
      return { x, y: m.y, vel, aimTo: aimToFrom({ x, y: m.y }, vel) };
    });
    // Existing spawned bodies belong to the un-mirrored markers; drop them so
    // the next E rebuilds from the mirrored markers.
    destroySpawnedOpponents();
    setStatus("Setup mirrored across field center — press E to play");
  }

  function cancelPlacement() {
    state = State.IDLE;
    placedBallPos = null;
    placedPlayerPos = null;
    placedOppPos = null;
    setStatus("");
  }

  // ============================================================
  // Shareable setup codec (binary pack -> base64 ASCII)
  // ============================================================
  // Layout (little-endian): [0]=version, [1]=flags, then 9 float32
  // (armed{ballx,bally,velx,vely}, player{x,y,velx,vely}, delayMs), then
  // 1 byte oppCount, then per marker: 1 flag byte (bit0=launched), 2 float32
  // (x,y), and — only when launched — 2 more float32 (velx,vely).
  // flags bit0=armedShot present, bit1=playerShot.
  //
  // v2 (legacy, still decoded): same head, then oppCount*2 float32 (x,y) with
  // every marker stationary. v1 (legacy): [0]=1, [1]=flags(bit2=single
  // opponent), then 11 float32 — armed{4}, player{4}, opponent{x,y}, delayMs
  // LAST. 46 bytes; the single opponent (bit2) maps to marker 0. decodeSetup
  // normalizes all versions to { flags, f[0..8]=shots+delay, markers[] } where
  // each marker is {x,y} or {x,y,vel:{x,y}}.
  const CODE_VERSION = 3;
  const CODE_HEAD_BYTES = 2 + 9 * 4; // 38
  const CODE_V1_BYTES = 2 + 11 * 4; // 46

  function aimToFrom(pos, vel) {
    // aimTo = pos + vel * SPEED_DIVISOR (see computeAim); vel already carries
    // the (possibly inverted) launch direction and magnitude.
    return {
      x: pos.x + vel.x * SPEED_DIVISOR,
      y: pos.y + vel.y * SPEED_DIVISOR,
    };
  }

  function encodeSetup() {
    const n = Math.min(oppMarkers.length, 255);
    // Per marker: 1 flag byte + 8 (x,y); launched markers add 8 more (velx,vely).
    let markerBytes = 0;
    for (let i = 0; i < n; i++) markerBytes += 9 + (oppMarkers[i].vel ? 8 : 0);
    const buf = new ArrayBuffer(CODE_HEAD_BYTES + 1 + markerBytes);
    const dv = new DataView(buf);
    dv.setUint8(0, CODE_VERSION);
    let flags = 0;
    if (armedShot) flags |= 1;
    if (playerShot) flags |= 2;
    dv.setUint8(1, flags);
    const head = [
      armedShot ? armedShot.ballPos.x : 0,
      armedShot ? armedShot.ballPos.y : 0,
      armedShot ? armedShot.vel.x : 0,
      armedShot ? armedShot.vel.y : 0,
      playerShot ? playerShot.ballPos.x : 0,
      playerShot ? playerShot.ballPos.y : 0,
      playerShot ? playerShot.vel.x : 0,
      playerShot ? playerShot.vel.y : 0,
      launchDelayMs,
    ];
    for (let i = 0; i < head.length; i++)
      dv.setFloat32(2 + i * 4, head[i], true);
    dv.setUint8(CODE_HEAD_BYTES, n);
    let off = CODE_HEAD_BYTES + 1;
    for (let i = 0; i < n; i++) {
      const m = oppMarkers[i];
      const launched = !!m.vel;
      dv.setUint8(off, launched ? 1 : 0);
      off += 1;
      dv.setFloat32(off, m.x, true);
      dv.setFloat32(off + 4, m.y, true);
      off += 8;
      if (launched) {
        dv.setFloat32(off, m.vel.x, true);
        dv.setFloat32(off + 4, m.vel.y, true);
        off += 8;
      }
    }
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function decodeSetup(code) {
    const bin = atob(code.trim());
    if (bin.length < 2) throw new Error("bad length");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dv = new DataView(bytes.buffer);
    const version = dv.getUint8(0);
    const flags = dv.getUint8(1);

    // v1: 11 floats, delay last, single opponent (bit2) at floats 8-9.
    if (version === 1) {
      if (bin.length !== CODE_V1_BYTES) throw new Error("bad length");
      const f = [];
      for (let i = 0; i < 8; i++) f.push(dv.getFloat32(2 + i * 4, true));
      f.push(dv.getFloat32(2 + 10 * 4, true)); // delayMs -> normalized f[8]
      const markers =
        flags & 4
          ? [
              {
                x: dv.getFloat32(2 + 8 * 4, true),
                y: dv.getFloat32(2 + 9 * 4, true),
              },
            ]
          : [];
      return { flags, f, markers };
    }

    if (version !== 2 && version !== 3) throw new Error("bad version");
    if (bin.length < CODE_HEAD_BYTES + 1) throw new Error("bad length");
    const f = [];
    for (let i = 0; i < 9; i++) f.push(dv.getFloat32(2 + i * 4, true));
    const n = dv.getUint8(CODE_HEAD_BYTES);
    const markers = [];
    let off = CODE_HEAD_BYTES + 1;

    // v2: oppCount fixed-size stationary markers (x,y) only.
    if (version === 2) {
      if (bin.length !== CODE_HEAD_BYTES + 1 + n * 8)
        throw new Error("bad length");
      for (let i = 0; i < n; i++) {
        markers.push({
          x: dv.getFloat32(off, true),
          y: dv.getFloat32(off + 4, true),
        });
        off += 8;
      }
      return { flags, f, markers };
    }

    // v3: per marker a flag byte (bit0=launched) + x,y, plus velx,vely when set.
    for (let i = 0; i < n; i++) {
      if (off + 9 > bin.length) throw new Error("bad length");
      const launched = dv.getUint8(off) === 1;
      off += 1;
      const x = dv.getFloat32(off, true);
      const y = dv.getFloat32(off + 4, true);
      off += 8;
      if (launched) {
        if (off + 8 > bin.length) throw new Error("bad length");
        markers.push({
          x,
          y,
          vel: { x: dv.getFloat32(off, true), y: dv.getFloat32(off + 4, true) },
        });
        off += 8;
      } else {
        markers.push({ x, y });
      }
    }
    if (off !== bin.length) throw new Error("bad length");
    return { flags, f, markers };
  }

  function applySetup(code) {
    const { flags, f, markers } = decodeSetup(code);
    if (flags & 1) {
      const ballPos = { x: f[0], y: f[1] };
      const vel = { x: f[2], y: f[3] };
      armedShot = { ballPos, vel, aimTo: aimToFrom(ballPos, vel) };
    } else armedShot = null;
    if (flags & 2) {
      const pos = { x: f[4], y: f[5] };
      const vel = { x: f[6], y: f[7] };
      playerShot = { ballPos: pos, vel, aimTo: aimToFrom(pos, vel) };
    } else playerShot = null;
    launchDelayMs = f[8];
    destroySpawnedOpponents(); // markers changed; existing spawns are stale
    oppMarkers = markers.map((m) =>
      m.vel
        ? { x: m.x, y: m.y, vel: m.vel, aimTo: aimToFrom(m, m.vel) }
        : { x: m.x, y: m.y },
    );
  }

  function copySetupCode() {
    const code = encodeSetup();
    const done = () => setStatus("Setup code copied");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, () => {
        window.prompt("Copy this setup code:", code);
        done();
      });
    } else {
      window.prompt("Copy this setup code:", code);
      done();
    }
  }

  function pasteSetupCode() {
    const code = window.prompt("Paste setup code:");
    if (!code) return;
    try {
      applySetup(code);
      setStatus("Setup loaded from code");
    } catch (err) {
      setStatus("Invalid setup code");
      log("decode failed", err);
    }
  }

  // Advance the state machine on a left click at the current mouse world pos.
  function handlePlacementClick() {
    const mouseW = mouseToWorld();
    if (!mouseW) return;
    if (state === State.PLACING_BALL) {
      placedBallPos = { x: mouseW.x, y: mouseW.y };
      state = State.AIMING;
      setStatus("AIMING — move to aim, SHIFT inverts, click to set speed");
    } else if (state === State.AIMING) {
      const aim = computeAim(placedBallPos, mouseW, ballRadius);
      armedShot = { ballPos: placedBallPos, vel: aim.vel, aimTo: aim.aimTo };
      placedBallPos = null;
      state = State.IDLE;
      setStatus("Armed (speed " + aim.speed.toFixed(2) + ") — press E to play");
    } else if (state === State.PLACING_PLAYER) {
      placedPlayerPos = { x: mouseW.x, y: mouseW.y };
      state = State.AIMING_PLAYER;
      setStatus(
        "AIMING PLAYER — move to aim, SHIFT inverts, click to set speed",
      );
    } else if (state === State.AIMING_PLAYER) {
      const aim = computeAim(placedPlayerPos, mouseW, playerRadius);
      playerShot = { ballPos: placedPlayerPos, vel: aim.vel, aimTo: aim.aimTo };
      placedPlayerPos = null;
      state = State.IDLE;
      setStatus(
        "Player armed (speed " +
          aim.speed.toFixed(2) +
          ") — E plays; all launches delayed " +
          launchDelayMs +
          "ms",
      );
    } else if (state === State.PLACING_OPP) {
      if (shiftHeld) {
        // SHIFT-click arms the aim step: set the origin, next click sets speed.
        placedOppPos = { x: mouseW.x, y: mouseW.y };
        state = State.AIMING_OPP;
        setStatus(
          "AIMING OPPONENT — move to aim, SHIFT inverts, click to set speed",
        );
      } else {
        // Toggle: click near an existing marker removes it, else add a
        // stationary one. Stay in PLACING_OPP so several can be placed.
        const idx = markerIndexNear(mouseW);
        if (idx !== -1) {
          oppMarkers.splice(idx, 1);
        } else {
          oppMarkers.push({ x: mouseW.x, y: mouseW.y });
        }
        setStatus(oppPlacingStatus());
      }
    } else if (state === State.AIMING_OPP) {
      const aim = computeAim(placedOppPos, mouseW, playerRadius);
      // Inside the outline circle => still a launched marker, just 0 speed (no
      // brake) — same as a normal launch with zero velocity.
      oppMarkers.push({
        x: placedOppPos.x,
        y: placedOppPos.y,
        vel: aim.vel,
        aimTo: aim.aimTo,
      });
      placedOppPos = null;
      state = State.PLACING_OPP; // back to placing so more can be added
      setStatus(
        "Opponent launched (speed " +
          aim.speed.toFixed(2) +
          ") — " +
          oppPlacingStatus(),
      );
    }
  }

  function oppPlacingStatus() {
    return (
      "PLACING OPPONENTS — " +
      oppMarkers.length +
      " placed (⇧-click = launched, click to remove, F/ESC done)"
    );
  }

  // Index of a marker within the remove radius of a world point, else -1.
  function markerIndexNear(p) {
    const r = playerRadius * OPP_REMOVE_RADIUS_FACTOR;
    const r2 = r * r;
    for (let i = 0; i < oppMarkers.length; i++) {
      const m = oppMarkers[i];
      if ((m.x - p.x) ** 2 + (m.y - p.y) ** 2 <= r2) return i;
    }
    return -1;
  }

  function placingActive() {
    return state !== State.IDLE;
  }

  // ============================================================
  // Input listeners
  // ============================================================
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  // Mouse position is always tracked (passive, never suppressed).
  window.addEventListener(
    "mousemove",
    (e) => {
      mouseClientX = e.clientX;
      mouseClientY = e.clientY;
    },
    { passive: true, capture: true },
  );

  // Capture-phase mouse suppression during placement/aiming; left mousedown
  // advances the state machine.
  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  // Dedupe: preventDefault() on pointerdown suppresses the compatibility
  // mousedown/click, but on browsers without pointer events only mousedown
  // fires. Act on whichever comes first, ignore the twin.
  let lastClickAt = 0;
  function tryPlacementClick() {
    const now = performance.now();
    if (now - lastClickAt < 200) return;
    lastClickAt = now;
    handlePlacementClick();
  }
  for (const type of [
    "mousedown",
    "mouseup",
    "click",
    "pointerdown",
    "pointerup",
    "contextmenu",
  ]) {
    window.addEventListener(
      type,
      (e) => {
        if (!trainerActive() || !placingActive()) return;
        // Settings menu is open. Events on the panel must reach its inputs, but
        // the game binds capture-phase mousedown/mouseup that preventDefault
        // (killing focus/drag). We run at document-start (before the game), so
        // stopImmediatePropagation here blocks the game's handler while leaving
        // the native input behavior intact. Canvas clicks are not placement.
        if (state === State.SETTINGS) {
          if (settingsEl && settingsEl.contains(e.target))
            e.stopImmediatePropagation();
          return;
        }
        // ignore interactions on our overlay
        if (overlayEl && overlayEl.contains(e.target)) return;
        swallow(e);
        if (
          (type === "pointerdown" || type === "mousedown") &&
          e.button === 0
        ) {
          tryPlacementClick();
        }
      },
      true,
    );
  }

  // Global G / ESC: opening & closing the parameters panel must win over ALL
  // focus. Registered before the shield (below) and the main handler, so it
  // fires first in the capture phase — even when a panel input has focus (where
  // the shield would otherwise swallow the key and the main handler
  // early-returns on isTyping).
  window.addEventListener(
    "keydown",
    (e) => {
      if (!trainerActive()) return;
      const g =
        e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const esc = e.key === "Escape";
      if (state === State.SETTINGS) {
        // Panel open: G or ESC always closes, regardless of focus.
        if (!g && !esc) return;
        closeSettings();
      } else if (g && !isTypingTarget(document.activeElement)) {
        // Panel closed: G opens, unless typing in some other field (chat, etc.)
        // so G isn't hijacked from the game's inputs.
        openSettings();
      } else {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  // Shield the settings panel's inputs from the game's key handlers (it binds
  // keydown/keyup that can preventDefault). We run before the game, so stopping
  // propagation here keeps the game out while native typing still works.
  for (const type of ["keydown", "keyup", "keypress"]) {
    window.addEventListener(
      type,
      (e) => {
        if (settingsEl && settingsEl.contains(e.target))
          e.stopImmediatePropagation();
      },
      true,
    );
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Shift") shiftHeld = true;
      if (!trainerActive()) return;
      if (isTypingTarget(document.activeElement)) return;

      const k = e.key.toLowerCase();
      if (k === "r") {
        if (e.shiftKey) {
          // SHIFT+R: remove the ball placement entirely.
          armedShot = null;
          if (state === State.PLACING_BALL || state === State.AIMING)
            cancelPlacement();
          setStatus("Ball placement removed");
        } else if (state === State.PLACING_BALL || state === State.AIMING) {
          // Toggle: pressing R during the R flow cancels it.
          cancelPlacement();
        } else {
          state = State.PLACING_BALL;
          placedBallPos = null;
          setStatus("PLACING BALL — click to set position");
        }
        swallow(e);
      } else if (k === "e") {
        playShot();
        swallow(e);
      } else if (k === "f") {
        if (e.shiftKey) {
          // SHIFT+F: remove all opponent markers + spawned bodies.
          oppMarkers = [];
          destroySpawnedOpponents();
          if (state === State.PLACING_OPP || state === State.AIMING_OPP)
            cancelPlacement();
          setStatus("All opponents removed");
        } else if (state === State.PLACING_OPP || state === State.AIMING_OPP) {
          // Toggle: pressing F during opponent placement exits the mode.
          cancelPlacement();
        } else {
          state = State.PLACING_OPP;
          setStatus(oppPlacingStatus());
        }
        swallow(e);
      } else if (k === "t") {
        if (e.shiftKey) {
          // SHIFT+T: remove the player launch entirely.
          playerShot = null;
          if (state === State.PLACING_PLAYER || state === State.AIMING_PLAYER)
            cancelPlacement();
          setStatus("Player launch removed");
        } else if (
          state === State.PLACING_PLAYER ||
          state === State.AIMING_PLAYER
        ) {
          // Toggle: pressing T during the T flow cancels it.
          cancelPlacement();
        } else {
          state = State.PLACING_PLAYER;
          placedPlayerPos = null;
          setStatus("PLACING PLAYER — click to set position");
        }
        swallow(e);
      } else if (k === "m") {
        mirrorSetup();
        swallow(e);
      } else if (k === "c") {
        copySetupCode();
        swallow(e);
      } else if (k === "v") {
        pasteSetupCode();
        swallow(e);
      } else if (k === "q") {
        toggleCollapse();
        swallow(e);
      } else if (e.key === "Escape") {
        if (state === State.SETTINGS) {
          closeSettings();
          swallow(e);
        } else if (placingActive()) {
          cancelPlacement();
          swallow(e);
        }
      }
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Shift") shiftHeld = false;
    },
    true,
  );

  // ============================================================
  // Overlay
  // ============================================================
  let overlayEl = null;
  let statusEl = null;
  let listEl = null;
  let collapsed = OVERLAY_START_COLLAPSED;

  const HOTKEYS = [
    ["R", "Place ball (again to cancel)"],
    ["T", "Place player (again to cancel)"],
    ["F", "Place opponents (⇧-click = launched, click to remove)"],
    ["E", "Play (spawns opponents; ball delayed if player armed)"],
    ["M", "Mirror setup across field center (again to reset)"],
    ["⇧R/T/F", "Remove ball / player / all opponents"],
    ["C / V", "Copy / paste setup code"],
    ["G", "Update parameters (variance, launch delay)"],
    ["Q", "Toggle this list"],
    ["ESC", "Cancel placement"],
  ];

  function buildOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.style.cssText = [
      "position:fixed",
      "left:12px",
      "bottom:12px",
      "z-index:2147483647",
      "font-family:monospace",
      "font-size:12px",
      "color:#fff",
      "background:rgba(0,0,0,0.65)",
      "border:1px solid rgba(255,255,255,0.25)",
      "border-radius:6px",
      "padding:8px 10px",
      "pointer-events:auto",
      "user-select:none",
      "line-height:1.5",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "TRAIN TRAINER  (Q to toggle)";
    title.style.cssText = "font-weight:bold;margin-bottom:4px;opacity:0.85";
    overlayEl.appendChild(title);

    listEl = document.createElement("div");
    for (const [key, desc] of HOTKEYS) {
      const row = document.createElement("div");
      const kEl = document.createElement("span");
      kEl.textContent = key;
      kEl.style.cssText =
        "display:inline-block;min-width:34px;font-weight:bold;color:#ffcc00";
      const dEl = document.createElement("span");
      dEl.textContent = desc;
      row.appendChild(kEl);
      row.appendChild(dEl);
      listEl.appendChild(row);
    }
    overlayEl.appendChild(listEl);

    statusEl = document.createElement("div");
    statusEl.style.cssText =
      "margin-top:6px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.2);color:#33ccff;min-height:14px";
    overlayEl.appendChild(statusEl);

    (document.body || document.documentElement).appendChild(overlayEl);
  }

  function toggleCollapse() {
    collapsed = !collapsed; // collapsed => overlay fully hidden
    updateOverlayVisibility();
  }
  function setStatus(t) {
    if (statusEl) statusEl.textContent = t || "";
  }

  function updateOverlayVisibility() {
    if (!overlayEl) return;
    overlayEl.style.display =
      domTrainSelected() && !collapsed ? "block" : "none";
  }

  // ============================================================
  // Update parameters panel (G): shot randomization + launch delay
  // ============================================================
  let settingsEl = null;

  // Each spec: label, current getter, setter, slider max (clamps slider only —
  // the numeric box is uncapped), slider step.
  const PARAM_FIELDS = [
    {
      label: "Ball speed ± (km/h)",
      get: () => ballSpeedVarKmh,
      set: (v) => (ballSpeedVarKmh = v),
      max: 100,
      step: 5,
    },
    {
      label: "Ball angle ± (°)",
      get: () => ballAngleVarDeg,
      set: (v) => (ballAngleVarDeg = v),
      max: 45,
      step: 1,
    },
    {
      label: "Player speed ± (km/h)",
      get: () => playerSpeedVarKmh,
      set: (v) => (playerSpeedVarKmh = v),
      max: 50,
      step: 5,
    },
    {
      label: "Player angle ± (°)",
      get: () => playerAngleVarDeg,
      set: (v) => (playerAngleVarDeg = v),
      max: 45,
      step: 1,
    },
    {
      // Stored internally as ms (launchDelayMs); edited here in seconds.
      label: "Launch delay (s)",
      get: () => launchDelayMs / 1000,
      set: (v) => (launchDelayMs = v * 1000),
      max: 3,
      step: 0.25,
    },
  ];

  function buildSettings() {
    if (settingsEl) return;
    settingsEl = document.createElement("div");
    settingsEl.style.cssText = [
      "position:fixed",
      "left:12px",
      "bottom:220px",
      "z-index:2147483647",
      "font-family:monospace",
      "font-size:12px",
      "color:#fff",
      "background:rgba(0,0,0,0.8)",
      "border:1px solid rgba(255,255,255,0.25)",
      "border-radius:6px",
      "padding:8px 10px",
      "pointer-events:auto",
      "user-select:none",
      "display:none",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "UPDATE PARAMETERS  (G to close)";
    title.style.cssText = "font-weight:bold;margin-bottom:6px;opacity:0.85";
    settingsEl.appendChild(title);

    for (const field of PARAM_FIELDS) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:8px;margin-bottom:4px";

      const lbl = document.createElement("span");
      lbl.textContent = field.label;
      lbl.style.cssText = "min-width:150px";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = String(field.max);
      slider.step = String(field.step);
      slider.value = String(field.get());
      slider.style.cssText = "width:120px";

      const box = document.createElement("input");
      box.type = "number";
      box.min = "0";
      box.step = String(field.step);
      box.value = String(field.get());
      box.style.cssText =
        "width:56px;background:#111;color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:3px;padding:1px 3px;font-family:monospace";

      // Two-way bind: slider drag -> box + state; box input -> slider + state.
      slider.addEventListener("input", () => {
        const v = parseFloat(slider.value) || 0;
        field.set(v);
        box.value = String(v);
      });
      box.addEventListener("input", () => {
        const v = Math.max(0, parseFloat(box.value) || 0);
        field.set(v);
        slider.value = String(v); // slider clamps its own thumb to [0, max]
      });

      row.appendChild(lbl);
      row.appendChild(slider);
      row.appendChild(box);
      settingsEl.appendChild(row);
    }

    (document.body || document.documentElement).appendChild(settingsEl);
  }

  function openSettings() {
    // Leaving any placement flow; SETTINGS pins the player via the step hook.
    placedBallPos = null;
    placedPlayerPos = null;
    state = State.SETTINGS;
    buildSettings();
    setStatus("Update parameters — G/ESC to close");
  }
  function closeSettings() {
    if (state === State.SETTINGS) {
      state = State.IDLE;
      setStatus("");
    }
  }

  // Panel is shown iff we're in SETTINGS state (so entering R/T/F/etc. from an
  // open panel hides it automatically). Driven each tick.
  function updateSettingsVisibility() {
    if (!settingsEl) return;
    settingsEl.style.display =
      state === State.SETTINGS && domTrainSelected() ? "block" : "none";
  }

  // ============================================================
  // Main loop
  // ============================================================
  function tick() {
    updateTrainLatch();
    tagBodies();
    if (trainerActive()) {
      redraw();
      updateSpawnedSprites();
    } else {
      if (state === State.SETTINGS) closeSettings();
      if (liveGfx) {
        liveGfx.clear();
        if (armedGfx) armedGfx.clear();
      }
    }
    updateOverlayVisibility();
    updateSettingsVisibility();
    requestAnimationFrame(tick);
  }

  // ============================================================
  // Boot
  // ============================================================
  function boot() {
    if (!document.body) {
      setTimeout(boot, 50);
      return;
    }
    buildOverlay();
    updateOverlayVisibility();
  }

  hookPlanck();
  hookPIXI();
  boot();
  requestAnimationFrame(tick);
  log("loaded");
})();
