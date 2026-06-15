// apps/editor/src/commands/transform-node.ts
//
// On-canvas move/scale/rotate gizmos -> commands -> ops (Deliverable 09
// §9.1/§9.2, Week 7). Each command is a pure "current transform -> 'set'
// Op" translation — `<TransformGizmo>` calls these once per gesture (on
// pointer-up, with the gesture's total delta), not once per pointer-move;
// see Viewport.tsx for the live-preview/commit split.

import { createId, createOp } from "core";
import type { Composition, Id, Json, Op, Transform, Vec2, Vec3 } from "core";
import { findNodeIndex } from "./find-node-index";

/** Translates a node by (dx, dy) comp-space pixels — a "set" Op on `transform.position`. `position.z` is unchanged (2D gestures, Deliverable 05.1). */
export function moveNode(comp: Composition, nodeId: Id, dx: number, dy: number): Op {
  const index = findNodeIndex(comp, nodeId);
  const position = comp.root[index].transform.position;
  const before: Vec3 = { ...position };
  const after: Vec3 = { x: position.x + dx, y: position.y + dy, z: position.z };
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/transform/position`,
    before: before as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/**
 * A fixed point for scale/rotate: `local` is in the node's own
 * pre-transform coordinates (e.g. a bounding-box corner/edge midpoint, or
 * its center — viewport/geometry.ts's `getScaleHandles`/`getRectCenter`);
 * `world` is that point's CURRENT comp-space position
 * (`RenderNode.matrix` applied to `local`). When provided, `scaleNode`/
 * `rotateNode` solve for the `transform.position` that keeps `local`
 * mapped to `world` after the scale/rotation changes — i.e. the pivot
 * stays visually fixed, matching `<TransformGizmo>`'s live preview
 * (`transformAroundPivot`). Without a pivot, only `transform.anchor`
 * (default the node's local origin) stays fixed, per `composeTransform`'s
 * `T(position)·R(rotation)·S(scale)·T(-anchor)`.
 */
export interface TransformPivot {
  local: Vec2;
  world: Vec2;
}

/** Solves for the `transform.position` that keeps `pivot.local` mapped to `pivot.world` under `newScale`/`newRotationDegrees` (same `anchor`). */
function repositionAroundPivot(transform: Transform, pivot: TransformPivot, newScale: Vec2, newRotationDegrees: number): Vec3 {
  const rad = (newRotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rel: Vec2 = { x: pivot.local.x - transform.anchor.x, y: pivot.local.y - transform.anchor.y };
  // Same a/b/c/d as composeTransform.ts, with the NEW scale/rotation.
  const lin: Vec2 = {
    x: cos * newScale.x * rel.x + -sin * newScale.y * rel.y,
    y: sin * newScale.x * rel.x + cos * newScale.y * rel.y,
  };
  return { x: pivot.world.x - lin.x, y: pivot.world.y - lin.y, z: transform.position.z };
}

/**
 * Multiplies a node's current scale by (factorX, factorY) — a "set" Op on
 * the whole `transform` object (scale, and `position` if `pivot` is given,
 * change together as one undo step). Without `pivot`, `transform.anchor`
 * stays fixed (e.g. the default {0,0} = the shape's local origin/top-left).
 */
export function scaleNode(comp: Composition, nodeId: Id, factorX: number, factorY: number, pivot?: TransformPivot): Op {
  const index = findNodeIndex(comp, nodeId);
  const transform = comp.root[index].transform;
  const scale: Vec2 = { x: transform.scale.x * factorX, y: transform.scale.y * factorY };
  const position = pivot ? repositionAroundPivot(transform, pivot, scale, transform.rotation) : transform.position;
  const after: Transform = { ...transform, scale, position };
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/transform`,
    before: transform as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}

/**
 * Adds `deltaDegrees` to a node's current rotation — a "set" Op on the
 * whole `transform` object (rotation, and `position` if `pivot` is given,
 * change together as one undo step). Without `pivot`, `transform.anchor`
 * stays fixed.
 */
export function rotateNode(comp: Composition, nodeId: Id, deltaDegrees: number, pivot?: TransformPivot): Op {
  const index = findNodeIndex(comp, nodeId);
  const transform = comp.root[index].transform;
  const rotation = transform.rotation + deltaDegrees;
  const position = pivot ? repositionAroundPivot(transform, pivot, transform.scale, rotation) : transform.position;
  const after: Transform = { ...transform, rotation, position };
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/transform`,
    before: transform as unknown as Json,
    after: after as unknown as Json,
    txn: createId(),
  });
}