// apps/editor/src/commands/remove-node.ts
import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import { findNodeIndex } from "./find-node-index";

/**
 * Removes the top-level node `nodeId` from the composition's root —
 * Toolbar's "Delete" action / Delete-Backspace shortcut (use-delete-shortcut.ts).
 *
 * Uses core's "remove" Op (op.ts): `path` points at the element's index,
 * `before` holds the removed node (so `invertOp` -> "add" can re-insert it
 * at the same index — Undo restores the layer in its original position).
 */
export function removeNode(comp: Composition, nodeId: Id): Op {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  return createOp({
    type: "remove",
    compId: comp.id,
    path: `/root/${index}`,
    before: node as unknown as Json,
    after: null,
    txn: createId(),
  });
}