# SeaBytes — Architecture Reference

> Last updated: end of Phase 1 / WK9 post-session  
> Status: 403 tests passing, all packages building clean

---

## Overview

SeaBytes is a browser-based motion-graphics / video editor built as a **pnpm Turborepo monorepo**. It targets the same creative space as Adobe After Effects and DaVinci Resolve Fusion but runs entirely in the browser via WebGL (Pixi.js v8).

The architecture is deliberately layered: each inner layer has zero knowledge of outer layers, and all inter-layer communication flows through a single shared contract (`packages/contract`).

```
┌─────────────────────────────────────────────────┐
│  apps/editor   (React 18 + Zustand)             │
├─────────────────────────────────────────────────┤
│  packages/renderer-webgl  (Pixi.js v8)          │
├─────────────────────────────────────────────────┤
│  packages/nodekinds  (shape, text, image, …)    │
├─────────────────────────────────────────────────┤
│  packages/core  (evaluator, oplog, types)        │
├─────────────────────────────────────────────────┤
│  packages/contract  (shared render types)        │
└─────────────────────────────────────────────────┘
```

---

## Packages

### `packages/contract`
**The boundary.** Pure TypeScript interfaces and zero runtime code that both `core` and `renderer-webgl` import. Nothing else may import from this package.

Key exports:
- `RenderNode` / `RenderTree` — what the evaluator produces and the renderer consumes
- `GlyphRun` — one styled text segment (font, size, weight, color, opacity, offsetX/Y, scale)
- `ShapeGeom` — parametric geometry union: `rect | ellipse | line | polygon`
- `ColorOKLCH` — all colors stored as `{ l, c, h, alpha? }` in OKLCH
- `Mat3` — 2-D affine matrix `[a, b, tx, c, d, ty, 0, 0, 1]`

### `packages/core`
**The domain.** All data types, the evaluator pipeline, the op-log, and the NodeKind registry. No DOM, no Pixi, no React.

#### Types (`core/src/types/`)
| File | Purpose |
|---|---|
| `node.ts` | `Node` — the single structural type; behavior comes entirely from `NodeKindRegistry` |
| `composition.ts` | `Composition` — flat root array (`Node[]`), size, fps, duration |
| `project.ts` | `Project` — map of compositions + asset library |
| `channel.ts` | `Channel<V>` — path-addressed animation curve with typed keyframes |
| `keyframe.ts` | `Keyframe<V>` — frame, value, `interp: "hold"|"linear"|"bezier"`, optional handles |
| `text-span.ts` | `TextSpan` — rich text segment; includes `time?`, `channels?`, `fillMode?` for per-word animation |
| `transform.ts` | `Transform` — position (Vec3), scale (Vec2), rotation, anchor |
| `mask.ts` | `Mask` — bezier mask path with mode (add/subtract/intersect) |
| `effect.ts` | `EffectRef` / `TransitionRef` — references to effect/transition registry entries |

**`Node` has a single structural shape** — behavior comes from `NodeKindRegistry.get(node.kind)`. Core never branches on `node.kind`. `node.props` is `Record<string, Scalar>` where `Scalar = string | number | boolean | ColorOKLCH`. Arrays (like `pathPoints`, `spans`) are stored via `as unknown as Json` casts.

#### Evaluator (`core/src/evaluator/`)
The evaluator converts `(Composition, frame)` → `RenderTree` via a pipeline:

```
Composition + frame
  → evaluateComposition()
    → for each Node in root:
        evaluateNode(node, frame, parentMat, parentOpacity)
          1. Time-gate: skip if frame outside node.time
          2. sampleChannels(node, frame) → animated transform/props
          3. Compose world matrix: parentMat × localMat
          4. NodeKindRegistry.get(kind).render(sampledNode, frame) → RenderNode[]
          5. Wrap in effectGroup if node has enabled effects
          6. Recurse children
  → RenderTree { nodes: RenderNode[] }
```

Key files:
- `evaluate-node.ts` — main recursion, effect wrapping, parent transform composition
- `sample-channels.ts` — samples `node.channels[]` at frame, writes over static props
- `sample-span-channels.ts` — samples `TextSpan.channels[]` at frame with `FillMode` support
- `interpolate.ts` — `hold | linear | bezier` interpolation between keyframes
- `compose-transform.ts` — `Transform → Mat3` (position × rotation × scale × anchor)
- `transitions.ts` — detects overlapping clip pairs and builds transitionGroup render nodes

#### Op-Log (`core/src/oplog/`)
All mutations are expressed as `Op` objects and passed through `applyOp`:

```ts
interface Op {
  type: "add" | "remove" | "set" | "move" | "reparent" | "group";
  compId: Id;
  path: string;   // RFC6901 JSON Pointer into Composition
  before: Json;
  after: Json;
  txn: Id;
}
```

`setByPointer` / `removeByPointer` traverse and shallow-clone only the path from root to the changed leaf (structural sharing). Undo = `invertOp` (swap before/after). History is a flat `Op[]` with a cursor index.

#### NodeKind Registry (`core/src/registry/`)
```ts
interface NodeKind {
  kind: string;
  render(node: Node, frame: Frame, ctx: EvalCtx): RenderNode[];
  schema: { props: ZodSchema; channels: ChannelDef[] };
  defaults(): Partial<Node>;
  inspector?: InspectorFieldDef[];
}
```

The registry is built at app startup in `apps/editor/src/bootstrap/register-kinds.ts`.

### `packages/nodekinds`
Implementations of the five Phase 1 node kinds: `shape`, `text`, `image`, `video`, `group` (+ `null`, `comp`).

- `shape.ts` — 9 shape types: rect, ellipse, line, triangle, diamond, star, ngon, arrow, polygon (bezier path). All polygon variants are generated as `ShapeGeom { kind: "polygon", points: BPoint[], closed: boolean }`.
- `text.ts` — calls `layout(props, frame)` → `GlyphRun[]`
- `common.ts` — `layout()`: spans → GlyphRuns with x-offset tracking via canvas `measureText()` and per-span channel sampling via `sampleSpanChannels()`

### `packages/effects`
Effect and transition definitions. Each exports a `PassSpec` (GLSL shader + uniform schema).

Built-in effects: blur, drop-shadow, glow, grade, levels, rgb-split, displace  
Built-in transitions: wipe (linear + radial), cross-dissolve, whip, dip, slam

Effects are applied in `evaluate-node.ts` by wrapping nodes in an `effectGroup` RenderNode. The renderer then renders the effectGroup into an offscreen texture and applies each `PassSpec` as a Pixi Filter chain.

### `packages/renderer-webgl`
**Pixi.js v8 adapter.** Consumes `RenderTree` (from `contract`), produces pixels. Zero domain knowledge.

#### SceneGraph (`scene-graph.ts`)
Keyed diff reconciler: maps `RenderNode.id` → Pixi `Container/Text/Graphics/Sprite`. On each RAF tick:
1. `reconcile(tree)` — walks `tree.nodes` in z-order
2. For each node: find or create the Pixi display object by id
3. `setFromMatrix(node.matrix)` — applies the world matrix
4. `updateContent(display, node)` — dispatches by `node.t`:
   - `"image"` / `"video"` → `updateSprite()`
   - `"text"` → `updateText()` — creates one Pixi `Text` per `GlyphRun`, applies `text.alpha = run.opacity`, `text.scale = run.scale`
   - `"shape"` → `updateShape()` — `Graphics.clear()` + redraw via `roundRect | ellipse | lineTo | bezierCurveTo`
   - `"effectGroup"` → `reconcileEffectGroup()` — renders children to offscreen texture, applies filter chain

#### Coordinate Math (`matrix.ts`, `../viewport/geometry.ts`)
- `Mat3` layout: `[a, b, tx, c, d, ty, 0, 0, 1]` — `x' = a·x + b·y + tx`
- `applyMat3(m, pt)` — transform a point by a matrix
- `invertMat3(m)` — 2D affine inverse
- `compToScreen(pt, fit)` / `screenToComp(pt, fit)` — viewport fit transform
- `FitTransform` — `{ x, y, scale }` centering + zoom transform

---

## App (`apps/editor`)

### Store (`src/store/`)
Three slices composed via Zustand:

| Slice | State |
|---|---|
| `DocumentSlice` | `document: { project, opLog, cursor }` — persisted to localStorage, undoable |
| `SelectionSlice` | `selection: Id[]`, `tool: Tool`, ephemeral |
| `PlaybackSlice` | `playhead: Frame`, `playing: boolean`, ephemeral |
| `UiSlice` | `zoom`, `pan`, panel sizes/collapsed, `inspectorTab`, ephemeral |

`DocumentSlice.apply(op)` applies the op, pushes to opLog, truncates redo stack.  
`undo()` / `redo()` move the cursor and re-run `applyOp` in reverse.

The store is **never a module-level singleton** — created by `createEditorStore(project)` and provided via React context. This makes testing trivial.

### RAF Loop (inside `Viewport.tsx`)
```
requestAnimationFrame → 
  state = store.getState()
  tree = renderTreeAt(state, state.playhead, registry)  ← evaluator
  treeRef.current = tree                                 ← for gizmo matrix lookups
  renderer.render(tree, state.playing)                   ← scene-graph reconciler
  if playing: store.getState().advancePlayhead(dt)
```

The RAF loop reads `store.getState()` directly (not via React subscription) for zero-overhead per-frame access.

### Coordinate Spaces
Three spaces, two transforms:

```
node-local space   ──[nodeMatrix (world Mat3)]──►  comp space
comp space         ──[FitTransform { x, y, scale }]──►  screen space
```

- `nodeMatrix` is the node's world matrix from `treeRef.current`; encodes position + rotation + scale
- `FitTransform` is the viewport's contain+center+zoom transform
- The `PathEditOverlay` and `MaskPenOverlay` use `localToScreen = compToScreen(applyMat3(nodeMatrix, lp), fit)` and `screenToLocal = applyMat3(invertMat3(nodeMatrix), screenToComp(sc, fit))`

### Inspector Panel
Schema-driven, tab-organized. `getInspectorFields(node, registry)` returns a flat `InspectorFieldValue[]` from the NodeKind's `inspector` definition. `partitionFields()` splits them into name / general / transform / kind-specific groups. Four tabs:

| Tab | Content |
|---|---|
| Properties | Transform + geometry fields |
| Style | Appearance + fill/stroke color fields + Effects stack |
| Animate | Motion presets + Transitions |
| Text | Typography + Format Selection + Span Animation (text nodes only) |

### Commands (`src/commands/`)
All mutations go through commands → `Op` → `store.apply(op)`. Commands never write to the store directly.

Key commands:
| File | What it does |
|---|---|
| `add-node.ts` | Adds a new node at the end of root |
| `set-node-prop.ts` | Sets a single prop field via "set" op on `/root/N/props/field` |
| `text-span-ops.ts` | `setSpansAndTextOp` — replaces entire `props.spans` + `props.text` atomically |
| `set-span-animation.ts` | Per-span time windows, channel presets (fadeIn/slideUp/pop etc.), stagger |
| `convert-to-path.ts` | Bakes rect/ellipse/star/etc into bezier polygon `pathPoints` |
| `draw-stroke.ts` | RDP simplification + Catmull-Rom → bezier, creates new polygon node |
| `move-lane.ts` | Sets `node.lane` for timeline track grouping; `buildLanes(comp)` |
| `set-transition.ts` | Sets `transitionIn`/`transitionOut` + auto-creates clip overlap |

### Key Components
| Component | Role |
|---|---|
| `Viewport.tsx` | Canvas host, RAF loop, pointer routing, text/path/draw overlays |
| `TransformGizmo.tsx` | 8-handle scale/rotate/move overlay, double-click to enter sub-editors |
| `PathEditOverlay.tsx` | Bezier node editor: select anchors/handles, pen tool, close/open |
| `MaskPenOverlay.tsx` | Same pattern as PathEditOverlay but for node masks |
| `RichTextEditor.tsx` | contenteditable overlay for text editing; `saveSelection()`/`restoreSelection()` for color picker; commits via `setSpansAndTextOp` on every input |
| `SpanAnimPanel.tsx` | Per-span animation UI: start frame, transition duration, presets, fillMode |
| `TimelineTrack.tsx` | NLE-style clip timeline using `buildLanes()`; vertical drag = lane change |
| `DrawOverlay.tsx` | Freehand draw tool: RDP simplification → new polygon node |

---

## Per-Span Text Animation

`TextSpan` (in `packages/core/src/types/text-span.ts`) can carry:
- `time?: TextSpanTime` — `{ start: Frame, duration: Frame, fillMode: FillMode }`
- `channels?: Channel[]` — path-addressed: `"opacity" | "offsetX" | "offsetY" | "scale" | "color"`

`FillMode` controls what happens outside the animation window:
- `"forwards"` (default) — holds last keyframe; a fade-in stays visible
- `"none"` — returns to first keyframe; a fade-in returns to opacity 0
- `"backwards"` — holds first keyframe before start; pre-hides the span
- `"both"` — pre-hides before AND returns to first keyframe after

`sampleSpanChannels(span, frame)` is called inside `layout()` for every span, producing a `SampledSpan { opacity, offsetX, offsetY, scale, color? }` baked into each `GlyphRun`. The renderer applies `text.alpha = run.opacity` and `text.scale.set(run.scale)` per Pixi `Text` child.

---

## CSS Architecture
Four files, loaded in order:

| File | Purpose |
|---|---|
| `theme.css` | Design tokens, base component styles (`--surface-*`, `--accent`, `--radius`, `--space-*`, `--font-*`) |
| `workspace.css` | Layout grid (`app-shell`), panel shells, timeline |
| `inspector-tabs.css` | Menubar, tabbed inspector strip, status bar extensions |
| `span-anim.css` | Per-span animation panel styles |

---

## Monetary Conventions (for `pxyz_fx` reference)
This section is SeaBytes-specific; monetary fields do not apply here. SeaBytes has no financial data.

---

## Test Coverage
403 tests across 9 packages. Run with `pnpm turbo run test --force`.

Packages with meaningful coverage: `core` (43), `renderer-webgl` (71), `editor` (213).