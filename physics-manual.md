# NitroClash Physics Manual

Complete physics parameters extracted from the client script. The client uses **planck.js** (Box2D JavaScript port) for both client-side prediction and offline training mode. All values here are sufficient to build a physics-identical server.

---

## Table of Contents

1. [World Setup](#1-world-setup)
2. [Simulation Timing](#2-simulation-timing)
3. [Field Dimensions](#3-field-dimensions)
4. [Car (Player) Physics](#4-car-player-physics)
5. [Ball Physics](#5-ball-physics)
6. [Wall Physics](#6-wall-physics)
7. [Map Border Vertices](#7-map-border-vertices)
8. [Boost / Nitro System](#8-boost--nitro-system)
9. [Boost Pad Positions](#9-boost-pad-positions)
10. [Collision Filtering](#10-collision-filtering)
11. [Game Mode Modifiers](#11-game-mode-modifiers)
12. [Movement & Steering Logic](#12-movement--steering-logic)
13. [Spawn Positions](#13-spawn-positions)
14. [Planck.js Internal Constants](#14-planckjs-internal-constants)
15. [Quick Reference Summary](#15-quick-reference-summary)

---

## 1. World Setup

| Parameter | Value | Notes |
|-----------|-------|-------|
| Physics library | planck.js | Box2D port, Copyright 2016-2017 Ali Shakiba |
| Gravity | `Vec2(0, 0)` | Zero gravity — top-down game |
| allowSleep | `true` | |
| warmStarting | `true` | |
| continuousPhysics | `true` | |
| subStepping | `false` | |
| blockSolve | `true` | |
| velocityIterations | `8` | planck default, not overridden |
| positionIterations | `3` | planck default, not overridden |

---

## 2. Simulation Timing

| Parameter | Value |
|-----------|-------|
| Tick rate | **60 Hz** (fixed timestep) |
| Time step | `1/60` seconds (~16.667 ms) |
| `O.step()` call | `O.step(1/60)` every tick |

The game loop uses `simulationTimestep = 1e3 / 60` (ms). Both online catch-up steps and offline steps use `O.step(1/60)`.

---

## 3. Field Dimensions

| Parameter | Value |
|-----------|-------|
| `WORLD_WIDTH` | **100** world units |
| `WORLD_HEIGHT` | **56.25** world units |
| `MAP_VIEWBOX` | 1920 x 1080 (rendering) |
| Left goal line X | ~4.375 |
| Right goal line X | ~95.508 |
| Goal Y range | 23.4375 to 32.8125 |
| Goal height | **9.375** world units |

The aspect ratio is 16:9 (100 / 56.25 = 1920 / 1080).

---

## 4. Car (Player) Physics

### Body Properties

| Parameter | Value |
|-----------|-------|
| Body type | `DYNAMIC` |
| Shape | `Circle` |
| Radius | **0.6103515625** world units |
| linearDamping | **0** (planck default, not specified) |
| angularDamping | **0.5** |

### Fixture Properties

| Parameter | Value |
|-----------|-------|
| density | **0.05** |
| friction | **0.4** |
| restitution | **0.8** |

### Movement Constants

| Parameter | Raw Value | Notes |
|-----------|-----------|-------|
| `PLAYER_SPEED` | **0.75** | Base acceleration per second |
| `PLAYER_MAX_SPEED` | **10** | World units per second |
| `PLAYER_BRAKE_STRENGTH` | **0.005** | Impulse multiplier against velocity |
| Max turn rate | **0.1 radians/tick** | ~5.73 deg/tick, ~344 deg/sec |
| Drift factor | **0.5** | Default, server can override via opcode 20 |

---

## 5. Ball Physics

### Body Properties

| Parameter | Value (Ge >= 1) | Value (Ge = 0) |
|-----------|-----------------|----------------|
| Body type | `DYNAMIC` | `DYNAMIC` |
| Shape | `Circle` | `Circle` |
| Radius | **0.9765625** | **0.8138** (100/81.92/1.5) |
| linearDamping | **0.4** | **0.4** |
| angularDamping | **0.2** | **0.2** |

### Fixture Properties

| Parameter | Value (Ge >= 1) | Value (Ge = 0) |
|-----------|-----------------|----------------|
| density | **0.004167** (0.005/1.2) | **0.005** |
| friction | **0.4** | **0.4** |
| restitution | **1.0** (perfect bounce) | **1.0** |

The ball has **no speed cap** — it relies on `linearDamping: 0.4` to naturally decelerate.

---

## 6. Wall Physics

| Parameter | Value |
|-----------|-------|
| Body type | `STATIC` (default) |
| Shape | `Chain` (polyline segments) |
| restitution | **0.2** |
| friction | **0.6** |
| density | `0` (static body default) |

There are **6 chain shapes** forming the field boundary. See [Map Border Vertices](#7-map-border-vertices).

---

## 7. Map Border Vertices

The field has 6 chain shapes. Each is defined as flat arrays of `[x, y, x, y, ...]` coordinates.

### Border 0 — Top wall, left side (goal post to center)

```
4.345703, 23.4375,
7.8125, 23.4375,
8.747321, 23.065054,
9.600431, 22.357701,
10.298549, 21.358265,
10.775453, 20.120537,
10.975303, 18.708337,
10.854316, 17.19305,
10.382707, 15.648956,
9.545563, 14.147266,
8.34465, 12.754761,
7.248413, 11.872643,
6.251122, 11.155698,
5.370048, 10.56851,
4.622464, 10.075661,
4.025644, 9.641733,
3.596858, 9.23131,
3.352381, 8.808973,
3.308487, 8.339305,
3.481449, 7.786888,
3.887539, 7.116305,
4.545181, 6.294025,
5.472816, 5.286527,
6.388775, 4.490235,
8.006918, 3.880943,
50.3125, 3.880943
```

### Border 1 — Top wall, right side (goal post to center)

```
95.6543, 23.4375,
92.1875, 23.4375,
91.25268, 23.065054,
90.39957, 22.357701,
89.70145, 21.358265,
89.22455, 20.120537,
89.0247, 18.708337,
89.14568, 17.19305,
89.61729, 15.648956,
90.45444, 14.147266,
91.65535, 12.754761,
92.75159, 11.872643,
93.74888, 11.155698,
94.62995, 10.56851,
95.37754, 10.075661,
95.97436, 9.641733,
96.40314, 9.23131,
96.64762, 8.808973,
96.69151, 8.339305,
96.51855, 7.786888,
96.11246, 7.116305,
95.45482, 6.294025,
94.52718, 5.286527,
93.61122, 4.490235,
91.99308, 3.880943,
49.6875, 3.880943
```

### Border 2 — Bottom wall, left side

```
4.345703, 32.8125,
7.8125, 32.8125,
8.747321, 33.184946,
9.600431, 33.892299,
10.298549, 34.891735,
10.775453, 36.129463,
10.975303, 37.541663,
10.854316, 39.05695,
10.382707, 40.601044,
9.545563, 42.102734,
8.34465, 43.495239,
7.248413, 44.377357,
6.251122, 45.094302,
5.370048, 45.68149,
4.622464, 46.174339,
4.025644, 46.608267,
3.596858, 47.01869,
3.352381, 47.441027,
3.308487, 47.910695,
3.481449, 48.463112,
3.887539, 49.133695,
4.545181, 49.955975,
5.472816, 50.963473,
6.388775, 51.759765,
8.006918, 52.369057,
50.3125, 52.369057
```

### Border 3 — Bottom wall, right side

```
95.6543, 32.8125,
92.1875, 32.8125,
91.25268, 33.184946,
90.39957, 33.892299,
89.70145, 34.891735,
89.22455, 36.129463,
89.0247, 37.541663,
89.14568, 39.05695,
89.61729, 40.601044,
90.45444, 42.102734,
91.65535, 43.495239,
92.75159, 44.377357,
93.74888, 45.094302,
94.62995, 45.68149,
95.37754, 46.174339,
95.97436, 46.608267,
96.40314, 47.01869,
96.64762, 47.441027,
96.69151, 47.910695,
96.51855, 48.463112,
96.11246, 49.133695,
95.45482, 49.955975,
94.52718, 50.963473,
93.61122, 51.759765,
91.99308, 52.369057,
49.6875, 52.369057
```

### Border 4 — Left goal line

```
4.375, 23.4375,
4.375, 32.8125
```

### Border 5 — Right goal line

```
95.50781, 23.4375,
95.50781, 32.8125
```

### Derived Field Geometry

- Top wall runs at Y ~ 3.88
- Bottom wall runs at Y ~ 52.37
- Left goal opening: X ~ 4.35–4.375, Y = 23.4375 to 32.8125
- Right goal opening: X ~ 95.508–95.654, Y = 23.4375 to 32.8125
- The corners have curved ramps connecting the walls to the goal posts (the long vertex lists)

---

## 8. Boost / Nitro System

| Parameter | Value |
|-----------|-------|
| Starting nitro (online) | **25** |
| Starting nitro (offline) | **100** |
| Maximum nitro | **100** |
| Drain rate | **1 per tick** while boosting (= 60/sec) |
| Full boost duration | 100/60 = **~1.667 seconds** |
| Refill (offline) | Resets to 100 when hitting 0 |
| Refill (online) | Server-controlled via state updates |

### Boost Effects on Movement

| Parameter | Normal | Boosting |
|-----------|--------|----------|
| Acceleration impulse | `e` | `e * 2` |
| Max speed | 10 | **20** |
| Over-speed drag applied | No | Yes (when Ge >= 1) |

---

## 9. Boost Pad Positions

14 pads defined as (x, y) pairs. Pad visual size is ~2.34 x 2.34 world units.

| Pad | X | Y | Location |
|-----|---|---|----------|
| 1 | 15.696192 | 47.998825 | Bottom-left |
| 2 | 15.696192 | 8.251172 | Top-left |
| 3 | 14.100928 | 28.125 | Left-center |
| 4 | 35.927097 | 34.41909 | Left-mid bottom |
| 5 | 35.927097 | 21.83091 | Left-mid top |
| 6 | 50.0 | 50.166016 | Center-bottom |
| 7 | 50.0 | 34.41909 | Center lower-mid |
| 8 | 50.0 | 21.83091 | Center upper-mid |
| 9 | 50.0 | 6.0839844 | Center-top |
| 10 | 64.0729 | 34.41909 | Right-mid bottom |
| 11 | 64.0729 | 21.83091 | Right-mid top |
| 12 | 84.30381 | 47.998825 | Bottom-right |
| 13 | 85.85269 | 28.125 | Right-center |
| 14 | 84.30381 | 8.251172 | Top-right |

Pickup detection is **server-side only**. The server sends opcode 11 to toggle pad visibility. No client-side collision logic exists for pads.

---

## 10. Collision Filtering

**No custom collision filters.** All bodies use planck.js defaults:

| Parameter | Value |
|-----------|-------|
| filterGroupIndex | `0` |
| filterCategoryBits | `1` (0x0001) |
| filterMaskBits | `65535` (0xFFFF) |

All bodies collide with all other bodies: players hit players, ball, and walls.

**No contact listeners** are registered. All collision response is handled by planck.js built-in physics (restitution, friction, impulse resolution). Goal detection and boost pad collection are server-side.

---

## 11. Game Mode Modifiers

| Ge | Mode | Players/Team | Ball Radius | Speed Mult | Brake Mult | Ball Density Mult |
|----|------|-------------|-------------|------------|------------|-------------------|
| 0 | Classic 3v3 | 3 | 0.8138 | 1.0x | 1.0x | 1.0x |
| 1 | Standard 3v3 | 3 | 0.9765625 | 1.5x | 1.5x | 1/1.2x |
| 2 | 2v2 | 2 | 0.9765625 | 1.5x | 1.5x | 1/1.2x |
| 3 | 1v1 | 1 | 0.9765625 | 1.5x | 1.5x | 1/1.2x |
| 4 | 5v5 | 5 | 0.9765625 | 1.5x | 1.5x | 1/1.2x |
| 5 | Offline | 3 | 0.9765625 | 1.5x | 1.5x | 1/1.2x |

When `Ge >= 1` (all modes except Classic):
- `PLAYER_SPEED` per tick: `(0.75 / 60) * 1.5 = 0.01875`
- `PLAYER_BRAKE_STRENGTH`: `0.005 * 1.5 = 0.0075`
- Ball density: `0.005 / 1.2 = 0.004167`
- Ball radius: `0.9765625`
- Over-speed deceleration is applied

When `Ge = 0` (Classic):
- `PLAYER_SPEED` per tick: `0.75 / 60 = 0.0125`
- `PLAYER_BRAKE_STRENGTH`: `0.005`
- Ball density: `0.005`
- Ball radius: `100 / 81.92 / 1.5 ≈ 0.8138`
- No over-speed deceleration

---

## 12. Movement & Steering Logic

### Per-tick movement (pseudocode)

```
// Constants for this tick
e = (PLAYER_SPEED / 60) * (Ge >= 1 ? 1.5 : 1)
brakeStr = PLAYER_BRAKE_STRENGTH * (Ge >= 1 ? 1.5 : 1)
isBoosting = flags & 1
isBraking  = flags & 2

// 1. Apply brake impulse
if (isBraking):
    brakeImpulse = -velocity * brakeStr
    body.applyLinearImpulse(brakeImpulse, body.position)

// 2. Calculate steering direction with drift
driftFactor = Fe[playerSlot]  // default 0.5, server can change
velocityAngle = atan2(velocity.y, velocity.x)
speed = velocity.length()
angleDiff = normalizeAngle(inputAngle - velocityAngle)

if (speed > 0):
    if (|angleDiff| < PI/2):
        steerAngle = inputAngle + driftFactor * normalizeAngle(velocityAngle - inputAngle)
    else:
        steerAngle = inputAngle - driftFactor * normalizeAngle(velocityAngle + PI - inputAngle)
else:
    steerAngle = inputAngle

// 3. Calculate force direction and magnitude
forceMag = e * (isBoosting ? 2 : 1)
force = Vec2(cos(steerAngle) * forceMag, sin(steerAngle) * forceMag)

// 4. Max speed enforcement
maxSpd = PLAYER_MAX_SPEED * (isBoosting ? 2 : 1)
newVel = velocity + force

if (newVel.length() <= maxSpd OR newVel.length() < velocity.length()):
    body.applyLinearImpulse(force, body.position)
else:
    // Clamp: redirect force to maintain current speed
    clamped = normalize(newVel) * velocity.length() - velocity
    body.applyLinearImpulse(clamped, body.position)

// 5. Over-speed drag (Ge >= 1 only)
if (Ge >= 1 AND velocity.length() > maxSpd):
    drag = velocity * 0.01 * -e
    body.applyLinearImpulse(drag, body.position)

// 6. Drain nitro if boosting
if (isBoosting AND nitro > 0):
    nitro -= 1  // per tick

// 7. Turn the car body toward input angle
angleDelta = normalizeAngle(inputAngle - body.angle)
turnAmount = clamp(angleDelta, -0.1, 0.1)  // max 0.1 rad/tick
body.setTransform(body.position, body.angle + turnAmount)

// 8. Step physics
world.step(1/60)
```

### Angle normalization (`zn` function)

Normalizes an angle difference to the range `(-PI, PI]`:

```
function normalizeAngle(from, to):
    diff = to - from
    while (diff > PI):  diff -= 2*PI
    while (diff < -PI): diff += 2*PI
    return diff
```

---

## 13. Spawn Positions

### Offline / Training Mode

| Entity | X | Y |
|--------|---|---|
| Ball | 50.0 (WORLD_WIDTH/2) | 28.125 (WORLD_HEIGHT/2) |
| Player 0 (you) | 25.0 (0.25 * WORLD_WIDTH) | 28.125 (WORLD_HEIGHT/2) |
| Player 1 (AI) | 97.0 (0.97 * WORLD_WIDTH) | 28.125 (WORLD_HEIGHT/2) |

The training AI is set to `{ angle: 0, boost: false, brake: true }` — it just brakes and stays still.

### Online Mode

Spawn positions are sent by the server via opcode 9 (round reset). The server decides placement.

---

## 14. Planck.js Internal Constants

These Box2D constants affect collision resolution and are baked into planck.js:

| Setting | Value | Description |
|---------|-------|-------------|
| `maxManifoldPoints` | 2 | Max contact points per manifold |
| `maxPolygonVertices` | 12 | Max vertices per polygon shape |
| `aabbExtension` | 0.1 | Broadphase AABB padding |
| `aabbMultiplier` | 2 | AABB movement prediction factor |
| `linearSlop` | 0.005 | Collision tolerance |
| `angularSlop` | 2/180 * PI (~0.0349 rad) | Angular tolerance |
| `polygonRadius` | 0.01 | Polygon skin radius |
| `maxSubSteps` | 8 | Max TOI sub-steps |
| `maxTOIContacts` | 32 | Max TOI contacts per step |
| `maxTOIIterations` | 20 | Max TOI solver iterations |
| `maxDistnceIterations` | 20 | Max distance iterations |
| `velocityThreshold` | 1 | Below this speed, inelastic collision |
| `maxLinearCorrection` | 0.2 | Max position correction per step |
| `maxAngularCorrection` | 8/180 * PI (~0.1396 rad) | Max angular correction per step |
| **`maxTranslation`** | **2** | Max body displacement per step |
| **`maxRotation`** | **0.5 * PI** (~1.5708 rad) | Max rotation per step |
| `baumgarte` | 0.2 | Position error correction rate |
| `toiBaugarte` | 0.75 | TOI position correction rate |
| `timeToSleep` | 0.5 | Seconds of inactivity before sleep |
| `linearSleepTolerance` | 0.01 | Linear velocity sleep threshold |
| `angularSleepTolerance` | 2/180 * PI | Angular velocity sleep threshold |

---

## 15. Quick Reference Summary

All values needed to create a physics-identical simulation:

```javascript
// === World ===
const GRAVITY              = { x: 0, y: 0 };
const TIME_STEP            = 1 / 60;            // seconds
const VELOCITY_ITERATIONS  = 8;
const POSITION_ITERATIONS  = 3;

// === Field ===
const WORLD_WIDTH          = 100;
const WORLD_HEIGHT         = 56.25;

// === Player (Car) Body ===
const PLAYER_RADIUS            = 0.6103515625;
const PLAYER_LINEAR_DAMPING    = 0;             // planck default
const PLAYER_ANGULAR_DAMPING   = 0.5;
const PLAYER_DENSITY           = 0.05;
const PLAYER_FRICTION          = 0.4;
const PLAYER_RESTITUTION       = 0.8;

// === Player Movement ===
const PLAYER_SPEED             = 0.75;          // base accel/sec
const PLAYER_MAX_SPEED         = 10;            // units/sec
const PLAYER_BRAKE_STRENGTH    = 0.005;
const PLAYER_MAX_TURN_RATE     = 0.1;           // rad/tick
const PLAYER_DRIFT_FACTOR      = 0.5;           // default

// === Ball Body ===
const BALL_RADIUS_CLASSIC      = 0.8138;        // Ge=0
const BALL_RADIUS_STANDARD     = 0.9765625;     // Ge>=1
const BALL_LINEAR_DAMPING      = 0.4;
const BALL_ANGULAR_DAMPING     = 0.2;
const BALL_DENSITY_CLASSIC     = 0.005;         // Ge=0
const BALL_DENSITY_STANDARD    = 0.004167;      // Ge>=1 (0.005/1.2)
const BALL_FRICTION            = 0.4;
const BALL_RESTITUTION         = 1.0;           // perfect bounce

// === Walls ===
const WALL_RESTITUTION         = 0.2;
const WALL_FRICTION            = 0.6;

// === Nitro/Boost ===
const NITRO_START_ONLINE       = 25;
const NITRO_START_OFFLINE      = 100;
const NITRO_MAX                = 100;
const NITRO_DRAIN_PER_TICK     = 1;
const BOOST_FORCE_MULTIPLIER   = 2;             // 2x impulse
const BOOST_SPEED_MULTIPLIER   = 2;             // 2x max speed
const BOOST_OVER_SPEED_DECAY   = 0.01;          // drag factor

// === Game Mode Multipliers (Ge >= 1) ===
const MODE_SPEED_MULT          = 1.5;
const MODE_BRAKE_MULT          = 1.5;
const MODE_BALL_DENSITY_DIV    = 1.2;
```
