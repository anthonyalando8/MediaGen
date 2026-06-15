// apps/editor/src/store/node-tree.ts
//
// Tier1 node-tree helpers — operate on `Node.children` (the persisted
// hierarchy), distinct from the flat evaluated `RenderTree` (contract,
// produced by evaluateComposition — see evaluate-node.ts's flat-array doc).

import type { Id, Node } from "core";

/**
 * All descendant ids of `node` — its children, their children, and so on —
 * NOT including `node.id` itself. Used by <TransformGizmo> to find which
 * flat `RenderTree.nodes` entries belong to a selected "group" node, for
 * both its bounding box (geometry.ts's `getGroupBounds`) and live drag
 * preview (Viewport.tsx cascades the group's preview matrix to these ids).
 */
export function collectDescendantIds(node: Node): Set<Id> {
  const ids = new Set<Id>();
  const visit = (n: Node): void => {
    for (const child of n.children ?? []) {
      ids.add(child.id);
      visit(child);
    }
  };
  visit(node);
  return ids;
}