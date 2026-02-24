#!/usr/bin/env bash
set -e

BASE="c:/Users/can19/Downloads/nc"
REPO="$BASE/tampermonkey-scripts"

commit_version() {
  local src="$1"
  local msg_file="$2"
  # Remove all tracked files (keep .git and this script)
  find "$REPO" -maxdepth 1 -not -name '.git' -not -name 'do_commits.sh' -not -path "$REPO" -exec rm -rf {} +
  # Copy all files from source folder
  cp -r "$src"/. "$REPO/"
  cd "$REPO"
  git add -A
  git commit -F "$msg_file"
}

write_msg() {
  printf '%s' "$1" > /tmp/nc_commit_msg.txt
}

# --- Copy 1 ---
write_msg "Initial commit: position logger with overlay scaffold

Adds nc-pixi-hook.user.js v0.1 with a basic periodic position logger
that hooks into the Planck.js world via PIXI, printing body positions
to an on-page overlay. Also adds nc-inject.user.js, patch-script.js,
and physics_base.py for initial map-border geometry reference."
commit_version "$BASE/tampermonkey copy" /tmp/nc_commit_msg.txt

# --- Copy 2 ---
write_msg "Rewrite pixi hook as real-time collision detection overlay (v0.2)

Replace the simple position logger with a full overlay system:
- Hardcode MAP_BORDERS and WALL_SEGMENTS from physics_base.py
- Add pointToSegmentDistance, ballToPlayerDist, playerToPlayerDist helpers
- Add detectCollisions() covering ball-player, player-player, and ball-wall
- Render an event log with 3s linger via requestAnimationFrame DOM overlay
- Remove old PIXI hook and startPositionLogger"
commit_version "$BASE/tampermonkey copy 2" /tmp/nc_commit_msg.txt

# --- Copy 3 ---
write_msg "Replace hardcoded physics constants with dynamic runtime extraction (v0.3)

Instead of baking in PLAYER_RADIUS, BALL_RADIUS, and wall geometry:
- Add extractWallSegments() to read chain/edge fixtures from static Planck bodies
- Rewrite classifyBodies() to auto-detect player vs ball radius by frequency
- Pass live playerRadius/ballRadius into detectCollisions()
- Add player-wall collision detection"
commit_version "$BASE/tampermonkey copy 3" /tmp/nc_commit_msg.txt

# --- Copy 4 ---
write_msg "Switch collision detection to event-driven Planck.js contacts (v0.4)

Replace distance-polling with native physics callbacks:
- Add installContactListener() using planck.World begin-contact/end-contact
- Add bodyLabelCache (body to label map) with rebuildBodyLabels()
- Track activeContacts map for currently-touching pairs
- Show active contacts section in overlay
- Remove all manual distance math (pointToSegmentDistance, detectCollisions, extractWallSegments)"
commit_version "$BASE/tampermonkey copy 4" /tmp/nc_commit_msg.txt

# --- Copy 5 ---
write_msg "Add PIXI visual contact markers and player name resolution (v0.5)

Render red circles on the game canvas at collision points:
- Add hookPIXI() to capture stage via WebGLRenderer/CanvasRenderer hooks
- Add findGameWorldContainer() via BFS through PIXI stage using ball position
- Add spawnContactCircle(x, y) drawing fading PIXI.Graphics markers
- Add refreshPlayerNames() scanning PIXI.Text nodes for nametag matching
- Detect local player by white nametag fill color
- Fix team assignment to interleaved order (blue0, red0, blue1, red1...)"
commit_version "$BASE/tampermonkey copy 5" /tmp/nc_commit_msg.txt

# --- Copy 6 ---
write_msg "Add idNameCache for internal label to display name bridging (v0.6)

Introduce idNameCache map populated alongside bodyNameCache so that
internal body ID labels can be resolved to human-readable display names
throughout the codebase. Minor code style cleanup; no functional changes
to collision detection or overlay rendering."
commit_version "$BASE/tampermonkey copy 6" /tmp/nc_commit_msg.txt

# --- Copy 7 ---
write_msg "Add WebSocket game event parsing and right-side events overlay (v0.7)

Intercept binary WS messages to surface in-game events:
- Add hookWebSocket() wrapping WebSocket.prototype.send
- Parse message types: 6 (goal), 9 (kickoff), 15 (player actions), 8/14 (match end)
- Add gameEventLog[] and yellow nc-events-overlay on the right side
- Add resolvePlayerIndex() mapping WS indices to display names
- Increase EVENT_LINGER_MS from 3000 to 7000ms"
commit_version "$BASE/tampermonkey copy 7" /tmp/nc_commit_msg.txt

# --- Copy 8 ---
write_msg "Replace string-based name lookup with position-based WS index mapping (v0.8)

Fix player identification in WebSocket events:
- Remove readWsString() and name extraction from WS type-7 messages
- Add wsIndexToBody map (WS player index to Planck body reference)
- Add buildWsIndexMapping() that matches Float32 positions from WS payload
  to live Planck body positions within 1 unit tolerance
- resolvePlayerIndex() now looks up wsIndexToBody and calls displayLabel()"
commit_version "$BASE/tampermonkey copy 8" /tmp/nc_commit_msg.txt

# --- Copy 9 ---
write_msg "Fix WS index-body offset; improve label resolution fallback

Correct off-by-one: treat index 0 as ball, shift player lookups to idx+1.
Add fallback to player index string when body is not yet mapped. Add idNameCache
alongside wsIndexToBody for internal label to display name resolution.
Experimental reversed bodyLabelCache loop added for team assignment debugging."
commit_version "$BASE/tampermonkey copy 9" /tmp/nc_commit_msg.txt

# --- Copy 10 ---
write_msg "Add boundary brake enforcement for circle and halfline rules

Auto-override the outgoing input packet to force brake when a player
violates positional rules:
- Add boundaryRules with circle (center exclusion zone) and halfline (no crossing x=50)
- Add checkCircleBoundary() and checkHalflineBoundary() returning brake/release/null
- Add applyBoundaryBrake() combining all active rules
- Hook WS send to intercept type-2 input packets (12 bytes), read angle+flags,
  apply boundary brake, and rewrite the byte in-place
- Expose window.ncBoundary for console control; print usage on load"
commit_version "$BASE/tampermonkey copy 10" /tmp/nc_commit_msg.txt

# --- Copy 11 ---
write_msg "Add visual brake override overlay showing team and brake status

Surface boundary enforcement state to the player in real time:
- Add createBrakeOverlay() rendering a fixed red banner at top-center
- Track lastBrakeOverride boolean; show/hide banner each tick
- Display team name inside the overlay via getLocalPlayerTeam()
- Update ensureOverlay() to manage the new third overlay element"
commit_version "$BASE/tampermonkey copy 11" /tmp/nc_commit_msg.txt

# --- Copy 12 ---
write_msg "Refactor team detection to use bodyLabelCache for reliability

getLocalPlayerTeam() now reads team from Planck bodyLabelCache (interleaved
body order) rather than the fragile wsIndexToBody WS mapping.
Brake overlay content set dynamically in tick() using innerHTML with
a small tag for team name. Add comment clarifying bodyLabelCache schema."
commit_version "$BASE/tampermonkey copy 12" /tmp/nc_commit_msg.txt

# --- Copy 13 ---
write_msg "Add tennis-ref.user.js: new Tennis Referee script with match state engine

New Tampermonkey script that enforces tennis-like rules in NitroClash:
- GameState enum: BLUE_SERVE, RED_SERVE, PLAY, SCORE_BLUE, SCORE_RED
- Full matchState tracking touches, wall touches, last touchers, and score
- installContactListener() implements 3-touch foul, double-touch, wall-touch,
  and serve transition logic
- tickMatchState() handles halfline-crossing touch resets and back-line scoring
- scorePoint(), startServe(), countPlayers(), getBallBody() helpers
- Centered game state overlay showing serve team and score messages
- WS type-9 kickoff triggers startServe() with random first server"
commit_version "$BASE/tampermonkey copy 13" /tmp/nc_commit_msg.txt

# --- Copy 14 ---
write_msg "Introduce TeamEnum constants; harden boundary and tennis referee logic

Replace all Blue/Red string literals with TeamEnum.BLUE / TeamEnum.RED:
- Add TeamEnum = { BLUE, RED, BOTH } object used across boundary rules and goal parsing
- boundaryRules entries now carry team field using TeamEnum values for targeted enforcement
- checkCircleBoundary and checkHalflineBoundary guard against TeamEnum.BOTH rules
- tennis-ref.user.js v0.1: full tennis ruleset forked from pixi-hook v0.7,
  show_touches() and clearScoreFoulMarkers() replace the old contact-circle system"
commit_version "$BASE/tampermonkey copy 14" /tmp/nc_commit_msg.txt

# --- Copy 15 ---
write_msg "Fix wall touch counting to only apply during PLAY state (tennis-ref)

Wall touches were incorrectly counted during BLUE_SERVE and RED_SERVE,
allowing rules to fire before the point had started. Restrict wall touch
logic in installContactListener() to GameState.PLAY only.
Simplify tickMatchState() guard: positive check for !== PLAY instead of
two-condition null/SCORE_* check; move planckWorld guard after state check."
commit_version "$BASE/tampermonkey copy 15" /tmp/nc_commit_msg.txt

# --- Copy 16 ---
write_msg "Add brake rule messages and implement 2-point alternating serve rotation

Surface which boundary rule triggered the brake override:
- Add message string to boundaryRules.circle and .halfline entries
- Track lastBrakeMessage; applyBoundaryBrake() returns rule context
- Brake overlay now shows the triggering rule message directly

Overhaul serve rotation logic:
- serve_times counter starts at 1 on match start
- On each kickoff: rotate server to other team when serve_times >= 2,
  else same team serves again; implements alternating serve every 2 points"
commit_version "$BASE/tampermonkey copy 16" /tmp/nc_commit_msg.txt

echo "All 16 commits done!"
