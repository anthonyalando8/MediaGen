// apps/editor/src/commands/ungroup-node.ts
import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import { findNodeIndex } from "./find-node-index";

/**
 * Ungroups the "group" node `nodeId` — re-inserts its children at
 * consecutive positions starting where the group was, in their original
 * (z-)order, and removes the group itself.
 *
 * This is the structural inverse of `groupNodes` (group-nodes.ts), and
 * produces the op shape `applyGroupOp`/`invertGroupOp` (core's
 * `oplog/reducer.ts`) recognize as "ungroup" via `isUngroup` (`before` has
 * a `group` key): `before = {at, group}`, `after = {indices}`. `invertOp`
 * on this op reproduces the matching "group" op (re-grouping) — so Undo
 * after Ungroup restores the group as a single step, same as any other op.
 */
export function ungroupNode(comp: Composition, nodeId: Id): Op {
  const at = findNodeIndex(comp, nodeId);
  const group = comp.root[at];
  if (group.kind !== "group") {
    throw new Error(`ungroupNode: node ${nodeId} is not a group (kind="${group.kind}")`);
  }
  const children = group.children ?? [];
  if (children.length === 0) {
    throw new Error(`ungroupNode: group ${nodeId} has no children`);
  }
  const indices = children.map((_, i) => at + i);
  return createOp({
    type: "group",
    compId: comp.id,
    path: "/root",
    before: { at, group: group as unknown as Json } as unknown as Json,
    after: { indices } as unknown as Json,
    txn: createId(),
  });
}