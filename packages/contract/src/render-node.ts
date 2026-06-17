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
}

export interface Stroke {
  color: ColorOKLCH;
  width: number;
}

export type ShapeGeom =
  | { kind: "rect"; width: number; height: number; radius: number }
  | { kind: "ellipse"; width: number; height: number }
  | { kind: "line"; length: number };

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