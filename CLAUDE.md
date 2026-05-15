# Doodle Go — project rules for Claude

This file layers on top of `~/.claude/CLAUDE.md`. Read both.

## Stack (non-negotiable without discussion)

- Vanilla JS + HTML/CSS, Canvas2D rendering.
- **Physics — Matter.js today; migrating to Rapier 2D (Rust → WASM).**
  Both CDNs are preloaded in `index.html`. Rapier is available as
  `window.RAPIER` once `await window._rapierReady` resolves. `game.js` still
  uses Matter; the port lands across the next commit(s). See DEVLOG Phase 16
  (in-progress).
- **No build step.** No bundler, no transpiler, no TypeScript.
- `game.js` is one file. Do not split it.
- Cache-bust: the `<script>` tag in `index.html` uses `?v=N`. Bump it on every meaningful change to `game.js`.

If a user request would violate any of the above, push back in one sentence and ask before complying. See the `vanilla-js-guard` skill.

## File map

- `index.html` — start screen, canvas, win screen, lobby, dev panel scaffold.
- `style.css` — cream/doodle theme.
- `game.js` — physics, rendering, input, lobby, dev panel, drawing system, multiplayer scaffold. Everything.
- `Doodle Go/` — art assets (hero image, sprite reference).
- `unity-project/` — older Unity port kept for reference. **Do not sync changes to it.**

## Hard "don't" list (the project learned these the hard way)

- **Don't introduce polygon platforms.** Generator is circles + axis-aligned rectangles. Polygons caused unstable grabs.
- **Don't add side walls.** Falling off any edge is death — that's the design.
- **Don't make any body but the glove trigger grabs.** Glove only, tagged `_arm`. Anything else is the "elbow grab" bug.
- **Head rotation is currently FREE** (no `inertia: Infinity`). The body-relative shoulder hard-clamp keeps each elbow on its own outer half-circle of the body so the rig stays sane. If torque-from-stretching ever feels too whippy, reintroduce `inertia: Infinity` on the head — that's the stable fallback.
- **Don't share `playerGroup` across players.** Each player gets `Body.nextGroup(true)`.

## Standard workflows

**Adding a physics tunable:**
1. Define the const at the top of `game.js` with a sensible default.
2. Add a slider + number input pair in the dev panel (see Phase 12 patterns).
3. Wire to `localStorage` for persistence.
4. Apply live to the rig where possible; respawn for level-shape tunables.

**After a meaningful change:**
1. Bump `?v=` in `index.html`.
2. If the change is phase-worthy, run the `devlog-update` skill.
3. If a non-obvious lesson came out of debugging, run the `capture-learning` skill.

## Controls (don't break these without intent)

Keyboard: WASD reach, LMB/RMB hold to grab, Q draw mode, P dev panel, Enter start.
Gamepad: stick/dpad reach, LB/LT + RB/RT hold to grab, Y draw mode, A ready in lobby, X reroll name, B remove, Start to start.

## TODO snapshot (Phase 15 era)

- Real online multiplayer (PeerJS or Node+WebSocket). UI is scaffolded; networking is stubbed.
- Static site hosting.
- 2v2 team scoring.
- Sound + music.
- Mobile / touch controls.
