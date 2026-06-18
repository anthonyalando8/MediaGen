// apps/editor/src/commands/set-transition.ts
//
// TransitionPanel's "apply transition" / "remove transition" / "change
// duration" actions. Unlike add-effect.ts's `node.effects[]` (an array,
// needing its own append/filter-by-id logic), `transitionIn`/`transitionOut`
// are single optional fields — `setNodeProp` (set-node-prop.ts) already
// handles "set node[path] = value" generically, so these are thin
// builders on top of it rather than their own Op-construction logic.

import { createId, createOp } from "core";
import type { Composition, Id, Json, Node, Op } from "core";
import type { TransitionDef } from "effects";
import { findNodeIndex } from "./find-node-index";

export type TransitionSide = "transitionIn" | "transitionOut";

/**
 * Sets `node[side]` to a new TransitionRef built from `def`'s own Zod
 * schema parsed against `{}` (same "always valid, schema-complete
 * defaults" convention as `addEffectOp`), at `durationF` frames. Setting
 * either side directly (rather than requiring the OTHER sibling to react)
 * matches `applyTransitions`'s own resolution rule (core/evaluator/
 * transitions.ts: "transitionIn takes precedence... when BOTH are set") —
 * the UI only ever needs to write ONE side for a transition to take
 * effect, never coordinate two nodes in one op.
 */
export function setTransitionOp(comp: Composition, nodeId: Id, side: TransitionSide, def: TransitionDef, durationF: number): Op {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  const before = (node[side] ?? null) as unknown as Json;

  const ref = {
    preset: def.preset,
    durationF,
    props: def.schema.props.parse({}),
  };

  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/${side}`,
    before,
    after: ref as unknown as Json,
    txn: createId(),
  });
}

/** Clears `node[side]` entirely — the "remove transition" action. */
export function removeTransitionOp(comp: Composition, nodeId: Id, side: TransitionSide): Op {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  const before = (node[side] ?? null) as unknown as Json;

  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/${side}`,
    before,
    after: null,
    txn: createId(),
  });
}

/** Updates only `durationF` on an EXISTING TransitionRef at `node[side]` — the duration field's onChange handler. Throws if `node[side]` isn't set (the panel should only render this control once a transition already exists). */
export function setTransitionDurationOp(comp: Composition, nodeId: Id, side: TransitionSide, durationF: number): Op {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  const existing = node[side];
  if (!existing) {
    throw new Error(`setTransitionDurationOp: node "${nodeId}" has no ${side} to update`);
  }

  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/${side}/durationF`,
    before: existing.durationF as unknown as Json,
    after: durationF as unknown as Json,
    txn: createId(),
  });
}