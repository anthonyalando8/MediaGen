// apps/editor/src/commands/reorder.ts
import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import { findNodeIndex } from "./find-node-index";

/**
 * Moves the top-level node `nodeId` to `toIndex` within `comp.root`
 * (z-order = array order — Deliverable 07: "Iterates root in z-order").
 * `toIndex` is the index in the RESULTING array (standard array-move
 * semantics): moving index 0 to index 2 in [A,B,C,D] yields [B,C,A,D].
 *
 * `op.before`/`op.after` are `{from,to}` JSON-pointer pairs (Deliverable
 * 05.4's "move"/"reparent" convention) — `applyMoveOp` removes the element
 * at `from` and re-inserts it at `to`. `before` is the *reverse* pair
 * (remove from `toIndex`, re-insert at `fromIndex`), so `invertOp` — which
 * swaps `before`/`after` wholesale — correctly undoes the move.
 */
export function reorderNode(comp: Composition, nodeId: Id, toIndex: number): Op {
  const fromIndex = findNodeIndex(comp, nodeId);
  return createOp({
    type: "move",
    compId: comp.id,
    path: "/root",
    before: { from: `/root/${toIndex}`, to: `/root/${fromIndex}` } as unknown as Json,
    after: { from: `/root/${fromIndex}`, to: `/root/${toIndex}` } as unknown as Json,
    txn: createId(),
  });
}