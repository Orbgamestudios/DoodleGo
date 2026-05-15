// =====================================================================
// Albert Fudge Island — Unity port (converted from the JS/Matter version)
//
// Usage:
//   1. Create a new empty GameObject in your scene named "GameManager".
//   2. Add this script to it. Nothing else is required — the script
//      builds the level, player, camera, and UI at runtime.
//   3. Press Play.
//
// Controls (in Play mode):
//   WASD          — reach arms / swing when grabbing
//   Left Mouse    — toggle LEFT glove grab (intent on; locks on contact)
//   Right Mouse   — toggle RIGHT glove grab
//   Q             — toggle Draw Mode
//   1/2/3/4       — choose Blue Einstein / Blue Epstein / Red Einstein / Red Epstein
//                   (also rebuilds the level)
// =====================================================================
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class GameManager : MonoBehaviour
{
    // ------------------ Tunables ------------------
    [Header("World")]
    public float worldWidth  = 24f;          // playfield width in world units
    public float worldHeight = 14f;
    public Vector2 gravity   = new Vector2(0f, -19.6f);
    public float timeScale   = 0.55f;        // matches the JS timeScale

    [Header("Character")]
    public float headRadius   = 0.52f;
    public float upperLen     = 0.80f;
    public float foreLen      = 0.80f;
    public float armWidth     = 0.12f;
    public float gloveRadius  = 0.26f;
    public float shoulderX    = 0.36f;
    public float shoulderY    = 0.28f;
    public float swingForce   = 18f;
    public float headMaxV     = 6f;
    public float handDrive    = 9f;
    public float handReach    = 1.85f;
    public float maxArmAngV   = 5f;          // rad/sec cap on arm rotation

    [Header("Drawing")]
    public float maxInk       = 14f;         // world-unit budget
    public float drawThickness = 0.22f;
    public float drawDensity  = 4f;
    public float minSegmentLen = 0.18f;

    [Header("Respawn")]
    public float deathYOffset = 2f;          // distance below world bottom that kills you
    public float respawnSeconds = 5f;

    [Header("Selection (read-only at runtime)")]
    public Team team = Team.Blue;
    public CharacterKind character = CharacterKind.Epstein;

    public enum Team { Blue, Red }
    public enum CharacterKind { Einstein, Epstein }

    // ------------------ Internal state ------------------
    Player player;
    List<Platform> platforms = new();
    List<DrawnLine> drawings = new();
    GameObject portal;
    Camera cam;
    Canvas hudCanvas;
    Text inkText, timerText, deathText, hintText;
    Image inkBar;
    GameObject deathOverlay;

    float inkLeft;
    bool  drawMode;
    bool  isDrawing;
    List<Vector2> drawPoints = new();
    float startTime;
    bool  dead;
    float deathTime;

    // World bounds (in world space)
    float worldLeft, worldRight, worldTop, worldBottom;

    // Player-only collision layer / physics matrix
    int playerLayer;
    int defaultLayer;

    // ============================================================
    void Awake()
    {
        // Sets up physics + layer matrix BEFORE anything else.
        Physics2D.gravity = gravity;
        Time.timeScale    = timeScale;

        defaultLayer = LayerMask.NameToLayer("Default");
        playerLayer  = SetupPlayerLayer();
    }

    void Start()
    {
        BuildCamera();
        BuildHUD();
        BuildLevel();
        SpawnPlayer();
        startTime = Time.time;
    }

    int SetupPlayerLayer()
    {
        // Try to find a free user layer for "Player" (no collisions inside the player rig)
        // Falls back to Default if all user layers are taken.
        for (int i = 8; i < 32; i++)
        {
            string n = LayerMask.LayerToName(i);
            if (string.IsNullOrEmpty(n) || n == "Player")
            {
                Physics2D.IgnoreLayerCollision(i, i, true);
                return i;
            }
        }
        Debug.LogWarning("No free layer for Player rig; player parts may self-collide.");
        return 0;
    }

    void BuildCamera()
    {
        if (Camera.main != null) { cam = Camera.main; }
        else
        {
            var go = new GameObject("Main Camera");
            go.tag = "MainCamera";
            cam = go.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
        }
        cam.orthographic = true;
        cam.orthographicSize = worldHeight * 0.5f;
        cam.backgroundColor = new Color(0.53f, 0.81f, 0.92f);
        cam.transform.position = new Vector3(0, 0, -10);

        worldLeft   = -worldWidth * 0.5f;
        worldRight  =  worldWidth * 0.5f;
        worldTop    =  worldHeight * 0.5f;
        worldBottom = -worldHeight * 0.5f;
    }

    // ============================================================
    // LEVEL
    // ============================================================
    void BuildLevel()
    {
        // Side walls + ceiling (no floor — the bottom is a void).
        MakeStaticBox("WallL",   new Vector2(worldLeft  - 0.1f, 0),       new Vector2(0.2f, worldHeight + 4));
        MakeStaticBox("WallR",   new Vector2(worldRight + 0.1f, 0),       new Vector2(0.2f, worldHeight + 4));
        MakeStaticBox("Ceiling", new Vector2(0, worldTop + 0.1f),         new Vector2(worldWidth + 4, 0.2f));

        // Mirrored platform layout — matches JS.
        // (Reading: each entry is x in [-1..1] relative units, y top-down 0..1, width in units, height in units.)
        var pdata = new (float xN, float yN, float w, float h)[]
        {
            (-0.70f, 0.84f, 3.0f, 0.34f),
            (-0.43f, 0.62f, 2.5f, 0.34f),
            ( 0.00f, 0.37f, 2.9f, 0.34f),
            ( 0.43f, 0.62f, 2.5f, 0.34f),
            ( 0.70f, 0.84f, 3.0f, 0.34f),
        };
        foreach (var p in pdata)
        {
            var x = p.xN * worldWidth * 0.5f;
            var y = worldTop - p.yN * worldHeight;
            platforms.Add(MakePlatform(new Vector2(x, y), new Vector2(p.w, p.h)));
        }

        // Portal (sensor — triggers Win)
        var pg = new GameObject("Portal");
        pg.transform.position = new Vector3(0, worldTop - 0.32f * worldHeight, 0);
        var sr = pg.AddComponent<SpriteRenderer>();
        sr.sprite = CreateCircleSprite(64, new Color(0.85f, 0.6f, 1f), Color.white);
        sr.transform.localScale = new Vector3(1.1f, 1.1f, 1);
        sr.color = new Color(0.85f, 0.6f, 1f, 0.85f);
        var col = pg.AddComponent<CircleCollider2D>();
        col.isTrigger = true;
        col.radius = 0.5f;
        pg.AddComponent<PortalTrigger>().game = this;
        portal = pg;
    }

    Platform MakePlatform(Vector2 center, Vector2 size)
    {
        var go = new GameObject("Platform");
        go.transform.position = center;
        var sr = go.AddComponent<SpriteRenderer>();
        sr.sprite = CreateRectSprite(64, 16, new Color(0.17f, 0.17f, 0.24f), 8);
        sr.drawMode = SpriteDrawMode.Sliced;
        sr.size = size;
        var col = go.AddComponent<BoxCollider2D>();
        col.size = size;
        var pm = new PhysicsMaterial2D("PlatMat") { friction = 1f, bounciness = 0f };
        col.sharedMaterial = pm;
        var rb = go.AddComponent<Rigidbody2D>();
        rb.bodyType = RigidbodyType2D.Static;
        var p = new Platform { go = go, size = size, collider = col };
        return p;
    }

    GameObject MakeStaticBox(string name, Vector2 c, Vector2 s)
    {
        var go = new GameObject(name);
        go.transform.position = c;
        var col = go.AddComponent<BoxCollider2D>();
        col.size = s;
        var rb = go.AddComponent<Rigidbody2D>();
        rb.bodyType = RigidbodyType2D.Static;
        return go;
    }

    // ============================================================
    // PLAYER
    // ============================================================
    void SpawnPlayer()
    {
        if (player != null) DestroyPlayer();

        float spawnX = (team == Team.Blue) ? worldLeft + 3.5f : worldRight - 3.5f;
        float spawnY = worldTop - 2.0f;

        player = new Player();

        // ---- Head ----
        var headGO = new GameObject("Head");
        headGO.layer = playerLayer;
        headGO.transform.position = new Vector3(spawnX, spawnY, 0);
        var headSR = headGO.AddComponent<SpriteRenderer>();
        headSR.sprite = LoadHeadSprite();
        headSR.sortingOrder = 10;
        // size the sprite to the desired head radius (a sprite is 1 unit per 100px by default)
        float headScale = (headRadius * 2f) / (headSR.sprite.bounds.size.y);
        headGO.transform.localScale = new Vector3(headScale, headScale, 1);
        var headRB = headGO.AddComponent<Rigidbody2D>();
        headRB.gravityScale = 1f;
        headRB.mass = 5f;
        headRB.angularDamping = 8f;
        headRB.linearDamping = 0.4f;
        headRB.constraints = RigidbodyConstraints2D.FreezeRotation;  // head doesn't spin
        var headCol = headGO.AddComponent<CircleCollider2D>();
        headCol.radius = headRadius / headScale;  // collider radius in local units
        player.head = headGO;
        player.headRB = headRB;

        // ---- Arms ----
        player.arms[0] = BuildArm(-1, headGO);
        player.arms[1] = BuildArm( 1, headGO);

        // Reset health
        dead = false;
    }

    Arm BuildArm(int sign, GameObject head)
    {
        var arm = new Arm();
        arm.side = (sign < 0) ? "left" : "right";

        Vector2 headPos = head.transform.position;
        Vector2 shoulder = headPos + new Vector2(sign * shoulderX, -shoulderY);

        // Upper arm
        var upper = MakeArmSegment("UpperArm_" + arm.side, shoulder + new Vector2(0, -upperLen * 0.5f), upperLen, sign);
        upper.transform.localScale = new Vector3(1, 1, 1);
        // Forearm
        var fore  = MakeArmSegment("ForeArm_"  + arm.side, shoulder + new Vector2(0, -(upperLen + foreLen * 0.5f)), foreLen, sign);
        // Glove
        var glove = MakeGlove(    "Glove_"     + arm.side, shoulder + new Vector2(0, -(upperLen + foreLen + gloveRadius - 0.06f)), arm.side == "left");

        arm.upper = upper;  arm.upperRB = upper.GetComponent<Rigidbody2D>();
        arm.fore  = fore;   arm.foreRB  = fore.GetComponent<Rigidbody2D>();
        arm.glove = glove;  arm.gloveRB = glove.GetComponent<Rigidbody2D>();

        // Shoulder joint: head ↔ upper top
        var shoulderJ = head.AddComponent<HingeJoint2D>();
        shoulderJ.connectedBody = arm.upperRB;
        shoulderJ.autoConfigureConnectedAnchor = false;
        shoulderJ.anchor = new Vector2(sign * shoulderX, -shoulderY) / head.transform.localScale.x;
        shoulderJ.connectedAnchor = new Vector2(0, upperLen * 0.5f);

        // Elbow joint: upper bottom ↔ forearm top
        var elbow = upper.AddComponent<HingeJoint2D>();
        elbow.connectedBody = arm.foreRB;
        elbow.autoConfigureConnectedAnchor = false;
        elbow.anchor = new Vector2(0, -upperLen * 0.5f);
        elbow.connectedAnchor = new Vector2(0, foreLen * 0.5f);

        // Wrist joint: forearm bottom ↔ glove
        var wrist = fore.AddComponent<HingeJoint2D>();
        wrist.connectedBody = arm.gloveRB;
        wrist.autoConfigureConnectedAnchor = false;
        wrist.anchor = new Vector2(0, -foreLen * 0.5f);
        wrist.connectedAnchor = new Vector2(0, gloveRadius - 0.06f);

        // Wire the glove collision handler to this arm.
        var g = glove.GetComponent<Glove>();
        g.arm = arm;
        g.game = this;

        return arm;
    }

    GameObject MakeArmSegment(string name, Vector2 center, float len, int sign)
    {
        var go = new GameObject(name);
        go.layer = playerLayer;
        go.transform.position = center;
        var sr = go.AddComponent<SpriteRenderer>();
        sr.sprite = CreateRectSprite(16, (int)(len * 100), TeamColor(), 6);
        sr.drawMode = SpriteDrawMode.Sliced;
        sr.size = new Vector2(armWidth, len);
        sr.sortingOrder = 7;
        var col = go.AddComponent<CapsuleCollider2D>();
        col.size = new Vector2(armWidth, len);
        col.direction = CapsuleDirection2D.Vertical;
        var rb = go.AddComponent<Rigidbody2D>();
        rb.gravityScale = 1f;
        rb.mass = 0.6f;
        rb.linearDamping = 0.6f;
        rb.angularDamping = 6f;
        return go;
    }

    GameObject MakeGlove(string name, Vector2 center, bool isLeft)
    {
        var go = new GameObject(name);
        go.layer = playerLayer;
        go.transform.position = center;

        // Glove disc
        var sr = go.AddComponent<SpriteRenderer>();
        sr.sprite = CreateCircleSprite(64, isLeft ? new Color(0.23f, 0.51f, 0.96f) : new Color(0.94f, 0.27f, 0.27f), Color.white);
        sr.sortingOrder = 12;
        float scale = (gloveRadius * 2f) / sr.sprite.bounds.size.y;
        go.transform.localScale = new Vector3(scale, scale, 1);

        // Letter L/R as a child SpriteRenderer (textured text)
        var letterGO = new GameObject("Letter");
        letterGO.transform.SetParent(go.transform, false);
        var lsr = letterGO.AddComponent<SpriteRenderer>();
        lsr.sprite = CreateLetterSprite(isLeft ? 'L' : 'R', 64, Color.white);
        lsr.sortingOrder = 13;

        var col = go.AddComponent<CircleCollider2D>();
        col.radius = (gloveRadius / scale) * 0.95f;
        var rb = go.AddComponent<Rigidbody2D>();
        rb.gravityScale = 1f;
        rb.mass = 0.8f;
        rb.linearDamping = 0.6f;
        rb.angularDamping = 6f;
        rb.constraints = RigidbodyConstraints2D.FreezeRotation;

        var g = go.AddComponent<Glove>();
        return go;
    }

    Color TeamColor()
    {
        return team == Team.Blue ? new Color(0.23f, 0.51f, 0.96f) : new Color(0.94f, 0.27f, 0.27f);
    }

    Sprite LoadHeadSprite()
    {
        string key = (team == Team.Blue ? "blue_" : "red_") + (character == CharacterKind.Einstein ? "einstein" : "epstein");
        var tex = Resources.Load<Texture2D>("Sprites/" + key);
        if (tex == null) { Debug.LogWarning("Missing head sprite: " + key); return CreateCircleSprite(64, new Color(1,0.85f,0.7f), Color.black); }
        // Use only the top ~42% of the texture for the "head" portion
        int srcW = tex.width, srcH = tex.height;
        int headH = Mathf.RoundToInt(srcH * 0.42f);
        int headW = Mathf.RoundToInt(srcW * 0.95f);
        int sx = Mathf.RoundToInt(srcW * 0.025f);
        int sy = srcH - headH; // sprite Y is bottom-up
        var rect = new Rect(sx, sy, headW, headH);
        return Sprite.Create(tex, rect, new Vector2(0.5f, 0.5f), 100f);
    }

    void DestroyPlayer()
    {
        if (player == null) return;
        if (player.head) Destroy(player.head);
        foreach (var a in player.arms)
        {
            if (a == null) continue;
            if (a.upper) Destroy(a.upper);
            if (a.fore)  Destroy(a.fore);
            if (a.glove) Destroy(a.glove);
        }
    }

    // ============================================================
    // HUD
    // ============================================================
    void BuildHUD()
    {
        var canvasGO = new GameObject("HUDCanvas");
        hudCanvas = canvasGO.AddComponent<Canvas>();
        hudCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvasGO.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        canvasGO.AddComponent<GraphicRaycaster>();

        // Top bar: ink
        var inkBG = NewUI("InkBG", hudCanvas.transform, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0, -34));
        inkBG.GetComponent<Image>().color = new Color(0, 0, 0, 0.5f);
        var rt = inkBG.GetComponent<RectTransform>();
        rt.sizeDelta = new Vector2(360, 34);

        var label = NewText("InkLabel", inkBG.transform, "INK", 16, FontStyle.Bold);
        label.GetComponent<RectTransform>().anchoredPosition = new Vector2(-140, 0);

        var barBG = NewUI("InkBarBG", inkBG.transform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(20, 0));
        barBG.GetComponent<Image>().color = new Color(1,1,1,0.15f);
        barBG.GetComponent<RectTransform>().sizeDelta = new Vector2(200, 12);

        var bar = NewUI("InkBar", barBG.transform, new Vector2(0, 0.5f), new Vector2(0, 0.5f), new Vector2(0, 0));
        var barImg = bar.GetComponent<Image>();
        barImg.color = new Color(0.36f, 0.51f, 0.96f);
        bar.GetComponent<RectTransform>().pivot = new Vector2(0, 0.5f);
        bar.GetComponent<RectTransform>().sizeDelta = new Vector2(200, 12);
        inkBar = barImg;

        var pct = NewText("InkPct", inkBG.transform, "100%", 14, FontStyle.Bold);
        pct.GetComponent<RectTransform>().anchoredPosition = new Vector2(150, 0);
        inkText = pct;

        var timer = NewText("Timer", hudCanvas.transform, "0:00", 14, FontStyle.Bold);
        timer.GetComponent<RectTransform>().anchorMin = new Vector2(0.5f, 1f);
        timer.GetComponent<RectTransform>().anchorMax = new Vector2(0.5f, 1f);
        timer.GetComponent<RectTransform>().anchoredPosition = new Vector2(230, -34);
        timerText = timer;

        var hint = NewText("Hint", hudCanvas.transform, "WASD swing/reach  ·  LMB/RMB toggle glove  ·  Q draw  ·  1-4 pick character", 12, FontStyle.Normal);
        hint.GetComponent<RectTransform>().anchorMin = new Vector2(0.5f, 0f);
        hint.GetComponent<RectTransform>().anchorMax = new Vector2(0.5f, 0f);
        hint.GetComponent<RectTransform>().anchoredPosition = new Vector2(0, 20);
        hint.color = new Color(1, 1, 1, 0.5f);
        hintText = hint;

        // Death overlay
        deathOverlay = NewUI("DeathOverlay", hudCanvas.transform, new Vector2(0, 0), new Vector2(1, 1), Vector2.zero);
        deathOverlay.GetComponent<Image>().color = new Color(0, 0, 0, 0.6f);
        deathOverlay.GetComponent<RectTransform>().anchorMin = Vector2.zero;
        deathOverlay.GetComponent<RectTransform>().anchorMax = Vector2.one;
        deathOverlay.GetComponent<RectTransform>().sizeDelta = Vector2.zero;

        var dText = NewText("DeathText", deathOverlay.transform, "💀 You Fell Into The Void!\nRespawning in 5", 36, FontStyle.Bold);
        dText.alignment = TextAnchor.MiddleCenter;
        dText.color = new Color(1, 0.4f, 0.4f);
        deathText = dText;
        deathOverlay.SetActive(false);
    }

    GameObject NewUI(string name, Transform parent, Vector2 amin, Vector2 amax, Vector2 anchored)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Image));
        go.transform.SetParent(parent, false);
        var rt = go.GetComponent<RectTransform>();
        rt.anchorMin = amin; rt.anchorMax = amax;
        rt.anchoredPosition = anchored;
        return go;
    }
    Text NewText(string name, Transform parent, string txt, int size, FontStyle st)
    {
        var go = new GameObject(name, typeof(RectTransform));
        go.transform.SetParent(parent, false);
        var t = go.AddComponent<Text>();
        t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        t.text = txt;
        t.fontSize = size;
        t.fontStyle = st;
        t.color = Color.white;
        t.alignment = TextAnchor.MiddleCenter;
        t.horizontalOverflow = HorizontalWrapMode.Overflow;
        t.verticalOverflow = VerticalWrapMode.Overflow;
        return t;
    }

    // ============================================================
    // UPDATE / INPUT
    // ============================================================
    void Update()
    {
        HandleCharacterPick();
        HandleDrawModeToggle();
        HandleMouseInput();
        UpdateHUD();
    }

    void FixedUpdate()
    {
        if (player == null) return;
        if (dead) { TickDeath(); return; }

        if (player.head.transform.position.y < worldBottom - deathYOffset) { Kill(); return; }

        var dir = ReadWASD();
        ApplyMovement(dir);
        DriveFreeArms(dir);
        CapArmAngVel();
    }

    void HandleCharacterPick()
    {
        bool rebuild = false;
        if (Input.GetKeyDown(KeyCode.Alpha1)) { team = Team.Blue; character = CharacterKind.Einstein; rebuild = true; }
        if (Input.GetKeyDown(KeyCode.Alpha2)) { team = Team.Blue; character = CharacterKind.Epstein; rebuild = true; }
        if (Input.GetKeyDown(KeyCode.Alpha3)) { team = Team.Red;  character = CharacterKind.Einstein; rebuild = true; }
        if (Input.GetKeyDown(KeyCode.Alpha4)) { team = Team.Red;  character = CharacterKind.Epstein; rebuild = true; }
        if (rebuild)
        {
            DestroyPlayer();
            SpawnPlayer();
            inkLeft = maxInk;
            dead = false;
            deathOverlay.SetActive(false);
        }
    }

    Vector2 ReadWASD()
    {
        Vector2 d = Vector2.zero;
        if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow))  d.x -= 1;
        if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) d.x += 1;
        if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow))    d.y += 1;
        if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow))  d.y -= 1;
        if (d.sqrMagnitude > 0.0001f) d.Normalize();
        return d;
    }

    void ApplyMovement(Vector2 dir)
    {
        if (dir.sqrMagnitude < 0.001f) return;
        // Only grabbed arms transmit force into the body — pure swing/torque from grip points.
        foreach (var arm in player.arms)
        {
            if (arm == null || !arm.grabbed) continue;
            player.headRB.AddForceAtPosition(dir * swingForce, arm.glove.transform.position, ForceMode2D.Force);
        }
        var v = player.headRB.linearVelocity;
        if (Mathf.Abs(v.x) > headMaxV) v.x = Mathf.Sign(v.x) * headMaxV;
        if (Mathf.Abs(v.y) > headMaxV * 1.3f) v.y = Mathf.Sign(v.y) * headMaxV * 1.3f;
        player.headRB.linearVelocity = v;
    }

    void DriveFreeArms(Vector2 dir)
    {
        foreach (var arm in player.arms)
        {
            if (arm == null || arm.grabbed) continue;
            int sign = arm.side == "left" ? -1 : 1;
            Vector2 headPos = player.head.transform.position;
            Vector2 shoulder = headPos + new Vector2(sign * shoulderX, -shoulderY);
            Vector2 target;
            if (dir.sqrMagnitude > 0.001f)
            {
                Vector2 bias = new Vector2(dir.x + sign * 0.30f, dir.y + 0.05f);
                bias.Normalize();
                target = shoulder + bias * handReach;
            }
            else
            {
                target = shoulder + new Vector2(sign * 0.45f, -2.3f);
            }
            Vector2 gp = arm.glove.transform.position;
            Vector2 d = target - gp;
            arm.gloveRB.AddForce(d * handDrive, ForceMode2D.Force);
        }
    }

    void CapArmAngVel()
    {
        foreach (var arm in player.arms)
        {
            if (arm == null) continue;
            foreach (var rb in new[] { arm.upperRB, arm.foreRB })
            {
                if (rb == null) continue;
                float av = rb.angularVelocity * Mathf.Deg2Rad;
                if (Mathf.Abs(av) > maxArmAngV)
                {
                    rb.angularVelocity = Mathf.Sign(av) * maxArmAngV * Mathf.Rad2Deg;
                }
            }
        }
    }

    // ============================================================
    // GRAB
    // ============================================================
    public void ToggleGrab(string side)
    {
        if (player == null || dead) return;
        var arm = side == "left" ? player.arms[0] : player.arms[1];
        if (arm == null) return;

        if (arm.grabbed)
        {
            ReleaseGrab(arm);
            arm.grabIntent = false;
        }
        else if (arm.grabIntent)
        {
            arm.grabIntent = false;
        }
        else
        {
            arm.grabIntent = true;
            // Immediate grab attempt if the glove is already touching a grabbable.
            var g = arm.glove.GetComponent<Glove>();
            if (g != null) g.TryImmediateGrab(arm);
        }
    }

    public void Grab(Arm arm, Rigidbody2D other, Vector2 worldPoint)
    {
        if (arm.grabbed || other == null) return;

        var j = arm.glove.AddComponent<HingeJoint2D>();
        j.connectedBody = other;
        j.autoConfigureConnectedAnchor = true;
        // Snap to contact point: place anchors at the glove center (it's already approximately there).
        j.useLimits = false;
        arm.grabbed = true;
        arm.grabIntent = true;
        arm.grabJoint = j;
        arm.grabBody = other;
    }

    public void ReleaseGrab(Arm arm)
    {
        if (arm.grabJoint != null) Destroy(arm.grabJoint);
        arm.grabJoint = null;
        arm.grabbed = false;
        arm.grabBody = null;
    }

    void HandleMouseInput()
    {
        if (Input.GetMouseButtonDown(0))
        {
            if (drawMode) StartDrawing(MouseWorld());
            else ToggleGrab("left");
        }
        if (Input.GetMouseButtonUp(0))
        {
            if (drawMode && isDrawing) FinishDrawing();
        }
        if (Input.GetMouseButtonDown(1))
        {
            if (!drawMode) ToggleGrab("right");
        }
        if (isDrawing) ContinueDrawing(MouseWorld());
    }

    Vector2 MouseWorld()
    {
        Vector3 m = Input.mousePosition;
        m.z = -cam.transform.position.z;
        return cam.ScreenToWorldPoint(m);
    }

    // ============================================================
    // DRAW MODE
    // ============================================================
    void HandleDrawModeToggle()
    {
        if (Input.GetKeyDown(KeyCode.Q))
        {
            drawMode = !drawMode;
            if (!drawMode && isDrawing) CancelDrawing();
        }
    }

    void StartDrawing(Vector2 p)
    {
        if (inkLeft <= 0) return;
        isDrawing = true;
        drawPoints.Clear();
        drawPoints.Add(p);
    }
    void ContinueDrawing(Vector2 p)
    {
        if (!isDrawing) return;
        Vector2 last = drawPoints[drawPoints.Count - 1];
        float d = Vector2.Distance(last, p);
        if (d < 0.08f) return;
        if (inkLeft - d < 0) { FinishDrawing(); return; }
        inkLeft -= d;
        drawPoints.Add(p);
    }
    void CancelDrawing()
    {
        if (isDrawing)
        {
            // Refund ink
            float refund = 0;
            for (int i = 1; i < drawPoints.Count; i++) refund += Vector2.Distance(drawPoints[i - 1], drawPoints[i]);
            inkLeft = Mathf.Min(maxInk, inkLeft + refund);
        }
        isDrawing = false;
        drawPoints.Clear();
    }
    void FinishDrawing()
    {
        isDrawing = false;
        if (drawPoints.Count < 3) { drawPoints.Clear(); return; }

        // Simplify
        var simplified = new List<Vector2> { drawPoints[0] };
        for (int i = 1; i < drawPoints.Count; i++)
            if (Vector2.Distance(simplified[^1], drawPoints[i]) > minSegmentLen) simplified.Add(drawPoints[i]);
        if (simplified.Count < 2) { drawPoints.Clear(); return; }

        var parent = new GameObject("Drawing");
        // Compute centroid
        Vector2 center = Vector2.zero;
        foreach (var p in simplified) center += p;
        center /= simplified.Count;
        parent.transform.position = center;

        var rb = parent.AddComponent<Rigidbody2D>();
        rb.gravityScale = 1f;
        rb.mass = drawDensity * simplified.Count * drawThickness * 1.5f;  // heavy
        rb.linearDamping = 0.5f;
        rb.angularDamping = 3f;
        rb.sleepMode = RigidbodySleepMode2D.StartAwake;

        var mat = new PhysicsMaterial2D("DrawMat") { friction = 1f, bounciness = 0f };

        // Build segment colliders + a single LineRenderer for the visuals.
        for (int i = 0; i < simplified.Count - 1; i++)
        {
            var a = simplified[i] - center;
            var b = simplified[i + 1] - center;
            Vector2 mid = (a + b) * 0.5f;
            Vector2 dir = b - a;
            float len = dir.magnitude;
            if (len < 0.001f) continue;
            float angle = Mathf.Atan2(dir.y, dir.x) * Mathf.Rad2Deg;

            var segGO = new GameObject("Seg" + i);
            segGO.transform.SetParent(parent.transform, false);
            segGO.transform.localPosition = mid;
            segGO.transform.localRotation = Quaternion.Euler(0, 0, angle);
            var col = segGO.AddComponent<BoxCollider2D>();
            col.size = new Vector2(Mathf.Max(len, 0.12f), drawThickness);
            col.sharedMaterial = mat;
        }

        var lr = parent.AddComponent<LineRenderer>();
        lr.useWorldSpace = false;
        lr.positionCount = simplified.Count;
        var pts = new Vector3[simplified.Count];
        for (int i = 0; i < simplified.Count; i++) pts[i] = (Vector3)(simplified[i] - center);
        lr.SetPositions(pts);
        lr.startWidth = lr.endWidth = drawThickness;
        lr.numCapVertices = 8;
        lr.numCornerVertices = 8;
        lr.material = new Material(Shader.Find("Sprites/Default"));
        lr.startColor = lr.endColor = TeamColor();
        lr.sortingOrder = 5;

        drawings.Add(new DrawnLine { go = parent });
        drawPoints.Clear();
    }

    // ============================================================
    // WIN / DEATH
    // ============================================================
    public void OnReachedPortal()
    {
        // Simple "win" handling — for now, just stop time and show a message.
        Time.timeScale = 0f;
        deathText.text = "🎉 You Escaped!\nPress 1-4 to play again";
        deathText.color = new Color(1f, 0.85f, 0.3f);
        deathOverlay.SetActive(true);
    }

    void Kill()
    {
        dead = true;
        deathTime = Time.unscaledTime;
        // Disable physics on player parts
        SetPlayerKinematic(true);
        // Drop any grabs
        foreach (var a in player.arms) ReleaseGrab(a);
        deathText.color = new Color(1f, 0.4f, 0.4f);
        deathOverlay.SetActive(true);
        deathText.text = "💀 You Fell Into The Void!\nRespawning in " + Mathf.CeilToInt(respawnSeconds);
    }

    void TickDeath()
    {
        float remaining = respawnSeconds - (Time.unscaledTime - deathTime);
        if (remaining <= 0)
        {
            Respawn();
            return;
        }
        deathText.text = "💀 You Fell Into The Void!\nRespawning in " + Mathf.CeilToInt(remaining);
    }

    void Respawn()
    {
        dead = false;
        deathOverlay.SetActive(false);
        SetPlayerKinematic(false);
        float spawnX = (team == Team.Blue) ? worldLeft + 3.5f : worldRight - 3.5f;
        float spawnY = worldTop - 2.0f;
        player.head.transform.position = new Vector3(spawnX, spawnY, 0);
        player.headRB.linearVelocity = Vector2.zero;
        for (int i = 0; i < player.arms.Length; i++)
        {
            var arm = player.arms[i];
            int sign = (i == 0) ? -1 : 1;
            Vector2 shoulder = new Vector2(spawnX + sign * shoulderX, spawnY - shoulderY);
            arm.upper.transform.position = shoulder + new Vector2(0, -upperLen * 0.5f);
            arm.upper.transform.rotation = Quaternion.identity;
            arm.upperRB.linearVelocity = Vector2.zero;
            arm.upperRB.angularVelocity = 0;
            arm.fore.transform.position  = shoulder + new Vector2(0, -(upperLen + foreLen * 0.5f));
            arm.fore.transform.rotation  = Quaternion.identity;
            arm.foreRB.linearVelocity = Vector2.zero;
            arm.foreRB.angularVelocity = 0;
            arm.glove.transform.position = shoulder + new Vector2(0, -(upperLen + foreLen + gloveRadius - 0.06f));
            arm.gloveRB.linearVelocity = Vector2.zero;
        }
    }

    void SetPlayerKinematic(bool kinematic)
    {
        var t = kinematic ? RigidbodyType2D.Kinematic : RigidbodyType2D.Dynamic;
        player.headRB.bodyType = t;
        foreach (var a in player.arms)
        {
            a.upperRB.bodyType = t;
            a.foreRB.bodyType  = t;
            a.gloveRB.bodyType = t;
        }
    }

    // ============================================================
    // HUD update
    // ============================================================
    void UpdateHUD()
    {
        if (inkLeft <= 0) inkLeft = maxInk;
        float pct = Mathf.Clamp01(inkLeft / maxInk);
        inkBar.rectTransform.sizeDelta = new Vector2(200f * pct, 12f);
        inkText.text = Mathf.RoundToInt(pct * 100f) + "%";

        float t = Time.time - startTime;
        int m = (int)(t / 60f), s = (int)(t % 60f);
        timerText.text = m + ":" + (s < 10 ? "0" : "") + s;
    }

    // ============================================================
    // Procedural sprite creation
    // ============================================================
    static Sprite CreateRectSprite(int w, int h, Color fill, int radius)
    {
        var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
        tex.filterMode = FilterMode.Bilinear;
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
        {
            bool inside = true;
            // Rounded corners
            int dx = Mathf.Min(x, w - 1 - x);
            int dy = Mathf.Min(y, h - 1 - y);
            if (dx < radius && dy < radius)
            {
                int rx = radius - dx, ry = radius - dy;
                if (rx * rx + ry * ry > radius * radius) inside = false;
            }
            tex.SetPixel(x, y, inside ? fill : new Color(0, 0, 0, 0));
        }
        tex.Apply();
        return Sprite.Create(tex, new Rect(0, 0, w, h), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, new Vector4(radius, radius, radius, radius));
    }
    static Sprite CreateCircleSprite(int size, Color fill, Color outline)
    {
        var tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
        tex.filterMode = FilterMode.Bilinear;
        int cx = size / 2, cy = size / 2;
        int r  = size / 2 - 1;
        for (int y = 0; y < size; y++)
        for (int x = 0; x < size; x++)
        {
            int dx = x - cx, dy = y - cy;
            float d = Mathf.Sqrt(dx * dx + dy * dy);
            if (d < r - 1.5f) tex.SetPixel(x, y, fill);
            else if (d < r)   tex.SetPixel(x, y, outline);
            else              tex.SetPixel(x, y, new Color(0, 0, 0, 0));
        }
        tex.Apply();
        return Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f);
    }
    static Sprite CreateLetterSprite(char letter, int size, Color color)
    {
        // Render text via Unity's GUIStyle into a RenderTexture
        var tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
        for (int y = 0; y < size; y++)
        for (int x = 0; x < size; x++)
            tex.SetPixel(x, y, new Color(0, 0, 0, 0));

        // Draw a simple stroked letter pattern using a procedural bitmap font (L and R only).
        DrawSimpleLetter(tex, letter, color);
        tex.Apply();
        return Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f);
    }
    static void DrawSimpleLetter(Texture2D tex, char letter, Color color)
    {
        int s = tex.width;
        int t = Mathf.RoundToInt(s * 0.10f);            // stroke thickness
        int margin = Mathf.RoundToInt(s * 0.18f);
        int left = margin, right = s - margin;
        int bottom = margin, top = s - margin;

        void Box(int x0, int y0, int x1, int y1)
        {
            for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
                if (x >= 0 && y >= 0 && x < s && y < s) tex.SetPixel(x, y, color);
        }
        if (letter == 'L')
        {
            Box(left, bottom, left + t, top);              // vertical stem
            Box(left, bottom, right, bottom + t);          // bottom bar
        }
        else if (letter == 'R')
        {
            Box(left, bottom, left + t, top);              // vertical stem
            int midY = bottom + (top - bottom) / 2;
            Box(left, top - t, right, top);                // top bar
            Box(left, midY, right, midY + t);              // middle bar
            Box(right - t, midY, right, top - t);          // right vertical (top half)
            // Diagonal leg (R's foot)
            int legX0 = left + t, legY0 = midY;
            int legX1 = right,    legY1 = bottom;
            int steps = Mathf.Max(Mathf.Abs(legX1 - legX0), Mathf.Abs(legY1 - legY0));
            for (int i = 0; i <= steps; i++)
            {
                float u = i / (float)steps;
                int x = Mathf.RoundToInt(Mathf.Lerp(legX0, legX1, u));
                int y = Mathf.RoundToInt(Mathf.Lerp(legY0, legY1, u));
                for (int oy = 0; oy < t; oy++)
                    for (int ox = 0; ox < t; ox++)
                        if (x + ox < s && y + oy < s) tex.SetPixel(x + ox, y + oy, color);
            }
        }
    }
}

// =====================================================================
// Data classes
// =====================================================================
public class Player
{
    public GameObject head;
    public Rigidbody2D headRB;
    public Arm[] arms = new Arm[2];
}

public class Arm
{
    public string side;
    public GameObject upper, fore, glove;
    public Rigidbody2D upperRB, foreRB, gloveRB;
    public bool grabIntent;
    public bool grabbed;
    public Joint2D grabJoint;
    public Rigidbody2D grabBody;
}

public class Platform
{
    public GameObject go;
    public Vector2 size;
    public Collider2D collider;
}

public class DrawnLine
{
    public GameObject go;
}
