// apps/editor/src/commands/add-effect.ts
//
// Effect-stack panel's "add effect" / "remove effect" actions. Both emit a
// single "set" Op replacing the WHOLE `node.effects` array (rather than an
// "add"/"remove" Op targeting one array element) — `node.effects` is
// `undefined` on most nodes today (Phase 1 content, or any Phase 2 node
// that's never had an effect added), and `core`'s `insertByPointer`
// requires its target path's PARENT to already be a container; it can't
// initialize a missing array on the fly. Building the next array value
// here and `set`-ing it as one atomic op sidesteps that without touching
// `baseNode()`'s shared defaults (core/domain/node.ts) just for this one
// panel — and keeps "add/remove an effect" a single undo step either way.

import { createId, createOp } from "core";
import type { Composition, Id, Json, Node, Op } from "core";
import type { EffectDef } from "effects";
import { findNodeIndex } from "./find-node-index";

/**
 * Appends a new EffectRef (built from `def`'s own Zod schema parsed
 * against `{}`, so it always starts with valid, schema-complete defaults —
 * registry.test.ts's structural-sanity tests guarantee every builtin
 * effect's props schema provides one) to `node.effects`.
 */
export function addEffectOp(comp: Composition, nodeId: Id, def: EffectDef): Op {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  const before = node.effects ?? [];

  const ref = {
    id: createId(),
    effect: def.effect,
    enabled: true,
    props: def.schema.props.parse({}),
  };

  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/effects`,
    before: before as unknown as Json,
    after: [...before, ref] as unknown as Json,
    txn: createId(),
  });
}

/** Removes one effect from `node.effects` by its EffectRef id (not array index — stable regardless of other effects' add/remove/reorder). */
export function removeEffectOp(comp: Composition, nodeId: Id, refId: Id): Op {
  const index = findNodeIndex(comp, nodeId);
  const node: Node = comp.root[index];
  const before = node.effects ?? [];
  if (!before.some((ref) => ref.id === refId)) {
    throw new Error(`removeEffectOp: no effect with id "${refId}" on node "${nodeId}"`);
  }

  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/effects`,
    before: before as unknown as Json,
    after: before.filter((ref) => ref.id !== refId) as unknown as Json,
    txn: createId(),
  });
}