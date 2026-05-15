# Doodle Go — Development Log

A chronicle of how this project evolved across the conversation. The game began life
as **Albert Fudge Island** and progressively became **Doodle Go** — a 2D physics
climber inspired by *Heave Ho*, where small doodle-style characters reach for a flag
by grabbing platforms with their gloved hands.

---

## Project at a glance

- **Stack:** Vanilla JS + HTML/CSS, [Matter.js](https://brm.io/matter-js/) for physics, plain Canvas2D for rendering. No build step.
- **Files of interest:**
  - `index.html` — start screen, game canvas, win screen, multiplayer scaffolding.
  - `style.css` — cream/doodle theme, lobby, dev panel, multiplayer UI.
  - `game.js` — the entire game (physics, rendering, input, lobby, dev panel, drawing system, multiplayer scaffold).
  - `Doodle Go/Doodle Go image.png` — start-screen hero image.
  - `Doodle Go/heave ho sprite.jpg` — visual reference for the character art.
  - `unity-project/` — an earlier Unity port that mirrored the JS gameplay (kept for reference).
- **Cache busting:** the script tag uses `?v=17` (bumped on every meaningful change so the browser actually loads the new build).

---

## Timeline of features

### Phase 1 — Bug fixes on the original "Albert Fudge Island" build
- Draw mode and jump were broken; the character floated above platforms; movement was sluggish.
- Decision: scrap the legged character entirely. Build a head + 2 arms + 2 gloves rig.

### Phase 2 — Head + arms physics rig
- Each player became a `head` circle plus two arms.
- Each arm = `upperArm` rectangle + `forearm` rectangle + `glove` circle, joined by Matter `Constraint`s acting as shoulder / elbow / wrist hinges.
- Arms are driven by WASD or stick; gloves can grab.
- Per-player `playerGroup = Body.nextGroup(true)` (negative collision group) so a rig doesn't collide with itself.

### Phase 3 — Grab system iterations
- Initially: any forearm contact triggered a grab. Felt random / "elbow grabs."
- Iteration: tightened to forearm tip only.
- Final: a **separate glove body** sits on the outside tip of the forearm. Only the glove can grab.
- Grab style went **toggle → hold-to-grab**. Mouse: press to grab, release to drop. Gamepad LB/RB/LT/RT: same hold semantics.
- Teammate body parts (head, arm, glove) are also grabbable — you can swing off another player.

### Phase 4 — Drawing system
- Press `Q` (keyboard) or `Y` (gamepad) to enter Draw Mode.
- Mouse drags or RT-hold draws a line. Each line becomes a heavy compound `Body` (one rect per segment, sleep-enabled so it settles cleanly on platforms).
- Per-player ink budget. Draw cursor (in world space) is shown as a colored crosshair.

### Phase 5 — World, camera, minimap
- World grew from canvas-sized to **2200 × 1500**.
- A camera follows the average player position with smooth lerp; clamped to world bounds.
- A minimap in the top-right shows platforms, the goal, and team-colored player dots.

### Phase 6 — Procedural map generation
- 2–3 curvy paths from the spawn corner to the goal, sampled via Catmull-Rom splines.
- Each sample places a random shape with perpendicular jitter, plus satellite shapes nearby.
- An additional configurable count of fully random "scatter" shapes fills the rest of the world.
- After polygons + angled rectangles caused unstable grabs, the generator was simplified to **circles + axis-aligned rectangles only**.

### Phase 7 — Multiplayer (local couch)
- One keyboard slot + up to three gamepad slots.
- Each player has their own input poll, edge-triggered grab buttons, draw mode, ink, dead/respawn timer, and HUD row.
- Per-player smoothed cameras for split-screen.

### Phase 8 — Adaptive split-screen (perpendicular pie slices)
- When farthest pair of players exceeds a tunable distance, the screen splits.
- Layout is **pie-slice**: each player gets a wedge of the canvas pointing toward their world direction relative to the group centroid.
- 2 players → two 180° wedges (a single perpendicular line).
- 3 / 4 players → wedges meeting at the canvas center.
- Each wedge clips its own clip-path and translates the camera to its centroid.
- The minimap mirrors the split: each player's slice gets a faint team-colored tint and yellow boundary rays.
- Below the split threshold, the unified camera **zooms out** as players spread (down to a configurable minimum), so they can stay on one screen as long as possible.

### Phase 9 — Goal evolution
- Started as a **portal sensor**.
- Briefly became a **U-shaped goal** with 3 walls and a balloon inside.
- Then a **flag** the player had to be near; finally a **purely visual flag** (no collider, can't be grabbed) sitting on a guaranteed thick yellow platform that is always part of the level.
- Win condition: every alive player must be inside the trigger radius for **1.5 seconds** (yellow ring sweeps around the base while the timer fills).

### Phase 10 — Lobby rebuild
- Old lobby: 4 fixed slots with character buttons.
- New lobby: starts **empty**, players join via:
  - Click "+ Add Player" → modal "Press any input" (auto-detects keyboard or gamepad).
  - **Auto-claim:** pressing any button on an unconnected gamepad silently creates a slot.
- Each slot has:
  - **Random name** (adjective + funny noun, e.g. *Crunchy Bartholomew*) with 🎲 reroll, ✏️ inline edit, ✕ remove.
  - **10-color picker.** Gloves stay L=blue / R=red regardless.
  - **Ready** button (mustard yellow → green when ready).
- All-ready triggers a **3-second countdown** (with `3 → 2 → 1 → GO!` overlay) before physics resumes.
- A 2v2 rotation: with > 4 ready players, a hidden `_sitOuts` counter prioritizes whoever sat out previously.

### Phase 11 — Doodle theme rebrand
- Renamed to **Doodle Go**.
- Cream paper backdrop on the start screen with the actual *Doodle Go* cover art as the hero image.
- Multi-layer **parallax background**: 3 layers of wobbly hsl blobs scrolled at different depths.
- All platforms re-rendered with **doodle wobble**: jittered outlines, layered fills, diagonal hatching, ink-style stroke. Color palette is bright "crayon" hues; one yellow platform always sits under the goal.
- Map edges removed entirely — falling off any side is death.
- Body rotation locked back to upright (`inertia: Infinity`) since stretching was unintentionally torquing the torso.
- **Shoulder angle clamp** restricts each arm to its own half-circle (down → side → up). Arms can no longer swing across the body / behind the back.
- The Einstein/Epstein PNGs were retired. The head sprite is now drawn entirely on the canvas: a wobbly oval body in the player's color, two black eye blobs with white highlights, intense black brows, and a toothy grin (homage to the Heave-Ho cover).

### Phase 12 — Dev panel
- Toggle with **P**. Survives between menu/game/win.
- Tunables grouped into World, Body, Arms, Gloves, Drawings — sliders + number inputs sync.
- Live-applies to the current rig where possible (densities, gravity, time scale, air friction).
- Per-session "next-map" tunables (`OBJ_AVG_SIZE`, `OBJS_PER_PATH`, `OBJ_DENSITY`) are applied via a **Regen Map** header button or a respawn.
- Recent additions: **Cursor Sensitivity**, **Split-Screen Distance**, **Min Camera Zoom**, **Nametag Size**.
- Settings persist to `localStorage`. **Reset** restores defaults.

### Phase 13 — Death / respawn UX
- Original full-screen "💀 You Fell Into The Void" overlay was replaced with a **death log** — small toast notifications fading out below the minimap (e.g. `💀 Sneaky Pickle fell into the void` → `✨ Sneaky Pickle respawned`).
- Each respawn re-statics the bodies briefly to clear momentum and resets to spawn position.

### Phase 14 — In-game HUD cleanup
- Per-player HUD rows (top center): colored chip + name + ink bar + device icon.
- Floating name tag above each character's head (size adjustable via slider; cream chip with the player's color stripe).
- Removed the giant slice-center nametags and the central yellow dot from the minimap — both were too noisy.

### Phase 15 — Multiplayer / room-code UI scaffolding
- Two tabs at the top of the lobby: **Local Couch** (default) and **Online (room code)**.
- Online tab has Create Room / Join Room, an 8-character room-code badge, copy/leave buttons, a peer list, and a chat panel.
- **The networking is intentionally stubbed** — UI works locally so the flow is testable, but no peers actually connect yet. A clear ⚠️ banner says so.
- Recommended next step: drop in [PeerJS](https://peerjs.com) (free public WebRTC broker) for host-authoritative sync, or stand up a tiny Node + WebSocket server.

---

## Controls cheat sheet

### Keyboard / Mouse
| Key | Action |
| --- | --- |
| WASD / Arrows | Reach arms / swing when grabbing |
| Left Mouse | Hold = grab with left glove |
| Right Mouse | Hold = grab with right glove |
| Q | Toggle draw mode (mouse-drag draws) |
| P | Toggle dev panel |
| Enter | Start game (when ready in the lobby) |

### Gamepad (per player)
| Button | Lobby | In-game |
| --- | --- | --- |
| Left stick / D-pad | Cycle colors | Reach / swing |
| A | Toggle Ready | — |
| X | Reroll name | — |
| B | Remove from lobby | — |
| Start | Start the game | — |
| LB / LT (hold) | — | Grab left glove |
| RB / RT (hold) | — | Grab right glove |
| Y | — | Toggle draw mode (RT hold = stroke) |

---

## Architecture notes

### Player rig
- `head` (circle, `inertia: Infinity` so it stays upright).
- Per arm: `upperArm`, `forearm`, `glove` connected by `Constraint`s with `stiffness: 1`, `damping: 0.9` (snappy, no stretch).
- Glove is the **only** body that triggers grabs; tagged with `_arm` for O(1) lookup in the collision handler.
- Heads / arms / gloves carry `_player = playerObj` so cross-player contact can identify the owner and reject self-grabs.

### Camera & viewports
- Single canvas (1200 × 700) is a **viewport** into a much larger world (2200 × 1500).
- One unified camera lerped to the centroid of alive players when bunched up.
- Per-player camera (`p.cameraX`, `p.cameraY`) used in split mode.
- `currentZoom` lerps between `SPLIT_ZOOM_MAX` and `SPLIT_ZOOM_MIN` based on player spread (single-cam mode only).
- `worldFromScreen(x, y)` converts mouse coordinates back to world space using the keyboard player's slice in split mode.

### Procedural level
- `createLevel()` → 2–3 curvy paths via `generateCurvyWaypoints` + Catmull-Rom `sampleSplinePath`.
- `generateRandomShape()` returns circles or axis-aligned rectangles only. Each shape gets a doodle color and a deterministic wobble seed.
- `removeOverlaps()` does a cheap AABB pruning pass.
- `buildGoal()` always places a thick yellow platform under the flag; the flag itself has no collider.

### Pie-slice split
- `computeSlices(alive)` returns `{ player, ang1, ang2, poly, centroid }` per player.
- `wedgePolygon(cx, cy, ang1, ang2)` walks canvas corners between two angles and builds a clip polygon.
- `renderSlice(slice, camX, camY)` clips, translates to the wedge centroid, scales by `currentZoom`, and renders the world.
- Minimap mirrors the same wedges with team-tinted fills.

### Death / void
- No side walls. Falling off the bottom (`y > WORLD_H + 80`), top (`y < -400`), or sides (`x < -200`, `x > WORLD_W + 200`) triggers `killPlayer(p)`.
- `addLog(msg, color)` enqueues a toast with `expiresAt`. Drawn in `drawLog()` below the minimap.

---

## Tunables (dev panel)

| Group | Tunable | Purpose |
| --- | --- | --- |
| World | Time Scale | Global slow-mo (cleaner physics) |
| World | Gravity | Downward pull |
| World | Respawn Delay | Seconds before respawn after dying |
| World | Split-Screen Distance | Farthest-pair distance to split (exit = 80%) |
| World | Object Avg Size | Mean platform size next map |
| World | Objects per Path | Mean samples along each path |
| World | Map Density | Extra scatter platforms per map |
| World | Nametag Size | Floating name tag font size |
| World | Min Camera Zoom | How far the camera zooms out before splitting |
| Body | Swing Force | WASD push when a glove is gripping |
| Body | Head Max Velocity | Hard cap to prevent flying |
| Body | Head Density / Air Friction | Mass + drag on the head |
| Arms | Hand Drive | Force pulling free gloves toward target |
| Arms | Hand Reach | Distance the arm tries to extend |
| Arms | Max Arm Angular Velocity | Caps arm rotation speed |
| Arms | Arm Density / Air Friction | Mass + drag on arm segments |
| Gloves | Glove Density / Air Friction | Mass + drag on the gloves |
| Drawings | Drawing Density / Thickness / Max Ink | Heavy drawn objects + budget |
| Drawings | Cursor Sensitivity | Gamepad draw cursor speed |

`localStorage` persists every value across reloads.

---

## What's still TODO

- **Real online multiplayer.** UI is wired (room code, chat, peer list); the networking layer needs to be implemented. Options:
  - **PeerJS** (browser-to-browser WebRTC, free public broker) — host-authoritative model: host sends snapshots, clients send inputs.
  - **Node + WebSocket** server hosted on Render / Fly.io / Railway for stricter authority.
- **Hosting the static site itself** — GitHub Pages, Netlify, or Vercel. Five-minute deploy from the project folder.
- Networked chat (depends on the above).
- 2v2 scoring (currently teams are randomly assigned but no team-based win logic — `triggerWinAll` still requires every alive player in the goal).
- Sound effects + music.
- Mobile / touch controls.

---

## Scratch / reference

- `unity-project/` is a static Unity 2022.3 LTS project that mirrors the JS gameplay (head + arms, glove grab, draw mode, U goal, etc.). It's not synced with the latest doodle-theme JS work but works as a starting point if the project ever moves to Unity for real.
- `example.png` and `Doodle Go/level theme*.jpg` are art-direction references.
