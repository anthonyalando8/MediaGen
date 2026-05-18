# Choreography Engine — Testing Guide

## Part 1: Testing the UI Dev Harness

### Setup

```bash
# Install dependencies (once)
npm install

# Start the dev server
npm run dev
# Opens at http://localhost:5173
```

---

### Tab 1 — Interactive (Layer 1 + 2)

Tests the character rig and semantic action system directly.

**What to verify:**
1. Character renders fully assembled — head, arms, legs, hands, face features
2. **Rig Ref Audit** panel (bottom right) — all rows should be green ✓
3. Click any **expression** button → face changes instantly (no multiple clicks)
4. Click any **action** button → animation plays once and settles
5. Click the same action again rapidly → interrupts cleanly, no stuck poses
6. **Idle mode** switcher → `default` breathes+sways, `menace` slow weight shift, `float` bobs

**Key things to check:**
- `walk_in` → character slides in from left
- `jump` → full launch, air pose, bounce land, squash recovery
- `panic` → arm flail, torso shake
- `walk_cycle` → alternating legs + arm swing
- Expression buttons change face while body idle continues

---

### Tab 2 — Scene Player (Layer 3)

Tests the full `MasterTimeline` → `CharacterTimeline` → `ActionRegistry` pipeline driven by scene JSON.

**Steps:**
1. Click the **scene player** tab
2. Click **▶ play**
3. Watch the stage — two characters should walk in from opposite sides
4. Character schedule badges light up green as each action fires
5. Camera badges light up as camera moves trigger (push_in at 2.5s, shake at 5.8s)
6. Event log shows a live stream of character actions and expressions

**Scrubbing:**
- Drag the timeline slider to any position → scene seeks to that time
- Characters should hold their correct pose at any scrub position
- Click **↺ restart** → both characters reset and scene replays from t=0

**What to verify:**
- Both characters visible from frame 0 (not invisible/black)
- Actions fire at the correct timestamps shown in the schedule
- Camera shake at 5.8s is visible (stage wobbles)
- Scene completes and `■ complete` appears in event log

---

### Tab 3 — Stage Lab (Layer 4)

Tests `Stage.jsx`, `CameraRig`, background/lighting system.

**Background presets:**
- `default` → dark gradient
- `city_night` → silhouette skyline with building lights
- `studio` → flat dark studio
- `void` → pure black

**Lighting presets:**
- `neutral` → no tint
- `dramatic_side` → subtle purple overlay
- `danger_red` → red atmosphere
- `backlit` → heavy shadow

**Camera presets** (click any, stage transforms):
- `push_in` → stage zooms toward center
- `dolly_out` → stage pulls back
- `camera_shake` → rapid jitter
- `dutch_tilt` → stage rotates then returns
- `rack_focus` → quick zoom snap then settle
- `handheld` → continuous slow drift loop
- **↺ reset camera** → returns to neutral position

**What to verify:**
- Background switches update instantly without re-mounting characters
- Camera transforms apply to the entire stage div (both characters move together)
- `reset camera` always returns to `scale:1, x:0, y:0`

---

### Tab 4 — Layer 5 (SceneComposer, SubtitleRenderer, PerformanceMonitor)

**Scene playlist:**
- Switch between `confrontation` and `lipsync_demo` scenes
- Each has different characters, dialogue, and camera moves

**Subtitles:**
- `lipsync_demo` scene has dialogue — caption cues appear bottom of stage
- Captions use word-by-word reveal mode
- Active cues highlight green in the subtitle panel

**Performance monitor** (live, samples every 500ms):
- `fps` — should be ≥55 in dev mode
- `tweenCount` — rises during actions, falls after
- `status` — `ok` (green) / `warn` (yellow) / `critical` (red)

**Schema validator:**
- Runs automatically when scene switches
- All built-in scenes should show `✓ valid`

**Character variants panel:**
- Shows palette swatches for each variant
- `hero_default` / `villain_default` / `hero_alt` / `neutral`
- (Palette swap on live rig requires the rig refs to be passed — 
   console.log shows the API call for now)

---

## Part 2: Testing the Python Render Pipeline

### Prerequisites

```bash
# Install Python dependencies
pip install playwright

# Install Chromium browser
playwright install chromium

# FFmpeg must be in PATH
# Windows: https://www.gyan.dev/ffmpeg/builds/
# Mac:     brew install ffmpeg
# Linux:   sudo apt install ffmpeg

# Verify
ffmpeg -version
```

---

### Step 1: Start the Vite dev server

The Python renderer targets the running Vite server. Keep it running:

```bash
npm run dev
# Must be running at http://localhost:5173
```

---

### Step 2: Test render mode in the browser first

Open this URL in Chrome to verify the render entry point works:

```
http://localhost:5173/?render=1
```

You should see:
```
render mode — waiting for scene
window.__setRenderScene__(sceneJSON)
```

Then in the browser console, paste:

```javascript
const scene = await fetch('/scenes/example_scene.json').then(r => r.json());
window.__setRenderScene__(scene);
```

The stage should render with both characters. Then:

```javascript
// Verify the renderer ref is exposed
console.log(window.__sceneRenderer__);
// Should show: { play, pause, seekTo, enableDeterministicMode, tick, tickToFrame, ... }

// Test deterministic tick
window.__sceneRenderer__.enableDeterministicMode();
window.__sceneRenderer__.tickToFrame(0, 30);    // frame 0
window.__sceneRenderer__.tickToFrame(30, 30);   // frame 1s
window.__sceneRenderer__.tickToFrame(90, 30);   // frame 3s
```

---

### Step 3: Run the Python renderer

```bash
cd python/

# Basic render — 30fps, dev server width
python scene_runner.py ../scenes/example_scene.json \
  --output ../output/frames \
  --fps 30

# High-res TikTok export
python scene_runner.py ../scenes/example_scene.json \
  --output ../output/frames \
  --fps 30 \
  --width 1080

# Frames only (skip FFmpeg)
python scene_runner.py ../scenes/lipsync_demo.json \
  --no-ffmpeg \
  --fps 30

# Full options
python scene_runner.py ../scenes/example_scene.json \
  --output   ../output/frames \
  --fps      30 \
  --width    1080 \
  --runtime-url http://localhost:5173
```

**Expected output:**
```
╔══ Choreography Engine Renderer ══════════════════
║  Scene:   ../scenes/example_scene.json
║  Output:  ../output/frames
║  FPS:     30
║  Width:   1080px
╚══════════════════════════════════════════════════

[INFO] Scene: 'confrontation_001'  Duration: 10.0s  Frames: 300
[INFO] Scene validation ✓
[INFO] Frame output: ../output/frames/confrontation_001
[INFO] Launching Chromium... (1 worker(s))
[INFO] Injecting scene JSON...
[INFO] Waiting for scene to build...
[CAPTURE] 1/300  0.3%  elapsed: 2.1s  eta: 628.4s
[CAPTURE] 31/300  10.3%  elapsed: 8.5s  eta: 75.0s
...
[INFO] Captured 300 frames ✓
[FFmpeg] → confrontation_001.mp4
[FFmpeg] ✓ confrontation_001.mp4  (2.4 MB)
[DONE] Render complete in 95.3s
```

---

### Output files

```
output/
  frames/
    confrontation_001/
      frame_00000.png
      frame_00001.png
      ...
      frame_00299.png
  confrontation_001.mp4     ← final video
```

---

### Troubleshooting

| Problem | Fix |
|---|---|
| `playwright install chromium` fails | Run as admin / check network proxy |
| `ffmpeg not found` | Add FFmpeg to PATH, or use `--no-ffmpeg` |
| `Scene file not found` | Use path relative to `python/` directory |
| Stage is black in render | Check `http://localhost:5173/?render=1` manually first |
| `window.__SCENE_BUILT__` never true | Increase timeout in `scene_runner.py` line `timeout=15_000` |
| Frames look frozen | Verify `enableDeterministicMode()` is called before frame loop |
| Characters invisible | Same `fromTo`/`gsap.set` bugs — check scene JSON has no `fade_in` as first action |

---

### Render pipeline diagram

```
scene.json
    │
    ▼
scene_runner.py          ← Python CLI
    │  validates JSON
    │  launches Chromium (Playwright)
    │  navigates to /?render=1
    │
    ▼
RenderApp.jsx            ← React (headless)
    │  window.__setRenderScene__(scene)
    │  SceneRenderer mounts, builds MasterTimeline
    │  window.__SCENE_BUILT__ = true
    │
    ▼
scene_runner.py (frame loop)
    │  for each frame:
    │    tickToFrame(i, fps)     ← advances GSAP clock
    │    wait for __FRAME_READY__
    │    page.screenshot(frame_N.png)
    │
    ▼
frame_export.py
    │  ffmpeg -framerate 30 -i frame_%05d.png output.mp4
    │
    ▼
output/scene_id.mp4      ← final video
```