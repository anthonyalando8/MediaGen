// apps/editor/src/commands/find-node-index.ts
import type { Composition, Id } from "core";

/**
 * Index of the top-level node `id` within `comp.root`. Phase 1 commands
 * (move/scale/rotate/reorder/hide/lock) only address the flat root array —
 * dragging into/out of a group's `children` is Week 8+ scope.
 */
export function findNodeIndex(comp: Composition, id: Id): number {
  const index = comp.root.findIndex((n) => n.id === id);
  if (index === -1) {
    throw new Error(`findNodeIndex: no top-level node with id "${id}" in composition "${comp.id}"`);
  }
  return index;
}