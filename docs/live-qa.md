# Live Mission Acceptance

Run the headed Chromium acceptance harness against an already running Vite development server. It uses external Playwright and Chromium installations; it does not install packages or change application files.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.js \
CHROMIUM_EXECUTABLE=/absolute/path/to/Chromium \
LIVE_QA_URL=http://127.0.0.1:5173/ \
node tools/qa/live-missions.mjs
```

`PLAYWRIGHT_MODULE` can be an absolute entry-file path or `file:` URL. If omitted, the harness uses `/tmp/darkcolony-browser-harness-20260918/node_modules/playwright-core/index.js` only when it exists. `CHROMIUM_EXECUTABLE` is required. `LIVE_QA_URL` defaults to `http://127.0.0.1:5173/`. A graphical desktop session is required.

Each run creates a unique `darkcolony-live-missions-*` directory in the system temporary directory. The final output names that directory. Any failed assertion, browser error, failed request, or HTTP error makes the process exit nonzero. This checks the opening missions, not campaign completion or availability of full victory scripting.

## Assertions

- HUMAN01 and ALIEN01 each run in a fresh headed browser context for at least five seconds, advancing at least 75 simulation ticks and retaining five roster units.
- The app requests schema-2 source maps, both terrain layers, attributes, tags, PTH bytes, terrain metadata, and the decoded terrain atlas. Loaded navigation matches the response and blocks families `0` and `255`.
- Captured world draws convert upward runtime Y to downward screen Y; radar
	artwork stays in top-down source order. Picking and markers use the inverse
	conversion, with nonempty coverage and asymmetric source rows.
- Draw probes normalize Canvas transforms and assert independent background
	(`0x20`) and foreground (`0x40`) horizontal mirror flags from MAP attributes.
- Browser widths 640 and 1280 retain a 512x452 canvas backing and identical logical camera view. Canvas pixels are nonblank and the page has no horizontal overflow. Screenshots are saved at both widths.
- F2 selects five units; G then 1 stores their IDs; right-click clears selection; 1 restores those exact IDs in both mission state and roster.
- A four-neighbor search over the actual loaded PTH chooses an unoccupied, visible on-screen ground cell reachable from every selected unit. A scaled canvas click must displace all five units. S must stop them and their exact positions must remain unchanged afterward.
- Clicking the radar center pans the camera to the map center without changing selection. J opens populated source objectives and closes them again.
- Source audio is linked from its fetched response bytes through decoding to a non-silent buffer-source start connected to a running audio output. Mute sets the master gain to zero, prevents new response voices, and unmute restores gain and playback. Silent unlock buffers are excluded.
- Console errors, uncaught page errors, failed requests, and HTTP responses of 400 or higher fail acceptance.

## Inspection Boundaries

This is a Vite development-server harness, not a bundled production-preview harness. It imports the already-loaded mission module by its exact URL and wraps `render` to retain a read-only reference to the live mission. Browser-only wrappers observe canvas drawing, response buffers, audio decoding, connections, and source starts while delegating to the original implementations. It never queues simulation commands, changes units, or invokes render/advance itself. Actions use Playwright mouse and keyboard input.

The probes verify audio scheduling and routing, not physical speaker audibility. Master gain assertions observe `setValueAtTime` on the gain node connected to the destination: an idle audio graph can report stale `AudioParam.value` values. Terrain checks verify draw-source orientation, not pixel-perfect emulation of the original game. Failed missions still produce diagnostics and the other mission is attempted. The JSON report includes measured values, request statuses, selected destination/path distances, before/after unit positions, audio evidence, failures, and passing assertions. No assertion promises full campaign victory.