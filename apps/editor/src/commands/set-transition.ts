// apps/editor/src/commands/set-transition.ts
//
// Transition commands. The key insight: transitions require clips to OVERLAP
// in time. applyTransitions() returns null for sequential clips. So when
// applying a transition we also create the overlap by adjusting clip timing.
//
// setTransitionOps() returns an ARRAY of ops — the caller applies them all.
// This keeps each op individually undoable (which is fine — undo restores
// the whole sequence in reverse) and avoids abusing the "group" op type.

import { createId, createOp, toFrame } from "core";
import type { Composition, Id, Json, Node, Op } from "core";
import type { TransitionDef } from "effects";
import { findNodeIndex } from "./find-node-index";

export type TransitionSide = "transitionIn" | "transitionOut";

/**
 * Returns the ops needed to apply a transition, including clip timing
 * adjustments to create the required overlap. Apply all ops in order.
 *
 * Overlap creation: splits durationF evenly — outgoing clip extends
 * forward by half, incoming clip moves back by half. Matches Premiere/
 * DaVinci behaviour at a cut point.
 */
export function setTransitionOps(
  comp: Composition,
  nodeId: Id,
  side: TransitionSide,
  def: TransitionDef,
  durationF: number
): Op[] {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  const ops: Op[] = [];

  const ref = {
    preset: def.preset,
    durationF,
    props: def.schema.props.parse({}),
  };

  // Find adjacent clip pair
  const prevIndex = side === "transitionIn" ? index - 1 : index;
  const nextIndex = side === "transitionIn" ? index : index + 1;
  const prevNode = comp.root[prevIndex];
  const nextNode = comp.root[nextIndex];

  // Adjust clip timing to create overlap if needed
  if (prevNode && nextNode) {
    const prevEnd = (prevNode.time.start as number) + (prevNode.time.duration as number);
    const nextStart = nextNode.time.start as number;
    const existingOverlap = prevEnd - nextStart;

    if (existingOverlap < durationF) {
      const needed = durationF - Math.max(0, existingOverlap);
      const extendPrev = Math.round(needed / 2);
      const movNext = needed - extendPrev;

      // Extend outgoing clip's duration
      const prevDur = prevNode.time.duration as number;
      ops.push(createOp({
        type: "set", compId: comp.id,
        path: `/root/${prevIndex}/time/duration`,
        before: prevDur as unknown as Json,
        after: toFrame(prevDur + extendPrev) as unknown as Json,
        txn: createId(),
      }));

      // Move incoming clip start back + extend its duration
      const nextSt = nextNode.time.start as number;
      const nextDur = nextNode.time.duration as number;
      ops.push(createOp({
        type: "set", compId: comp.id,
        path: `/root/${nextIndex}/time/start`,
        before: nextSt as unknown as Json,
        after: toFrame(Math.max(0, nextSt - movNext)) as unknown as Json,
        txn: createId(),
      }));
      ops.push(createOp({
        type: "set", compId: comp.id,
        path: `/root/${nextIndex}/time/duration`,
        before: nextDur as unknown as Json,
        after: toFrame(nextDur + movNext) as unknown as Json,
        txn: createId(),
      }));
    }
  }

  // Set the transition ref
  ops.push(createOp({
    type: "set", compId: comp.id,
    path: `/root/${index}/${side}`,
    before: (node[side] ?? null) as unknown as Json,
    after: ref as unknown as Json,
    txn: createId(),
  }));

  return ops;
}

/** Single-op convenience wrapper for callers that don't need timing adjustment (e.g. already-overlapping clips). */
export function setTransitionOp(
  comp: Composition,
  nodeId: Id,
  side: TransitionSide,
  def: TransitionDef,
  durationF: number
): Op {
  return setTransitionOps(comp, nodeId, side, def, durationF).slice(-1)[0];
}

/** Clears `node[side]` entirely. */
export function removeTransitionOp(comp: Composition, nodeId: Id, side: TransitionSide): Op {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${index}/${side}`,
    before: (node[side] ?? null) as unknown as Json,
    after: null,
    txn: createId(),
  });
}

/** Updates `durationF` on an existing TransitionRef. */
export function setTransitionDurationOp(comp: Composition, nodeId: Id, side: TransitionSide, durationF: number): Op {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  const existing = node[side];
  if (!existing) throw new Error(`setTransitionDurationOp: node "${nodeId}" has no ${side}`);
  return createOp({
    type: "set", compId: comp.id,
    path: `/root/${index}/${side}/durationF`,
    before: existing.durationF as unknown as Json,
    after: durationF as unknown as Json,
    txn: createId(),
  });
}