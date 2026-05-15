// ============================================
// ALBERT FUDGE ISLAND — Glove-grab, swing-only, void floor
// ============================================
(function () {
    "use strict";

    const { Engine, Bodies, Body, Composite, Constraint, Events, Query } = Matter;

    // --- CONFIG (tunable values are `let` so the dev panel can mutate them live) ---
    // Canvas is the viewport. The world is much larger; the camera follows the player(s).
    const W = 1200, H = 700;
    const WORLD_W = 2200;
    const WORLD_H = 1500;
    const CAM_ZOOM = 1.1;
    let currentZoom = CAM_ZOOM;        // dynamically lerps when players are far apart (unified mode)
    const HEAD_RADIUS      = 18;
    const ARM_W            = 5;
    const UPPER_LEN        = 28;
    const FORE_LEN         = 28;
    const GLOVE_RADIUS     = 9;
    // Shoulder anchor sits on the OUTER edge of the head circle (not inside it),
    // so the arms emerge cleanly from the side of the body.
    const SHOULDER_X       = 17;        // ≈ HEAD_RADIUS, slightly inside the rim
    const SHOULDER_Y       = 4;         // small downward bias
    const BORDER           = 14;
    const DEATH_Y          = WORLD_H + 80;
    // Mini-map
    const MINIMAP_W = 240;
    const MINIMAP_H = Math.round(MINIMAP_W * (WORLD_H / WORLD_W));
    // Team collision categories (Matter.js bitmasks)
    // Collision categories. World/platforms use the default 0x0001.
    // Player rig parts get unique bits so head ↔ forearm collide while
    // head ↔ upper / head ↔ glove / forearm ↔ upper / forearm ↔ glove don't.
    const CAT_WORLD = 0x0001;
    const CAT_HEAD  = 0x0010;
    const CAT_UPPER = 0x0020;
    const CAT_FORE  = 0x0040;
    const CAT_GLOVE = 0x0080;
    // Flag goal — visual only (no collision, no grab). Win if head is near the base.
    const GOAL_POLE_H   = 130;
    const GOAL_POLE_W   = 4;
    const GOAL_RADIUS   = 56;     // 80% of previous 70
    const GOAL_WIN_TIME_MS = 1500;
    // Goal always rests on a generated platform of this size:
    const GOAL_PLATFORM_W = 220;
    const GOAL_PLATFORM_H = 24;

    // Live-tunable physics values
    let TIME_SCALE       = 0.55;
    let GRAVITY_Y        = 0.95;
    let SWING_FORCE      = 0.024;
    let HEAD_MAX_V       = 8;
    let HAND_DRIVE       = 0.00045;
    let HAND_REACH       = 70;
    let MAX_ARM_ANG_V    = 0.075;
    let MAX_INK          = 700;
    let DRAW_THICKNESS   = 11;
    let DRAW_DENSITY     = 0.18;
    let RESPAWN_MS       = 5000;
    let HEAD_DENSITY     = 0.005;
    let ARM_DENSITY      = 0.0008;
    let GLOVE_DENSITY    = 0.0011;
    let HEAD_AIR_DAMP    = 0.02;
    let ARM_AIR_DAMP     = 0.04;
    let GLOVE_AIR_DAMP   = 0.04;
    let HEAD_FRICTION        = 0.25;   // kinetic friction when sliding on platforms
    let HEAD_FRICTION_STATIC = 0.5;    // resistance to start sliding
    let HEAD_RESTITUTION     = 0.05;   // bounciness when colliding
    let CURSOR_SENS      = 12;
    let OBJ_AVG_SIZE     = 55;
    let OBJS_PER_PATH    = 14;
    let OBJ_DENSITY      = 22;
    let SPLIT_ENTER      = 700;
    let NAMETAG_SIZE     = 11;          // px (in world) for floating name above heads
    let SPLIT_ZOOM_MIN   = 0.55;        // min zoom factor used when players are far apart (single-cam mode)
    let SPLIT_ZOOM_MAX   = 1.1;         // = CAM_ZOOM default; what you see when bunched up
    let BODY_SPIN_DAMP   = 0.85;        // multiplied into head.angularVelocity each frame
    let BODY_MAX_SPIN    = 0.05;        // hard cap on head angular velocity (rad/scaled-frame)
    let SHOULDER_LIMIT_K = 0.25;        // soft restoring strength when upper-arm goes outside its half-circle range

    // --- STATE ---
    let engine, canvas, ctx;
    let gameState = "menu";
    let players  = [];                 // active player rigs
    let keyboardPlayerIdx = -1;        // index of the keyboard player (-1 if none)
    let platforms = [];
    let walls     = [];
    let portalBody = null;
    let drawnBodies = [];
    let drawMode  = false;             // tied to the keyboard player
    let isDrawing = false;
    let drawPoints = [];
    let keys = {};                     // held-key state (keyboard)
    let mouseX = 0, mouseY = 0;
    let startTime = 0;
    let portalAngle = 0;
    let winner = null;                 // player object that reached the portal
    // Lobby state: 4 slots (0 = keyboard, 1-3 = gamepads)
    const SLOT_COUNT = 4;
    let lobbySlots = [];               // [{ device:{type,index}, team, char }]
    // All players spawn on the same (left) side — different teams stack here together.
    const SPAWN_POSITIONS = [
        { x: 220, y: WORLD_H - 220 },
        { x: 340, y: WORLD_H - 220 },
        { x: 220, y: WORLD_H - 380 },
        { x: 340, y: WORLD_H - 380 }
    ];
    let camera = { x: WORLD_W / 2, y: WORLD_H / 2 };
    let goal = null;
    let goalTimerStart = 0;
    let balloonColor = "#fbbf24";
    // Split-screen state (adaptive). SPLIT_ENTER is live-tunable; SPLIT_EXIT tracks below it.
    let splitScreen = false;
    let splitSlices = [];              // cached pie-slice descriptors for the current frame
    let deathLog = [];                 // [{ msg, color, expiresAt }] — small in-game notifications
    let countdownStart = 0;            // ms timestamp when the pre-game countdown started

    // --- SPRITES ---
    const sprites = {};
    const spriteFiles = {
        "blue_einstein": "blue einstein mii.png",
        "blue_epstein":  "blue epstein mii.png",
        "red_einstein":  "red einstein mii.png",
        "red_epstein":   "red epstein mii.png"
    };
    function loadSprites() {
        for (const [k, f] of Object.entries(spriteFiles)) {
            const img = new Image();
            img.src = f;
            sprites[k] = img;
        }
    }

    // --- HELPERS ---
    const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    function getShoulderPos(arm) {
        const head = arm.owner.head;
        const sox = arm.side === "left" ? -SHOULDER_X : SHOULDER_X;
        const soy = SHOULDER_Y;
        // Rotate the local shoulder offset by the head's current angle so the
        // shoulder follows the body when it spins.
        const cos = Math.cos(head.angle), sin = Math.sin(head.angle);
        return {
            x: head.position.x + sox * cos - soy * sin,
            y: head.position.y + sox * sin + soy * cos
        };
    }

    function isGrabbable(body) {
        if (!body) return false;
        if (body.label === "platform") return true;
        if (body.label === "drawing") return true;
        if (body.label === "goalWall") return true;
        // Teammates: heads, arms, gloves of other players on the same team are grabbable.
        // (Cross-team contact never happens because of the collision filter, so we don't
        // need to re-check team here — if it touched, it's a teammate.)
        if (body.label === "head" || body.label === "armUpper" || body.label === "armFore" || body.label === "glove") return true;
        const root = body.parent;
        return root && root !== body && root.label === "drawing";
    }

    // --- LEVEL (procedurally generated, path-based) ---
    function createLevel() {
        platforms = [];
        walls = [];
        drawnBodies = [];
        // No side walls or ceiling — the world has no edges. Players can fall off any
        // side; falling past WORLD_H + 80 (world Y) triggers death and respawn.

        // Place the goal flag first so the paths can target it.
        // The pole extends GOAL_POLE_H upward from (gx, gy); keep clearance from the ceiling.
        const gx = WORLD_W - 360 + (Math.random() - 0.5) * 220;
        const gy = (GOAL_POLE_H + 80) + Math.random() * 260;
        buildGoal(gx, gy);

        // Generate the platform layout once the goal location is known.
        const generated = generatePlatformLayout(gx, gy);
        for (const p of generated) {
            const body = makeShapeBody(p);
            if (body) platforms.push(body);
        }

        balloonColor = `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`;
        goalTimerStart = 0;

        Composite.add(engine.world, [...walls, ...platforms]);
    }

    // Build the flag goal at (gx, gy). The flag is purely visual — it has no collider
    // and can't be grabbed. A thick platform underneath ensures the flag always sits
    // on a solid surface to climb to.
    function buildGoal(gx, gy) {
        // Platform under the flag (real collider — players land on this)
        const plat = Bodies.rectangle(gx, gy + GOAL_PLATFORM_H / 2, GOAL_PLATFORM_W, GOAL_PLATFORM_H, {
            isStatic: true, label: "platform",
            friction: 1, frictionStatic: 1.5, restitution: 0,
            chamfer: { radius: 6 }, slop: 0.02
        });
        plat._w = GOAL_PLATFORM_W; plat._h = GOAL_PLATFORM_H;
        plat._shape = "rect";
        plat._color = "#facc15";       // colored differently so the goal platform stands out
        platforms.push(plat);

        goal = {
            x: gx, y: gy,                          // base of the pole (top of the platform)
            topX: gx, topY: gy - GOAL_POLE_H,      // top of the pole
            radius: GOAL_RADIUS,
            platform: plat
        };
    }

    // Generate a layout based on 2-3 curvy paths from the spawn to the goal.
    // Each path samples shapes along it, with perpendicular jitter for variation.
    // Plus a sprinkle of completely-random shapes between the paths.
    function generatePlatformLayout(goalX, goalY) {
        const items = [];

        // Always-present starter ground at spawn so players can stand
        items.push({ type: "rect", x: 230, y: WORLD_H - 90, w: 420, h: 24 });

        const startX = 230, startY = WORLD_H - 160;

        const numPaths = 2 + Math.floor(Math.random() * 2);     // 2 or 3
        const allowedSamples = [];                              // remember every sample for jitter neighborhoods

        for (let pi = 0; pi < numPaths; pi++) {
            const wps = generateCurvyWaypoints(startX, startY, goalX, goalY, 4 + Math.floor(Math.random() * 3));
            const countTarget = Math.max(3, Math.round(OBJS_PER_PATH + (Math.random() - 0.5) * 6));
            const samples = sampleSplinePath(wps, countTarget);

            for (let i = 0; i < samples.length; i++) {
                const s = samples[i];
                // Perpendicular jitter — pulls samples off the central line
                const t = sampleTangent(wps, i / (samples.length - 1));
                const nx = -t.y, ny = t.x;                   // perpendicular
                const off = (Math.random() - 0.5) * 140;
                const x = s.x + nx * off + (Math.random() - 0.5) * 60;
                const y = s.y + ny * off + (Math.random() - 0.5) * 60;

                // Don't intrude on the spawn area
                if (x < 360 && y > WORLD_H - 360) continue;

                items.push(generateRandomShape(x, y));
                allowedSamples.push({ x, y });

                // Sometimes also add a satellite shape near this sample
                if (Math.random() < 0.45) {
                    const sx = x + (Math.random() - 0.5) * 220;
                    const sy = y + (Math.random() - 0.5) * 220;
                    items.push(generateRandomShape(sx, sy));
                }
            }
        }

        // Extra fully-random shapes scattered around the world (controlled by OBJ_DENSITY)
        const extra = Math.max(0, Math.round(OBJ_DENSITY + (Math.random() - 0.5) * 8));
        for (let i = 0; i < extra; i++) {
            const x = 200 + Math.random() * (WORLD_W - 400);
            const y = 220 + Math.random() * (WORLD_H - 500);
            if (x < 380 && y > WORLD_H - 380) continue;
            items.push(generateRandomShape(x, y));
        }

        return removeOverlaps(items);
    }

    // Generate a chain of waypoints with controlled curviness from start to end.
    function generateCurvyWaypoints(sx, sy, ex, ey, count) {
        const wps = [{ x: sx, y: sy }];
        // Pick a random side bias so paths spread to different vertical bands
        const sideBias = (Math.random() - 0.5) * 700;
        for (let i = 1; i < count - 1; i++) {
            const t = i / (count - 1);
            // Base lerp
            const lx = sx + (ex - sx) * t;
            const ly = sy + (ey - sy) * t;
            // Curve perpendicular to (sx,sy)->(ex,ey)
            const dx = ex - sx, dy = ey - sy;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len, ny = dx / len;
            const curve = Math.sin(t * Math.PI) * sideBias;
            const wobble = (Math.random() - 0.5) * 280;
            wps.push({ x: lx + nx * (curve + wobble), y: ly + ny * (curve + wobble) });
        }
        wps.push({ x: ex, y: ey });
        return wps;
    }

    // Catmull-Rom-style spline sampling — smooth path through all waypoints.
    function sampleSplinePath(wps, steps) {
        const out = [];
        for (let i = 0; i < wps.length - 1; i++) {
            const p0 = wps[Math.max(0, i - 1)];
            const p1 = wps[i];
            const p2 = wps[i + 1];
            const p3 = wps[Math.min(wps.length - 1, i + 2)];
            const segSteps = Math.max(2, Math.floor(steps / (wps.length - 1)));
            for (let j = 0; j < segSteps; j++) {
                const t = j / segSteps;
                const t2 = t * t, t3 = t2 * t;
                const x = 0.5 * ((2 * p1.x) +
                                 (-p0.x + p2.x) * t +
                                 (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                                 (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
                const y = 0.5 * ((2 * p1.y) +
                                 (-p0.y + p2.y) * t +
                                 (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                                 (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
                out.push({ x, y });
            }
        }
        out.push(wps[wps.length - 1]);
        return out;
    }
    function sampleTangent(wps, t) {
        // Approximate tangent at fraction t along the chain
        const i = Math.min(wps.length - 2, Math.max(0, Math.floor(t * (wps.length - 1))));
        const a = wps[i], b = wps[i + 1] || a;
        const dx = b.x - a.x, dy = b.y - a.y;
        const m = Math.hypot(dx, dy) || 1;
        return { x: dx / m, y: dy / m };
    }

    // Pick a random shape — only circles and axis-aligned rectangles (polygons and
    // angled rectangles were removed because they grab inconsistently).
    function generateRandomShape(x, y) {
        const shapes = ["circle", "circle", "wide", "narrow", "tall"];
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        const s = OBJ_AVG_SIZE;
        const jitter = () => 0.6 + Math.random() * 0.8;   // 0.6× – 1.4×
        switch (shape) {
            case "circle":
                return { type: "circle", x, y, r: Math.max(12, s * 0.55 * jitter()) };
            case "wide":
                return { type: "rect", x, y,
                         w: Math.max(60, s * 3.0 * jitter()),
                         h: Math.max(14, s * 0.3) };
            case "narrow":
                return { type: "rect", x, y,
                         w: Math.max(50, s * 1.5 * jitter()),
                         h: Math.max(16, s * 0.32) };
            case "tall":
                return { type: "rect", x, y,
                         w: Math.max(16, s * 0.3),
                         h: Math.max(80, s * 2.0 * jitter()) };
        }
    }

    // Cheap AABB overlap pruner
    function removeOverlaps(items) {
        const out = [];
        for (const it of items) {
            const r = (it.type === "circle" ? it.r * 2 : it.type === "polygon" ? it.r * 2 :
                       Math.max(it.w, it.h));
            const w = it.type === "circle" || it.type === "polygon" ? it.r * 2 : it.w;
            const h = it.type === "circle" || it.type === "polygon" ? it.r * 2 : it.h;
            let bad = false;
            for (const ex of out) {
                const ew = ex.type === "circle" || ex.type === "polygon" ? ex.r * 2 : ex.w;
                const eh = ex.type === "circle" || ex.type === "polygon" ? ex.r * 2 : ex.h;
                if (Math.abs(it.x - ex.x) < (w + ew) * 0.45 + 12 &&
                    Math.abs(it.y - ex.y) < (h + eh) * 0.45 + 12) { bad = true; break; }
            }
            if (!bad) out.push(it);
        }
        return out;
    }

    // Bright doodle palette (avoid pure red/blue which are reserved for L/R gloves)
    const PLATFORM_COLORS = [
        "#fb923c", "#facc15", "#a3e635", "#34d399", "#22d3ee",
        "#a78bfa", "#f472b6", "#fda4af", "#86efac", "#fde68a"
    ];
    function pickPlatformColor() {
        return PLATFORM_COLORS[Math.floor(Math.random() * PLATFORM_COLORS.length)];
    }

    // Build a static Matter body from a shape descriptor.
    function makeShapeBody(p) {
        const opts = {
            isStatic: true, label: "platform",
            friction: 1, frictionStatic: 1.5, restitution: 0,
            slop: 0.02
        };
        if (p.type === "circle") {
            const b = Bodies.circle(p.x, p.y, p.r, opts);
            b._shape = "circle";
            b._r = p.r;
            b._color = pickPlatformColor();
            return b;
        }
        // axis-aligned rect
        const b = Bodies.rectangle(p.x, p.y, p.w, p.h, { ...opts, chamfer: { radius: 4 } });
        b._shape = "rect";
        b._w = p.w; b._h = p.h;
        b._color = pickPlatformColor();
        return b;
    }

    // --- PLAYER ---
    function createPlayer(spec, idx) {
        const spawnX = SPAWN_POSITIONS[idx % SPAWN_POSITIONS.length].x;
        const spawnY = SPAWN_POSITIONS[idx % SPAWN_POSITIONS.length].y;

        const playerGroup = Body.nextGroup(true);    // negative — used by upper + glove (no own-rig collision)
        const bodyGroup   = Body.nextGroup(false);   // positive — used by head + forearm (always collide → physical limit)

        const head = Bodies.circle(spawnX, spawnY, HEAD_RADIUS, {
            label: "head",
            friction: HEAD_FRICTION, frictionStatic: HEAD_FRICTION_STATIC,
            frictionAir: HEAD_AIR_DAMP, restitution: HEAD_RESTITUTION,
            density: HEAD_DENSITY,
            // Head + own forearm share the positive bodyGroup → they ALWAYS collide.
            // Category mask still excludes upper-arm + glove so those don't bump.
            collisionFilter: { group: bodyGroup, category: CAT_HEAD, mask: CAT_WORLD | CAT_FORE }
        });

        const playerObj = {
            idx,
            name: spec.name || ("Player " + (idx + 1)),
            color: spec.color || "#3B82F6",
            team: spec.team || "blue",                 // legacy; still used by sprite picker
            char: spec.char || "epstein",
            device: spec.device,                       // { type: 'keyboard' } or { type: 'gamepad', index }
            head,
            arms: [],
            group: playerGroup,
            inkLeft: MAX_INK,
            input: { dx: 0, dy: 0, mag: 0 },
            prevButtons: { l: false, r: false, draw: false, rt: false },
            dead: false, deathTime: 0,
            winner: false,
            // Drawing state (per-player). Each player can independently enter/exit draw mode.
            drawMode: false,
            isDrawing: false,
            drawPoints: [],
            drawCursor: { x: spawnX, y: spawnY - 60 },
            // Per-player camera (smoothly lerps toward the head). Used in split-screen
            // mode where each player has their own viewport.
            cameraX: spawnX, cameraY: spawnY
        };
        head._player = playerObj;

        function makeArm(side) {
            const sign = side === "left" ? -1 : 1;
            const sx = spawnX + sign * SHOULDER_X;
            const sy = spawnY + SHOULDER_Y;

            // Upper arm — playerGroup (negative) keeps it from colliding with own
            // glove. Mask excludes everything except world so it doesn't bump heads
            // or forearms anywhere either.
            const upper = Bodies.rectangle(sx, sy + UPPER_LEN / 2, ARM_W, UPPER_LEN, {
                label: "armUpper",
                density: ARM_DENSITY, friction: 0.5, frictionAir: ARM_AIR_DAMP, restitution: 0.02,
                chamfer: { radius: ARM_W / 2 - 0.5 },
                collisionFilter: { group: playerGroup, category: CAT_UPPER, mask: CAT_WORLD }
            });

            // Forearm — bodyGroup (positive) shared with the head → they always
            // collide, providing a physical stop that prevents the arm from spinning
            // through the body. Doesn't collide with own upper-arm or glove.
            const fore = Bodies.rectangle(sx, sy + UPPER_LEN + FORE_LEN / 2, ARM_W, FORE_LEN, {
                label: "armFore",
                density: ARM_DENSITY, friction: 0.5, frictionAir: ARM_AIR_DAMP, restitution: 0.02,
                chamfer: { radius: ARM_W / 2 - 0.5 },
                collisionFilter: { group: bodyGroup, category: CAT_FORE, mask: CAT_WORLD | CAT_HEAD }
            });

            // Glove — separate physics body attached to the OUTSIDE tip of the forearm.
            // This is the ONLY part that can trigger a grab. Mask includes CAT_GLOVE so
            // cross-player gloves can collide (= teammate-glove grab via contact event).
            const gloveCY = sy + UPPER_LEN + FORE_LEN + GLOVE_RADIUS - 3;
            const glove = Bodies.circle(sx, gloveCY, GLOVE_RADIUS, {
                label: "glove",
                density: GLOVE_DENSITY, friction: 0.7, frictionAir: GLOVE_AIR_DAMP, restitution: 0.02,
                inertia: Infinity, inverseInertia: 0,
                collisionFilter: { group: playerGroup, category: CAT_GLOVE, mask: CAT_WORLD | CAT_GLOVE }
            });
            glove._side = side;

            // High stiffness + heavier damping = tight, non-stretchy joints.
            const shoulder = Constraint.create({
                bodyA: head, pointA: { x: sign * SHOULDER_X, y: SHOULDER_Y },
                bodyB: upper, pointB: { x: 0, y: -UPPER_LEN / 2 },
                length: 0, stiffness: 1, damping: 0.9
            });
            const elbow = Constraint.create({
                bodyA: upper, pointA: { x: 0, y: UPPER_LEN / 2 },
                bodyB: fore,  pointB: { x: 0, y: -FORE_LEN / 2 },
                length: 0, stiffness: 1, damping: 0.9
            });
            const wrist = Constraint.create({
                bodyA: fore, pointA: { x: 0, y: FORE_LEN / 2 },
                bodyB: glove, pointB: { x: 0, y: -GLOVE_RADIUS + 3 },
                length: 0, stiffness: 1, damping: 0.9
            });

            Composite.add(engine.world, [upper, fore, glove, shoulder, elbow, wrist]);

            const arm = {
                side, upper, fore, glove, shoulder, elbow, wrist,
                grabIntent: false,
                grabbed: false, grabBody: null, grabConstraint: null,
                owner: playerObj
            };
            // Tag the glove so the collision handler can find its owning arm in O(1)
            glove._arm = arm;
            // Mark the rest of the rig with the owning player too (used by grab logic
            // to detect "this is a teammate body" and skip self-grabs)
            upper._player = playerObj;
            fore._player  = playerObj;
            glove._player = playerObj;
            return arm;
        }

        const leftArm  = makeArm("left");
        const rightArm = makeArm("right");
        playerObj.arms = [leftArm, rightArm];

        Composite.add(engine.world, head);
        return playerObj;
    }

    function spawnRoster(roster) {
        players = [];
        keyboardPlayerIdx = -1;
        for (let i = 0; i < roster.length; i++) {
            const p = createPlayer(roster[i], i);
            players.push(p);
            if (p.device.type === "keyboard") keyboardPlayerIdx = i;
        }
    }

    // Reads device → fills p.input with { x, y, mag } per frame.
    // Also drives the drawing cursor for gamepad players while in draw mode.
    function pollPlayerInput(p) {
        let dx = 0, dy = 0;
        if (p.device.type === "keyboard") {
            if (keys["a"] || keys["arrowleft"])  dx -= 1;
            if (keys["d"] || keys["arrowright"]) dx += 1;
            if (keys["w"] || keys["arrowup"])    dy -= 1;
            if (keys["s"] || keys["arrowdown"])  dy += 1;
            const m = Math.hypot(dx, dy);
            if (m > 0) { dx /= m; dy /= m; }
            // While the keyboard player is in draw mode, the WASD keys still control
            // the arms (drawing is mouse-driven, separate input device).
            p.input.x = dx; p.input.y = dy; p.input.mag = m > 0 ? 1 : 0;
        } else if (p.device.type === "gamepad") {
            const pads = navigator.getGamepads ? navigator.getGamepads() : [];
            const gp = pads[p.device.index];
            if (!gp) { p.input.x = 0; p.input.y = 0; p.input.mag = 0; return; }
            const ax = gp.axes[0] || 0;
            const ay = gp.axes[1] || 0;
            const dz = 0.18;
            const mag = Math.hypot(ax, ay);

            if (p.drawMode) {
                // Left stick steers the drawing CURSOR (not the arms).
                if (mag >= dz) {
                    const adj = (mag - dz) / (1 - dz);
                    const speed = CURSOR_SENS * Math.min(adj, 1);
                    p.drawCursor.x += (ax / mag) * speed;
                    p.drawCursor.y += (ay / mag) * speed;
                }
                // Clamp to world bounds
                p.drawCursor.x = Math.max(BORDER, Math.min(WORLD_W - BORDER, p.drawCursor.x));
                p.drawCursor.y = Math.max(BORDER, Math.min(WORLD_H - BORDER, p.drawCursor.y));
                p.input.x = 0; p.input.y = 0; p.input.mag = 0;
                // Continuously feed the cursor into the in-progress stroke
                if (p.isDrawing) continueDrawingFor(p, p.drawCursor.x, p.drawCursor.y);
            } else {
                if (mag < dz) { p.input.x = 0; p.input.y = 0; p.input.mag = 0; }
                else {
                    const adj = (mag - dz) / (1 - dz);
                    p.input.x = (ax / mag) * Math.min(adj, 1);
                    p.input.y = (ay / mag) * Math.min(adj, 1);
                    p.input.mag = Math.min(adj, 1);
                }
            }
        }
    }

    // Edge-triggered button events (gamepad). Keyboard players get edges via
    // explicit mouse/key event listeners.
    function processPlayerEdges(p) {
        if (p.device.type !== "gamepad") return;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = pads[p.device.index];
        if (!gp) return;
        const lbtn = !!(gp.buttons[4] && gp.buttons[4].pressed) || !!(gp.buttons[6] && gp.buttons[6].pressed);
        const rbtn = !!(gp.buttons[5] && gp.buttons[5].pressed) || !!(gp.buttons[7] && gp.buttons[7].pressed);
        const cur = {
            l:    lbtn,
            r:    rbtn,
            draw: !!(gp.buttons[3] && gp.buttons[3].pressed),  // Y / Triangle
            rt:   rbtn,                                         // right shoulder/trigger (stroke while in draw mode)
            a:    !!(gp.buttons[0] && gp.buttons[0].pressed)
        };
        const prev = p.prevButtons;

        // Y always toggles draw mode (any time during play).
        if (cur.draw && !prev.draw) {
            if (p.drawMode) exitDrawModeFor(p);
            else            enterDrawModeFor(p);
        }

        if (p.drawMode) {
            // While drawing: RT/RB-hold creates the stroke; release confirms it.
            if (cur.rt && !prev.rt) startDrawingFor(p, p.drawCursor.x, p.drawCursor.y);
            else if (!cur.rt && prev.rt && p.isDrawing) finishDrawingFor(p);
            // Also make sure gloves don't stay clutched while in draw mode
            holdGrab(p, "left",  false);
            holdGrab(p, "right", false);
        } else {
            // Hold-to-grab: drives intent on press, releases on release.
            holdGrab(p, "left",  cur.l);
            holdGrab(p, "right", cur.r);
        }

        p.prevButtons = cur;
    }

    function updatePlayer(p) {
        if (!p || p.dead) return;
        const head = p.head;
        const dir = p.input;

        // 1) Body movement comes ONLY through grabbed gloves.
        if (dir.mag > 0) {
            for (const arm of p.arms) {
                if (!arm.grabbed) continue;
                const g = arm.glove.position;
                Body.applyForce(head, g, {
                    x: dir.x * SWING_FORCE,
                    y: dir.y * SWING_FORCE
                });
            }
        }
        if (Math.abs(head.velocity.x) > HEAD_MAX_V) {
            Body.setVelocity(head, { x: Math.sign(head.velocity.x) * HEAD_MAX_V, y: head.velocity.y });
        }
        const yCap = HEAD_MAX_V * 1.3;
        if (Math.abs(head.velocity.y) > yCap) {
            Body.setVelocity(head, { x: head.velocity.x, y: Math.sign(head.velocity.y) * yCap });
        }

        // 2) Each free arm's GLOVE is driven toward a target.
        for (const arm of p.arms) {
            if (arm.grabbed) continue;
            const sideSign = arm.side === "left" ? -1 : 1;
            const shoulder = getShoulderPos(arm);
            let tx, ty;
            if (dir.mag > 0) {
                const bx = dir.x + sideSign * 0.30;
                const by = dir.y - 0.05;
                const bm = Math.hypot(bx, by) || 1;
                tx = shoulder.x + (bx / bm) * HAND_REACH;
                ty = shoulder.y + (by / bm) * HAND_REACH;
            } else {
                tx = shoulder.x + sideSign * 22;
                ty = shoulder.y + 115;
            }
            const gp = arm.glove.position;
            const ddx = tx - gp.x;
            const ddy = ty - gp.y;
            Body.applyForce(arm.glove, gp, {
                x: ddx * HAND_DRIVE,
                y: ddy * HAND_DRIVE
            });
        }

        // 3) Cap arm angular velocity for paced motion.
        for (const arm of p.arms) {
            for (const seg of [arm.upper, arm.fore]) {
                if (Math.abs(seg.angularVelocity) > MAX_ARM_ANG_V) {
                    Body.setAngularVelocity(seg, Math.sign(seg.angularVelocity) * MAX_ARM_ANG_V);
                }
            }
        }

        // 4) Damp + cap the body's spin so arm-pull torque doesn't whip it around.
        head.angularVelocity *= BODY_SPIN_DAMP;
        if (Math.abs(head.angularVelocity) > BODY_MAX_SPIN) {
            Body.setAngularVelocity(head, Math.sign(head.angularVelocity) * BODY_MAX_SPIN);
        }

        // 5) Soft upper-arm angle limit (no hard snap). Each upper arm is bounded to
        //    its half-plane of the body — right arm sweeps down → right → up;
        //    left arm sweeps down → left → up. We add a small restoring angular
        //    velocity if it tries to leave the range. Smooth, not snap.
        for (const arm of p.arms) softShoulderLimit(arm, head);
    }

    function softShoulderLimit(arm, head) {
        const sign = arm.side === "left" ? -1 : 1;
        let rel = arm.upper.angle - head.angle;
        while (rel >  Math.PI) rel -= 2 * Math.PI;
        while (rel < -Math.PI) rel += 2 * Math.PI;
        const lo = sign > 0 ? 0 : -Math.PI;
        const hi = sign > 0 ? Math.PI : 0;
        let push = 0;
        if (rel < lo)      push = (lo - rel) * SHOULDER_LIMIT_K;        // nudge back toward lo
        else if (rel > hi) push = -(rel - hi) * SHOULDER_LIMIT_K;       // nudge back toward hi
        if (push !== 0) {
            Body.setAngularVelocity(arm.upper, arm.upper.angularVelocity + push);
        }
    }

    // --- GRAB (glove-only, intent-based) ---
    function grabAtBody(arm, target, worldPoint) {
        const root = target.parent || target;
        const wp = worldPoint || arm.glove.position;
        const dx = wp.x - root.position.x;
        const dy = wp.y - root.position.y;
        const cos = Math.cos(-root.angle), sin = Math.sin(-root.angle);
        const localPt = { x: dx * cos - dy * sin, y: dx * sin + dy * cos };

        // Constrain the GLOVE itself to the grab point. Length 0 = rigid grip.
        const c = Constraint.create({
            bodyA: arm.glove, pointA: { x: 0, y: 0 },
            bodyB: root, pointB: localPt,
            length: 0, stiffness: 1, damping: 0.6
        });
        Composite.add(engine.world, c);
        arm.grabbed = true;
        arm.grabIntent = true;
        arm.grabBody = root;
        arm.grabConstraint = c;
    }

    function tryImmediateGrab(arm) {
        // Only grab if the GLOVE is actually overlapping a grabbable right now.
        const gp = arm.glove.position;
        const grabbables = getGrabbables();
        const inside = Query.point(grabbables, gp);
        if (inside.length > 0) {
            grabAtBody(arm, inside[0], gp);
            return;
        }
        const cols = Query.collides(arm.glove, grabbables);
        for (const col of cols) {
            const other = col.bodyA === arm.glove ? col.bodyB : col.bodyA;
            if (!isGrabbable(other)) continue;
            const supports = col.supports || [];
            const pt = supports.length > 0 ? supports[0] : gp;
            grabAtBody(arm, other, pt);
            return;
        }
    }

    function getGrabbables() {
        const out = [];
        for (const p of platforms) out.push(p);
        for (const d of drawnBodies) {
            const parts = d.body.parts;
            if (parts.length > 1) {
                for (let i = 1; i < parts.length; i++) out.push(parts[i]);
            } else {
                out.push(d.body);
            }
        }
        return out;
    }

    function releaseGrab(arm) {
        if (arm.grabConstraint) {
            Composite.remove(engine.world, arm.grabConstraint);
            arm.grabConstraint = null;
        }
        arm.grabbed = false;
        arm.grabBody = null;
    }

    // Hold-to-grab semantics:
    //   pressed = true  → set intent, try immediate grab if already touching
    //   pressed = false → release any active grab and clear intent
    function holdGrab(p, side, pressed) {
        if (!p || p.dead) return;
        const arm = p.arms.find(a => a.side === side);
        if (!arm) return;
        if (pressed) {
            if (!arm.grabIntent) {
                arm.grabIntent = true;
                tryImmediateGrab(arm);
            }
        } else {
            arm.grabIntent = false;
            if (arm.grabbed) releaseGrab(arm);
        }
    }

    // --- DRAWING (per-player) ---
    // Each player has: drawMode, isDrawing, drawPoints, drawCursor, inkLeft.
    // Keyboard player: cursor follows mouse position (world space).
    // Gamepad player:  cursor moves with left-stick when in draw mode.
    function getKeyboardPlayer() {
        if (keyboardPlayerIdx < 0) return null;
        return players[keyboardPlayerIdx] || null;
    }
    function startDrawingFor(p, x, y) {
        if (!p || !p.drawMode || p.inkLeft <= 0) return;
        p.isDrawing = true;
        p.drawPoints = [{ x, y }];
    }
    function continueDrawingFor(p, x, y) {
        if (!p || !p.isDrawing) return;
        const last = p.drawPoints[p.drawPoints.length - 1];
        const d = dist(last, { x, y });
        if (d < 4) return;
        if (p.inkLeft - d < 0) { finishDrawingFor(p); return; }
        p.inkLeft -= d;
        p.drawPoints.push({ x, y });
    }
    function finishDrawingFor(p) {
        if (!p) return;
        p.isDrawing = false;
        if (p.drawPoints.length < 3) { p.drawPoints = []; return; }

        const simplified = [p.drawPoints[0]];
        for (let i = 1; i < p.drawPoints.length; i++) {
            if (dist(simplified[simplified.length - 1], p.drawPoints[i]) > 9) {
                simplified.push(p.drawPoints[i]);
            }
        }
        if (simplified.length < 2) { p.drawPoints = []; return; }

        const parts = [];
        for (let i = 0; i < simplified.length - 1; i++) {
            const a = simplified[i], b = simplified[i + 1];
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const len = dist(a, b);
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            const seg = Bodies.rectangle(mx, my, Math.max(len, 6), DRAW_THICKNESS, {
                angle,
                chamfer: { radius: DRAW_THICKNESS / 2 - 1 }
            });
            parts.push(seg);
        }
        const body = Body.create({
            parts,
            label: "drawing",
            friction: 1.0, frictionStatic: 1.8, restitution: 0,
            frictionAir: 0.06,
            density: DRAW_DENSITY,
            slop: 0.02,
            sleepThreshold: 30,
            // No explicit category/mask — drawings collide with everything by default.
        });
        Composite.add(engine.world, body);

        const localPts = simplified.map(pt => ({
            x: pt.x - body.position.x,
            y: pt.y - body.position.y
        }));

        const color = p.team === "red" ? "#d94a4a" : "#4a90d9";
        drawnBodies.push({ body, color, localPts });
        p.drawPoints = [];
    }
    function cancelDrawingFor(p) {
        if (!p) return;
        if (p.isDrawing && p.drawPoints.length > 1) {
            let refund = 0;
            for (let i = 1; i < p.drawPoints.length; i++) {
                refund += dist(p.drawPoints[i - 1], p.drawPoints[i]);
            }
            p.inkLeft = Math.min(MAX_INK, p.inkLeft + refund);
        }
        p.isDrawing = false;
        p.drawPoints = [];
    }
    function exitDrawModeFor(p) {
        if (!p) return;
        if (p.isDrawing) cancelDrawingFor(p);
        p.drawMode = false;
        // Release grabs are NOT changed; draw mode is non-destructive to grabs.
        if (p === getKeyboardPlayer()) {
            document.getElementById("draw-mode-indicator").classList.add("hidden");
            canvas.classList.remove("draw-cursor");
        }
    }
    function enterDrawModeFor(p) {
        if (!p) return;
        p.drawMode = true;
        // Seed the cursor at the player's head so they can see it immediately
        if (p.head) p.drawCursor = { x: p.head.position.x, y: p.head.position.y - 40 };
        if (p === getKeyboardPlayer()) {
            document.getElementById("draw-mode-indicator").classList.remove("hidden");
            canvas.classList.add("draw-cursor");
        }
    }

    // Back-compat: the keyboard player's mouse handlers and the Q key still call these.
    function getDrawingPlayer() { return getKeyboardPlayer(); }
    function startDrawing(x, y)    { startDrawingFor(getKeyboardPlayer(), x, y); }
    function continueDrawing(x, y) { continueDrawingFor(getKeyboardPlayer(), x, y); }
    function finishDrawing()       { finishDrawingFor(getKeyboardPlayer()); }
    function cancelDrawing()       { cancelDrawingFor(getKeyboardPlayer()); }
    function exitDrawMode()        { exitDrawModeFor(getKeyboardPlayer()); }
    function enterDrawMode()       { enterDrawModeFor(getKeyboardPlayer()); }
    // `drawMode` global mirrors the keyboard player's drawMode for legacy checks elsewhere.
    Object.defineProperty(window, "_afi_dummy_drawMode", { configurable: true, get(){ return drawMode; } });

    // --- RENDER ---
    // ---- Optimized doodle background ----
    // Each parallax layer is pre-rendered ONCE to a small tileable offscreen canvas.
    // Per frame we just draw the canvas a few times with a parallax offset — this is
    // dramatically cheaper than re-tracing wobbly polygons every frame.
    let bgLayers = null;
    const BG_TILE_W = 540;
    const BG_TILE_H = 380;
    function ensureBackgroundLayers() {
        if (bgLayers) return;
        bgLayers = [
            buildBgLayer({ count: 6,  hueRange: [80, 130],  minR: 60, maxR: 120, depth: 0.20, alpha: 0.50 }), // far hills
            buildBgLayer({ count: 9,  hueRange: [10, 60],   minR: 22, maxR: 55,  depth: 0.45, alpha: 0.55 }), // mid blobs
            buildBgLayer({ count: 14, hueRange: [200, 320], minR: 8,  maxR: 22,  depth: 0.80, alpha: 0.45 })  // near scribbles
        ];
    }
    function buildBgLayer(cfg) {
        const tile = document.createElement("canvas");
        tile.width = BG_TILE_W;
        tile.height = BG_TILE_H;
        const tctx = tile.getContext("2d");
        tctx.globalAlpha = cfg.alpha;
        // Render `count` blobs onto the tile. Render each blob THREE times around its
        // intended position (centre + wraps) so the tile is seamlessly tileable.
        for (let i = 0; i < cfg.count; i++) {
            const x  = Math.random() * BG_TILE_W;
            const y  = Math.random() * BG_TILE_H;
            const r  = cfg.minR + Math.random() * (cfg.maxR - cfg.minR);
            const hue = cfg.hueRange[0] + Math.random() * (cfg.hueRange[1] - cfg.hueRange[0]);
            const wobble = 4 + Math.random() * 6;
            const seed = Math.random() * 1000;
            tctx.fillStyle = `hsl(${hue},65%,55%)`;
            for (const dx of [-BG_TILE_W, 0, BG_TILE_W]) {
                for (const dy of [-BG_TILE_H, 0, BG_TILE_H]) {
                    drawDoodleBlobInto(tctx, x + dx, y + dy, r, wobble, seed);
                }
            }
        }
        return { tile, depth: cfg.depth };
    }
    function drawDoodleBlobInto(targetCtx, x, y, r, wobble, seed) {
        targetCtx.beginPath();
        const steps = 14;
        for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            const wob = Math.sin(seed + a * 3) * wobble + Math.cos(seed * 2 + a * 5) * (wobble * 0.4);
            const rr = r + wob;
            const px = x + Math.cos(a) * rr;
            const py = y + Math.sin(a) * rr;
            if (i === 0) targetCtx.moveTo(px, py); else targetCtx.lineTo(px, py);
        }
        targetCtx.closePath();
        targetCtx.fill();
    }
    function drawBackground() {
        // Cream paper backdrop
        ctx.fillStyle = "#f5ecd5";
        ctx.fillRect(0, 0, W, H);
        ensureBackgroundLayers();
        // Tile each pre-rendered layer canvas across the screen with a parallax offset
        for (const layer of bgLayers) {
            const ox = ((-camera.x * layer.depth) % BG_TILE_W + BG_TILE_W) % BG_TILE_W - BG_TILE_W;
            const oy = ((-camera.y * layer.depth * 0.5) % BG_TILE_H + BG_TILE_H) % BG_TILE_H - BG_TILE_H;
            for (let tx = ox; tx < W; tx += BG_TILE_W) {
                for (let ty = oy; ty < H; ty += BG_TILE_H) {
                    ctx.drawImage(layer.tile, tx, ty);
                }
            }
        }
    }
    function drawWorldEdges() {
        // No world borders — the map is open. Draw a faint horizon line near the
        // bottom of the world to hint at the void.
        ctx.strokeStyle = "rgba(40,30,20,0.25)";
        ctx.lineWidth = 2;
        const segs = 50;
        const segLen = WORLD_W / segs;
        ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
            const x = i * segLen;
            const y = WORLD_H - 4 + Math.sin(i * 0.7) * 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    // Pseudo-random offset (deterministic per body) for doodle wobble
    function _wobbleOffsets(p, count) {
        if (p._wob && p._wob.length === count) return p._wob;
        const arr = new Array(count);
        let seed = (p.id || 1) * 9301 + 49297;
        for (let i = 0; i < count; i++) {
            seed = (seed * 9301 + 49297) % 233280;
            arr[i] = ((seed / 233280) - 0.5) * 1.6;   // ±0.8 px
        }
        p._wob = arr;
        return arr;
    }

    function drawPlatforms() {
        for (const p of platforms) {
            if (p._noRenderShape) continue;
            const pos = p.position;
            const fillColor = p._color || "#6b8df0";   // bright doodle color (overridable per body)
            const strokeColor = "#1a1a2e";

            if (p._shape === "circle") {
                drawDoodleCircle(pos.x, pos.y, p._r, fillColor, strokeColor, p);
                continue;
            }

            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(p.angle);

            if (p._shape === "polygon") {
                const sides = p._sides | 0;
                const r = p._r;
                // shadow
                ctx.save();
                ctx.translate(3 * Math.cos(-p.angle), 3 * Math.sin(-p.angle));
                ctx.fillStyle = "rgba(0,0,0,0.18)";
                ctx.beginPath();
                for (let k = 0; k < sides; k++) {
                    const a = (k / sides) * Math.PI * 2 - Math.PI / 2;
                    const px = Math.cos(a) * r, py = Math.sin(a) * r;
                    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.closePath(); ctx.fill();
                ctx.restore();
                // body — vertical gradient inside the rotated frame
                const lg = ctx.createLinearGradient(0, -r, 0, r);
                lg.addColorStop(0, "#33334a"); lg.addColorStop(1, "#181828");
                ctx.fillStyle = lg;
                ctx.beginPath();
                for (let k = 0; k < sides; k++) {
                    const a = (k / sides) * Math.PI * 2 - Math.PI / 2;
                    const px = Math.cos(a) * r, py = Math.sin(a) * r;
                    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = "rgba(255,255,255,0.10)";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            } else {
                // rectangle in local space
                drawDoodleRect(p, p._w, p._h, fillColor, strokeColor);
            }

            ctx.restore();
        }
    }

    // ---- Doodle drawing primitives (rough wobbly outlines, layered fills) ----
    function drawDoodleCircle(cx, cy, r, fill, stroke, p) {
        const wob = _wobbleOffsets(p, 32);
        // Soft offset shadow
        ctx.fillStyle = "rgba(40,30,30,0.18)";
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const rr = r + (wob[i] || 0) * 0.6;
            const x = cx + 3 + Math.cos(a) * rr;
            const y = cy + 4 + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
        // Fill
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const rr = r + (wob[i] || 0);
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
        // Inner shading streak (colored-pencil hatching)
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = "rgba(0,0,0,0.10)";
        ctx.lineWidth = 1;
        for (let yy = -r; yy <= r; yy += 4) {
            ctx.beginPath();
            ctx.moveTo(cx - r, cy + yy + (wob[(yy|0)%wob.length]||0));
            ctx.lineTo(cx + r, cy + yy);
            ctx.stroke();
        }
        ctx.restore();
        // Wobbly outline
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const rr = r + (wob[i] || 0);
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
    }
    function drawDoodleRect(body, w, h, fill, stroke) {
        const wob = _wobbleOffsets(body, 16);
        const r = Math.min(6, w / 4, h / 4);
        // Shadow
        ctx.fillStyle = "rgba(40,30,30,0.18)";
        roundRect(ctx, -w / 2 + 3, -h / 2 + 4, w, h, r);
        ctx.fill();
        // Fill
        ctx.fillStyle = fill;
        roundRect(ctx, -w / 2 + (wob[0] || 0), -h / 2 + (wob[1] || 0), w + (wob[2] || 0), h + (wob[3] || 0), r);
        ctx.fill();
        // Diagonal hatching
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, -w / 2, -h / 2, w, h, r);
        ctx.clip();
        ctx.strokeStyle = "rgba(0,0,0,0.10)";
        ctx.lineWidth = 1;
        for (let i = -h; i < w + h; i += 5) {
            ctx.beginPath();
            ctx.moveTo(-w / 2 + i, -h / 2);
            ctx.lineTo(-w / 2 + i + h, h / 2);
            ctx.stroke();
        }
        ctx.restore();
        // Wobbly outline
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        // Trace rounded rect with small jitter at corners
        ctx.moveTo(-w / 2 + r + (wob[4] || 0), -h / 2 + (wob[5] || 0));
        ctx.lineTo( w / 2 - r + (wob[6] || 0), -h / 2 + (wob[7] || 0));
        ctx.quadraticCurveTo(w / 2, -h / 2, w / 2 + (wob[8] || 0), -h / 2 + r);
        ctx.lineTo( w / 2 + (wob[9] || 0),  h / 2 - r);
        ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r + (wob[10]||0), h / 2 + (wob[11]||0));
        ctx.lineTo(-w / 2 + r + (wob[12]||0), h / 2 + (wob[13]||0));
        ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2 + (wob[14]||0), h / 2 - r);
        ctx.lineTo(-w / 2 + (wob[15]||0), -h / 2 + r);
        ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
        ctx.closePath();
        ctx.stroke();
    }
    function drawGoal() {
        if (!goal) return;
        const gx = goal.x, gy = goal.y;
        const tx = goal.topX, ty = goal.topY;

        // Trigger radius (faint ring on the ground)
        ctx.strokeStyle = "rgba(255, 230, 120, 0.35)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(gx, gy, goal.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Pole shadow + body (drawn explicitly so its style matches the flag)
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(gx - GOAL_POLE_W / 2 + 2, ty + 2, GOAL_POLE_W, GOAL_POLE_H);
        const pg = ctx.createLinearGradient(gx - GOAL_POLE_W, 0, gx + GOAL_POLE_W, 0);
        pg.addColorStop(0, "#8a8aa0"); pg.addColorStop(0.5, "#e1e1ee"); pg.addColorStop(1, "#8a8aa0");
        ctx.fillStyle = pg;
        ctx.fillRect(gx - GOAL_POLE_W / 2, ty, GOAL_POLE_W, GOAL_POLE_H);

        // Pole top — small finial
        ctx.fillStyle = "#ffd966";
        ctx.beginPath(); ctx.arc(gx, ty - 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Flag (triangle pennant, animated wave) — to the right of the pole
        const flagH = 56;
        const flagW = 86;
        const t = Date.now() / 500;
        const sway = Math.sin(t) * 4;
        ctx.fillStyle = balloonColor;
        ctx.beginPath();
        ctx.moveTo(gx + GOAL_POLE_W / 2, ty + 4);                                    // pole top attach
        ctx.quadraticCurveTo(gx + flagW * 0.55, ty + 4 + sway,
                             gx + flagW, ty + flagH * 0.35 + sway);                  // top edge with wave
        ctx.quadraticCurveTo(gx + flagW * 0.55, ty + flagH * 0.45,
                             gx + GOAL_POLE_W / 2, ty + flagH);                      // bottom edge back
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Subtle inner stripe for depth
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx + GOAL_POLE_W / 2 + 2, ty + 8);
        ctx.quadraticCurveTo(gx + flagW * 0.55, ty + flagH * 0.20 + sway,
                             gx + flagW - 6, ty + flagH * 0.34 + sway);
        ctx.stroke();

        // Win-timer ring around the base
        if (goalTimerStart > 0) {
            const pct = Math.min(1, (Date.now() - goalTimerStart) / GOAL_WIN_TIME_MS);
            ctx.strokeStyle = "rgba(255, 230, 120, 0.95)";
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(gx, gy, goal.radius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
            ctx.stroke();
        }

        // "GOAL" label
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 14px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("GOAL", gx, ty - 18);
    }

    function drawDrawings() {
        drawnBodies.forEach(d => {
            const pts = d.localPts;
            const cos = Math.cos(d.body.angle);
            const sin = Math.sin(d.body.angle);
            const cx = d.body.position.x;
            const cy = d.body.position.y;
            const path = () => {
                ctx.beginPath();
                for (let i = 0; i < pts.length; i++) {
                    const wx = cx + pts[i].x * cos - pts[i].y * sin;
                    const wy = cy + pts[i].x * sin + pts[i].y * cos;
                    if (i === 0) ctx.moveTo(wx, wy);
                    else ctx.lineTo(wx, wy);
                }
            };
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = DRAW_THICKNESS + 3;
            path(); ctx.stroke();
            ctx.strokeStyle = d.color;
            ctx.lineWidth = DRAW_THICKNESS;
            path(); ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.2)";
            ctx.lineWidth = DRAW_THICKNESS * 0.32;
            path(); ctx.stroke();
        });
    }

    function drawDrawingPreview() {
        for (const p of players) {
            if (!p.isDrawing || p.drawPoints.length < 2) continue;
            ctx.strokeStyle = p.team === "blue" ? "rgba(59,130,246,0.75)" : "rgba(239,68,68,0.75)";
            ctx.lineWidth = DRAW_THICKNESS;
            ctx.lineCap = "round"; ctx.lineJoin = "round";
            ctx.setLineDash([6, 8]);
            ctx.beginPath();
            ctx.moveTo(p.drawPoints[0].x, p.drawPoints[0].y);
            for (let i = 1; i < p.drawPoints.length; i++) ctx.lineTo(p.drawPoints[i].x, p.drawPoints[i].y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // Cursor in world space for each in-draw-mode player.
    function drawDrawCursors() {
        for (const p of players) {
            if (!p.drawMode) continue;
            let cx, cy;
            if (p === getKeyboardPlayer()) {
                const w = worldFromScreen(mouseX, mouseY);
                cx = w.x; cy = w.y;
            } else {
                cx = p.drawCursor.x; cy = p.drawCursor.y;
            }
            const teamColor = p.team === "blue" ? "#3B82F6" : "#EF4444";
            // Crosshair
            ctx.strokeStyle = teamColor;
            ctx.lineWidth = 2 / currentZoom;
            ctx.beginPath();
            ctx.arc(cx, cy, 14, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy);
            ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18);
            ctx.stroke();
            // Player tag
            ctx.fillStyle = teamColor;
            ctx.font = "bold 11px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText("P" + (p.idx + 1) + " ✏️", cx, cy - 22);
        }
    }

    function drawSegmentBetween(ax, ay, bx, by, color) {
        // Draw a solid colored capsule from point A to point B (no joint dots).
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        ctx.save();
        ctx.translate((ax + bx) / 2, (ay + by) / 2);
        ctx.rotate(angle);
        ctx.fillStyle = color;
        roundRect(ctx, -len / 2, -ARM_W / 2, len, ARM_W, ARM_W / 2);
        ctx.fill();
        ctx.restore();
    }

    function drawArm(arm, color) {
        const head = arm.owner.head;
        const sign = arm.side === "left" ? -1 : 1;
        // Shoulder anchor in head's local frame, rotated by the head's angle so it
        // follows the body when it spins.
        const sox = sign * SHOULDER_X, soy = SHOULDER_Y;
        const cos = Math.cos(head.angle), sin = Math.sin(head.angle);
        const shoulder = {
            x: head.position.x + sox * cos - soy * sin,
            y: head.position.y + sox * sin + soy * cos
        };

        // Elbow: upper-arm body's outer end (the joint between upper and fore).
        const ua = arm.upper.angle;
        const elbow = {
            x: arm.upper.position.x + (UPPER_LEN / 2) * -Math.sin(ua),
            y: arm.upper.position.y + (UPPER_LEN / 2) *  Math.cos(ua)
        };

        // Wrist: forearm body's outer end (where it meets the glove).
        const fa = arm.fore.angle;
        const wrist = {
            x: arm.fore.position.x + (FORE_LEN / 2) * -Math.sin(fa),
            y: arm.fore.position.y + (FORE_LEN / 2) *  Math.cos(fa)
        };

        // Solid color capsule segments — no joint ball drawn.
        drawSegmentBetween(shoulder.x, shoulder.y, elbow.x, elbow.y, color);
        drawSegmentBetween(elbow.x,    elbow.y,    wrist.x, wrist.y, color);
    }

    function drawGlove(arm) {
        const g = arm.glove.position;
        const isLeft = arm.side === "left";
        const fill   = isLeft ? "#3B82F6" : "#EF4444";
        const letter = isLeft ? "L" : "R";

        // Soft shadow
        ctx.fillStyle = "rgba(0,0,0,0.32)";
        ctx.beginPath();
        ctx.arc(g.x + 1.5, g.y + 2, GLOVE_RADIUS + 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Glove body
        const grd = ctx.createRadialGradient(
            g.x - GLOVE_RADIUS * 0.4, g.y - GLOVE_RADIUS * 0.4, GLOVE_RADIUS * 0.2,
            g.x, g.y, GLOVE_RADIUS
        );
        grd.addColorStop(0, isLeft ? "#7BB1FF" : "#FF8585");
        grd.addColorStop(1, fill);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(g.x, g.y, GLOVE_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        // Outline (state ring)
        if (arm.grabbed) {
            ctx.strokeStyle = "#FFD700";
            ctx.lineWidth = 3;
        } else if (arm.grabIntent) {
            const pulse = 1 + Math.sin(Date.now() / 120) * 0.25;
            ctx.strokeStyle = "rgba(255,255,255,0.95)";
            ctx.lineWidth = 2.5 * pulse;
        } else {
            ctx.strokeStyle = "rgba(0,0,0,0.5)";
            ctx.lineWidth = 1.5;
        }
        ctx.beginPath();
        ctx.arc(g.x, g.y, GLOVE_RADIUS + (arm.grabbed ? 1.5 : 0), 0, Math.PI * 2);
        ctx.stroke();

        // Letter
        ctx.fillStyle = "#fff";
        ctx.font = "bold " + Math.floor(GLOVE_RADIUS * 1.4) + "px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(letter, g.x, g.y + 1);
        ctx.fillText(letter, g.x, g.y + 1);
    }

    // Procedural Heave-Ho-style doodle character. Drawn entirely in the body's
    // local frame — translate + rotate to the head's transform once, then draw
    // everything axis-aligned. This way the face rotates with the body.
    function drawHead(x, y, _team, _char, color, idHash, angle) {
        const r = HEAD_RADIUS;
        const wob = _doodleWobble(idHash || 1, 24);

        // Soft shadow stays in WORLD space (doesn't rotate with the body)
        ctx.fillStyle = "rgba(40,30,30,0.18)";
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.95, r * 0.95, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle || 0);

        // Body blob (peanut/oval, slightly taller than wide)
        const rx = r * 1.05, ry = r * 1.15;
        ctx.fillStyle = color || "#ef4444";
        ctx.beginPath();
        const steps = 22;
        for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            const w = wob[i % wob.length] || 0;
            const px = Math.cos(a) * (rx + w);
            const py = Math.sin(a) * (ry + w * 0.7);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#1a1a2e";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.stroke();

        // Eyes
        const eyeY = -r * 0.25;
        const eyeDX = r * 0.40;
        const eyeR = r * 0.22;
        for (const sx of [-1, 1]) {
            ctx.fillStyle = "#000";
            ctx.beginPath();
            ctx.ellipse(sx * eyeDX, eyeY, eyeR, eyeR * 0.95, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.beginPath();
            ctx.arc(sx * eyeDX - eyeR * 0.3, eyeY - eyeR * 0.35, eyeR * 0.22, 0, Math.PI * 2);
            ctx.fill();
        }
        // Brows
        ctx.strokeStyle = "#000";
        ctx.lineWidth = r * 0.18;
        ctx.lineCap = "round";
        for (const sx of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(sx * (eyeDX - eyeR * 0.5), eyeY - eyeR * 0.85);
            ctx.lineTo(sx * (eyeDX + eyeR * 0.7), eyeY - eyeR * 1.05);
            ctx.stroke();
        }
        // Toothy grin
        const mouthY = r * 0.32;
        const mouthW = r * 0.55;
        const mouthH = r * 0.25;
        ctx.fillStyle = "#1a1a2e";
        roundRect(ctx, -mouthW, mouthY - mouthH * 0.4, mouthW * 2, mouthH, 4);
        ctx.fill();
        ctx.fillStyle = "#fffceb";
        const tw = (mouthW * 2) / 3.4;
        for (let i = 0; i < 3; i++) {
            ctx.fillRect(-mouthW + 4 + i * (tw + 1.5), mouthY - mouthH * 0.25, tw - 1, mouthH * 0.65);
        }

        ctx.restore();
    }
    function _doodleWobble(seed, count) {
        const arr = new Array(count);
        let s = seed * 9301 + 49297;
        for (let i = 0; i < count; i++) {
            s = (s * 9301 + 49297) % 233280;
            arr[i] = ((s / 233280) - 0.5) * 2.6;
        }
        return arr;
    }

    function drawOnePlayer(p) {
        if (!p || p.dead) return;
        const head = p.head;
        const armColor = p.color || "#3B82F6";
        for (const arm of p.arms) drawArm(arm, armColor);
        drawHead(head.position.x, head.position.y, p.team, p.char, armColor, p.idx + 1, head.angle);
        for (const arm of p.arms) drawGlove(arm);
        // Floating name tag above the head (always shown; size controlled by tunable)
        if (p.name) {
            const fs = NAMETAG_SIZE;
            ctx.font = `bold ${fs}px Inter, sans-serif`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const padH = Math.max(2, fs * 0.25);
            const padW = Math.max(6, fs * 0.6);
            const tw = ctx.measureText(p.name).width + padW * 2;
            const ny = head.position.y - HEAD_RADIUS - fs * 1.05;
            ctx.fillStyle = "rgba(255,253,235,0.92)";
            roundRect(ctx, head.position.x - tw / 2, ny - fs / 2 - padH, tw, fs + padH * 2, 4);
            ctx.fill();
            ctx.strokeStyle = "#1a1a2e";
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.fillStyle = armColor;
            ctx.fillRect(head.position.x - tw / 2, ny - fs / 2 - padH, 3, fs + padH * 2);
            ctx.fillStyle = "#1a1a2e";
            ctx.fillText(p.name, head.position.x, ny);
        }
    }

    function drawAllPlayers() {
        for (const p of players) drawOnePlayer(p);
    }

    function drawHUD() {
        // Timer (shared)
        if (gameState === "playing") {
            const elapsed = (Date.now() - startTime) / 1000;
            const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
            const t = document.getElementById("timer-text");
            if (t) t.textContent = m + ":" + (s < 10 ? "0" : "") + s;
        }
        // Per-player rows (built into #player-hud)
        const drawer = getDrawingPlayer();
        const container = document.getElementById("player-hud");
        if (!container) return;
        // Ensure rows exist for each player
        while (container.children.length < players.length) {
            const row = document.createElement("div");
            row.className = "phud-row";
            row.innerHTML = `
                <span class="phud-tag"></span>
                <span class="phud-name"></span>
                <div class="phud-bar-bg"><div class="phud-bar"></div></div>
                <span class="phud-pct"></span>
                <span class="phud-device"></span>`;
            container.appendChild(row);
        }
        while (container.children.length > players.length) container.removeChild(container.lastChild);

        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            const row = container.children[i];
            const isDrawer = (p === drawer);
            const pct = Math.max(0, isDrawer ? (p.inkLeft / MAX_INK) : 0);
            const tag = row.querySelector(".phud-tag");
            tag.textContent = "";
            tag.style.background = p.color || "#3B82F6";
            row.querySelector(".phud-name").textContent = p.name || "Player";
            const bar = row.querySelector(".phud-bar");
            bar.style.width = (pct * 100) + "%";
            const c1 = p.color || "#3B82F6";
            bar.style.background = `linear-gradient(90deg, ${c1}, ${c1}aa)`;
            bar.classList.toggle("low", pct < 0.25 && isDrawer);
            row.querySelector(".phud-pct").textContent = isDrawer ? (Math.round(pct * 100) + "%") : "—";
            row.querySelector(".phud-device").textContent = p.device.type === "keyboard"
                ? "⌨️" : ("🎮" + (p.device.index + 1));
            row.classList.toggle("dead", !!p.dead);
        }
    }

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
    }

    function clampCam(cx, cy, vpW, vpH) {
        const halfW = (vpW / 2) / currentZoom;
        const halfH = (vpH / 2) / currentZoom;
        return {
            x: Math.max(halfW, Math.min(WORLD_W - halfW, cx)),
            y: Math.max(halfH, Math.min(WORLD_H - halfH, cy))
        };
    }

    function updateSplitState() {
        const alive = players.filter(p => !p.dead);
        let maxD = 0;
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i].head.position, b = alive[j].head.position;
                const d = Math.hypot(b.x - a.x, b.y - a.y);
                if (d > maxD) maxD = d;
            }
        }
        const SPLIT_EXIT = SPLIT_ENTER * 0.8;   // hysteresis (~20% lower)
        if (alive.length < 2) splitScreen = false;
        else if (!splitScreen && maxD > SPLIT_ENTER) splitScreen = true;
        else if (splitScreen && maxD < SPLIT_EXIT)  splitScreen = false;
        // Compute pie slices once per frame so render + minimap share the layout
        splitSlices = splitScreen ? computeSlices(alive) : [];
    }

    function updateCamera() {
        const alive = players.filter(p => !p.dead);
        // Compute farthest-pair distance for dynamic unified zoom
        let maxD = 0;
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i].head.position, b = alive[j].head.position;
                const d = Math.hypot(b.x - a.x, b.y - a.y);
                if (d > maxD) maxD = d;
            }
        }
        // Target zoom: full zoom when bunched up, drop toward SPLIT_ZOOM_MIN as they spread.
        // Once farther than SPLIT_ENTER, the screen splits and zoom returns to default.
        let targetZoom = SPLIT_ZOOM_MAX;
        if (!splitScreen && alive.length >= 2) {
            const t = Math.min(1, maxD / Math.max(1, SPLIT_ENTER));
            targetZoom = SPLIT_ZOOM_MAX + (SPLIT_ZOOM_MIN - SPLIT_ZOOM_MAX) * t;
        }
        currentZoom += (targetZoom - currentZoom) * 0.12;

        // Shared camera (used when not splitting) — center on alive players
        let n = 0, sx = 0, sy = 0;
        for (const p of alive) {
            sx += p.head.position.x; sy += p.head.position.y; n++;
        }
        if (n > 0) {
            const tx = sx / n, ty = sy / n;
            camera.x += (tx - camera.x) * 0.12;
            camera.y += (ty - camera.y) * 0.12;
        }
        const c = clampCam(camera.x, camera.y, W, H);
        camera.x = c.x; camera.y = c.y;

        // Per-player cameras (used in split mode) — each follows its own head.
        // Clamp using the bounding box of the player's slice on the canvas (so the
        // camera doesn't leave the world even when the slice is a small wedge).
        for (const p of players) {
            const tx = p.head.position.x, ty = p.head.position.y;
            p.cameraX += (tx - p.cameraX) * 0.16;
            p.cameraY += (ty - p.cameraY) * 0.16;
            const slice = splitScreen ? getPlayerSlice(p) : null;
            const sliceW = slice ? sliceBoundsW(slice.poly) : W;
            const sliceH = slice ? sliceBoundsH(slice.poly) : H;
            const cc = clampCam(p.cameraX, p.cameraY, sliceW, sliceH);
            p.cameraX = cc.x; p.cameraY = cc.y;
        }
    }
    function sliceBoundsW(poly) {
        let lo = Infinity, hi = -Infinity;
        for (const v of poly) { if (v.x < lo) lo = v.x; if (v.x > hi) hi = v.x; }
        return hi - lo;
    }
    function sliceBoundsH(poly) {
        let lo = Infinity, hi = -Infinity;
        for (const v of poly) { if (v.y < lo) lo = v.y; if (v.y > hi) hi = v.y; }
        return hi - lo;
    }

    // ---- Pie-slice split layout ----
    // For each alive player, compute a polygon on the canvas (a wedge centered on the
    // screen middle, oriented toward the player's world direction relative to the group
    // centroid). Two-player splits are 180° wedges → a single perpendicular line.
    function computeSlices(alive) {
        const cx = W / 2, cy = H / 2;
        if (alive.length === 1) {
            return [{ player: alive[0], poly: [{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}],
                       centroid: { x: cx, y: cy } }];
        }
        // World-space centroid
        let wcx = 0, wcy = 0;
        for (const p of alive) { wcx += p.head.position.x; wcy += p.head.position.y; }
        wcx /= alive.length; wcy /= alive.length;
        // Angle from centroid for each player (atan2 → canvas-y is downward, so angle is
        // also flipped but the algorithm is consistent: same convention everywhere).
        const ranked = alive.map(p => ({
            player: p,
            angle: Math.atan2(p.head.position.y - wcy, p.head.position.x - wcx)
        })).sort((a, b) => a.angle - b.angle);

        // Boundary angles between adjacent players (CCW)
        const n = ranked.length;
        const bounds = new Array(n);
        for (let i = 0; i < n; i++) {
            const me = ranked[i];
            const next = ranked[(i + 1) % n];
            let diff = next.angle - me.angle;
            while (diff <= 0) diff += 2 * Math.PI;
            bounds[i] = me.angle + diff / 2;
        }

        const slices = [];
        for (let i = 0; i < n; i++) {
            const ang1 = bounds[(i - 1 + n) % n];
            const ang2 = bounds[i];
            const poly = wedgePolygon(cx, cy, ang1, ang2);
            let xx = 0, yy = 0;
            for (const v of poly) { xx += v.x; yy += v.y; }
            slices.push({
                player: ranked[i].player,
                ang1, ang2, poly,
                centroid: { x: xx / poly.length, y: yy / poly.length }
            });
        }
        return slices;
    }

    function rayToRectEdge(cx, cy, ang) {
        const dx = Math.cos(ang), dy = Math.sin(ang);
        let t = Infinity;
        if (dx >  1e-6) t = Math.min(t, (W - cx) / dx);
        if (dx < -1e-6) t = Math.min(t, (0 - cx) / dx);
        if (dy >  1e-6) t = Math.min(t, (H - cy) / dy);
        if (dy < -1e-6) t = Math.min(t, (0 - cy) / dy);
        return { x: cx + dx * t, y: cy + dy * t };
    }

    function wedgePolygon(cx, cy, ang1, ang2) {
        while (ang2 <= ang1) ang2 += 2 * Math.PI;
        const poly = [{ x: cx, y: cy }, rayToRectEdge(cx, cy, ang1)];
        // Add canvas corners that fall between ang1 and ang2 (CCW)
        const corners = [{x:W,y:0},{x:W,y:H},{x:0,y:H},{x:0,y:0}];
        const withAngles = corners.map(c => {
            let a = Math.atan2(c.y - cy, c.x - cx);
            while (a < ang1) a += 2 * Math.PI;
            return { x: c.x, y: c.y, angle: a };
        }).filter(c => c.angle > ang1 && c.angle < ang2)
          .sort((a, b) => a.angle - b.angle);
        for (const c of withAngles) poly.push({ x: c.x, y: c.y });
        poly.push(rayToRectEdge(cx, cy, ang2));
        return poly;
    }

    // Returns the slice descriptor for a player (used by mouse mapping etc.).
    function getPlayerSlice(p) {
        if (!splitScreen) return null;
        for (const s of splitSlices) if (s.player === p) return s;
        return null;
    }

    function worldFromScreen(x, y) {
        // Map screen → world via the keyboard player's slice so drawing aligns
        // with what they see even in split mode.
        const kb = getKeyboardPlayer();
        if (kb && splitScreen) {
            const slice = getPlayerSlice(kb);
            if (slice) {
                return {
                    x: (x - slice.centroid.x) / currentZoom + kb.cameraX,
                    y: (y - slice.centroid.y) / currentZoom + kb.cameraY
                };
            }
        }
        return {
            x: (x - W / 2) / currentZoom + camera.x,
            y: (y - H / 2) / currentZoom + camera.y
        };
    }

    function renderWorld() {
        drawWorldEdges();
        drawPlatforms();
        drawGoal();
        drawDrawings();
        drawDrawingPreview();
        drawAllPlayers();
        drawDrawCursors();
    }

    function renderSlice(slice, camX, camY) {
        ctx.save();
        // Build clip path from the slice polygon
        const poly = slice.poly;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.clip();
        // Camera centered on the slice's centroid in screen space
        ctx.translate(slice.centroid.x, slice.centroid.y);
        ctx.scale(currentZoom, currentZoom);
        ctx.translate(-camX, -camY);
        renderWorld();
        ctx.restore();
    }

    function drawSplitSeparators(alive) {
        // Draw the wedge boundaries (rays from canvas center to the rect edge)
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (const slice of splitSlices) {
            const a1 = slice.ang1;
            const p1 = rayToRectEdge(W / 2, H / 2, a1);
            ctx.moveTo(W / 2, H / 2);
            ctx.lineTo(p1.x, p1.y);
        }
        ctx.stroke();

        // (Removed slice-center name tags — names now appear only above the heads.)
    }

    function render() {
        drawBackground();

        const alive = players.filter(p => !p.dead);
        if (splitScreen && splitSlices.length >= 2) {
            for (const slice of splitSlices) {
                renderSlice(slice, slice.player.cameraX, slice.player.cameraY);
            }
            drawSplitSeparators(alive);
        } else {
            // Single unified viewport
            const fullSlice = {
                poly: [{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}],
                centroid: { x: W / 2, y: H / 2 }
            };
            renderSlice(fullSlice, camera.x, camera.y);
        }

        drawMinimap();
        drawLog();
        drawCountdown();
    }

    function drawLog() {
        const now = Date.now();
        deathLog = deathLog.filter(e => e.expiresAt > now);
        if (deathLog.length === 0) return;
        const padX = 12, padY = 6;
        let y = MINIMAP_H + 32;     // start below the minimap
        ctx.font = "bold 13px Inter, sans-serif";
        ctx.textBaseline = "middle";
        for (const e of deathLog) {
            const fade = Math.max(0, Math.min(1, (e.expiresAt - now) / 1200));
            const alpha = Math.min(1, fade + 0.25);
            const w = Math.min(360, ctx.measureText(e.msg).width + padX * 2);
            const x = W - w - 16;
            ctx.fillStyle = `rgba(10, 14, 26, ${0.72 * alpha})`;
            roundRect(ctx, x, y, w, 24, 6);
            ctx.fill();
            ctx.fillStyle = e.color;
            ctx.fillRect(x, y + 4, 3, 16);
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            ctx.textAlign = "left";
            ctx.fillText(e.msg, x + padX, y + 12);
            y += 28;
        }
    }

    function drawCountdown() {
        if (gameState !== "countdown") return;
        const elapsed = Date.now() - countdownStart;
        const sec = 3 - Math.floor(elapsed / 1000);
        const display = sec > 0 ? String(sec) : "GO!";
        // Dim backdrop
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, W, H);
        // Pulse scale based on fractional time
        const frac = (elapsed % 1000) / 1000;
        const scale = 1.5 - frac * 0.5;
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(scale, scale);
        ctx.fillStyle = sec > 0 ? "#FFD700" : "#5eead4";
        ctx.font = "bold 160px 'Bangers', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 6;
        ctx.strokeText(display, 0, 0);
        ctx.fillText(display, 0, 0);
        ctx.restore();
    }

    function drawMinimap() {
        const mw = MINIMAP_W, mh = MINIMAP_H;
        const mx = W - mw - 16, my = 16;
        const sx = mw / WORLD_W, sy = mh / WORLD_H;

        // Background
        ctx.fillStyle = "rgba(10, 14, 26, 0.85)";
        ctx.fillRect(mx, my, mw, mh);
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 2;
        ctx.strokeRect(mx, my, mw, mh);

        // Platforms (drawn axis-aligned even when source is angled — minimap is a hint)
        ctx.fillStyle = "rgba(220,220,235,0.55)";
        for (const p of platforms) {
            const pw = (p._w || 30) * sx;
            const ph = (p._h || 8) * sy;
            ctx.fillRect(mx + p.position.x * sx - pw / 2, my + p.position.y * sy - ph / 2, pw, ph);
        }

        // Goal flag on minimap
        if (goal) {
            const fx = mx + goal.x * sx, fy = my + goal.y * sy;
            const topY = my + goal.topY * sy;
            ctx.strokeStyle = "#e1e1ee";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(fx, topY);
            ctx.stroke();
            ctx.fillStyle = balloonColor;
            ctx.beginPath();
            ctx.moveTo(fx, topY);
            ctx.lineTo(fx + 8, topY + 4);
            ctx.lineTo(fx, topY + 8);
            ctx.closePath();
            ctx.fill();
        }

        // Players (per-player color dots)
        for (const p of players) {
            if (p.dead) continue;
            const px = mx + p.head.position.x * sx;
            const py = my + p.head.position.y * sy;
            ctx.fillStyle = p.color || "#3B82F6";
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.55)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        if (!splitScreen) {
            // Unified camera-view rectangle
            const vx = (camera.x - (W / 2) / currentZoom) * sx;
            const vy = (camera.y - (H / 2) / currentZoom) * sy;
            const vw = (W / currentZoom) * sx;
            const vh = (H / currentZoom) * sy;
            ctx.strokeStyle = "rgba(255,255,255,0.7)";
            ctx.lineWidth = 1;
            ctx.strokeRect(mx + vx, my + vy, vw, vh);
        } else if (splitSlices.length >= 2) {
            // Show the split center + boundary rays in world space, mirroring the canvas
            // pie. The split center on the minimap is the player centroid.
            const alive = players.filter(p => !p.dead);
            let acx = 0, acy = 0;
            for (const p of alive) { acx += p.head.position.x; acy += p.head.position.y; }
            acx /= alive.length; acy /= alive.length;
            const cmx = mx + acx * sx, cmy = my + acy * sy;
            // Tint each slice region on the minimap with its player's team color
            for (const slice of splitSlices) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(mx, my, mw, mh);
                ctx.clip();
                // Wedge on minimap
                ctx.beginPath();
                ctx.moveTo(cmx, cmy);
                const r = (mw + mh) * 2;          // generous radius — clipped to minimap rect
                const p1 = { x: cmx + Math.cos(slice.ang1) * r, y: cmy + Math.sin(slice.ang1) * r };
                const p2 = { x: cmx + Math.cos(slice.ang2) * r, y: cmy + Math.sin(slice.ang2) * r };
                ctx.lineTo(p1.x, p1.y);
                // Sweep around CCW
                let a = slice.ang1, ae = slice.ang2;
                while (ae <= a) ae += 2 * Math.PI;
                const steps = 24;
                for (let s = 1; s <= steps; s++) {
                    const aa = a + (ae - a) * (s / steps);
                    ctx.lineTo(cmx + Math.cos(aa) * r, cmy + Math.sin(aa) * r);
                }
                ctx.closePath();
                const team = slice.player.team;
                ctx.fillStyle = team === "red" ? "rgba(239,68,68,0.18)" : "rgba(59,130,246,0.18)";
                ctx.fill();
                ctx.restore();
            }
            // Draw boundary rays on top
            ctx.save();
            ctx.beginPath();
            ctx.rect(mx, my, mw, mh);
            ctx.clip();
            ctx.strokeStyle = "rgba(255, 215, 0, 0.85)";
            ctx.lineWidth = 1.5;
            for (const slice of splitSlices) {
                const r = (mw + mh) * 2;
                ctx.beginPath();
                ctx.moveTo(cmx, cmy);
                ctx.lineTo(cmx + Math.cos(slice.ang1) * r, cmy + Math.sin(slice.ang1) * r);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    // --- COLLISIONS ---
    function setupCollisions() {
        // Glove contact → grab attempt. Each glove is tagged with `_arm = arm` so we
        // can look up the owning arm in O(1) without iterating all players.
        // Bodies on OTHER teammates are grabbable (heads, arms, gloves) — but not
        // bodies belonging to the SAME player (the glove can't grab its own arm).
        const handleGrabContact = (pair) => {
            const a = pair.bodyA, b = pair.bodyB;
            const arm = a._arm || b._arm;
            if (!arm) return;
            if (arm.grabbed || !arm.grabIntent) return;
            if (arm.owner.dead) return;
            const other = (a._arm === arm) ? b : a;
            if (!isGrabbable(other)) return;
            // Reject grabbing your own body parts
            const otherPlayer = other._player || (other._arm && other._arm.owner);
            if (otherPlayer === arm.owner) return;
            const supports = (pair.collision && pair.collision.supports) || [];
            const pt = supports.length > 0 ? supports[0] : arm.glove.position;
            grabAtBody(arm, other, pt);
        };
        Events.on(engine, "collisionStart",  (e) => { e.pairs.forEach(handleGrabContact); });
        Events.on(engine, "collisionActive", (e) => { e.pairs.forEach(handleGrabContact); });

    }

    // Each frame: check if every alive player's head is within the flag's trigger radius.
    function checkGoal() {
        if (!goal || gameState !== "playing") return;
        let any = false, allIn = true;
        for (const p of players) {
            if (p.dead) continue;
            any = true;
            const d = Math.hypot(p.head.position.x - goal.x, p.head.position.y - goal.y);
            p.inGoal = d <= goal.radius;
            if (!p.inGoal) allIn = false;
        }
        if (!any) return;
        if (allIn) {
            if (!goalTimerStart) goalTimerStart = Date.now();
            if (Date.now() - goalTimerStart >= GOAL_WIN_TIME_MS) triggerWinAll();
        } else {
            goalTimerStart = 0;
        }
    }

    function triggerWinAll() {
        if (gameState === "win") return;
        gameState = "win";
        const elapsed = (Date.now() - startTime) / 1000;
        const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
        document.getElementById("win-time").textContent = m + ":" + (s < 10 ? "0" : "") + s;
        const totalInkUsed = players.reduce((acc, p) => acc + (1 - p.inkLeft / MAX_INK), 0);
        const inkAvg = players.length ? Math.round(totalInkUsed / players.length * 100) : 0;
        document.getElementById("win-ink").textContent = inkAvg + "%";
        const t = document.querySelector(".win-title");
        if (t) {
            const names = players.filter(p => !p.dead).map(p => p.name).join(", ");
            t.textContent = "🎉 " + names + " — All in the Goal!";
        }
        showScreen("win-screen");
    }

    function showScreen(id) {
        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById(id).classList.add("active");
    }

    function startGame(roster) {
        if (!roster || roster.length === 0) return;
        gameState = "playing";
        // Per-player drawing state is initialized fresh on createPlayer; we still
        // keep the legacy globals as `false` for any stale checks.
        drawMode = false;
        isDrawing = false;
        drawPoints = [];
        keys = {};
        winner = null;
        if (engine) Engine.clear(engine);
        engine = Engine.create({
            gravity: { x: 0, y: GRAVITY_Y },
            positionIterations: 14,
            velocityIterations: 12,
            constraintIterations: 6,
            enableSleeping: true
        });
        engine.timing.timeScale = TIME_SCALE;
        createLevel();
        spawnRoster(roster);
        setupCollisions();
        // Center camera on the spawn cluster so the first frame doesn't snap
        if (players.length > 0) {
            let sx = 0, sy = 0;
            for (const p of players) { sx += p.head.position.x; sy += p.head.position.y; }
            camera.x = sx / players.length;
            camera.y = sy / players.length;
        }
        goalTimerStart = 0;
        startTime = Date.now();
        showScreen("game-screen");
        document.getElementById("draw-mode-indicator").classList.add("hidden");
        document.getElementById("death-overlay").classList.add("hidden");
        canvas.classList.remove("draw-cursor");
        // Reset HUD container so it rebuilds with fresh rows
        const hud = document.getElementById("player-hud");
        if (hud) hud.innerHTML = "";
    }

    // --- INPUT ---
    function setupInput() {
        document.addEventListener("keydown", e => {
            const k = e.key.toLowerCase();
            keys[k] = true;
            // P toggles the dev panel from anywhere (menu / game / win)
            if (k === "p") {
                toggleDevPanel();
                e.preventDefault();
                return;
            }
            // Lobby — claim the keyboard slot the moment any non-modifier key is pressed
            if (lobbyAwaiting && gameState === "menu") {
                // Ignore pure-modifier keys
                if (["control","alt","shift","meta","capslock"].includes(k)) return;
                if (!isKeyboardUsed()) {
                    commitNewSlot({ type: "keyboard" });
                    e.preventDefault();
                    return;
                }
            }
            if (gameState !== "playing") return;
            if (k === "q") {
                const kb = getKeyboardPlayer();
                if (!kb) return;
                if (kb.drawMode) exitDrawModeFor(kb);
                else enterDrawModeFor(kb);
                e.preventDefault();
            }
        });
        document.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

        canvas.addEventListener("contextmenu", e => e.preventDefault());

        canvas.addEventListener("mousedown", e => {
            if (gameState !== "playing") return;
            const rect = canvas.getBoundingClientRect();
            const sx = W / rect.width, sy = H / rect.height;
            mouseX = (e.clientX - rect.left) * sx;
            mouseY = (e.clientY - rect.top) * sy;
            const kbPlayer = getKeyboardPlayer();
            if (kbPlayer && kbPlayer.drawMode) {
                if (e.button === 0) {
                    const w = worldFromScreen(mouseX, mouseY);
                    startDrawingFor(kbPlayer, w.x, w.y);
                }
                e.preventDefault();
                return;
            }
            // Hold-to-grab: press → intent on, release → intent off + release.
            if (!kbPlayer) return;
            if (e.button === 0)      holdGrab(kbPlayer, "left",  true);
            else if (e.button === 2) holdGrab(kbPlayer, "right", true);
            e.preventDefault();
        });
        canvas.addEventListener("mousemove", e => {
            const rect = canvas.getBoundingClientRect();
            const sx = W / rect.width, sy = H / rect.height;
            mouseX = (e.clientX - rect.left) * sx;
            mouseY = (e.clientY - rect.top) * sy;
            const kbPlayer = getKeyboardPlayer();
            if (kbPlayer && kbPlayer.isDrawing) {
                const w = worldFromScreen(mouseX, mouseY);
                continueDrawingFor(kbPlayer, w.x, w.y);
            }
        });
        canvas.addEventListener("mouseup", e => {
            const kbPlayer = getKeyboardPlayer();
            if (!kbPlayer) return;
            if (kbPlayer.drawMode && kbPlayer.isDrawing) {
                finishDrawingFor(kbPlayer);
                return;
            }
            if (e.button === 0)      holdGrab(kbPlayer, "left",  false);
            else if (e.button === 2) holdGrab(kbPlayer, "right", false);
        });
        canvas.addEventListener("mouseleave", () => {
            const kbPlayer = getKeyboardPlayer();
            if (!kbPlayer) return;
            if (kbPlayer.isDrawing) finishDrawingFor(kbPlayer);
            // Releasing the mouse outside the canvas should also drop grabs
            holdGrab(kbPlayer, "left",  false);
            holdGrab(kbPlayer, "right", false);
        });
    }

    // --- DEATH / RESPAWN (per-player) ---
    function killPlayer(p) {
        if (!p || p.dead) return;
        p.dead = true;
        p.deathTime = Date.now();
        for (const arm of p.arms) { releaseGrab(arm); arm.grabIntent = false; }
        if (p.drawMode) exitDrawModeFor(p);
        Body.setStatic(p.head, true);
        for (const arm of p.arms) {
            Body.setStatic(arm.upper, true);
            Body.setStatic(arm.fore, true);
            Body.setStatic(arm.glove, true);
        }
        addLog(`💀 ${p.name} fell into the void`, p.color);
    }
    function addLog(msg, color) {
        deathLog.push({ msg, color: color || "#fff", expiresAt: Date.now() + 4500 });
        if (deathLog.length > 6) deathLog.shift();
    }

    function respawnPlayer(p) {
        const spawnX = SPAWN_POSITIONS[p.idx % SPAWN_POSITIONS.length].x;
        const spawnY = SPAWN_POSITIONS[p.idx % SPAWN_POSITIONS.length].y;
        for (const arm of p.arms) {
            Body.setStatic(arm.upper, false);
            Body.setStatic(arm.fore, false);
            Body.setStatic(arm.glove, false);
        }
        Body.setStatic(p.head, false);
        Body.setPosition(p.head, { x: spawnX, y: spawnY });
        Body.setVelocity(p.head, { x: 0, y: 0 });
        for (const arm of p.arms) {
            const sign = arm.side === "left" ? -1 : 1;
            const sx = spawnX + sign * SHOULDER_X;
            const sy = spawnY + SHOULDER_Y;
            Body.setPosition(arm.upper, { x: sx, y: sy + UPPER_LEN / 2 });
            Body.setAngle(arm.upper, 0);
            Body.setVelocity(arm.upper, { x: 0, y: 0 });
            Body.setAngularVelocity(arm.upper, 0);
            Body.setPosition(arm.fore, { x: sx, y: sy + UPPER_LEN + FORE_LEN / 2 });
            Body.setAngle(arm.fore, 0);
            Body.setVelocity(arm.fore, { x: 0, y: 0 });
            Body.setAngularVelocity(arm.fore, 0);
            Body.setPosition(arm.glove, { x: sx, y: sy + UPPER_LEN + FORE_LEN + GLOVE_RADIUS - 3 });
            Body.setVelocity(arm.glove, { x: 0, y: 0 });
        }
        p.dead = false;
        p.deathTime = 0;
    }

    function updateDeathTimers() {
        for (const p of players) {
            if (!p.dead) continue;
            if (Date.now() - p.deathTime >= RESPAWN_MS) {
                respawnPlayer(p);
                addLog(`✨ ${p.name} respawned`, p.color);
            }
        }
        const overlay = document.getElementById("death-overlay");
        if (overlay) overlay.classList.add("hidden");
    }

    // --- LOOP ---
    function gameLoop() {
        requestAnimationFrame(gameLoop);
        if (gameState === "menu") {
            pollLobbyControls();
            return;
        }
        if (gameState === "countdown") {
            // Render the freshly-spawned scene so players can see the world,
            // but don't tick physics or accept input yet.
            updateSplitState();
            updateCamera();
            render();
            drawHUD();
            // Transition to playing after 3 seconds + a brief "GO!" frame.
            if (Date.now() - countdownStart >= 3500) {
                gameState = "playing";
                startTime = Date.now();           // reset timer so countdown isn't counted
            }
            return;
        }
        if (gameState !== "playing") return;
        Engine.update(engine, 1000 / 60);
        // Poll input (incl. gamepads) and process edge-triggered buttons
        for (const p of players) {
            pollPlayerInput(p);
            processPlayerEdges(p);
        }
        // Void death check — falling off ANY side now kills (no walls)
        for (const p of players) {
            if (p.dead) continue;
            const pos = p.head.position;
            if (pos.y > DEATH_Y || pos.x < -200 || pos.x > WORLD_W + 200 || pos.y < -400) {
                killPlayer(p);
            }
        }
        // Movement / arms
        for (const p of players) updatePlayer(p);
        updateDeathTimers();
        checkGoal();
        updateSplitState();
        updateCamera();
        render();
        drawHUD();
    }

    // ============================================================
    // DEV PANEL — press P to toggle. All physics tunables live-edit.
    // ============================================================
    const DEV_STORAGE_KEY = "albert_fudge_dev_tunables_v1";

    // Each tunable: get + set, plus UI metadata. `set` may push the new value
    // into existing physics bodies so changes feel instant.
    const TUNABLES = {
        // --- World ---
        timeScale: {
            label: "Time Scale", min: 0.05, max: 2, step: 0.01, group: "World",
            help: "Global slow-motion. Lower = slower, easier collision solving.",
            get: () => TIME_SCALE,
            set: v => { TIME_SCALE = v; if (engine) engine.timing.timeScale = v; }
        },
        gravityY: {
            label: "Gravity", min: 0, max: 3, step: 0.01, group: "World",
            help: "Downward acceleration applied to all dynamic bodies.",
            get: () => GRAVITY_Y,
            set: v => { GRAVITY_Y = v; if (engine) engine.world.gravity.y = v; }
        },
        respawnSec: {
            label: "Respawn Delay (sec)", min: 0, max: 30, step: 0.5, group: "World",
            help: "How long after falling into the void before you respawn.",
            get: () => RESPAWN_MS / 1000,
            set: v => { RESPAWN_MS = v * 1000; }
        },
        splitDistance: {
            label: "Split-Screen Distance (world)", min: 200, max: 3000, step: 25, group: "World",
            help: "Players farther apart than this enter split-screen. Exit threshold is 80% of this value.",
            get: () => SPLIT_ENTER,
            set: v => { SPLIT_ENTER = v; }
        },
        objAvgSize: {
            label: "Object Avg Size (next map)", min: 12, max: 220, step: 1, group: "World",
            help: "Mean size used by the procedural map generator. Applies on next level (Respawn / restart).",
            get: () => OBJ_AVG_SIZE,
            set: v => { OBJ_AVG_SIZE = v; }
        },
        objsPerPath: {
            label: "Objects per Path (next map)", min: 3, max: 40, step: 1, group: "World",
            help: "Mean number of platforms sampled along each of the 2-3 imaginary paths.",
            get: () => OBJS_PER_PATH,
            set: v => { OBJS_PER_PATH = v; }
        },
        objDensity: {
            label: "Map Density (extra scatter, next map)", min: 0, max: 80, step: 1, group: "World",
            help: "How many extra random platforms are scattered across the map (independent of paths).",
            get: () => OBJ_DENSITY,
            set: v => { OBJ_DENSITY = v; }
        },
        nametagSize: {
            label: "Nametag Size", min: 6, max: 36, step: 1, group: "World",
            help: "Font size (in world px) of the floating name tag above each character.",
            get: () => NAMETAG_SIZE,
            set: v => { NAMETAG_SIZE = v; }
        },
        splitZoomMin: {
            label: "Min Camera Zoom (when far apart)", min: 0.25, max: 1.5, step: 0.05, group: "World",
            help: "How far the camera zooms OUT before the screen splits. Lower = sees more of the map.",
            get: () => SPLIT_ZOOM_MIN,
            set: v => { SPLIT_ZOOM_MIN = v; }
        },

        // --- Body movement ---
        swingForce: {
            label: "Swing Force (body accel)", min: 0, max: 0.2, step: 0.001, group: "Body",
            help: "WASD force routed through each grabbed glove. 0 = can't move.",
            get: () => SWING_FORCE,
            set: v => { SWING_FORCE = v; }
        },
        headMaxV: {
            label: "Head Max Velocity", min: 0.5, max: 40, step: 0.1, group: "Body",
            help: "Hard cap on head velocity per frame (prevents flying).",
            get: () => HEAD_MAX_V,
            set: v => { HEAD_MAX_V = v; }
        },
        headDensity: {
            label: "Head Density (weight)", min: 0.0005, max: 0.05, step: 0.0005, group: "Body",
            help: "Higher = heavier head. Affects how fast it swings + falls.",
            get: () => HEAD_DENSITY,
            set: v => { HEAD_DENSITY = v; for (const p of players) Body.setDensity(p.head, v); }
        },
        headAirDamp: {
            label: "Head Air Friction", min: 0, max: 0.4, step: 0.001, group: "Body",
            help: "Air resistance on the head. Higher = more drag.",
            get: () => HEAD_AIR_DAMP,
            set: v => { HEAD_AIR_DAMP = v; for (const p of players) p.head.frictionAir = v; }
        },
        headFriction: {
            label: "Head Friction (sliding on platforms)", min: 0, max: 2, step: 0.01, group: "Body",
            help: "Kinetic friction between the head and platforms. 0 = ice, 1 = rubber.",
            get: () => HEAD_FRICTION,
            set: v => { HEAD_FRICTION = v; for (const p of players) p.head.friction = v; }
        },
        headFrictionStatic: {
            label: "Head Friction (static — start of slide)", min: 0, max: 2, step: 0.01, group: "Body",
            help: "Resistance to starting to slide. Higher = head sticks to platforms more before moving.",
            get: () => HEAD_FRICTION_STATIC,
            set: v => { HEAD_FRICTION_STATIC = v; for (const p of players) p.head.frictionStatic = v; }
        },
        headRestitution: {
            label: "Head Bounciness", min: 0, max: 1, step: 0.01, group: "Body",
            help: "How bouncy the head is on collision. 0 = thud, 1 = super-ball.",
            get: () => HEAD_RESTITUTION,
            set: v => { HEAD_RESTITUTION = v; for (const p of players) p.head.restitution = v; }
        },
        bodySpinDamp: {
            label: "Body Spin Damping", min: 0.5, max: 1, step: 0.01, group: "Body",
            help: "Multiplied into head angular velocity each frame. 1 = no damping; 0.5 = halts almost instantly.",
            get: () => BODY_SPIN_DAMP,
            set: v => { BODY_SPIN_DAMP = v; }
        },
        bodyMaxSpin: {
            label: "Body Max Spin (rad/frame)", min: 0.005, max: 0.5, step: 0.005, group: "Body",
            help: "Hard cap on how fast the body can rotate.",
            get: () => BODY_MAX_SPIN,
            set: v => { BODY_MAX_SPIN = v; }
        },
        shoulderLimitK: {
            label: "Shoulder Limit Strength (soft)", min: 0, max: 1, step: 0.01, group: "Arms",
            help: "Soft restoring force when an upper arm tries to swing across the body. 0 = no limit; 1 = stiff snap-back.",
            get: () => SHOULDER_LIMIT_K,
            set: v => { SHOULDER_LIMIT_K = v; }
        },

        // --- Arms ---
        handDrive: {
            label: "Hand Drive (arm accel)", min: 0, max: 0.005, step: 0.00005, group: "Arms",
            help: "Force pulling free gloves toward WASD direction. 0 = arms hang limp.",
            get: () => HAND_DRIVE,
            set: v => { HAND_DRIVE = v; }
        },
        handReach: {
            label: "Hand Reach Target", min: 20, max: 250, step: 1, group: "Arms",
            help: "How far from the shoulder a free arm tries to reach.",
            get: () => HAND_REACH,
            set: v => { HAND_REACH = v; }
        },
        maxArmAngV: {
            label: "Max Arm Angular Velocity", min: 0.005, max: 0.5, step: 0.005, group: "Arms",
            help: "Caps how fast arms can rotate. Lower = slower / smoother arms.",
            get: () => MAX_ARM_ANG_V,
            set: v => { MAX_ARM_ANG_V = v; }
        },
        armDensity: {
            label: "Arm Density (weight)", min: 0.0001, max: 0.01, step: 0.0001, group: "Arms",
            help: "Weight of upper + forearm segments.",
            get: () => ARM_DENSITY,
            set: v => {
                ARM_DENSITY = v;
                for (const p of players) for (const a of p.arms) {
                    Body.setDensity(a.upper, v);
                    Body.setDensity(a.fore,  v);
                }
            }
        },
        armAirDamp: {
            label: "Arm Air Friction", min: 0, max: 0.4, step: 0.001, group: "Arms",
            help: "Drag on arm segments. Higher = more sluggish arms.",
            get: () => ARM_AIR_DAMP,
            set: v => {
                ARM_AIR_DAMP = v;
                for (const p of players) for (const a of p.arms) {
                    a.upper.frictionAir = v;
                    a.fore.frictionAir  = v;
                }
            }
        },

        // --- Gloves ---
        gloveDensity: {
            label: "Glove Density (weight)", min: 0.0001, max: 0.02, step: 0.0001, group: "Gloves",
            help: "Weight of the hands themselves.",
            get: () => GLOVE_DENSITY,
            set: v => {
                GLOVE_DENSITY = v;
                for (const p of players) for (const a of p.arms) Body.setDensity(a.glove, v);
            }
        },
        gloveAirDamp: {
            label: "Glove Air Friction", min: 0, max: 0.4, step: 0.001, group: "Gloves",
            help: "Drag on the gloves.",
            get: () => GLOVE_AIR_DAMP,
            set: v => {
                GLOVE_AIR_DAMP = v;
                for (const p of players) for (const a of p.arms) a.glove.frictionAir = v;
            }
        },

        // --- Drawings ---
        drawDensity: {
            label: "Drawing Density (object weight)", min: 0.01, max: 1, step: 0.01, group: "Drawings",
            help: "Heaviness of NEW drawings. (Existing drawings keep their old weight.)",
            get: () => DRAW_DENSITY,
            set: v => { DRAW_DENSITY = v; }
        },
        drawThickness: {
            label: "Drawing Thickness", min: 3, max: 40, step: 1, group: "Drawings",
            help: "Stroke thickness for NEW drawings.",
            get: () => DRAW_THICKNESS,
            set: v => { DRAW_THICKNESS = v; }
        },
        maxInk: {
            label: "Max Ink", min: 50, max: 5000, step: 25, group: "Drawings",
            help: "Total ink budget on respawn / new game.",
            get: () => MAX_INK,
            set: v => { MAX_INK = v; }
        },
        cursorSens: {
            label: "Cursor Sensitivity (gamepad)", min: 2, max: 40, step: 0.5, group: "Drawings",
            help: "How fast the gamepad drawing cursor moves at full stick deflection.",
            get: () => CURSOR_SENS,
            set: v => { CURSOR_SENS = v; }
        },
    };

    const TUNABLE_DEFAULTS = {};
    for (const k in TUNABLES) TUNABLE_DEFAULTS[k] = TUNABLES[k].get();

    let devPanelEl = null;
    let devPanelOpen = false;

    function saveDevTunables() {
        const snap = {};
        for (const k in TUNABLES) snap[k] = TUNABLES[k].get();
        try { localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(snap)); } catch (e) {}
    }
    function loadDevTunables() {
        try {
            const raw = localStorage.getItem(DEV_STORAGE_KEY);
            if (!raw) return;
            const snap = JSON.parse(raw);
            for (const k in snap) {
                if (TUNABLES[k]) TUNABLES[k].set(snap[k]);
            }
        } catch (e) {}
    }
    function resetDevTunables() {
        for (const k in TUNABLES) TUNABLES[k].set(TUNABLE_DEFAULTS[k]);
        saveDevTunables();
        refreshDevPanelValues();
    }

    function buildDevPanel() {
        if (devPanelEl) return devPanelEl;

        // Inject the panel's CSS once (keeps style.css clean)
        if (!document.getElementById("dev-panel-style")) {
            const s = document.createElement("style");
            s.id = "dev-panel-style";
            s.textContent = `
                #dev-panel {
                    position: fixed; top: 20px; right: 20px; width: 380px;
                    max-height: calc(100vh - 40px); overflow-y: auto;
                    background: rgba(10, 14, 26, 0.94);
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(139, 92, 246, 0.45);
                    border-radius: 12px; padding: 0;
                    color: rgba(255,255,255,0.92);
                    font-family: 'Inter', sans-serif; font-size: 12px;
                    z-index: 1000;
                    box-shadow: 0 12px 40px rgba(0,0,0,0.6);
                }
                #dev-panel.hidden { display: none; }
                #dev-panel .dev-header {
                    position: sticky; top: 0;
                    background: linear-gradient(180deg, rgba(139,92,246,0.35), rgba(59,130,246,0.2));
                    border-bottom: 1px solid rgba(139,92,246,0.4);
                    padding: 10px 14px;
                    display: flex; align-items: center; gap: 8px;
                    border-radius: 12px 12px 0 0;
                    font-weight: 700;
                }
                #dev-panel .dev-header .title { flex: 1; letter-spacing: 1px; }
                #dev-panel .dev-header button {
                    background: rgba(255,255,255,0.1); color: #fff;
                    border: 1px solid rgba(255,255,255,0.2); border-radius: 6px;
                    padding: 4px 10px; cursor: pointer; font: inherit; font-weight: 600;
                }
                #dev-panel .dev-header button:hover { background: rgba(255,255,255,0.2); }
                #dev-panel .dev-body { padding: 10px 14px 16px; }
                #dev-panel .dev-section {
                    margin: 14px 0 6px; padding-bottom: 4px;
                    font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
                    color: rgba(168, 85, 247, 0.95); font-weight: 800;
                    border-bottom: 1px solid rgba(168,85,247,0.25);
                }
                #dev-panel .dev-row {
                    display: grid;
                    grid-template-columns: 1fr 80px;
                    gap: 6px 10px; align-items: center;
                    margin: 8px 0;
                }
                #dev-panel .dev-row label {
                    color: rgba(255,255,255,0.85); font-weight: 600;
                    cursor: help;
                }
                #dev-panel .dev-row .num {
                    background: rgba(0,0,0,0.4); color: #fff;
                    border: 1px solid rgba(255,255,255,0.15); border-radius: 5px;
                    padding: 4px 6px; font: inherit; text-align: right;
                    width: 100%;
                }
                #dev-panel .dev-row .slider {
                    grid-column: 1 / 3;
                    width: 100%; margin: 0; accent-color: #a855f7;
                }
                #dev-panel .dev-footer {
                    padding: 10px 14px; font-size: 11px;
                    color: rgba(255,255,255,0.55);
                    border-top: 1px solid rgba(255,255,255,0.08);
                }
                #dev-panel .dev-footer kbd {
                    background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 4px; padding: 1px 6px; font-size: 10px;
                }
            `;
            document.head.appendChild(s);
        }

        const panel = document.createElement("div");
        panel.id = "dev-panel";
        panel.classList.add("hidden");
        panel.innerHTML = `
            <div class="dev-header">
                <span class="title">🔧 Dev Panel</span>
                <button id="dev-reset" title="Reset all values to defaults">Reset</button>
                <button id="dev-rebuild" title="Respawn the player">Respawn</button>
                <button id="dev-close" title="Close (P)">✕</button>
            </div>
            <div class="dev-body"></div>
            <div class="dev-footer">
                Toggle with <kbd>P</kbd> · Values save to your browser · Hover labels for help
            </div>
        `;
        document.body.appendChild(panel);
        devPanelEl = panel;

        const body = panel.querySelector(".dev-body");

        // Group tunables by section
        const groups = {};
        for (const key in TUNABLES) {
            const g = TUNABLES[key].group || "Other";
            (groups[g] = groups[g] || []).push(key);
        }
        const groupOrder = ["World", "Body", "Arms", "Gloves", "Drawings", "Other"];

        for (const g of groupOrder) {
            if (!groups[g]) continue;
            const h = document.createElement("div");
            h.className = "dev-section";
            h.textContent = g;
            body.appendChild(h);

            for (const key of groups[g]) {
                const t = TUNABLES[key];
                const row = document.createElement("div");
                row.className = "dev-row";

                const lbl = document.createElement("label");
                lbl.textContent = t.label;
                lbl.title = t.help || "";

                const num = document.createElement("input");
                num.type = "number";
                num.className = "num";
                num.min = t.min; num.max = t.max; num.step = t.step;
                num.value = t.get();
                num.dataset.key = key;

                const slider = document.createElement("input");
                slider.type = "range";
                slider.className = "slider";
                slider.min = t.min; slider.max = t.max; slider.step = t.step;
                slider.value = t.get();
                slider.dataset.key = key;

                const onChange = (raw) => {
                    let v = parseFloat(raw);
                    if (isNaN(v)) return;
                    v = Math.min(t.max, Math.max(t.min, v));
                    t.set(v);
                    num.value = v;
                    slider.value = v;
                    saveDevTunables();
                };
                num.addEventListener("input", () => onChange(num.value));
                slider.addEventListener("input", () => onChange(slider.value));

                // Stop key events from leaking into the game while editing
                [num, slider].forEach(inp => {
                    inp.addEventListener("keydown", e => e.stopPropagation());
                    inp.addEventListener("keyup",   e => e.stopPropagation());
                });

                row.appendChild(lbl);
                row.appendChild(num);
                row.appendChild(slider);
                body.appendChild(row);
            }
        }

        panel.querySelector("#dev-close").addEventListener("click", toggleDevPanel);
        panel.querySelector("#dev-reset").addEventListener("click", resetDevTunables);
        const regenBtn = document.createElement("button");
        regenBtn.id = "dev-regen";
        regenBtn.title = "Regenerate the random map";
        regenBtn.textContent = "Regen Map";
        panel.querySelector(".dev-header").insertBefore(regenBtn, panel.querySelector("#dev-close"));
        regenBtn.addEventListener("click", () => {
            if (gameState !== "playing") return;
            // Rebuild the world (platforms + goal) and respawn every player.
            const roster = players.map(p => ({ team: p.team, char: p.char, device: p.device }));
            if (roster.length > 0) startGame(roster);
        });

        panel.querySelector("#dev-rebuild").addEventListener("click", () => {
            if (gameState !== "playing") return;
            for (const p of players) {
                for (const arm of p.arms) releaseGrab(arm);
                // Trigger near-instant respawn
                p.dead = true;
                p.deathTime = Date.now() - RESPAWN_MS;
            }
            document.getElementById("death-overlay").classList.add("hidden");
        });

        return panel;
    }

    function refreshDevPanelValues() {
        if (!devPanelEl) return;
        devPanelEl.querySelectorAll("input[data-key]").forEach(inp => {
            const t = TUNABLES[inp.dataset.key];
            if (t) inp.value = t.get();
        });
    }

    function toggleDevPanel() {
        const panel = buildDevPanel();
        devPanelOpen = !devPanelOpen;
        panel.classList.toggle("hidden", !devPanelOpen);
        if (devPanelOpen) refreshDevPanelValues();
    }

    // --- INIT ---
    document.addEventListener("DOMContentLoaded", () => {
        canvas = document.getElementById("game-canvas");
        ctx = canvas.getContext("2d");
        canvas.width = W; canvas.height = H;

        loadSprites();
        loadDevTunables();      // restore any saved physics tweaks before input wiring
        setupInput();
        buildDevPanel();        // pre-build so refreshDevPanelValues() can run before first toggle

        buildLobby();
        const startBtn = document.getElementById("start-btn");
        if (startBtn) startBtn.addEventListener("click", () => tryStartGame());
        const addBtn = document.getElementById("add-player-btn");
        if (addBtn) addBtn.addEventListener("click", () => {
            if (gameState !== "menu") return;
            startAwaiting();
        });
        const cancelBtn = document.getElementById("awaiting-cancel");
        if (cancelBtn) cancelBtn.addEventListener("click", () => cancelAwaiting());

        wireMultiplayerUI();

        // Bulletproof fallback: delegated click on document, in case the button
        // was rebuilt or the direct listener got detached.
        document.addEventListener("click", e => {
            const t = e.target;
            if (!t) return;
            if (t.id === "start-btn" || (t.closest && t.closest("#start-btn"))) {
                tryStartGame();
            }
        });

        // Expose for emergency debug from devtools console
        window.__afi = { tryStartGame: () => tryStartGame(), lobbySlots, get state(){ return gameState; } };

        // Enter key from anywhere on the menu starts the game if roster is ready
        document.addEventListener("keydown", e => {
            if (gameState !== "menu") return;
            if (e.key === "Enter") tryStartGame();
        });

        const replay = document.getElementById("btn-replay");
        if (replay) replay.addEventListener("click", () => {
            showScreen("start-screen");
            gameState = "menu";
            refreshLobbyUI();
        });

        // Pick up freshly-plugged-in gamepads
        window.addEventListener("gamepadconnected", () => refreshLobbyUI());
        window.addEventListener("gamepaddisconnected", () => refreshLobbyUI());

        gameLoop();
    });

    // ============================================================
    // LOBBY
    // ============================================================
    const PLAYER_COLORS = [
        "#EF4444", "#F97316", "#FACC15", "#84CC16", "#22C55E",
        "#14B8A6", "#3B82F6", "#A855F7", "#EC4899", "#92400E"
    ];
    const ADJECTIVES = [
        "Sneaky","Wobbly","Mighty","Brave","Sleepy","Grumpy","Silly","Tiny",
        "Fuzzy","Greasy","Squeaky","Crispy","Bouncy","Spicy","Sassy","Drowsy",
        "Cosmic","Funky","Wonky","Lazy","Glittery","Stinky","Snappy","Cheeky",
        "Salty","Cranky","Beefy","Crunchy","Loopy","Zesty"
    ];
    const FUNNY_NOUNS = [
        "Pickle","Bartholomew","Snorlax","Wiggleworth","Buttercup","Mortimer",
        "Banana","Toupee","Pumpkin","Wombat","Pancake","Noodle","Biscuit",
        "Doughnut","Waffle","Muffin","Tofu","Sprinkle","Cucumber","Walnut",
        "Marshmallow","Hamhock","Jellybean","Crumpet","Schnitzel","Quesadilla",
        "Burrito","Gumbo","Snickerdoodle","Beanbag"
    ];
    function rollName() {
        return ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] + " " +
               FUNNY_NOUNS[Math.floor(Math.random() * FUNNY_NOUNS.length)];
    }

    let lobbyAwaiting = false;          // are we currently watching for the next input?
    let lobbyPrevPadButtons = [];       // per-gamepad previous-button bitfield (for edge detection)

    function buildLobby() {
        lobbySlots = [];
        lobbyAwaiting = false;
        refreshLobbyUI();
    }

    // ---- Multiplayer / Room Code (UI-only scaffolding) ----
    // The networking layer is intentionally not implemented in this build. The UI
    // works locally so you can prototype the flow. To go live, plug in PeerJS
    // (peer-to-peer WebRTC, free public broker) or a small Node + WebSocket server.
    let mpRoomCode = null;
    let mpPeers = [];     // list of pseudo-peer names (local stub)
    function rand8Code() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let s = "";
        for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }
    function mpAppendChat(line, who) {
        const log = document.getElementById("mp-chat-log");
        if (!log) return;
        const div = document.createElement("div");
        div.innerHTML = (who ? `<b>${escapeHtml(who)}:</b> ` : "") + escapeHtml(line);
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }
    function mpRenderPeers() {
        const list = document.getElementById("mp-peer-list");
        if (!list) return;
        list.innerHTML = mpPeers.map(p => `<li>👤 ${escapeHtml(p)}</li>`).join("");
    }
    function wireMultiplayerUI() {
        const tabLocal  = document.getElementById("mp-tab-local");
        const tabOnline = document.getElementById("mp-tab-online");
        const onlineSec = document.getElementById("mp-online");
        const room      = document.getElementById("mp-room");
        const codeBadge = document.getElementById("mp-room-code");
        const codeIn    = document.getElementById("mp-code");
        const createBtn = document.getElementById("mp-create");
        const joinBtn   = document.getElementById("mp-join");
        const copyBtn   = document.getElementById("mp-copy");
        const leaveBtn  = document.getElementById("mp-leave");
        const chatIn    = document.getElementById("mp-chat-text");
        const chatSend  = document.getElementById("mp-chat-send");

        if (!tabLocal || !tabOnline) return;
        tabLocal.addEventListener("click", () => {
            tabLocal.classList.add("active"); tabOnline.classList.remove("active");
            onlineSec.classList.add("hidden");
        });
        tabOnline.addEventListener("click", () => {
            tabOnline.classList.add("active"); tabLocal.classList.remove("active");
            onlineSec.classList.remove("hidden");
        });

        createBtn.addEventListener("click", () => {
            mpRoomCode = rand8Code();
            mpPeers = ["You (host)"];
            codeBadge.textContent = mpRoomCode;
            room.classList.remove("hidden");
            mpRenderPeers();
            mpAppendChat(`Room ${mpRoomCode} opened. Share this code so friends can join.`, "system");
        });
        joinBtn.addEventListener("click", () => {
            const code = (codeIn.value || "").toUpperCase().trim();
            if (code.length !== 8) return;
            mpRoomCode = code;
            mpPeers = ["Host", "You"];
            codeBadge.textContent = mpRoomCode;
            room.classList.remove("hidden");
            mpRenderPeers();
            mpAppendChat(`Pretending to join room ${code}. (Networking not wired yet.)`, "system");
        });
        copyBtn.addEventListener("click", () => {
            if (mpRoomCode && navigator.clipboard) navigator.clipboard.writeText(mpRoomCode);
        });
        leaveBtn.addEventListener("click", () => {
            mpRoomCode = null; mpPeers = [];
            room.classList.add("hidden");
            const log = document.getElementById("mp-chat-log");
            if (log) log.innerHTML = "";
        });

        const sendChat = () => {
            const t = (chatIn.value || "").trim();
            if (!t) return;
            mpAppendChat(t, "You");
            chatIn.value = "";
        };
        chatSend.addEventListener("click", sendChat);
        chatIn.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") sendChat();
        });
        codeIn.addEventListener("keydown", (e) => e.stopPropagation());
    }

    function isKeyboardUsed() {
        return lobbySlots.some(s => s.device.type === "keyboard");
    }
    function isGamepadUsed(index) {
        return lobbySlots.some(s => s.device.type === "gamepad" && s.device.index === index);
    }
    function nextSlotColor() {
        // Pick a color that isn't already taken if possible.
        const used = new Set(lobbySlots.map(s => s.color));
        for (const c of PLAYER_COLORS) if (!used.has(c)) return c;
        return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
    }
    function makeSlot(device) {
        // Random sprite for visual variety (shirt color is hidden by the head crop)
        const charKeys = ["blue_einstein","blue_epstein","red_einstein","red_epstein"];
        const choice = charKeys[Math.floor(Math.random() * charKeys.length)];
        const [team, char] = choice.split("_");
        return {
            device,
            name: rollName(),
            color: nextSlotColor(),
            team, char,
            ready: false,
            cursor: 0,             // gamepad navigation: 0=color row, 1=ready
            colorIdx: Math.max(0, PLAYER_COLORS.indexOf(nextSlotColor())),
            prevBtns: {}
        };
    }
    function startAwaiting() {
        lobbyAwaiting = true;
        document.getElementById("awaiting-input").classList.remove("hidden");
        // Reset the "previous gamepad buttons" snapshot so we don't re-trigger on a held button
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        lobbyPrevPadButtons = pads.map(gp => gp ? gp.buttons.map(b => b.pressed) : null);
    }
    function cancelAwaiting() {
        lobbyAwaiting = false;
        document.getElementById("awaiting-input").classList.add("hidden");
    }
    function commitNewSlot(device) {
        if (device.type === "keyboard" && isKeyboardUsed()) return;
        if (device.type === "gamepad"  && isGamepadUsed(device.index)) return;
        lobbySlots.push(makeSlot(device));
        cancelAwaiting();
        refreshLobbyUI();
    }

    function refreshLobbyUI() {
        const container = document.getElementById("player-slots");
        if (!container) return;
        container.innerHTML = "";
        for (let i = 0; i < lobbySlots.length; i++) {
            const slot = lobbySlots[i];
            const dev = slot.device.type === "keyboard"
                ? "⌨️ Keyboard"
                : ("🎮 Gamepad " + (slot.device.index + 1));
            const div = document.createElement("div");
            div.className = "slot" + (slot.ready ? " active" : "");
            const colorRow = PLAYER_COLORS.map((c, ci) =>
                `<div class="color-swatch${slot.color === c ? " selected" : ""}" data-ci="${ci}" style="background:${c}"></div>`
            ).join("");
            const editing = slot._editing === true;
            div.innerHTML = `
                <div class="slot-header">
                    <span class="slot-device">${dev}</span>
                    <span class="slot-status ${slot.ready ? "picked" : "connected"}">${slot.ready ? "READY" : "CHOOSING"}</span>
                </div>
                <div class="slot-name-row">
                    ${editing
                        ? `<input class="slot-name-edit" value="${escapeHtml(slot.name)}" maxlength="22">`
                        : `<span class="slot-name" style="color:${slot.color}">${escapeHtml(slot.name)}</span>`}
                    <button class="slot-reroll" title="Reroll name">🎲</button>
                    <button class="slot-edit"   title="${editing ? "Save name" : "Edit name"}">${editing ? "💾" : "✏️"}</button>
                    <button class="slot-remove" title="Remove player">✕</button>
                </div>
                <div class="color-row">${colorRow}</div>
                <button class="ready-btn ${slot.ready ? "ready" : ""}">${slot.ready ? "Ready ✓" : "Ready?"}</button>
            `;
            container.appendChild(div);
            div.querySelector(".slot-reroll").addEventListener("click", () => {
                slot.name = rollName();
                slot._editing = false;
                refreshLobbyUI();
            });
            div.querySelector(".slot-edit").addEventListener("click", () => {
                if (slot._editing) {
                    const inp = div.querySelector(".slot-name-edit");
                    if (inp) slot.name = (inp.value || "").trim().slice(0, 22) || slot.name;
                    slot._editing = false;
                } else {
                    slot._editing = true;
                }
                refreshLobbyUI();
                if (slot._editing) {
                    const inp = div.querySelector(".slot-name-edit");
                    if (inp) { inp.focus(); inp.select(); }
                }
            });
            // Save on Enter while editing
            const inp = div.querySelector(".slot-name-edit");
            if (inp) {
                inp.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        slot.name = (inp.value || "").trim().slice(0, 22) || slot.name;
                        slot._editing = false;
                        refreshLobbyUI();
                    } else if (e.key === "Escape") {
                        slot._editing = false;
                        refreshLobbyUI();
                    }
                    // Don't let arrow keys etc. leak into the game's keyboard listener
                    e.stopPropagation();
                });
            }
            div.querySelector(".slot-remove").addEventListener("click", () => {
                lobbySlots.splice(i, 1);
                refreshLobbyUI();
            });
            div.querySelectorAll(".color-swatch").forEach((sw) => {
                sw.addEventListener("click", () => {
                    const ci = parseInt(sw.getAttribute("data-ci"));
                    slot.color = PLAYER_COLORS[ci];
                    slot.colorIdx = ci;
                    refreshLobbyUI();
                });
            });
            div.querySelector(".ready-btn").addEventListener("click", () => {
                slot.ready = !slot.ready;
                refreshLobbyUI();
            });
        }
        // Update Start button label/state
        const sb = document.getElementById("start-btn");
        if (sb) {
            const allReady = lobbySlots.length > 0 && lobbySlots.every(s => s.ready);
            sb.disabled = !allReady;
            sb.textContent = lobbySlots.length === 0
                ? "Waiting for players…"
                : (allReady ? "Start Game" : `${lobbySlots.filter(s => s.ready).length} / ${lobbySlots.length} ready`);
        }
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    }

    // Shared "start game" path — used by click, Enter, gamepad Start.
    // Doodle Go is 2v2. With > 4 ready players, we pick 4 with a rotation counter so
    // anyone who sat out previously gets priority next match. With ≤ 4 players, we
    // just take everybody. The chosen 4 are randomly split into two teams of 2.
    function tryStartGame() {
        try {
            if (gameState !== "menu") return;
            const ready = lobbySlots.filter(s => s.ready);
            if (ready.length === 0) { showStartError("Add at least one player and press Ready."); return; }
            if (ready.length !== lobbySlots.length) { showStartError("All players must press Ready."); return; }

            // Initialize the rotation counter the first time
            for (const s of lobbySlots) if (typeof s._sitOuts !== "number") s._sitOuts = 0;

            const TARGET = 4;
            let picked;
            if (ready.length <= TARGET) {
                picked = ready.slice();
            } else {
                // Sort by sit-out counter desc, ties broken randomly
                const shuffled = ready.slice().sort(() => Math.random() - 0.5);
                shuffled.sort((a, b) => b._sitOuts - a._sitOuts);
                picked = shuffled.slice(0, TARGET);
                // Update counters: picked players reset to 0, others get +1
                for (const s of ready) {
                    if (picked.includes(s)) s._sitOuts = 0;
                    else                    s._sitOuts += 1;
                }
                addLog(`👀 Sitting out: ${ready.filter(s => !picked.includes(s)).map(s => s.name).join(", ")}`, "#fbbf24");
            }
            // Random 2v2 split (informational — used in HUD and possibly future scoring)
            const shuffled = picked.slice().sort(() => Math.random() - 0.5);
            const teamA = shuffled.slice(0, Math.ceil(shuffled.length / 2));
            const teamB = shuffled.slice(Math.ceil(shuffled.length / 2));

            const roster = picked.map(s => ({
                device: s.device, name: s.name, color: s.color,
                team: s.team, char: s.char,
                teamGroup: teamA.includes(s) ? "A" : "B"
            }));
            startGame(roster);
            gameState = "countdown";
            countdownStart = Date.now();
        } catch (err) {
            console.error("[Doodle Go] startGame threw:", err);
            showStartError("Error: " + (err && err.message ? err.message : err));
        }
    }

    function showStartError(msg) {
        let el = document.getElementById("start-error");
        if (!el) {
            el = document.createElement("div");
            el.id = "start-error";
            el.style.cssText = "margin-top:10px;color:#ff8a8a;font-size:0.85rem;font-weight:600;text-align:center;";
            const sb = document.getElementById("start-btn");
            if (sb && sb.parentNode) sb.parentNode.appendChild(el);
        }
        el.textContent = msg;
        clearTimeout(el._t);
        el._t = setTimeout(() => { if (el) el.textContent = ""; }, 4000);
    }

    // The 5 char-option cells, in screen order, that the cursor cycles through.
    const LOBBY_OPTIONS = [
        { team: null,   char: null     },  // 0: None
        { team: "blue", char: "einstein" },
        { team: "blue", char: "epstein"  },
        { team: "red",  char: "einstein" },
        { team: "red",  char: "epstein"  }
    ];

    // Lobby gamepad polling. Two responsibilities:
    //   1) When awaiting a new player: catch the first button press on any unused
    //      controller and create a slot.
    //   2) For each existing gamepad slot: D-Pad/stick to navigate colors,
    //      A toggles ready, X rerolls name, B/Y removes the player, Start = start.
    function pollLobbyControls() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let needsRefresh = false;

        // 1) Auto-claim: any unused gamepad → create a slot the moment any button
        //    is pressed (no need to click "Add Player" first). Also still works when
        //    awaiting an explicit Add Player click.
        for (let gi = 0; gi < pads.length; gi++) {
            const gp = pads[gi];
            if (!gp) continue;
            if (isGamepadUsed(gi)) continue;
            const prev = lobbyPrevPadButtons[gi] || gp.buttons.map(b => b.pressed);
            let pressed = false;
            for (let bi = 0; bi < gp.buttons.length; bi++) {
                const cur = gp.buttons[bi].pressed;
                if (cur && !prev[bi]) { pressed = true; break; }
            }
            lobbyPrevPadButtons[gi] = gp.buttons.map(b => b.pressed);
            if (pressed) {
                commitNewSlot({ type: "gamepad", index: gi });
                return;
            }
        }

        // 2) Per-slot gamepad navigation
        for (const slot of lobbySlots) {
            if (slot.device.type !== "gamepad") continue;
            const gp = pads[slot.device.index];
            if (!gp) continue;

            const ax = gp.axes[0] || 0;
            const dpL = !!(gp.buttons[14] && gp.buttons[14].pressed);
            const dpR = !!(gp.buttons[15] && gp.buttons[15].pressed);
            const cur = {
                left:  dpL || ax < -0.5,
                right: dpR || ax > 0.5,
                a:     !!(gp.buttons[0] && gp.buttons[0].pressed),   // A / Cross  → toggle ready
                b:     !!(gp.buttons[1] && gp.buttons[1].pressed),   // B / Circle → remove
                x:     !!(gp.buttons[2] && gp.buttons[2].pressed),   // X / Square → reroll name
                start: !!(gp.buttons[9] && gp.buttons[9].pressed)
            };
            const prev = slot.prevBtns || {};

            if (cur.left  && !prev.left)  { slot.colorIdx = (slot.colorIdx - 1 + PLAYER_COLORS.length) % PLAYER_COLORS.length; slot.color = PLAYER_COLORS[slot.colorIdx]; needsRefresh = true; }
            if (cur.right && !prev.right) { slot.colorIdx = (slot.colorIdx + 1) % PLAYER_COLORS.length; slot.color = PLAYER_COLORS[slot.colorIdx]; needsRefresh = true; }
            if (cur.x && !prev.x) { slot.name = rollName(); needsRefresh = true; }
            if (cur.a && !prev.a) { slot.ready = !slot.ready; needsRefresh = true; }
            if (cur.b && !prev.b) {
                const i = lobbySlots.indexOf(slot);
                if (i >= 0) lobbySlots.splice(i, 1);
                needsRefresh = true;
                break;       // bail out — we're modifying the array
            }
            if (cur.start && !prev.start) tryStartGame();

            slot.prevBtns = cur;
        }

        if (needsRefresh) refreshLobbyUI();
    }
})();
