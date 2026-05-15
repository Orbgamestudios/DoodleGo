# Doodle Go

A doodle-style 2D physics climber inspired by *Heave Ho*. Couch + (eventually) online multiplayer. Each player is a wobbly doodle character with two arms ending in colored gloves — grab platforms, swing, and reach the flag.

🎮 **Play locally:** open `index.html` in any modern browser.

---

## Tech

- **Vanilla JS + HTML/CSS** — no build step, no bundler, no transpiler.
- **Matter.js** physics via CDN.
- **Canvas 2D** rendering.
- Single `game.js` file for all gameplay code.

This stack is deliberate so the game stays portable and fast to iterate on. See [`CLAUDE.md`](./CLAUDE.md) for the project's hard rules.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Start screen, canvas, win screen, lobby, dev-panel scaffold |
| `style.css` | Cream/doodle theme |
| `game.js` | Physics, rendering, input, lobby, dev panel, drawing, multiplayer scaffold |
| `Doodle Go/` | Art assets and references |
| `unity-project/` | Older Unity port kept for reference (not maintained) |
| [`DEVLOG.md`](./DEVLOG.md) | Phase-by-phase history of the project |
| [`CLAUDE.md`](./CLAUDE.md) | Per-project rules for Claude when contributing |

## Controls

**Keyboard:** WASD reach · LMB / RMB hold to grab · Q draw mode · P dev panel · Enter start.

**Gamepad:** stick / D-pad reach · LB / LT + RB / RT hold to grab · Y draw mode · A ready in lobby · X reroll name · B remove from lobby · Start to start.

## Status

- Local couch multiplayer (1 keyboard + up to 3 gamepads): ✅
- Procedural map generation, doodle background, parallax, draw mode, dev panel, lobby with names + colors + ready: ✅
- Online multiplayer (room codes UI is built; networking layer is stubbed): 🚧
- Static-site hosting on Cloudflare Pages: 🚧
- Touch controls / iOS PWA: 🚧

See `DEVLOG.md` for the full phase log and `CLAUDE.md` for project conventions.
