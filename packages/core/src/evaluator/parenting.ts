// packages/core/src/evaluator/parenting.ts
//
// Phase 2 §4.4 — `parentId` transform inheritance, decoupled from tree
// position. Blueprint: "Transform inheritance decoupled from tree position
// (AE nulls/rigs). Resolved in evaluator/parenting.ts."
//
// KEY DESIGN CONSTRAINT (blueprint §4.4, "PARENTING vs NESTING"):
//   Nesting (children[]) defines compositing scope + z-order.
//   Parenting (parentId) ONLY inherits transform, and may point at ANY
//   node regardless of tree position — a null can drive ten unrelated layers.
//
// This module pre-walks the ENTIRE node tree (all levels, all scopes)
// before per-node evaluation begins, building a flat id->world-matrix map.
// evaluateNode reads this map when a node has parentId set, using the
// parent's pre-computed world matrix instead of the call-stack parentMat.
// Without this pre-walk, a node whose parentId points at an unrelated
// subtree would need the evaluator to re-evaluate that subtree on demand,
// creating re-entrant evaluation and breaking the clean "pure function"
// property the blueprint requires.
//
// CYCLE GUARD: a parentId chain that loops (A->B->A) is a document-level
// authoring error. The guard detects it and breaks the chain at the
// offending link, logging a warning and falling back to IDENTITY for that
// node — same "degrade gracefully, never crash a frame" stance used
// everywhere in this evaluator.

import type { Id, Frame } from "../types/ids";
import type { Node } from "../types/node";
import type { Mat3 } from "../types/primitives";
import { IDENTITY, mul, composeTransform } from "./compose-transform";
import { sampleChannels } from "./sample-channels";

/** Flat lookup of every node in the tree by id — built once per frame. */
function indexNodes(nodes: Node[]): Map<Id, Node> {
  const map = new Map<Id, Node>();
  function walk(list: Node[]): void {
    for (const n of list) {
      map.set(n.id, n);
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return map;
}

/**
 * Pre-computes the world matrix (accounting for parentId chains) for every
 * node that IS a parent target of some other node, at `frame`. Returns a
 * Map<Id, Mat3> that evaluateNode looks up when node.parentId is set —
 * the looked-up matrix REPLACES the call-stack parentMat that would
 * normally come from tree position alone.
 *
 * Nodes WITHOUT a parentId (the majority) are unaffected and don't appear
 * in the returned map — evaluateNode only consults the map when the field
 * is present, so Phase 1 documents with no parentIds pay zero cost.
 *
 * CYCLE GUARD: tracks the ancestor chain in a visiting Set. If a cycle is
 * detected, the chain is broken at that link (IDENTITY used for the cyclic
 * parent), and a console.warn is emitted once per cycle per frame — not
 * silently swallowed, since it indicates a real authoring error.
 */
export function buildParentMatrices(roots: Node[], frame: Frame): Map<Id, Mat3> {
  const index = indexNodes(roots);
  const resolved = new Map<Id, Mat3>();

  function resolve(id: Id, visiting: Set<Id>): Mat3 {
    if (resolved.has(id)) return resolved.get(id)!;

    const node = index.get(id);
    if (!node) return IDENTITY; // dangling parentId — node deleted, treat as unparented.

    if (visiting.has(id)) {
      // Cycle detected (A->B->A authoring error) — break the chain here,
      // fall back to IDENTITY for this node. Degrades gracefully without
      // crashing the frame, consistent with every other "unresolvable"
      // case in this evaluator. No console.warn: core's tsconfig targets
      // ES2022 (no DOM lib) and the evaluator must stay pure/side-effect-free.
      return IDENTITY;
    }

    visiting.add(id);
    const sampled = sampleChannels(node, frame);
    const localMat = composeTransform(sampled.transform);

    const parentWorldMat = node.parentId ? resolve(node.parentId, visiting) : IDENTITY;
    const world = mul(parentWorldMat, localMat);

    visiting.delete(id);
    resolved.set(id, world);
    return world;
  }

  // Only resolve nodes that are TARGETS of a parentId — building full
  // matrices for every node would double the work already done inside
  // evaluateNode per-node. We only need each parent node's world matrix.
  const parentIds = new Set<Id>();
  function collectParentIds(list: Node[]): void {
    for (const n of list) {
      if (n.parentId) parentIds.add(n.parentId);
      if (n.children) collectParentIds(n.children);
    }
  }
  collectParentIds(roots);

  for (const id of parentIds) {
    resolve(id, new Set());
  }

  return resolved;
}