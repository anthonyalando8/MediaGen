// packages/core/src/types/transform.ts
import type { Vec2, Vec3 } from "./primitives";

/**
 * The rest value of a node's spatial properties. If a channel exists at
 * `transform.scale` (etc.), the Evaluator's sampled value overrides the
 * corresponding field at a given frame — see Deliverable 05.6's note on
 * sampled-vs-stored transform. `rotation` is in degrees.
 */
export interface Transform {
  position: Vec3;
  scale: Vec2;
  rotation: number;
  anchor: Vec2;
}
