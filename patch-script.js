/**
 * patch-script.js
 *
 * Run this with Node.js to generate the modified game script.
 * It reads the original minified script and injects a line that exposes
 * the private closure variables onto window.__nc.
 *
 * Usage:
 *   node patch-script.js
 *
 * Then serve the output folder with:
 *   npx http-server ./serve -p 9000 --cors
 */

const fs = require("fs");
const path = require("path");

// Paths - adjust if needed
const INPUT = path.join(
  __dirname,
  "..",
  "ncskins",
  "nitroclash.io",
  "scripts mini.js"
);
const OUTPUT_DIR = path.join(__dirname, "serve");
const OUTPUT = path.join(OUTPUT_DIR, "scripts_mini_modified.js");

console.log("Reading:", INPUT);
let code = fs.readFileSync(INPUT, "utf-8");

// ============================================================
// Patch: right before "return Na;", inject our exposure line.
// This leaks the key closure variables onto window.__nc so
// Tampermonkey can read them.
// ============================================================

const INJECT_MARKER = "return Na;";
const INJECT_CODE = `
  // [NC-INJECT] Expose internal game state for external tools
  window.__nc = {
    playerDatas: playerDatas,
    G: G,           // ball physics body
    H: H,           // ball PIXI sprite
    Ne: Ne,         // players per team
    me: me,         // sprite position data
    he: he,         // player input states (angle, boost, brake)
    De: De,         // player statistics
    B: B,           // current map config (WORLD_WIDTH, WORLD_HEIGHT, etc.)
    O: O,           // planck world
    ye: ye,         // player sprites
    ue: ue,         // player sprite containers
    pe: pe,         // additional player properties
    d: d,           // local player input
    ne: ne,         // game state
    Fe: Fe,         // boost levels
  };
`;

const markerIndex = code.lastIndexOf(INJECT_MARKER);
if (markerIndex === -1) {
  console.error('ERROR: Could not find "return Na;" in the script.');
  process.exit(1);
}

code =
  code.slice(0, markerIndex) +
  INJECT_CODE +
  "\n  " +
  code.slice(markerIndex);

// Write output
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
fs.writeFileSync(OUTPUT, code, "utf-8");
console.log("Patched script written to:", OUTPUT);
console.log("");
console.log("Next steps:");
console.log("  1. Serve it:  npx http-server ./tampermonkey/serve -p 9000 --cors");
console.log("  2. Install nc-inject.user.js in Tampermonkey");
console.log("  3. Open nitroclash.io and check the browser console");
