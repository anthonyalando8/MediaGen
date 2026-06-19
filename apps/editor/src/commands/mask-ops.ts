// apps/editor/src/commands/mask-ops.ts
//
// Phase 2 §4.2 — mask commands for the pen tool. Each op is a single
// undoable step via the existing op-log.

import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import type { Mask, MaskPath, BezierPoint } from "core";
import { findNodeIndex } from "./find-node-index";

/** Appends a brand-new, empty open Mask to node.masks[]. Returns the new mask's id so the caller can immediately start appending points to it. */
export function addMaskOp(comp: Composition, nodeId: Id): { op: Op; maskId: Id } {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  const existing = (node.masks ?? []) as Mask[];
  const maskId = createId();
  const newMask: Mask = {
    id: maskId,
    mode: "add",
    path: { points: [], closed: false },
    feather: 0,
    opacity: 1,
    inverted: false,
  };
  const after = [...existing, newMask];
  return {
    maskId,
    op: createOp({
      type: "set",
      compId: comp.id,
      path: `/root/${index}/masks`,
      before: existing as unknown as Json,
      after: after as unknown as Json,
      txn: createId(),
    }),
  };
}

/** Appends a single BezierPoint to an existing mask's path. */
export function appendMaskPointOp(comp: Composition, nodeId: Id, maskId: Id, point: BezierPoint): Op {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  const masks = (node.masks ?? []) as Mask[];
  const maskIndex = masks.findIndex((m) => m.id === maskId);
  if (maskIndex === -1) throw new Error(`appendMaskPointOp: mask "${maskId}" not found on node "${nodeId}"`);
  const mask = masks[maskIndex];
  const newPoints = [...mask.path.points, point];
  const newMasks = masks.map((m, i) =>
    i === maskIndex ? { ...m, path: { ...m.path, points: newPoints } } : m
  );
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/masks`,
    before: masks as unknown as Json,
    after: newMasks as unknown as Json,
    txn: createId(),
  });
}

/** Closes the mask path (last point connects back to first). */
export function closeMaskOp(comp: Composition, nodeId: Id, maskId: Id): Op {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  const masks = (node.masks ?? []) as Mask[];
  const maskIndex = masks.findIndex((m) => m.id === maskId);
  if (maskIndex === -1) throw new Error(`closeMaskOp: mask "${maskId}" not found`);
  const newMasks = masks.map((m, i) =>
    i === maskIndex ? { ...m, path: { ...m.path, closed: true } } : m
  );
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/masks`,
    before: masks as unknown as Json,
    after: newMasks as unknown as Json,
    txn: createId(),
  });
}

/** Updates the full path of a mask in one op — used for dragging handles. */
export function setMaskPathOp(comp: Composition, nodeId: Id, maskId: Id, path: MaskPath): Op {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  const masks = (node.masks ?? []) as Mask[];
  const maskIndex = masks.findIndex((m) => m.id === maskId);
  if (maskIndex === -1) throw new Error(`setMaskPathOp: mask "${maskId}" not found`);
  const newMasks = masks.map((m, i) =>
    i === maskIndex ? { ...m, path } : m
  );
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/masks`,
    before: masks as unknown as Json,
    after: newMasks as unknown as Json,
    txn: createId(),
  });
}

/** Removes a mask entirely. */
export function removeMaskOp(comp: Composition, nodeId: Id, maskId: Id): Op {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  const masks = (node.masks ?? []) as Mask[];
  const newMasks = masks.filter((m) => m.id !== maskId);
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/masks`,
    before: masks as unknown as Json,
    after: newMasks as unknown as Json,
    txn: createId(),
  });
}