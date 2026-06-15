// packages/core/src/types/node.ts
import type { ColorOKLCH, Json } from "./primitives";
import type { Id } from "./ids";
import type { BlendMode } from "./primitives";
import type { Transform } from "./transform";
import type { TimeSpan } from "./time";
import type { Channel } from "./channel";

/** Open string — "group" | "image" | "video" | "text" | "shape" | ... */
export type NodeKindId = string;

export type Scalar = string | number | boolean | ColorOKLCH;

/** What a node renders from: media asset, generator, or precomp target. */
export interface Source {
  /** Media (image/video/audio). */
  assetId?: Id;
  /** Generator kind id (P2). */
  generator?: string;
  /** Precomp target (P2). */
  compId?: Id;
}

/** P2 — reserved, inert in Phase 1. */
export interface EffectRef {
  id: Id;
  kind: string;
  params: Record<string, Scalar>;
}

/** P2 — reserved, inert in Phase 1. */
export interface Mask {
  id: Id;
  geom: Json;
  mode: "add" | "subtract" | "intersect";
}

/** P2 — reserved, inert in Phase 1. */
export interface TrackMatteRef {
  nodeId: Id;
  mode: "alpha" | "luma";
}

/**
 * The one structural type (Deliverable 05.3). Behavior comes entirely from
 * `NodeKindRegistry.get(node.kind)` — core never branches on `kind`.
 */
export interface Node {
  id: Id;
  kind: NodeKindId;
  name: string;

  // -- universal --
  transform: Transform;
  opacity: number;
  blend: BlendMode;
  time: TimeSpan;
  parentId?: Id;
  lane?: string;
  locked?: boolean;
  hidden?: boolean;
  origin: "user" | "source";

  // -- kind-specific --
  /** Static values (text, fontSize, fill, ...). */
  props: Record<string, Scalar>;
  /** Animated values, path-addressed. */
  channels: Channel[];
  /** Media / generator / precomp. */
  source?: Source;
  /** Container kinds (group/comp); z-order = array order. */
  children?: Node[];

  // -- reserved for later phases — present, inert in P1 --
  effects?: EffectRef[];
  masks?: Mask[];
  matte?: TrackMatteRef;
  isAdjustment?: boolean;
}
