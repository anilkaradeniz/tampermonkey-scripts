# NitroClash Custom Server — Design Manual

This document describes the complete binary protocol and server architecture required to build a custom NitroClash.io-compatible game server. All information was reverse-engineered from the minified client script.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Connection Flow](#2-connection-flow)
3. [Message Format](#3-message-format)
4. [String Encoding](#4-string-encoding)
5. [HTTP Endpoints](#5-http-endpoints)
6. [Game WebSocket — Client to Server](#6-game-websocket--client-to-server)
7. [Game WebSocket — Server to Client](#7-game-websocket--server-to-client)
8. [Party WebSocket — Client to Server](#8-party-websocket--client-to-server)
9. [Party WebSocket — Server to Client](#9-party-websocket--server-to-client)
10. [Ping WebSocket](#10-ping-websocket)
11. [Game State Machine](#11-game-state-machine)
12. [Game Modes](#12-game-modes)
13. [Action Types](#13-action-types)
14. [Chat Sender Slots](#14-chat-sender-slots)
15. [Physics State Structures](#15-physics-state-structures)
16. [Timing and Tick Rate](#16-timing-and-tick-rate)
17. [Constraints and Gotchas](#17-constraints-and-gotchas)

---

## 1. Architecture Overview

The game uses three WebSocket channels and several HTTP endpoints:

| Channel | Transport | Format | Purpose |
|---------|-----------|--------|---------|
| Game WS | `wss://<game-server>` | Binary (ArrayBuffer) | Main gameplay |
| Party WS | `wss://s.nitroclash.io/team` | Binary (ArrayBuffer) | Team/party lobby |
| Ping WS | `wss://<region-server>` | Binary (ArrayBuffer) | Latency measurement |
| HTTP | `http://s.nitroclash.io` | JSON/text | Matchmaking, auth, stats |

All WebSocket connections set `binaryType = "arraybuffer"`.

---

## 2. Connection Flow

```
Client                              Server
  |                                    |
  |  GET /servers                      |
  |----------------------------------->|  Returns JSON: region -> {uri, playerCount}
  |                                    |
  |  [Open Ping WS per region]         |
  |  Send opcode 99 (x3)              |
  |<---------------------------------->|  Respond opcode 99 (pong) each time
  |  [Close Ping WS, record best RTT]  |
  |                                    |
  |  POST /?r=<region>&m=<mode>        |
  |       &u=<name>&s=<session>        |
  |       &a=<authType>                |
  |----------------------------------->|  Returns: "<serverAddr> <reservationKey> [<sessionId>]"
  |                                    |
  |  [Open Game WS to serverAddr]      |
  |  Send opcode 1 (join)             |
  |----------------------------------->|
  |                                    |
  |  Receive opcode 2 (map data)       |
  |<-----------------------------------|
  |                                    |
  |  Send opcode 99 (ping, x3)        |
  |<---------------------------------->|  Respond opcode 99 (pong) each time
  |                                    |
  |  Send opcode 3 (ready)            |
  |----------------------------------->|
  |                                    |
  |  Receive opcode 7 (full sync)      |
  |<-----------------------------------|
  |                                    |
  |  Receive opcode 9 (kickoff)        |
  |<-----------------------------------|
  |                                    |
  |  === GAMEPLAY LOOP ===             |
  |  Send opcode 2 (~60Hz)            |
  |----------------------------------->|  Client input each frame
  |  Receive opcode 5 (state update)   |
  |<-----------------------------------|  Server tick with authoritative physics
  |                                    |
```

---

## 3. Message Format

All WebSocket messages are binary. The general structure:

```
Byte 0:   Uint8   — Opcode (message type ID)
Bytes 1+: varies  — Opcode-specific payload
```

All multi-byte numbers use **big-endian** byte order (DataView default).

---

## 4. String Encoding

Strings are encoded in two formats, both using 2 bytes per character (big-endian char codes):

### Short string (Uint8 length prefix)
```
Byte 0:        Uint8  — character count (max 255)
Bytes 1..2N:   N × Uint16 — character codes (big-endian)
```
Total: `1 + 2 * length` bytes.

### Long string (Int16 length prefix)
```
Bytes 0-1:     Int16  — character count
Bytes 2..2N+1: N × Uint16 — character codes (big-endian)
```
Total: `2 + 2 * length` bytes.

Most messages use the short string format.

---

## 5. HTTP Endpoints

Base URL: `http://s.nitroclash.io`

### GET /servers
Returns JSON mapping region codes to server info with player counts.

### POST /?r=`<region>`&m=`<gameMode>`&u=`<username>`&s=`<sessionId>`&a=`<authType>`
Request a game server assignment. Returns plain text: `<serverAddress> <reservationKey> [<newSessionId>]`

### POST /login?s=`<sessionId>`&a=`<authType>`
Authenticate with Google/Facebook. Body contains the auth token.

### POST /stats/mystats?a=`<authType>`
Fetch player statistics. Body contains the session ID.

### GET /e?`<eventData>`
Analytics/telemetry. Fire-and-forget. Retries after 5 seconds on failure.

### GET /lb/lb-`<metric>`-`<period>`.json
Fetch leaderboard data.

---

## 6. Game WebSocket — Client to Server

### Opcode 1 — Join Game

Sent on WebSocket open when joining as a player.

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `1` (opcode) |
| 1 | Int32 | Reservation key (from matchmaking POST) |
| 5 | Uint8 | Username length |
| 6 | String | Username (2 bytes/char) |
| ... | Uint8 | Session ID length |
| ... | String | Session ID (2 bytes/char) |
| ... | Uint8 | Game mode |

Total: `6 + 2*usernameLen + 1 + 2*sessionIdLen + 1`

### Opcode 2 — Player Input

Sent every rendered frame (~60 Hz). **The primary gameplay message.**

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `2` (opcode) |
| 1 | Float32 | Steering angle (radians, from atan2 of cursor relative to player) |
| 5 | Uint8 | Flags: bit 0 = boost, bit 1 = brake |
| 6 | Int16 | Current ping (ms) |
| 8 | Float32 | Aim distance (cursor distance from player, 0 if unset) |

Total: **12 bytes**. Fixed size.

### Opcode 3 — Ready to Play

Sent after 3 successful ping round-trips.

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `3` (opcode) |

Total: **1 byte**.

### Opcode 4 — Chat Message

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `4` (opcode) |
| 1 | Uint8 | Message length (max 255 chars) |
| 2 | String | Message text (2 bytes/char) |

Total: `2 + 2*messageLen`

### Opcode 5 — Ready for Next Game

Sent when player clicks "Ready" on the end-of-game screen.

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `5` (opcode) |
| 1 | Uint8 | Change team? (1 = yes, 0 = no) |

Total: **2 bytes**.

### Opcode 7/1 — Join as Spectator

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `7` (opcode) |
| 1 | Uint8 | `1` (sub-opcode: join spectator) |
| 2 | Uint8 | Game mode |
| 3 | Uint8 | Username length |
| 4 | String | Username (2 bytes/char) |
| ... | Uint8 | Session ID length |
| ... | String | Session ID (2 bytes/char) |

### Opcode 7/2 — Spectate Next Game

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `7` |
| 1 | Uint8 | `2` |

Total: **2 bytes**.

### Opcode 7/3 — Spectate Previous Game

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `7` |
| 1 | Uint8 | `3` |

Total: **2 bytes**.

### Opcode 8 — Request Replay Download

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `8` (opcode) |
| 1 | Int32 | Replay ID part 1 |
| 5 | Int32 | Replay ID part 2 |
| 9 | Int32 | Replay ID part 3 |
| 13 | Int32 | Replay ID part 4 |

Total: **17 bytes**.

### Opcode 99 — Ping

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `99` |

Total: **1 byte**. Sent as `Uint8Array([99])`.

---

## 7. Game WebSocket — Server to Client

### Opcode 1 — Map Unavailable / Server Full

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `1` |

Total: **1 byte**. Client will close socket and retry matchmaking.

### Opcode 2 — Map Data

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `2` (opcode) |
| 1 | Int32 | Map ID (indexes into client-side map definitions) |
| 5 | Int32 | Match duration (seconds × 60 = total ticks) |
| 9 | Uint8 | Boost pad count (N = number of pads, each pad has x,y) |
| 10 | Float32[] | Boost pad positions: N × 2 Float32 values (x, y pairs) |
| ... | Uint8 | Game mode (optional) |

**Important:** Wall geometry is determined client-side by the Map ID, not sent by the server. Boost pad positions ARE server-controlled.

### Opcode 4 — Pong (Input Acknowledged)

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `4` |

Total: **1 byte**. Client uses this to calculate round-trip time for its ping display.

### Opcode 5 — Game State Update

The core gameplay message. Sent every server tick with authoritative physics.

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `5` (opcode) |
| 1 | Uint8 | Game state enum (2=countdown, 3=playing, 4=goal scored) |
| 2 | Int32 | Server tick number |

Then for each player (2 × playersPerTeam), **33 bytes each**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Float32 | Position X |
| +4 | Float32 | Position Y |
| +8 | Float32 | Rotation angle |
| +12 | Float32 | Velocity X |
| +16 | Float32 | Velocity Y |
| +20 | Float32 | Angular velocity |
| +24 | Float32 | Nitro/boost level (0–25) |
| +28 | Float32 | Aim angle |
| +32 | Uint8 | Flags: bit 0 = boosting, bit 1 = braking |

Then the ball, **24 bytes**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Float32 | Position X |
| +4 | Float32 | Position Y |
| +8 | Float32 | Rotation |
| +12 | Float32 | Velocity X |
| +16 | Float32 | Velocity Y |
| +20 | Float32 | Angular velocity |

Total for 3v3: `6 + (6 × 33) + 24 = 228 bytes` per tick.

### Opcode 6 — Goal Scored

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `6` (opcode) |
| 1 | Int32 | Tick number |
| 5 | Uint8 | Scoring team (0 = blue, 1 = red) |
| 6 | Uint8 | Scorer player slot index |
| 7 | Uint8 | Assister player slot index |
| 8 | Float32 | Shot speed (displayed as value × 5 km/h) |
| 12 | Int32 | Reserved |

Total: **16 bytes**.

### Opcode 7 — Full State Sync

Sent once after the player is ready. Contains everything needed to initialize the game view.

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `7` (opcode) |
| 1 | Uint8 | Game state enum |
| 2 | Uint8 | This client's player slot index |
| 3 | Int32 | Current server tick |
| 7 | Int32 | Countdown ticks remaining |
| 11 | Int16 | Blue team score |
| 13 | Int16 | Red team score |

Then per player (2 × playersPerTeam), **29 bytes each**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Float32 | Position X |
| +4 | Float32 | Position Y |
| +8 | Float32 | Rotation |
| +12 | Float32 | Velocity X |
| +16 | Float32 | Velocity Y |
| +20 | Float32 | Angular velocity |
| +24 | Float32 | Aim angle |
| +28 | Uint8 | Flags (boost/brake) |

Then ball (24 bytes, same as opcode 5).

Then per player: length-prefixed string (player name).

Then per boost pad: Uint8 visibility (0 = hidden, non-zero = visible).

### Opcode 8 — Game End Summary (v1)

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `8` (opcode) |
| 1 | Int16 | Blue score |
| 3 | Int16 | Red score |
| 5 | Int32 | Reserved |

Then per player, **6 bytes each**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Uint8 | Goals |
| +1 | Uint8 | Assists |
| +2 | Int32 | Points |

Then optionally, **16 bytes**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Int32 | Replay ID part 1 |
| +4 | Int32 | Replay ID part 2 |
| +8 | Int32 | Replay ID part 3 |
| +12 | Int32 | Replay ID part 4 |

### Opcode 9 — Round Reset / Kickoff

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `9` (opcode) |
| 1 | Int32 | Start tick (0 for first round) |
| 5 | Int32 | Countdown delay (ms) |

Then per player, **12 bytes each**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Float32 | Position X |
| +4 | Float32 | Position Y |
| +8 | Float32 | Rotation |

Then ball, **12 bytes** (same layout: x, y, rotation).

Client resets all velocities to zero, makes all boost pads visible, and starts the countdown.

### Opcode 10 — Player Name Change

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `10` (opcode) |
| 1 | Uint8 | Player slot index |
| 2 | String | New name (length-prefixed) |

### Opcode 11 — Boost Pad Visibility

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `11` (opcode) |
| 1 | Uint8 | Boost pad index |
| 2 | Uint8 | Visibility (255 = visible, < 255 = hidden) |

### Opcode 12 — Kicked for Inactivity

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `12` |

Total: **1 byte**.

### Opcode 13 — Chat Message

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `13` (opcode) |
| 1 | Uint8 | Sender slot (see [Chat Sender Slots](#14-chat-sender-slots)) |
| 2 | String | Message text (length-prefixed) |

### Opcode 14 — Game End Summary (v2, with saves)

Same as opcode 8 but per-player stats are **7 bytes each**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Uint8 | Goals |
| +1 | Uint8 | Assists |
| +2 | Uint8 | Saves |
| +3 | Int32 | Points |

### Opcode 15 — Player Action Award

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `15` (opcode) |
| 1 | Uint8 | Player slot index |
| 2 | Uint8 | Action type (see [Action Types](#13-action-types)) |
| 3 | Int16 | Points awarded |

Total: **5 bytes**.

### Opcode 16 — Player Ready Indicator

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `16` (opcode) |
| 1 | Uint8 | Player slot index |

Total: **2 bytes**. Shows checkmark on end screen.

### Opcode 17 — Kicked for Not Ready

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `17` |

Total: **1 byte**.

### Opcode 18 — Scoreboard Stats Update

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `18` (opcode) |

Then per player, **8 bytes each**:

| Offset | Type | Field |
|--------|------|-------|
| +0 | Uint8 | Goals |
| +1 | Uint8 | Assists |
| +2 | Uint8 | Saves |
| +3 | Int16 | Points |
| +5 | Int16 | Ping |
| +7 | Uint8 | Level |

### Opcode 19 — Leaderboard Update

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `19` (opcode) |
| 1 | Int16 | Total player count |
| 3 | Int16 | This player's rank (0-indexed) |
| 5 | Int32 | This player's points |
| 9 | Uint8 | Entry count (N) |

Then N entries:

| Type | Field |
|------|-------|
| String | Player name (length-prefixed) |
| Int32 | Points |

### Opcode 20 — Boost/Nitro Update

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `20` (opcode) |
| 1 | Uint8 | Player slot index |
| 2 | Float32 | New nitro value |

Total: **6 bytes**.

### Opcode 21 — Level Progress / Achievements

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `21` (opcode) |
| 1 | Uint32 | Old points total |
| 5 | Uint32 | New points total |
| 9 | Uint8 | Achievement count (N) |

Then N achievements:

| Type | Field |
|------|-------|
| Uint16 | Achievement ID |

### Opcode 22 — Aim Distance Update

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `22` (opcode) |

Then per player (2 × playersPerTeam):

| Type | Field |
|------|-------|
| Float32 | Aim distance |

### Opcode 23 — Replay Start

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `23` (opcode) |
| 1 | Int32 | Start tick |
| 5 | Int32 | Duration (ticks) |

Total: **9 bytes**.

### Opcode 24 — Skip Replay Vote Count

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `24` (opcode) |
| 1 | Int32 | Number of skip votes |

Total: **5 bytes**.

### Opcode 25 — Replay File Data

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `25` (opcode) |
| 1+ | Raw bytes | Replay binary data (saved as .ncr file) |

### Opcode 99 — Pong

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `99` |

Total: **1 byte**.

---

## 8. Party WebSocket — Client to Server

Party WebSocket connects to: `wss://<matchmaking-host>/team`

### Opcode 1 — Join Party

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `1` (opcode) |
| 1 | Uint8 | Party code length |
| 2 | String | Party code (2 bytes/char) |

### Opcode 2 — Set Player Name

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `2` (opcode) |
| 1 | Uint8 | Name length |
| 2 | String | Name (2 bytes/char) |

### Opcode 3 — Ready (with name and side)

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `3` (opcode) |
| 1 | Uint8 | Name length |
| 2 | String | Name (2 bytes/char) |
| ... | Uint8 | Side/team (0 or 1) |

### Opcode 4 — Set Game Mode, Region, Private

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `4` (opcode) |
| 1 | Uint8 | Game mode |
| 2 | Uint8 | Region string length |
| 3 | String | Region (2 bytes/char) |
| ... | Uint8 | Is private (1 = yes, 0 = no) |

### Opcode 5 — Switch Side

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `5` |

Total: **1 byte**.

### Opcode 6 — Party Chat

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `6` (opcode) |
| 1 | Uint8 | Message length |
| 2 | String | Message (2 bytes/char) |

### Opcode 99 — Party Ping (keepalive)

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `99` |

Total: **1 byte**. Client sends every **10 seconds**.

---

## 9. Party WebSocket — Server to Client

### Opcode 1 — Party State Update

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `1` (opcode) |
| 1 | Uint8 | Member count (N) |

Then per member:

| Type | Field |
|------|-------|
| Uint8 | Is host (1 = yes) |
| Uint8 | Team (0 = blue, 1 = red) |
| Uint8 | Is ready (1 = yes) |
| String | Name (length-prefixed) |

After all members:

| Type | Field |
|------|-------|
| Uint8 | Game mode (200 = no change) |
| Uint8 | Is private (1 = yes) |
| Uint8 | Is host flag (1 = this client is host) |
| String | Forced region (length-prefixed, empty if none) |

### Opcode 3 — Start Game

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `3` (opcode) |
| 1 | Int32 | Reservation key |
| 5 | String | Server address (length-prefixed) |

Client closes the party WS and connects to the game server.

### Opcode 6 — Party Chat Message

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `6` (opcode) |
| 1+ | String | Message (length-prefixed) |

### Opcode 50 — Party Full

| Offset | Type | Field |
|--------|------|-------|
| 0 | Uint8 | `50` |

Total: **1 byte**. Client shows alert and disconnects.

---

## 10. Ping WebSocket

Used for measuring latency to each region before matchmaking.

- Client opens one WS per region
- On open: sends `Uint8Array([99])`
- Server responds with opcode `99`
- Client records RTT, sends next ping (up to 3 rounds)
- After 3 pongs: closes socket, records best latency for that region
- Lowest-latency region is auto-selected

---

## 11. Game State Machine

Variable `ne` in the client tracks the current game phase:

| Value | State | Description |
|-------|-------|-------------|
| 0 | Idle | Not in a game |
| 2 | Countdown | Pre-kickoff countdown running |
| 3 | Playing | Active gameplay |
| 4 | Goal Paused | Goal was scored, brief pause |
| 5 | End Screen | Game over, showing results |
| 7 | Replay | Watching instant replay |

### State transitions the server must drive:

```
[Connect] → Server sends opcode 7 (sync, state=2 or 3)
         → Server sends opcode 9 (kickoff, state=2)
    Countdown expires → state 3 (playing, sent in opcode 5)
    Goal scored → Server sends opcode 6 → state 4
                → Server sends opcode 23 (replay) → state 7
                → Server sends opcode 9 (reset) → state 2
    Match ends → Server sends opcode 8 or 14 → state 5
    Player readies up → Server sends opcode 7 + 9 → new match
```

---

## 12. Game Modes

| Value | Mode | Players Per Team |
|-------|------|-----------------|
| 0 | Soccer 3v3 | 3 |
| 1 | Default 3v3 | 3 |
| 2 | 2v2 | 2 |
| 3 | 1v1 | 1 |
| 4 | 5v5 | 5 |
| 5 | Offline/Practice | N/A |

The players-per-team value determines:
- How many player blocks appear in opcode 5/7/9 (always `2 × playersPerTeam`)
- Player slot indices: 0 to `playersPerTeam - 1` = blue team, `playersPerTeam` to `2 × playersPerTeam - 1` = red team

---

## 13. Action Types

Used in opcode 15 (Player Action Award):

| Value | Action | Description |
|-------|--------|-------------|
| 0 | Goal | Scored a goal |
| 1 | Assist | Assisted a goal |
| 2 | Save | Prevented a goal |
| 3 | Long Goal | Scored from distance |
| 4 | Overtime Goal | Scored in overtime |
| 5 | Hat Trick | Third goal by same player |
| 6 | Shot On Goal | Shot toward the goal |
| 7 | Center Ball | Centered the ball |
| 8 | Clear Ball | Cleared from defensive zone |
| 9 | First Touch | First touch after kickoff |
| 10 | Victory | Winning team award |

---

## 14. Chat Sender Slots

Used in opcode 13, byte 1:

| Value | Meaning |
|-------|---------|
| 0–9 | Player slot index (team color derived from slot) |
| 200 | Admin message |
| 254 | Info/system notice |
| 255 | System message |

---

## 15. Physics State Structures

### Player State (opcode 5) — 33 bytes

```
Float32  posX
Float32  posY
Float32  rotation          // radians
Float32  velocityX
Float32  velocityY
Float32  angularVelocity
Float32  nitro             // 0–25 range
Float32  aimAngle          // radians
Uint8    flags             // bit 0 = boosting, bit 1 = braking
```

### Player State (opcode 7, full sync) — 29 bytes

Same as above but **without nitro** (nitro is sent separately or starts at default).

### Ball State — 24 bytes

```
Float32  posX
Float32  posY
Float32  rotation
Float32  velocityX
Float32  velocityY
Float32  angularVelocity
```

### Player Reset Position (opcode 9) — 12 bytes

```
Float32  posX
Float32  posY
Float32  rotation
```

All velocities are implicitly zero after a reset.

---

## 16. Timing and Tick Rate

- **Client input rate:** ~60 Hz (once per rendered frame)
- **Server tick rate:** Determined by match duration encoding: `duration_ticks = seconds × 60`, implying **60 ticks/second**
- **Initial ping handshake:** 3 round-trips before sending opcode 3 (ready)
- **Party keepalive:** Opcode 99 every 10,000 ms
- **Client-side AFK timeout:** 20 seconds of no mouse/keyboard/touch input → auto-disconnect
- **Server-side AFK kick:** Server sends opcode 12

---

## 17. Constraints and Gotchas

### Wall geometry is client-side
The Map ID in opcode 2 indexes into hardcoded map definitions in the client. The server does not send wall positions. To use custom wall layouts, you must either:
- Use an existing Map ID and accept its walls
- Patch the client via Tampermonkey to inject custom map geometry

### Physics prediction mismatch
The client runs its own physics simulation for prediction. If your server's physics constants (gravity, friction, restitution, car acceleration, ball mass, etc.) differ from the client's built-in engine, players will see rubber-banding as the client's prediction gets corrected by server state updates every tick.

### Player slot indexing
- Blue team: slots `0` to `playersPerTeam - 1`
- Red team: slots `playersPerTeam` to `2 × playersPerTeam - 1`
- The total player array in state updates is always `2 × playersPerTeam` entries, even if some slots are empty

### Byte order
All multi-byte values use **big-endian** encoding (DataView default in the client).

### Action types are hardcoded
The client only displays the 11 predefined action types (0–10). Custom scoring actions cannot be shown without client patching.

### Replay IDs
The replay ID is a 128-bit value (4 × Int32). If you don't implement replays, omit the 16 trailing bytes from opcode 8/14 or don't send opcode 23.

### Boost pad positions vs map walls
Boost pad coordinates are sent by the server in opcode 2 and can be freely customized. Their visibility is toggled via opcode 11 during gameplay.
