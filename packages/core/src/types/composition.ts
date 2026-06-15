// packages/core/src/types/composition.ts
import type { ColorOKLCH, Json } from "./primitives";
import type { Id } from "./ids";
import type { Frame } from "./ids";
import type { Node } from "./node";

/** P2 — params a precomp instance can override; inert in Phase 1. */
export interface PropBinding {
  path: string;
  exposedAs: string;
  default: Json;
}

export interface Composition {
  id: Id;
  name: string;
  size: { width: number; height: number };
  fps: number;
  duration: Frame;
  background?: ColorOKLCH;
  /** The layer tree; array order = z-order. */
  root: Node[];
  exposed?: PropBinding[];
}
