// apps/editor/src/commands/set-matte.ts
//
// Phase 2 §4.2 — track matte commands. A track matte stencils a node
// using a sibling's alpha or luma channel.

import type { Composition, Id, Op } from "core";
import { setNodeProp } from "./set-node-prop";
import { findNodeIndex } from "./find-node-index";

export type MatteMode = "alpha" | "luma" | "alpha-inv" | "luma-inv";

/** Sets node.matte to reference `sourceNodeId` with the given mode. */
export function setMatteOp(comp: Composition, nodeId: Id, sourceNodeId: Id, mode: MatteMode): Op {
  findNodeIndex(comp, nodeId);
  findNodeIndex(comp, sourceNodeId);
  return setNodeProp(comp, nodeId, "matte", { sourceNodeId, type: mode });
}

/** Clears node.matte — removes the track matte. */
export function clearMatteOp(comp: Composition, nodeId: Id): Op {
  return setNodeProp(comp, nodeId, "matte", null);
}
