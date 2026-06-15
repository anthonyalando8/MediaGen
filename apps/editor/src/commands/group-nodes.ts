// apps/editor/src/commands/group-nodes.ts
import { createId, createOp } from "core";
import type { Composition, Id, Json, NodeKindRegistry, Op } from "core";
import { findNodeIndex } from "./find-node-index";

/**
 * Groups `nodeIds` (>= 2 top-level nodes) into a new "group" node, inserted
 * at the position of the topmost (lowest-index) member — Deliverable 12,
 * exit criterion 06: "User groups two nodes; the group transform moves
 * both." The new group's `transform` is `baseNode()`'s identity default, so
 * each child's world matrix is unchanged immediately after grouping
 * (`mul(IDENTITY, childLocal) === childLocal`); only *subsequent* edits to
 * the group's own transform (moveNode/scaleNode/rotateNode,
 * transform-node.ts) move the children together. `evaluate-node.ts`
 * recurses into `node.children` generically (not "group"-specific), so this
 * needs no `core` changes — see the 12.1 "6th NodeKind" test.
 *
 * Uses `core`'s "group" Op (Deliverable 05.4): `before = {indices}` (the
 * members' original ascending indices), `after = {group, at}` (the built
 * group node and its insertion index). `invertOp` turns this into the
 * matching "ungroup".
 */
export function groupNodes(comp: Composition, registry: NodeKindRegistry, nodeIds: Id[]): Op {
  if (nodeIds.length < 2) {
    throw new Error(`groupNodes: select at least 2 nodes to group (got ${nodeIds.length})`);
  }
  const indices = nodeIds.map((id) => findNodeIndex(comp, id)).sort((a, b) => a - b);
  const children = indices.map((i) => comp.root[i]);
  const group = registry.create("group", { name: "Group", children });
  return createOp({
    type: "group",
    compId: comp.id,
    path: "/root",
    before: { indices } as unknown as Json,
    after: { group: group as unknown as Json, at: indices[0] } as unknown as Json,
    txn: createId(),
  });
}