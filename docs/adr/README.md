# SeaBytes — Architecture Decision Records

Decisions made during Phase 1 build (WK1–WK9). Each ADR records what was decided, why, and what alternatives were rejected. Future sessions should read these before making changes to the affected areas.

---

## ADR-001: Single `Node` structural type, behavior via registry

**Status:** Accepted  
**Context:** Motion graphics tools typically have a class hierarchy (ImageLayer, TextLayer, ShapeLayer). This makes adding new layer types require deep changes.  
**Decision:** One `Node` interface for all layer types. `node.kind` is a plain string. All behavior (rendering, inspector fields, defaults, schema) lives in `NodeKindRegistry.get(node.kind)`. Core never branches on `node.kind`.  
**Consequences:** Adding a new NodeKind requires zero changes to core or the evaluator — only a new `NodeKind` registration. Inspector, timeline, and layer panel work automatically. Downside: TypeScript can't narrow `node.props` by kind; casts to `as unknown as T` are necessary for kind-specific props.

---

## ADR-002: `contract` package as the renderer boundary

**Status:** Accepted  
**Context:** The renderer (Pixi.js) must not know about domain types; domain must not know about Pixi.  
**Decision:** `packages/contract` contains only interfaces that both sides agree on (`RenderNode`, `GlyphRun`, `ShapeGeom`, `Mat3`, `ColorOKLCH`). No logic, no imports from `core` or `renderer-webgl`. Both packages import from `contract`; neither imports from the other.  
**Consequences:** Clean separation. The renderer could be swapped for Three.js or a canvas2d renderer without touching `core`. Downside: `GlyphRun` duplicates some fields from `TextSpan` — this is intentional; the renderer should never need to know about spans.

---

## ADR-003: Op-log with JSON Pointer paths, structural sharing

**Status:** Accepted  
**Context:** Need undo/redo with minimal memory overhead.  
**Decision:** Every mutation is an `Op { type, path, before, after }` where `path` is an RFC6901 JSON Pointer into `Composition`. `applyOp` uses `setByPointer` which shallow-clones only the nodes on the path from root to the leaf (structural sharing — unchanged subtrees are referenced, not copied). Undo = `invertOp` (swap before/after).  
**Consequences:** O(depth) memory per op instead of O(composition size). Deep paths (e.g. `/root/5/channels/2/keys/0/value`) are cheap. Downside: `pathPoints` and `spans` arrays are stored via `as unknown as Json` casts since `Scalar` doesn't include arrays — this is a known rough edge.

---

## ADR-004: Evaluator produces a flat `RenderNode[]`, not a tree

**Status:** Accepted  
**Context:** A compositing tree where each node can be a group with children would require the renderer to recurse — complex and error-prone.  
**Decision:** `evaluateNode` recurses the `Node` tree but produces a **flat** `RenderNode[]`. Children are interleaved as siblings with absolute world matrices already composed. The renderer receives a flat array in z-order and never recurses.  
**Exception:** `effectGroup` RenderNodes genuinely need their own nested reconciliation because effect filters must isolate a subtree. `effectGroup` is the one case where the renderer recurses — it has its own `LevelState` within `SceneGraph`.  
**Consequences:** Simple renderer. Correct transform and opacity composition. The `reparentToLocal()` helper re-roots effectGroup children from world to local space to prevent double-application of the group matrix.

---

## ADR-005: OKLCH as the canonical color space

**Status:** Accepted  
**Context:** CSS colors, Pixi colors (hex), and inspector colors need a common representation.  
**Decision:** All colors stored as `ColorOKLCH { l, c, h, alpha? }`. Conversion utilities in `packages/renderer-webgl/src/color.ts`: `oklchToHex`, `hexStringToOklch`, `rgbToOklch`.  
**Consequences:** Perceptually uniform interpolation for free. Inspector color picker shows hex (user-friendly) but stores OKLCH. No precision loss across round-trips.

---

## ADR-006: `Mat3` layout is `[a, b, tx, c, d, ty, 0, 0, 1]`

**Status:** Accepted  
**Context:** WebGL conventionally uses column-major matrices. CSS `matrix()` uses a different convention. Pixi uses its own `Matrix` class.  
**Decision:** SeaBytes `Mat3` is a flat 9-element array with layout `[a, b, tx, c, d, ty, 0, 0, 1]`. A point transforms as `x' = a·x + b·y + tx`, `y' = c·x + d·y + ty`. Translation is at indices `[2]` and `[5]`.  
**Consequences:** All coordinate math in `viewport/geometry.ts`, `PathEditOverlay`, and `MaskPenOverlay` depends on this convention. `applyMat3`, `invertMat3`, `mul` all assume it. **Do not change this without updating every call site.**

---

## ADR-007: Zustand store with three slices, never a module singleton

**Status:** Accepted  
**Context:** Module-level singletons make testing impossible and cause stale-closure bugs.  
**Decision:** `createEditorStore(project)` creates a fresh Zustand store per app instance. Three slices: Document (persisted, undoable), Selection+Playback (ephemeral), UI (ephemeral). Provided via React context (`StoreProvider`). Components use `useEditorStore(selector)` for subscriptions or `useEditorStoreApi()` for imperative access in event handlers.  
**Consequences:** Tests create isolated store instances. No shared mutable state. Downside: `useEditorStoreApi()` doesn't trigger re-renders — components that read from it in event handlers get the latest state, but must not use it for rendering.

---

## ADR-008: RAF loop reads store directly, not via React subscription

**Status:** Accepted  
**Context:** React re-renders on every frame would be catastrophically slow.  
**Decision:** The RAF loop inside `Viewport.tsx` calls `store.getState()` directly every tick — zero React overhead. It calls `renderTreeAt(state, frame, registry)` (pure function, no side effects), then `renderer.render(tree)`. React subscriptions (`useEditorStore`) are only used for UI that needs to re-render on state change (inspector, timeline headers).  
**Consequences:** 60fps rendering regardless of React reconciliation. Stale closure is not a risk because `store.getState()` always returns current state. The `treeRef` pattern (storing the latest `RenderTree` in a ref) lets gizmo components read node matrices without subscribing to the full tree.

---

## ADR-009: `node.lane` for timeline track grouping (string identity)

**Status:** Accepted  
**Context:** NLE timelines need multiple clips on one horizontal row.  
**Decision:** `node.lane?: string` — nodes sharing the same lane string render on the same timeline row. Nodes without a lane get their own solo row. `buildLanes(comp)` groups by lane. `moveLaneOp` sets `node.lane`.  
**Consequences:** No separate "Track" entity in the data model — tracks are emergent from shared lane strings. Simple, undoable. Downside: lane names are opaque strings; there's no `Track` object with metadata (color, name). This is a known Phase 2 gap.

---

## ADR-010: `execCommand` replaced by direct DOM manipulation for rich text color

**Status:** Accepted  
**Context:** `document.execCommand("foreColor", false, hex)` was used to apply color in the contenteditable editor. Chrome produces `<font color="#...">` (not `<span style="color: ...">`) making `domToSpans` unable to read the color back.  
**Decision:** `applyColor(hex)` in `RichTextEditor` directly creates a `<span style="color: #hex" data-color='{"l":…}'>` wrapping the selection via `range.surroundContents()`. `domToSpans` reads `data-color` (our own JSON attribute) first, falling back to `el.style.color`.  
**Consequences:** Reliable round-trip. Color always survives Escape/re-open. Downside: `surroundContents` fails when selection crosses element boundaries — handled via `extractContents()` fallback. Bold/Italic still use `execCommand` (they produce `<b>` / `<i>` tags which `domToSpans` handles reliably).

---

## ADR-011: `sampleSpanChannels` uses span-local time

**Status:** Accepted  
**Context:** Per-span animation channels need to be reusable — a "fade-in over 15 frames" preset should work regardless of when in the timeline the span appears.  
**Decision:** Channel keyframes are authored in span-local time: frame 0 = `span.time.start` in composition time. `sampleSpanChannels` computes `localFrame = frame - span.time.start` and passes that to `sampleChannel`.  
**Consequences:** Presets are authored once and reusable. Stagger (offset each span's start) works by changing `span.time.start` without touching the channels. Downside: debugging requires knowing whether a frame value is absolute or span-local.

---

## ADR-012: `TextSpan.time.fillMode` defaults to `"forwards"`

**Status:** Accepted  
**Context:** Without fill mode, a fade-in span disappears the moment its time window ends (evaluator returns `opacity: 0` outside the window). Every test user found this broken.  
**Decision:** `fillMode` defaults to `"forwards"` (hold last keyframe after window). Mapping:
- `"forwards"` → after window: sample at `duration` (clamps to last key)
- `"none"` → after window: sample at `0` (first key — fade-in returns to invisible)
- `"backwards"` → before window: sample at `0` (first key — fade-in pre-hides)
- `"both"` → backwards before + none after  
**Consequences:** Correct default for all enter animations. "Pre-hide" and "Wrap" are only visibly different when `span.time.start > 0` — the UI auto-advances start to 30f when these modes are selected with start=0.

---

## ADR-013: Shape polygon points stored on `props.pathPoints`

**Status:** Accepted  
**Context:** `node.props` is `Record<string, Scalar>` and `Scalar` doesn't include arrays. Bezier path points are `Array<{ point, inHandle?, outHandle? }>`.  
**Decision:** Store `pathPoints` directly on `props` via `as unknown as Json` cast. `geomFromProps` reads it back with `Array.isArray(raw) ? raw as PolygonGeom["points"] : []`. The zod schema uses `z.unknown().optional()` for this field.  
**Consequences:** Works at runtime despite type system protest. The same pattern is used for `props.spans` (TextSpan[]). A future improvement would be a typed `extras: Record<string, Json>` field on Node for complex structured data — but this is a Phase 2 concern.

---

## ADR-014: `path-edit-handle` and `editor-handle` singletons

**Status:** Accepted  
**Context:** `InspectorPanel` needs to trigger `Viewport`'s path-edit mode (and text editor formatting) but they're siblings in the React tree with no shared state.  
**Decision:** Module-level singletons (`registerPathEditHandler` / `enterPathEditMode`, `setActiveEditor` / `getActiveEditor`) let `InspectorPanel` call into `Viewport`'s local state without prop drilling or store pollution. `Viewport` registers its setters on mount.  
**Consequences:** Works reliably. The pattern is a controlled escape hatch — used only for cross-component imperative triggers, not for reactive state. Downside: singletons are technically global mutable state, which complicates testing. Currently no tests cover these interactions.

---

## ADR-015: `commit()` in `PathEditOverlay` reads fresh node from store

**Status:** Accepted  
**Context:** `PathEditOverlay` receives `node` as a prop from `Viewport`'s IIFE. `Viewport` doesn't subscribe to `node.props` changes, so the `node` prop is stale after the first `commit()`. Each subsequent commit was using the original `node.props` as `before`, causing each new point to overwrite the previous ones.  
**Decision:** `commit(pts, isClosed)` always reads the current node from the store: `const idx = comp.root.findIndex(n => n.id === node.id); const currentProps = comp.root[idx].props`. The `useCallback` dep array uses `node.id` (stable) not `node` (stale reference).  
**Consequences:** Each commit correctly builds on the previous committed state. The same fix was applied to `RichTextEditor`'s `handleInput` for the same reason.

---

## ADR-016: Video export is slow by design (MVP shortcut) — WebCodecs demux is the real fix, deferred

**Status:** Deferred (interim mitigation shipped; root cause NOT fixed — read this before touching video export performance)

**Context:** Compositions with video b-roll (introduced at scale by the MediaGen AI-scene media resolver, `apps/python/src/media_resolve.py`) were taking 20+ minutes to export and hitting a hardcoded 5-minute export timeout (`ExportWindow.tsx`), surfacing as "Failed at frame 412 / Export timed out." Investigation traced this to `packages/media/src/texture-source.ts`'s own documented "MVP shortcut": video texture sourcing for BOTH live preview and export uses a hidden `<video>` element, seeked via `el.currentTime = time` and awaited per output frame (`waitForSeek` + `waitForPresentedFrame`, `manager.ts`'s `prepare()`). Unlike an image (decoded once, reused free every frame), every video-visible export frame pays a real codec seek. A proper fix — WebCodecs-based demux, decoding video frames directly without a real `<video>` element — was already scoped as future work in `packages/media/src/decoder.ts`'s `FrameDecoder` (built, but never wired into the export pipeline; its own doc calls this "P2").

**Two "cheap" workarounds were investigated this session and REJECTED — do not re-attempt without addressing the reasons below:**
1. *"Let the video keep playing instead of hard-seeking every frame."* `manager.ts`'s `get()` already does something like this for LIVE PREVIEW (`SEQUENTIAL PLAYBACK` branch — element plays naturally, just pushes the latest decoded frame). It is **deliberately not used for export**: live preview re-renders continuously (RAF loop), so an unresolved seek can catch up on the *next* tick; export calls `render()` exactly once per output frame and captures the canvas synchronously immediately after, with no next tick to catch up on. Applying the live-preview shortcut to export would reintroduce the exact stale/wrong-frame bug `texture-source.ts`'s module doc describes fixing (see that file's "FIX IN THIS REVISION" note).
2. *"Parallelize video seeks within one frame."* `renderer.ts`'s `prepareFrame` awaits texture refs sequentially, deliberately — multiple refs can point at the SAME shared `<video>` element, and concurrent seeks on one element race. A same-asset-safe version (parallelize across *distinct* assets, serialize only within a shared asset) is theoretically valid, but doesn't help the common case here (one video per beat, not multiple simultaneous distinct videos) — not worth the risk for the expected gain.

**Decision:** Shipped only the safe, real win available this session: `ExportWindow.tsx`'s fixed 5-minute `Promise.race` timeout was replaced with a stall watchdog (`STALL_TIMEOUT_MS = 60_000`) that tracks time since the last `onProgress` callback and only aborts on genuine silence, not on total elapsed time. A slow-but-working video-heavy export (steady per-frame progress) now runs to completion instead of being killed partway.

**Consequences:** Exports no longer fail artificially, but video-heavy exports are still genuinely slow — the per-frame seek cost is inherent to the current architecture, unchanged. The real fix remains:
1. Add `mp4box.js` (not currently a dependency anywhere in the repo) to demux the video's MP4 container — extract codec string/description/codedWidth/codedHeight and chunk samples into `EncodedVideoChunk`s with correct timestamps/keyframe flags.
2. Build a "seek to arbitrary time" cursor on top of `FrameDecoder` (`decoder.ts` already does configure→decode→output; the missing piece is a sequential decode-ahead reader matched to how export already walks frames monotonically — NOT per-frame random-access seeking, which would be little better than today).
3. A new texture source producing `VideoFrame` outputs instead of an `HTMLVideoElement`; `renderer-webgl`'s texture upload path needs to accept that in addition to (not instead of) the existing element-based path.
4. Gate the new path to EXPORT ONLY via `packages/export`'s already-injectable `media`/`createRenderer` deps seam — live preview's proven `<video>`-based path must stay untouched.
5. No CI coverage is possible (`packages/export/src/index.ts`'s own comment: real encode/decode "can only be verified in a browser") — verification is manual, across whatever codecs the stock providers (Pexels/Pixabay) actually return.

Realistic estimate: multiple sessions, not a quick add — treat as its own scoped feature, not a bugfix.

---

## Phase 2 Handoff — What to build next

This section is for the next session. Read ARCHITECTURE.md first, then this.

### Current state (end of Phase 1 / WK9)
- 403 tests passing, all packages building clean
- Full editing pipeline: shape/text/image/video nodes, path editing, draw tool, mask pen, rich text, per-span animation with fillMode
- Timeline: NLE lanes, transition blocks, snap-to-grid
- Inspector: 4-tab layout, span animation panel, shape picker, font selector
- Menubar, status bar, keyboard shortcuts (V/T/R/B/F/Esc)
- Renderer: effects, transitions, masks, mattes

### Phase 2 priorities (in order)

**P2-A: Automatic word-splitting for span animation**  
The span animation panel works but requires the user to manually bold/color individual words to create span boundaries. Add a "Split into words" button in `SpanAnimPanel` that:
1. Reads `node.props.spans` (or `node.props.text` if no spans)
2. Splits each span's text on whitespace into individual word-spans
3. Assigns stable `id` values to each span (use `createId()`)
4. Commits via `setSpansAndTextOp`

Each resulting span is one word. The stagger preset then becomes genuinely useful for word-by-word reveals.

**P2-B: Timeline sub-lanes for spans**  
Spans with `time` windows should appear as mini-clips under their parent text node's timeline row. Expanding the text node row in the timeline reveals one sub-lane per animated span.
- `TimelineTrack.tsx` — detect text nodes with animated spans; render expandable row
- Each span clip is draggable left/right to set `span.time.start`
- Drag width = `span.time.duration`
- No vertical lane changing for span clips (they're always under their parent)

**P2-C: Channel editor UI**  
Currently `node.channels` can only be written via motion presets in `MotionPanel`. Add a proper curve editor:
- `CurveEditor.tsx` already exists as a stub in `apps/editor/src/components/`
- When a channel is selected in the Animate tab, show a bezier curve editor
- Add keyframe at current playhead: `channel-ops.ts` has `addKeyframeOp`
- Drag keyframes left/right (time), up/down (value)
- `FillMode` should also be exposed here for node-level channels (ADR-012 noted this as Phase 2)

**P2-D: Audio support**  
`packages/sources` exists as a stub. Add:
- Audio waveform rendering in the timeline (canvas2D, not WebGL)
- Playback via Web Audio API
- Waveform → automatic span timing: detect beats/transients and auto-assign `span.time.start` values

**P2-E: Export pipeline**  
`packages/export` stub exists. The export button in the menubar is currently inert. Implement:
- Frame-by-frame render to offscreen canvas
- Encode via MediaRecorder API (WebM/VP9) or ffmpeg.wasm (MP4/H264)
- Progress UI in the menubar

**P2-F: Per-span glow/neon effect**  
The data model already supports `span.channels` with path `"color"`. For neon glow:
- Add a `glowColor?: ColorOKLCH` and `glowRadius?: number` to `TextSpan`
- In `updateText()` in `scene-graph.ts`: apply a Pixi `BlurFilter` + color matrix as a child filter on individual `Text` objects when `run.glowColor` is set
- Or: render each `Text` to its own `RenderTexture` and apply the glow pass — cleaner but more memory

### Known rough edges to fix before Phase 2 features

1. **`props.spans` / `props.pathPoints` type hack** — stored as `unknown` since `Scalar` doesn't include arrays. Consider adding `extras?: Record<string, Json>` to `Node` for complex structured data.
2. **`lane` has no `Track` metadata** — lane strings are opaque. A `Track { id, name, color, locked }` map in `Composition` would allow proper track headers.
3. **No tests for cross-component singletons** — `path-edit-handle` and `editor-handle` are untested. Add integration tests in `apps/editor/src/components/*.test.ts`.
4. **`RichTextEditor` selection save/restore is fragile** — the `savedRangeRef` only saves when `onFocus` fires on the color input. If the user uses the keyboard to open the color picker, `onFocus` may not fire. Consider saving on every `selectionchange` event instead.
5. **Span `id` field is optional and not assigned** — spans don't have stable IDs yet, so timeline sub-lanes (P2-B) would use array index as identity, which breaks on reorder. Assign IDs in `setSpansAndTextOp` for any span missing one.

### File locations quick reference for Phase 2

| What to change | File |
|---|---|
| Add span auto-split | `apps/editor/src/commands/text-span-ops.ts` + `SpanAnimPanel.tsx` |
| Timeline span sub-lanes | `apps/editor/src/components/TimelineTrack.tsx` + `move-lane.ts` |
| Curve editor | `apps/editor/src/components/CurveEditor.tsx` + `channel-ops.ts` |
| Per-span glow | `packages/renderer-webgl/src/adapter/scene-graph.ts` (updateText) + `text-span.ts` |
| Audio waveform | `packages/sources/` + new `TimelineWaveform.tsx` |
| Export | `packages/export/` + `Menubar.tsx` (wire Export button) |
| `Track` metadata | `packages/core/src/types/composition.ts` + `move-lane.ts` |
| Channel fill mode UI | `apps/editor/src/components/MotionPanel.tsx` + `CurveEditor.tsx` |