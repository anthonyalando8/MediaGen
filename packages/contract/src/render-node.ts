// packages/contract/src/render-node.ts
// What the Evaluator emits, what a renderer consumes (Deliverable 05.5).

import type { BlendMode, ColorOKLCH, Json, Mat3, Rect } from "./primitives";

/** Renderer resolves TexRef -> texture via the media package's TextureManager. */
export interface TexRef {
  assetId: string;
  frame?: number;
}

export interface GlyphRun {
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  weight: number;
  color: ColorOKLCH;
  /** Italic style — maps to Pixi Text fontStyle. */
  italic?: boolean;
  /** Underline decoration. */
  underline?: boolean;
  /** Per-span animation values — sampled from span.channels at current frame. */
  opacity?: number;   // 0–1; default 1
  offsetX?: number;   // additional x offset in local px; default 0
  offsetY?: number;   // additional y offset in local px; default 0
  scale?: number;     // uniform scale multiplier; default 1
  /** Index into the originating spans array — used for timeline lane display. */
  spanIndex?: number;
  // ── Visual effects (pass-through from TextSpan) ──────────────────────
  stroke?: { color: import("./primitives").ColorOKLCH; width: number };
  shadow?: { color: import("./primitives").ColorOKLCH; blur: number; distance: number; angle: number; alpha: number };
  highlight?: { color: import("./primitives").ColorOKLCH; padding: number };
  blur?: number;
  colorMatrix?: { brightness?: number; saturation?: number; hue?: number; contrast?: number };
}

export interface Stroke {
  color: ColorOKLCH;
  width: number;
}

export type ShapeGeom =
  | { kind: "rect"; width: number; height: number; radius: number }
  | { kind: "ellipse"; width: number; height: number }
  | { kind: "line"; length: number }
  | {
      kind: "polygon";
      /** Bezier anchor points in node-local space. Same structure as MaskPath — each has a position and optional in/out tangent handles. */
      points: Array<{ point: { x: number; y: number }; inHandle?: { x: number; y: number }; outHandle?: { x: number; y: number } }>;
      closed: boolean;
    };

export interface RenderCommon {
  id: string;
  matrix: Mat3;
  opacity: number;
  blend: BlendMode;
}

export type RenderNode =
  | (RenderCommon & { t: "group"; children: RenderNode[] })
  | (RenderCommon & {
      t: "image" | "video";
      tex: TexRef;
      fit: "cover" | "contain" | "fill";
      /**
       * The node's LOCAL-space target box (origin top-left, before
       * `matrix`) that `fit` sizes/positions the texture within — same
       * convention as a shape's `geom` dimensions. Added to close the gap
       * the renderer previously documented: without a box, a sprite could
       * only render at its texture's native pixel size, ignoring `fit`
       * entirely, and an image/video node's bounding box (for selection/
       * gizmo) had nothing real to report. NodeKind.bounds() (image.ts/
       * video.ts) returns this same rect, so the gizmo outline always
       * matches what's actually drawn.
       */
      box: Rect;
    })
  | (RenderCommon & { t: "text"; runs: GlyphRun[] })
  | (RenderCommon & { t: "shape"; geom: ShapeGeom; fill?: ColorOKLCH; stroke?: Stroke })
  | (RenderCommon & {
      t: "effectGroup";
      /**
       * UNLIKE "group" (which contributes nothing of its own — children
       * are flattened into the RenderTree's top-level `nodes` array as
       * siblings with absolute world matrices, evaluate-node.ts's
       * documented P1 simplification), "effectGroup" is genuinely
       * RECURSIVE: its `children` stay nested here, not flattened. The
       * evaluator only emits an "effectGroup" instead of flattening when a
       * node actually needs render-to-texture isolation — has `masks`,
       * `matte`, `effects`, is a precomp instance, or is affected by an
       * `isAdjustment` sibling above it. A plain "group" with none of
       * these still flattens exactly as in Phase 1 — zero behavior change,
       * zero extra FBO cost, for any project that doesn't use Phase 2
       * features (the §12.1 fitness gate: "Phase 1 documents load
       * unmigrated").
       */
      children: RenderNode[];
      /** Ordered compositing operations the renderer applies over `children`'s composited result (mask -> effect -> matte -> adjustment -> transition; see PassSpec). */
      passes: PassSpec[];
      /** When true, `children` render to their own FBO first (precomp / isolated group) before any pass runs — see PassSpec's "renderer decides how" doc. When false, passes run directly over the accumulator (e.g. a bare adjustment layer, which has no children of its own to isolate). */
      isolate: boolean;
    })
  | (RenderCommon & {
      t: "transitionGroup";
      /**
       * The ONE two-input case in this contract — every other compositing
       * primitive (effect/mask/matte/adjustment, all via "effectGroup")
       * operates on a SINGLE accumulator texture, which is exactly what
       * `PassSpec` is shaped for (`uniforms` + one implicit input).
       * `vec4 trans(sampler2D from, sampler2D to, float progress)`
       * (TransitionDef's doc, effects package) genuinely needs TWO
       * independently-rendered source textures composited together — not
       * expressible as a `PassSpec`, however many fields are added to it,
       * without it secretly becoming "an effect with a hidden second
       * input" (a special case PassSpec's consumers would all need to
       * know about). A dedicated RenderNode variant makes the two-input
       * shape explicit and type-safe instead.
       *
       * `from`/`to` are each a COMPLETE RenderNode (subtree) — typically
       * the two z-order-adjacent siblings the Evaluator paired via
       * `Node.transitionIn`/`transitionOut` (evaluate-composition.ts's
       * `applyTransitions`), already independently evaluated exactly as
       * they would be without a transition. `matrix`/`opacity`/`blend` on
       * THIS wrapper are this group's own composited-result values (same
       * convention as "effectGroup" — a parent further up composes with
       * this node exactly as it would an unwrapped one); `from`/`to`
       * themselves carry their OWN world matrices (no local-space
       * re-rooting needed, unlike "effectGroup": the renderer renders each
       * to its own full-frame texture independently, not into a shared
       * nested Container, so there's no parent transform for them to
       * inherit here).
       */
      from: RenderNode;
      to: RenderNode;
      /** Registry key the renderer resolves to a two-sampler shader (TransitionDef.preset, e.g. "wipe" | "dip" | "slam"). */
      ref: string;
      /** Sampled, JSON-safe uniform values for the transition's OWN params (TransitionRef.props, e.g. a wipe's angle) — distinct from `progress`. */
      uniforms: Json;
      /** 0 at the start of the transition (fully "from") to 1 at the end (fully "to") — sampled once per frame from the transition's time span, never a Channel itself (TransitionRef has no `channels` field; only `durationF`). */
      progress: number;
    });

/**
 * One step of an "effectGroup"'s compositing pipeline (Deliverable 05/07).
 * The Evaluator emits these as DATA — sampled uniforms, no GPU handles —
 * so the same RenderTree is identical client-side and in the headless
 * render farm (Deliverable 11.3: "no second rendering codebase to drift").
 * `renderer-webgl/passes/` resolves `ref` to a compiled shader/operation and
 * decides FBO allocation, ordering within a single GPU pass, etc. — see the
 * "the Evaluator stays pure" doc in evaluate-node.ts / the Phase 2 blueprint
 * §5.
 */
export interface PassSpec {
  kind: "effect" | "mask" | "matte" | "adjustment" | "transition";
  /** Registry key the renderer resolves to a shader/operation — an EffectDef.effect, TransitionDef.preset, or a fixed key for mask/matte/adjustment passes. */
  ref: string;
  /** Sampled, JSON-safe uniform values for this pass (already resolved from any `channels` — the renderer never samples a Channel itself). */
  uniforms: Json;
  /** For "matte" passes: the sibling RenderNode id supplying the stencil (TrackMatteRef.sourceNodeId, already resolved to its rendered id). */
  srcNodeId?: string;
}

export interface RenderTree {
  size: { width: number; height: number };
  background?: ColorOKLCH;
  nodes: RenderNode[];
}