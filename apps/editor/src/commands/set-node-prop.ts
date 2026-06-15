// apps/editor/src/commands/set-node-prop.ts
import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import { dottedToPointer, getByPath } from "../util/path";
import { findNodeIndex } from "./find-node-index";

/**
 * Generic "set node[path] = value" Op — the schema-driven InspectorPanel's
 * single command (Deliverable 09 §9.1, Week 8). `path` is the dotted path
 * from a `NodeKind.schema.inspector` entry (or a universal field), e.g.
 * "props.fontSize", "transform.position.x", "name", "opacity". `before` is
 * read from the node's current value (`null` if unset) so `invertOp`
 * restores it exactly.
 */
export function setNodeProp(comp: Composition, nodeId: Id, path: string, value: Json): Op {
  const index = findNodeIndex(comp, nodeId);
  const before = (getByPath(comp.root[index], path) ?? null) as Json;
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/${dottedToPointer(path)}`,
    before,
    after: value,
    txn: createId(),
  });
}