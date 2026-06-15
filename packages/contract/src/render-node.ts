// packages/contract/src/render-node.ts
// What the Evaluator emits, what a renderer consumes (Deliverable 05.5).

import type { BlendMode, ColorOKLCH, Mat3 } from "./primitives";

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
  | (RenderCommon & { t: "image" | "video"; tex: TexRef; fit: "cover" | "contain" | "fill" })
  | (RenderCommon & { t: "text"; runs: GlyphRun[] })
  | (RenderCommon & { t: "shape"; geom: ShapeGeom; fill?: ColorOKLCH; stroke?: Stroke });

export interface RenderTree {
  size: { width: number; height: number };
  background?: ColorOKLCH;
  nodes: RenderNode[];
}
