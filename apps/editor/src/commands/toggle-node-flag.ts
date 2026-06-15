// apps/editor/src/commands/toggle-node-flag.ts
import { createId, createOp } from "core";
import type { Composition, Id, Op } from "core";
import { findNodeIndex } from "./find-node-index";

type ToggleableFlag = "hidden" | "locked";

function setNodeFlag(comp: Composition, nodeId: Id, flag: ToggleableFlag, value: boolean): Op {
  const index = findNodeIndex(comp, nodeId);
  const before = comp.root[index][flag] ?? false;
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/${flag}`,
    before,
    after: value,
    txn: createId(),
  });
}

/** LayerPanel's "hide" toggle — `evaluateNode`'s time-gate (`node.hidden || !inSpan(...)`) omits the node from the RenderTree entirely. */
export function setNodeHidden(comp: Composition, nodeId: Id, hidden: boolean): Op {
  return setNodeFlag(comp, nodeId, "hidden", hidden);
}

/**
 * LayerPanel's "lock" toggle. Phase 1: UI-only — `<TransformGizmo>` and
 * `<LayerPanel>`'s drag-to-reorder check `node.locked` before starting a
 * gesture, but `core`'s reducer doesn't enforce it (a locked node's Ops can
 * still be applied directly, e.g. from a script or future collab merge).
 */
export function setNodeLocked(comp: Composition, nodeId: Id, locked: boolean): Op {
  return setNodeFlag(comp, nodeId, "locked", locked);
}