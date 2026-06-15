// apps/editor/src/commands/add-node.ts
//
// "commands/ translate a gesture into Op(s) and call apply()" (Deliverable
// 09 §9.2). `addNode`/`appendNodeOp` are the Toolbar's "add node" action:
// they don't call apply() themselves (commands return Ops; the caller
// applies them — see Toolbar.tsx), so the same Op can be used in tests
// without a store.

import { createId, createOp, toFrame } from "core";
import type { Composition, Json, Node, NodeKindId, NodeKindRegistry, Op } from "core";

/**
 * Builds an "add" Op appending a new node of `kind` to the active
 * composition's top-level root (z-order = append). Nested-group targets
 * (drop onto a layer) are Week 8+ scope. Shared by `addNode` and
 * `addMediaNode` (add-media.ts), which differ only in `patch`.
 */
export function appendNodeOp(
  comp: Composition,
  registry: NodeKindRegistry,
  kind: NodeKindId,
  patch: Partial<Node> = {}
): Op {
  const node = registry.create(kind, { time: { start: toFrame(0), duration: comp.duration }, ...patch });
  return createOp({
    type: "add",
    compId: comp.id,
    path: `/root/${comp.root.length}`,
    before: null,
    after: node as unknown as Json,
    txn: createId(),
  });
}

export function addNode(comp: Composition, registry: NodeKindRegistry, kind: NodeKindId): Op {
  return appendNodeOp(comp, registry, kind);
}