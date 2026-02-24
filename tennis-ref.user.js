// ==UserScript==
// @name         NitroClash Tennis Referee via PIXI/Planck Hook
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Hooks into Planck.js contacts + WebSocket game events (goals, kickoffs, actions). Two overlays.
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/tennis-ref.user.js
// @downloadURL  https://github.com/anilkaradeniz/tampermonkey-scripts/raw/refs/heads/master/tennis-ref.user.js
// ==/UserScript==

/*
in this file, we will start defining event based updates.

keep a state variable:
{
  last_serve: TeamEnum.BLUE/RED,
  serve_times: int=0,
  blue_touches: array of contact events = [],
  red_touches: array of contact events = [],
  blue_wall_touches: array of contact events = [],
  red_wall_touches: array of contact events = [],
  blue_last_toucher: planck body object = null,
  red_last_toucher: planck body object = null,
  game_state: BLUE_SERVE|RED_SERVE|PLAY|SCORE_RED|SCORE_BLUE
}

state rules:
1. on match start: randomly select a server team and set game_state and last_serve accordingly
2. on first touch: increment serve_times, game_state=PLAY
3. on any player touch (including serve): add the contact event to the respective array, and update <team>_last_toucher
4. if len(<team>_touches) > 3: SCORE for opposite team
5. on any ball <> wall contact: add the contact event to the respective array (if blue half,  then blue team's wall touches array)
6. if len(<team>_wall_touches) > 2: SCORE for opposite team
7. if ball_x > 50: reset blue team touch arrays, opposite for red
8. if ball_x > 84.3+ball_radius: SCORE for blue
9. if ball_x < 15.7-ball_radius: SCORE for red

10. if player count > 2 and if new_toucher in <team>_touches: SCORE for other team
--state rules end--

func show_touches(array): places a red dot for every contact on the field (see the contact visualization code with red circles)

display and boundary rules:
if rules 4 or 6 trigger: trigger show_touches function for that array until kickoff/serve. i.e. as long as state==SCORE
if rule 10 trigger: show touches for that body only
if state==<team>_SERVE: show a text on top "<team> SERVE" while in serve state
if state==<team>_SERVE: boundaryRules.circle.team = opposite team, null otherwise
if state==SCORE_<team>: boundaryRules.halfline.team = null, BOTH otherwise

if 4 triggers: display <opp_team> SCORE ON 3 TOUCH FOUL BY <team>
if 6 triggers: display <opp_team> SCORE ON 2 WALL FOUL BY <team>
if 10 triggers: display <opp_team> SCORE ON DOUBLE TOUCH BY <player_name>
if 8 or 9 trigger: display <team> SCORED BACK LINE
*/

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

  const scoreFoulMarkers = [];

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

  const TeamEnum = {
    BLUE: "Blue",
    RED: "Red",
    BOTH: "Both",
  };

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

  // Planck bodies: Ball, Blue P0, Red P0, Blue P1, Red P1, etc., Wall Stored in bodyLabelCache.
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
      const team = i % 2 === 0 ? TeamEnum.BLUE : TeamEnum.RED;
      const idx = Math.floor(i / 2);
      bodyLabelCache.set(players[i], `${team} P${idx}`);
    }

    for (let i = 0; i < players.length; i++) {
      const team_size = players.length / 2;
      const team = i % 2 !== 0 ? TeamEnum.BLUE : TeamEnum.RED;
      const idx = team_size - Math.floor(i / 2) - 1;
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

  function clearScoreFoulMarkers() {
    for (const g of scoreFoulMarkers) {
      if (g.parent) g.parent.removeChild(g);
      g.destroy();
    }
    scoreFoulMarkers.length = 0;
  }

  function show_touches(contactEvents) {
    clearScoreFoulMarkers();
    const container = findGameWorldContainer();
    if (!container || typeof PIXI === "undefined") return;
    for (const evt of contactEvents) {
      const g = new PIXI.Graphics();
      g.beginFill(0xff0000, 0.8);
      g.drawCircle(0, 0, CONTACT_CIRCLE_RADIUS);
      g.endFill();
      g.x = evt.x;
      g.y = evt.y;
      container.addChild(g);
      scoreFoulMarkers.push(g);
    }
  }

  function installContactListener() {
    if (!planckWorld || contactListenerInstalled) return;

    planckWorld.on("begin-contact", function (contact) {
      const bodyA = contact.getFixtureA().getBody();
      const bodyB = contact.getFixtureB().getBody();
      rebuildBodyLabels();
      const labelA = labelBody(bodyA);
      const labelB = labelBody(bodyB);

      // Only process contacts involving the ball
      let ballBody = null,
        otherBody = null,
        otherLabel = null;
      if (labelA === "Ball") {
        ballBody = bodyA;
        otherBody = bodyB;
        otherLabel = labelB;
      } else if (labelB === "Ball") {
        ballBody = bodyB;
        otherBody = bodyA;
        otherLabel = labelA;
      } else return;

      const pt = getContactWorldPoint(contact);
      const now = Date.now();
      const contactEvt = { body: otherBody, x: pt.x, y: pt.y, timestamp: now };

      if (otherLabel === "Wall") {
        // Rule 5: assign wall touch to team based on ball x position
        if (matchState.game_state !== GameState.PLAY) return;
        const ballPos = ballBody.getPosition();
        if (ballPos.x >= 50) {
          matchState.red_wall_touches.push(contactEvt);
          // Rule 6
          if (matchState.red_wall_touches.length > 2) {
            show_touches(matchState.red_wall_touches);
            scorePoint(TeamEnum.BLUE, "BLUE SCORE ON 2 WALL FOUL BY RED");
          }
        } else {
          matchState.blue_wall_touches.push(contactEvt);
          // Rule 6
          if (matchState.blue_wall_touches.length > 2) {
            show_touches(matchState.blue_wall_touches);
            scorePoint(TeamEnum.RED, "RED SCORE ON 2 WALL FOUL BY BLUE");
          }
        }
        return;
      }

      // Player contact
      if (
        !otherLabel.startsWith(TeamEnum.BLUE) &&
        !otherLabel.startsWith(TeamEnum.RED)
      )
        return;
      const team = otherLabel.startsWith(TeamEnum.BLUE)
        ? TeamEnum.BLUE
        : TeamEnum.RED;
      const oppTeam = team === TeamEnum.BLUE ? TeamEnum.RED : TeamEnum.BLUE;

      // Rule 2: first touch transitions serve → play
      if (
        matchState.game_state === GameState.BLUE_SERVE ||
        matchState.game_state === GameState.RED_SERVE
      ) {
        matchState.serve_times++;
        matchState.game_state = GameState.PLAY;
        boundaryRules.circle.team = null;
      }

      if (matchState.game_state !== GameState.PLAY) return;

      // Rule 3: record touch, update last toucher
      const teamTouches =
        team === TeamEnum.BLUE
          ? matchState.blue_touches
          : matchState.red_touches;
      teamTouches.push(contactEvt);
      if (team === TeamEnum.BLUE) matchState.blue_last_toucher = otherBody;
      else matchState.red_last_toucher = otherBody;

      // Rule 10: double touch (only in games with > 2 players)
      if (countPlayers() > 2) {
        const prevTouches = teamTouches.slice(0, -1);
        if (prevTouches.some((e) => e.body === otherBody)) {
          const playerName = displayLabel(otherBody);
          show_touches(teamTouches.filter((e) => e.body === otherBody));
          scorePoint(
            oppTeam,
            `${oppTeam.toUpperCase()} SCORE ON DOUBLE TOUCH BY ${playerName}`,
          );
          return;
        }
      }

      // Rule 4: 3+ touch foul
      if (teamTouches.length > 3) {
        show_touches(teamTouches);
        scorePoint(
          oppTeam,
          `${oppTeam.toUpperCase()} SCORE ON 3 TOUCH FOUL BY ${team.toUpperCase()}`,
        );
      }
    });

    contactListenerInstalled = true;
    console.log("[NC-Hook] Contact listeners installed on Planck world");
  }

  // ============================================================
  // Match State
  // ============================================================

  const GameState = {
    BLUE_SERVE: "BLUE_SERVE",
    RED_SERVE: "RED_SERVE",
    PLAY: "PLAY",
    SCORE_RED: "SCORE_RED",
    SCORE_BLUE: "SCORE_BLUE",
  };

  const matchState = {
    last_serve: null,
    serve_times: 0,
    blue_touches: [],
    red_touches: [],
    blue_wall_touches: [],
    red_wall_touches: [],
    blue_last_toucher: null,
    red_last_toucher: null,
    game_state: null,
    score_message: null,
  };

  let lastBallSide = null;

  function countPlayers() {
    let count = 0;
    for (const label of bodyLabelCache.values()) {
      if (label !== "Ball" && label !== "Wall" && label !== "?") count++;
    }
    return count;
  }

  function getBallBody() {
    if (!planckWorld) return null;
    for (let body = planckWorld.getBodyList(); body; body = body.getNext()) {
      if (labelBody(body) === "Ball") return body;
    }
    return null;
  }

  function scorePoint(winningTeam, message) {
    matchState.game_state =
      winningTeam === TeamEnum.BLUE
        ? GameState.SCORE_BLUE
        : GameState.SCORE_RED;
    matchState.score_message = message;
    boundaryRules.halfline.team = null;
  }

  function startServe(team) {
    matchState.game_state =
      team === TeamEnum.BLUE ? GameState.BLUE_SERVE : GameState.RED_SERVE;
    matchState.last_serve = team;
    matchState.blue_touches = [];
    matchState.red_touches = [];
    matchState.blue_wall_touches = [];
    matchState.red_wall_touches = [];
    matchState.blue_last_toucher = null;
    matchState.red_last_toucher = null;
    matchState.score_message = null;
    clearScoreFoulMarkers();
    // Non-serving team cannot cross the center circle during serve
    boundaryRules.circle.team =
      team === TeamEnum.BLUE ? TeamEnum.RED : TeamEnum.BLUE;
    boundaryRules.halfline.team = TeamEnum.BOTH;
  }

  function tickMatchState() {
    if (matchState.game_state !== GameState.PLAY) return;
    if (!planckWorld) return;

    const ballBody = getBallBody();
    if (!ballBody) return;
    const ballPos = ballBody.getPosition();

    let ballRadius = 0;
    const f = ballBody.getFixtureList();
    if (f) {
      const s = f.getShape();
      if (s) ballRadius = s.getRadius();
    }

    // Rule 7: ball crosses halfline → reset departing team's touch arrays
    const currentSide = ballPos.x >= 50 ? "red" : "blue";
    if (currentSide !== lastBallSide) {
      if (currentSide === "red") {
        matchState.blue_touches = [];
        matchState.blue_wall_touches = [];
      } else {
        matchState.red_touches = [];
        matchState.red_wall_touches = [];
      }
      lastBallSide = currentSide;
    }

    // Rule 8: ball past red's back line → Blue scores
    if (ballPos.x > 84.3 + ballRadius) {
      scorePoint(TeamEnum.BLUE, "BLUE SCORED BACK LINE");
      return;
    }

    // Rule 9: ball past blue's back line → Red scores
    if (ballPos.x < 15.7 - ballRadius) {
      scorePoint(TeamEnum.RED, "RED SCORED BACK LINE");
    }
  }

  // ============================================================
  // Boundary brake rules — force brake when player violates zones
  // ============================================================

  // team: TeamEnum.BLUE, TeamEnum.RED, or TeamEnum.BOTH — which team(s) the rule applies to. null means disabled
  const boundaryRules = {
    circle: {
      enabled: true,
      cx: 50,
      cy: 28.125,
      radius: 40 - 28.125,
      team: TeamEnum.BOTH,
      message: "YOU CANNOT ENTER CENTER CIRCLE ON OPPONENT SERVE",
    },
    halfline: {
      enabled: true,
      x: 50,
      team: TeamEnum.BOTH,
      message: "YOU CANNOT CROSS HALF LINE",
    },
  };

  // Returns true (force brake), false (force release), or null (no opinion).
  function checkCircleBoundary(px, py, angle) {
    const c = boundaryRules.circle;
    if (!c.enabled) return null;
    if (c.team !== TeamEnum.BOTH) {
      const team = getLocalPlayerTeam();
      if (!team) return null;
      if (c.team === null) return null;
      if (c.team !== TeamEnum.BOTH && c.team !== team) return null;
    }

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
    if (h.team === null) return null;

    const team = getLocalPlayerTeam();
    if (!team) return null;

    if (h.team !== TeamEnum.BOTH && h.team !== team) return null;

    const isBlue = team === TeamEnum.BLUE;
    const inViolation = isBlue ? px > h.x : px < h.x;
    if (!inViolation) return null;

    const aimX = Math.cos(angle);
    const aimingDeeper = isBlue ? aimX > 0 : aimX < 0;
    return aimingDeeper; // true = going deeper → brake, false = retreating → release
  }

  // Returns TeamEnum.BLUE, TeamEnum.RED, or null — derived from bodyLabelCache which is built
  // from the documented interleaved Planck body order (Blue P0, Red P0, Blue P1, Red P1, …).
  function getLocalPlayerTeam() {
    if (!localPlayerBody) return null;
    const name = bodyNameCache.get(localPlayerBody);
    const label = bodyLabelCache.get(localPlayerBody);
    // console.log(`[NC-Hook] dbg Local player label: ${label}`);
    // console.log(`[NC-Hook] dbg Local player name: ${name}`);
    // console.log(`[NC-Hook] dbg cache:`, bodyNameCache);
    // console.log(`[NC-Hook] dbg cache:`, bodyLabelCache);
    // console.log(`[NC-Hook] dbg localPlayerBody:`, localPlayerBody);
    if (!label) return null;
    if (label.startsWith(TeamEnum.BLUE)) return TeamEnum.BLUE;
    if (label.startsWith(TeamEnum.RED)) return TeamEnum.RED;
    return null;
  }

  // Set by the send hook so the overlay can reflect current state
  let lastBrakeOverride = false;
  let lastBrakeMessage = "";

  // Combine all active boundary rules. Returns the brake value to send.
  function applyBoundaryBrake(angle, originalBrake) {
    if (!localPlayerBody) return originalBrake;

    const pos = localPlayerBody.getPosition();
    const checks = [
      {
        result: checkCircleBoundary(pos.x, pos.y, angle),
        rule: boundaryRules.circle,
      },
      {
        result: checkHalflineBoundary(pos.x, pos.y, angle),
        rule: boundaryRules.halfline,
      },
    ];

    // Any boundary forcing brake wins
    for (const { result, rule } of checks) {
      if (result === true) {
        lastBrakeMessage = rule.message || "BRAKE";
        return true;
      }
    }
    // Any boundary actively releasing (player aiming to escape) → release
    for (const { result } of checks) {
      if (result === false) return false;
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
    const body = wsIndexToBody.get(idx + 1); // 0 is probably the ball
    if (body) return displayLabel(body);
    // console.log(`[NC-Hook] cache`, bodyLabelCache);

    return `P${idx}`;
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
        const teamName = team === 0 ? TeamEnum.BLUE : TeamEnum.RED;
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
        if (turn === 0) {
          // Match start — randomly pick server, serve_times starts at 1
          const server = Math.random() < 0.5 ? TeamEnum.BLUE : TeamEnum.RED;
          matchState.serve_times = 1;
          lastBallSide = null;
          startServe(server);
          gameEventLog.push({
            text: `MATCH START — ${server} serves`,
            timestamp: now,
          });
        } else {
          // Kickoff — rotate server based on serve_times
          let server;
          if (matchState.serve_times >= 2) {
            // This team has served twice — switch to opponent
            server =
              matchState.last_serve === TeamEnum.BLUE
                ? TeamEnum.RED
                : TeamEnum.BLUE;
            matchState.serve_times = 0;
          } else {
            // Same team serves again
            server =
              matchState.last_serve ||
              (Math.random() < 0.5 ? TeamEnum.BLUE : TeamEnum.RED);
          }
          lastBallSide = null;
          startServe(server);
          gameEventLog.push({ text: "KICKOFF", timestamp: now });
        }
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

  let gameStateOverlayEl = null;

  function createGameStateOverlay() {
    gameStateOverlayEl = document.createElement("div");
    Object.assign(gameStateOverlayEl.style, {
      position: "fixed",
      top: "40px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "999999",
      fontFamily: "monospace",
      fontWeight: "bold",
      fontSize: "22px",
      padding: "8px 20px",
      borderRadius: "6px",
      pointerEvents: "none",
      textAlign: "center",
      display: "none",
    });
    document.body.appendChild(gameStateOverlayEl);
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
    brakeOverlayEl.style.textAlign = "center";
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
    if (!gameStateOverlayEl || !document.body.contains(gameStateOverlayEl)) {
      if (document.body) createGameStateOverlay();
    }
  }

  // ============================================================
  // Main loop — renders overlay + manages contact marker lifecycle
  // ============================================================

  function tick() {
    requestAnimationFrame(tick);
    ensureOverlay();
    if (brakeOverlayEl) {
      if (lastBrakeOverride) {
        brakeOverlayEl.textContent = lastBrakeMessage || "BRAKE";
        brakeOverlayEl.style.display = "";
      } else {
        brakeOverlayEl.style.display = "none";
      }
    }
    if (gameStateOverlayEl) {
      const gs = matchState.game_state;
      if (gs === GameState.BLUE_SERVE) {
        gameStateOverlayEl.style.background = "rgba(0,100,255,0.85)";
        gameStateOverlayEl.style.color = "#fff";
        gameStateOverlayEl.textContent = "BLUE SERVE";
        gameStateOverlayEl.style.display = "";
      } else if (gs === GameState.RED_SERVE) {
        gameStateOverlayEl.style.background = "rgba(200,0,0,0.85)";
        gameStateOverlayEl.style.color = "#fff";
        gameStateOverlayEl.textContent = "RED SERVE";
        gameStateOverlayEl.style.display = "";
      } else if (gs === GameState.SCORE_BLUE || gs === GameState.SCORE_RED) {
        gameStateOverlayEl.style.background =
          gs === GameState.SCORE_BLUE
            ? "rgba(0,100,255,0.85)"
            : "rgba(200,0,0,0.85)";
        gameStateOverlayEl.style.color = "#fff";
        gameStateOverlayEl.textContent = matchState.score_message || "";
        gameStateOverlayEl.style.display = "";
      } else {
        gameStateOverlayEl.style.display = "none";
      }
    }
    if (!overlayEl) return;

    const now = Date.now();

    // Update match state (ball position rules 7, 8, 9)
    tickMatchState();

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
