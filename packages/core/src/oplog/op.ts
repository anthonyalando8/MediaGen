// packages/core/src/oplog/op.ts
import { createId } from "../types/ids";
import type { Id } from "../types/ids";
import type { Json } from "../types/primitives";

/**
 * An invertible, path-addressed mutation (Deliverable 05.4). `path` is an
 * RFC6901 JSON Pointer into the `Composition` object tree, e.g.
 * "/root/0/children/2/transform/position".
 *
 * - "set": `before`/`after` are the old/new value at `path`. Trivially
 *   invertible by swapping before/after.
 * - "add" / "remove": invert into each other. `path` points at the array
 *   index the element occupies (for add: after insertion; for remove:
 *   before removal). `before`/`after` hold the element itself (as Json) on
 *   the side where it exists.
 * - "move" / "reparent": a generic array-element move, `before`/`after` are
 *   `{ from: string; to: string }` JSON-pointer pairs. Invert swaps from/to.
 * - "group": `path` is the parent array's pointer.
 *     before = { indices: number[] }   — original ascending sibling indices
 *     after  = { group: Json; at: number } — the pre-built group node
 *              (with its children populated) and its insertion index.
 *   Invert is "ungroup": remove the group node, re-insert its children at
 *   `before.indices` (ascending).
 */
export interface Op {
  id: Id;
  type: "add" | "remove" | "set" | "move" | "reparent" | "group";
  compId: Id;
  path: string;
  before: Json;
  after: Json;
  txn: Id;
  ts: number;
}

/** Convenience factory: fills `id`/`ts` if omitted. */
export function createOp(input: Omit<Op, "id" | "ts"> & Partial<Pick<Op, "id" | "ts">>): Op {
  return {
    ...input,
    id: input.id ?? createId(),
    ts: input.ts ?? Date.now(),
  };
}
