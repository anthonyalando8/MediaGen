// packages/core/src/types/composition.ts
import type { ColorOKLCH } from "./primitives";
import type { Id } from "./ids";
import type { Frame } from "./ids";
import type { Node } from "./node";
import type { PropBinding } from "./exposed";

export interface Composition {
  id: Id;
  name: string;
  size: { width: number; height: number };
  fps: number;
  duration: Frame;
  background?: ColorOKLCH;
  /** The layer tree; array order = z-order. */
  root: Node[];
  /** Phase 2 §4.3 — which inner props a precomp instance of this Composition can override. */
  exposed?: PropBinding[];
}