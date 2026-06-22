// apps/editor/src/commands/precompose.ts
//
// Phase 2 §8 — "Precompose" operation: extracts selected layers from the
// active composition into a NEW Composition in the project library, then
// replaces the original layers with a single "comp" node pointing at it.
//
// This is a TWO-STEP action (not a single Op):
//   1. state.addComp(newComp)  — registers the new Composition in project.comps
//                                outside the op-log (same as addAsset)
//   2. state.apply(op)         — applies a "group"-type op that extracts the
//                                selected layers from comp.root and replaces
//                                them with a single comp node
//
// The op-log only records step 2: undo removes the comp node and restores
// the original layers, but the extracted Composition stays in project.comps
// (orphaned but harmless, same as deleted assets). This is acceptable for
// Phase 2; a full "undo also removes the comp" would require a project-level
// op mechanism not yet built.
//
// IMPORTANT: `precompose` is called at the store level (see Toolbar /
// LayerPanel), not via `state.apply()` directly — the caller must call
// `state.addComp(result.newComp)` THEN `state.apply(result.op)` in order.

import { createComposition, createId, createOp, toFrame } from "core";
import type { Composition, Id, Json, NodeKindRegistry, Op } from "core";
import { findNodeIndex } from "./find-node-index";

export interface PrecomposeResult {
  /** The new Composition to add to project.comps via state.addComp(). */
  newComp: Composition;
  /** The op to apply via state.apply() — removes selected layers, inserts comp node. */
  op: Op;
  /** The comp node's id, so the caller can select it after precomposing. */
  compNodeId: Id;
}

/**
 * Extracts `nodeIds` from `activeComp` into a new Composition, and returns
 * the new comp + an op that replaces the extracted layers with a comp node.
 *
 * `nodeIds` must all be top-level children of `activeComp.root` — nested
 * nodes are not supported in Phase 2 (same constraint as groupNodes).
 * The extracted layers are placed in z-order in the new Composition.
 * The comp node is inserted at the position of the FIRST extracted layer.
 */
export function precompose(
  activeComp: Composition,
  registry: NodeKindRegistry,
  nodeIds: Id[],
  name = "Precomp"
): PrecomposeResult {
  if (nodeIds.length === 0) throw new Error("precompose: no layers selected");

  // Collect the selected nodes in their current z-order
  const indices = nodeIds
    .map((id) => findNodeIndex(activeComp, id))
    .sort((a, b) => a - b);
  const extractedNodes = indices.map((i) => activeComp.root[i]);

  // Build the new Composition from the extracted nodes.
  // Duration = max end frame of all extracted layers so the precomp's
  // timeline covers all their content by default.
  const maxEnd = Math.max(
    1,
    ...extractedNodes.map((n) => (n.time.start as number) + (n.time.duration as number))
  );
  const newCompId = createId();
  const newComp: Composition = {
    ...createComposition({ name }),
    id: newCompId,
    name,
    size: activeComp.size,
    fps: activeComp.fps,
    duration: toFrame(maxEnd),
    root: extractedNodes,
  };

  // Build a comp node that instances the new Composition.
  // Its time span covers the same range as the extracted layers' combined span.
  const minStart = Math.min(...extractedNodes.map((n) => n.time.start as number));
  const compNodeId = createId();
  const compNode = registry.create("comp", {
    name,
    time: { start: toFrame(minStart), duration: toFrame(maxEnd - minStart) },
    source: { compId: newCompId },
  });

  // Build the op: type "group" reuses the existing group op mechanism
  // (reducer.ts's applyGroupOp) which replaces a set of indices with a
  // single node at a given position. Undo (invertOp → ungroup) reads
  // `group.children` to restore the original layers — so we attach the
  // extracted nodes as `children` on the comp node purely for the op's
  // undo payload. The evaluator ignores `children` on a comp node
  // (it recurses into the source Composition instead), so this is safe.
  const compNodeWithChildren = { ...compNode, id: compNodeId, children: extractedNodes };
  const insertAt = indices[0];
  const op = createOp({
    type: "group",
    compId: activeComp.id,
    path: "/root",
    before: { indices } as unknown as Json,
    after: { group: compNodeWithChildren, at: insertAt } as unknown as Json,
    txn: createId(),
  });

  return { newComp, op, compNodeId };
}