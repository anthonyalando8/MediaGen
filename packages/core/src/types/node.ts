// packages/core/src/types/node.ts
import type { ColorOKLCH } from "./primitives";
import type { Id } from "./ids";
import type { BlendMode } from "./primitives";
import type { Transform } from "./transform";
import type { TimeSpan } from "./time";
import type { Channel } from "./channel";
import type { EffectRef, TransitionRef } from "./effect";
import type { Mask } from "./mask";
import type { TrackMatteRef } from "./matte";

/** Open string — "group" | "image" | "video" | "text" | "shape" | ... */
export type NodeKindId = string;

export type Scalar = string | number | boolean | ColorOKLCH;

/** What a node renders from: media asset, generator, or precomp target. */
export interface Source {
  /** Media (image/video/audio). */
  assetId?: Id;
  /** Generator kind id (P2). */
  generator?: string;
  /** Precomp target (P2) — Node.kind === "comp" instances the Composition at this id. */
  compId?: Id;
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

  // -- Phase 2: compositing (see types/effect.ts, mask.ts, matte.ts) --
  effects?: EffectRef[];
  masks?: Mask[];
  matte?: TrackMatteRef;
  isAdjustment?: boolean;
  /** Spans the boundary with the PREVIOUS sibling in z-order (Deliverable 5/6). */
  transitionIn?: TransitionRef;
  /** Spans the boundary with the NEXT sibling in z-order. */
  transitionOut?: TransitionRef;
}