# Albert Fudge Island — Unity Project

A Unity port of the web/JS prototype. Same heave-ho style gameplay: head + 2 arms + 2 gloves, glove-only grab, draw-mode line objects, void floor with respawn.

## Requirements

- **Unity 2022.3 LTS** (or any newer Unity 6 / Unity 2023+ version — the scripts use only standard Unity 2D APIs).
- Unity Hub (recommended) so you can pin a specific editor version.

## How to open

1. Install Unity Hub from https://unity.com/download.
2. In Unity Hub → **Installs** → install **Unity 2022.3 LTS** (any patch version is fine). Make sure the **2D** module is checked during install.
3. In Unity Hub → **Projects** → **Add** → **Add project from disk** → select this `unity-project` folder.
4. Open the project. On first import Unity will generate the `Library/` folder (~1-3 minutes).

## First-time scene setup

There's no pre-authored `.unity` scene to avoid version-mismatch surprises, so set up the scene manually (takes ~20 seconds):

1. **File → New Scene**, choose **2D (Built-in Renderer)**, and save it as `Assets/Scenes/Main.unity`.
2. Delete the default Main Camera if you want — the GameManager creates one automatically.
3. **GameObject → Create Empty**, rename it to `GameManager`.
4. With `GameManager` selected, click **Add Component** in the Inspector and add the `GameManager` script (it's in `Assets/Scripts/`).
5. Press **Play**.

That's it. The script builds the level, player, HUD, camera, and physics layers at runtime.

## Controls

| Key                   | Action                                                     |
|-----------------------|------------------------------------------------------------|
| `WASD` / Arrow keys   | Reach arms (8-directional) / swing the body when grabbing  |
| `Left Mouse`          | Toggle LEFT glove grab (intent ON; locks on contact)       |
| `Right Mouse`         | Toggle RIGHT glove grab                                    |
| `Q`                   | Toggle Draw Mode (LMB-drag to draw a line object)          |
| `1` / `2` / `3` / `4` | Choose Blue Einstein / Blue Epstein / Red Einstein / Red Epstein |

## Project layout

```
unity-project/
├── Assets/
│   ├── Scripts/
│   │   ├── GameManager.cs       ← everything: level, player, input, HUD, draw mode, death/respawn
│   │   ├── Glove.cs             ← glove collision → grab attempt
│   │   └── PortalTrigger.cs     ← portal sensor → win
│   ├── Resources/Sprites/
│   │   ├── blue_einstein.png    ← head sprites (cropped at runtime)
│   │   ├── blue_epstein.png
│   │   ├── red_einstein.png
│   │   ├── red_epstein.png
│   │   └── logo.png
│   └── Scenes/                  ← you create Main.unity here on first run
├── Packages/manifest.json       ← package dependencies (2D feature set + UI)
└── ProjectSettings/
    └── ProjectVersion.txt       ← pinned to Unity 2022.3.40f1
```

## How the gameplay maps to Unity

| JS / Matter concept                          | Unity equivalent                                             |
|----------------------------------------------|--------------------------------------------------------------|
| `Bodies.circle` / `Bodies.rectangle`         | `GameObject` + `Rigidbody2D` + `CircleCollider2D` / `BoxCollider2D` |
| `Constraint.create(... length:0, stiffness:1)` | `HingeJoint2D` on the parent body, anchors set to local pivots |
| Negative collision group (player parts)      | Player layer + `Physics2D.IgnoreLayerCollision(playerLayer, playerLayer, true)` |
| `engine.timing.timeScale = 0.55`             | `Time.timeScale = 0.55`                                      |
| Glove-only grab via collision events         | `Glove.cs` listens for `OnCollisionStay/Enter2D`             |
| Heavy drawn line                             | Compound `Rigidbody2D` parent + child `BoxCollider2D` per segment + `LineRenderer` for visuals |
| Void floor → death                           | `head.y < worldBottom - deathYOffset` → set bodies kinematic, show overlay, respawn after 5s |
| Portal sensor                                | `CircleCollider2D` with `isTrigger = true` + `PortalTrigger.cs` |

## Tuning

All numerical parameters are public fields on `GameManager` — adjust them in the Inspector at runtime. Useful knobs:

- `Swing Force` — strength of WASD when grabbing
- `Hand Drive` — how aggressively free arms reach toward WASD direction
- `Max Arm Ang V` — angular-velocity cap (lower = slower arm motion)
- `Draw Density` — heaviness of drawn objects
- `Time Scale` — global slow-motion factor (0.55 by default for clean collisions)

## Known limitations / things you may want to do next

- The character-select menu from the web version isn't included — use `1`-`4` in Play mode to switch.
- HUD uses Unity's Legacy `Text` for portability. You'll likely want to swap to TextMeshPro for production.
- Drawn line visuals use a simple `LineRenderer` with a colored material. For a polished look, replace with a custom `MeshFilter` mesh and shader.
- The web version's start screen, win screen UI, and audio aren't ported — they're trivial to add in `BuildHUD()`.

## Web version

The original JS/Matter prototype is still in the parent folder (`../game.js`, `../index.html`, `../style.css`). Both versions share the same character art.
