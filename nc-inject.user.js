// ==UserScript==
// @name         NitroClash Inject (Option 1 - Script Replace)
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Replaces the game script with a local modified version that exposes internal state, then prints player/ball positions.
// @match        *://nitroclash.io/*
// @match        *://www.nitroclash.io/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // CONFIG - Point this to wherever you serve the modified script
  // ============================================================
  // Option A: Serve via a local HTTP server (e.g. python -m http.server 9000)
  const MODIFIED_SCRIPT_URL = "http://localhost:9000/scripts_mini_modified.js";

  // How often to print positions (ms)
  const PRINT_INTERVAL = 2000;

  // ============================================================
  // Step 1: Block the original game script from loading
  // ============================================================

  // We watch for <script> elements being added to the DOM.
  // When we see the game script, we prevent it from loading
  // and inject our modified version instead.

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.tagName === "SCRIPT" && node.src) {
          // Match the game script by its filename pattern
          if (
            node.src.includes("game.js") ||
            node.src.includes("scripts") // adjust if the script URL differs
          ) {
            console.log("[NC-Inject] Blocked original script:", node.src);

            // Prevent the original from executing
            node.type = "javascript/blocked";

            // Remove it so the browser doesn't try to run it
            node.parentNode && node.parentNode.removeChild(node);

            // Now load our modified version
            loadModifiedScript();
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ============================================================
  // Step 2: Fetch & inject the modified script
  // ============================================================

  function loadModifiedScript() {
    observer.disconnect();
    console.log("[NC-Inject] Fetching modified script from:", MODIFIED_SCRIPT_URL);

    GM_xmlhttpRequest({
      method: "GET",
      url: MODIFIED_SCRIPT_URL,
      onload: function (response) {
        if (response.status === 200) {
          console.log("[NC-Inject] Injecting modified script...");
          const script = document.createElement("script");
          script.textContent = response.responseText;
          document.documentElement.appendChild(script);
          console.log("[NC-Inject] Modified script injected. Starting position logger.");
          startPositionLogger();
        } else {
          console.error("[NC-Inject] Failed to fetch modified script:", response.status);
        }
      },
      onerror: function (err) {
        console.error("[NC-Inject] Error fetching modified script:", err);
      },
    });
  }

  // ============================================================
  // Step 3: Periodically read the exposed state and print positions
  // ============================================================

  function startPositionLogger() {
    setInterval(() => {
      // The modified script should expose these on window.__nc
      const nc = window.__nc;
      if (!nc) {
        console.log("[NC-Inject] Waiting for game state (__nc not available yet)...");
        return;
      }

      const { playerDatas, G, Ne } = nc;

      if (!playerDatas || !playerDatas.length) {
        console.log("[NC-Inject] No player data yet (not in a game?)");
        return;
      }

      const totalPlayers = 2 * (Ne || 3);

      console.group("[NC-Inject] Positions");

      // Print player positions
      for (let i = 0; i < totalPlayers && i < playerDatas.length; i++) {
        const body = playerDatas[i];
        if (body && typeof body.getPosition === "function") {
          const pos = body.getPosition();
          const vel = body.getLinearVelocity();
          const team = i < (Ne || 3) ? "Team A" : "Team B";
          const idx = i < (Ne || 3) ? i : i - (Ne || 3);
          console.log(
            `  Player ${idx} (${team}): pos(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}) vel(${vel.x.toFixed(2)}, ${vel.y.toFixed(2)})`
          );
        }
      }

      // Print ball position
      if (G && typeof G.getPosition === "function") {
        const ballPos = G.getPosition();
        const ballVel = G.getLinearVelocity();
        console.log(
          `  Ball: pos(${ballPos.x.toFixed(2)}, ${ballPos.y.toFixed(2)}) vel(${ballVel.x.toFixed(2)}, ${ballVel.y.toFixed(2)})`
        );
      }

      console.groupEnd();
    }, PRINT_INTERVAL);
  }
})();
