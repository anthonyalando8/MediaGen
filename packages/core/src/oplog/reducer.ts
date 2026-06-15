// packages/core/src/oplog/reducer.ts
//
// Immutable, path-addressed reducer for the op-log (Deliverable 05.4, §6 of
// the v1.0 doc). All functions are pure: they return a new root object,
// sharing untouched subtrees with the input via shallow cloning along the
// touched path only.
//
// Path convention: RFC6901 JSON Pointers operating on the `Composition`
// object tree, e.g. "/root/0/children/2/transform/position".

import type { Json } from "../types/primitives";
import type { Op } from "./op";

export type PathToken = string;

/** Splits an RFC6901 JSON Pointer into unescaped tokens. "" -> []. */
export function parsePointer(pointer: string): PathToken[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON pointer (must start with "/" or be ""): ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

function cloneContainer<T>(container: T): T {
  if (Array.isArray(container)) return [...container] as unknown as T;
  if (isContainer(container)) return { ...(container as Record<string, unknown>) } as unknown as T;
  throw new Error(`cannot traverse into non-container value: ${JSON.stringify(container)}`);
}

function keyFor(container: unknown, token: PathToken): string | number {
  if (Array.isArray(container)) {
    return token === "-" ? container.length : Number(token);
  }
  return token;
}

/** Reads the value at `pointer` within `root`. Throws if the path doesn't exist. */
export function getAt(root: unknown, tokens: PathToken[]): unknown {
  let cur = root;
  for (const token of tokens) {
    if (!isContainer(cur)) {
      throw new Error(`cannot read token "${token}": parent is not an object/array`);
    }
    const key = keyFor(cur, token);
    cur = Array.isArray(cur) ? (cur as unknown[])[key as number] : (cur as Record<string, unknown>)[key as string];
  }
  return cur;
}

export function getByPointer<T = Json>(root: unknown, pointer: string): T {
  return getAt(root, parsePointer(pointer)) as T;
}

/**
 * Clones along `tokens` (shallow at each step) and invokes `mutate` on the
 * final container with its key, returning the new root. The original `root`
 * and any untouched siblings are left unchanged.
 */
function updateAtPointer<T>(
  root: T,
  tokens: PathToken[],
  mutate: (container: Record<string, unknown> | unknown[], key: string | number) => void
): T {
  if (tokens.length === 0) {
    throw new Error("cannot update the root itself via a pointer (path must be non-empty)");
  }
  const newRoot = cloneContainer(root);
  let parent: Record<string, unknown> | unknown[] = newRoot as unknown as Record<string, unknown> | unknown[];
  for (let i = 0; i < tokens.length - 1; i++) {
    const key = keyFor(parent, tokens[i]);
    const child = Array.isArray(parent) ? parent[key as number] : (parent as Record<string, unknown>)[key as string];
    const clonedChild = cloneContainer(child);
    if (Array.isArray(parent)) {
      parent[key as number] = clonedChild;
    } else {
      (parent as Record<string, unknown>)[key as string] = clonedChild;
    }
    parent = clonedChild as Record<string, unknown> | unknown[];
  }
  const lastKey = keyFor(parent, tokens[tokens.length - 1]);
  mutate(parent, lastKey);
  return newRoot;
}

/** Immutably sets the value at `pointer`, replacing whatever was there. */
export function setByPointer<T>(root: T, pointer: string, value: Json): T {
  return updateAtPointer(root, parsePointer(pointer), (parent, key) => {
    if (Array.isArray(parent)) {
      parent[key as number] = value;
    } else {
      (parent as Record<string, unknown>)[key as string] = value;
    }
  });
}

/**
 * Immutably inserts `value` into the array at `pointer`. The last token is
 * the insertion index ("-" appends). `pointer`'s parent must be an array.
 */
export function insertByPointer<T>(root: T, pointer: string, value: Json): T {
  return updateAtPointer(root, parsePointer(pointer), (parent, key) => {
    if (!Array.isArray(parent)) {
      throw new Error(`insertByPointer requires an array parent at ${pointer}`);
    }
    parent.splice(key as number, 0, value);
  });
}

/** Immutably removes the element at `pointer`, returning the new root and the removed value. */
export function removeByPointer<T>(root: T, pointer: string): { root: T; removed: Json } {
  let removed: Json = null;
  const newRoot = updateAtPointer(root, parsePointer(pointer), (parent, key) => {
    if (Array.isArray(parent)) {
      const idx = key as number;
      removed = (parent[idx] as Json) ?? null;
      parent.splice(idx, 1);
    } else {
      const k = key as string;
      removed = ((parent as Record<string, unknown>)[k] as Json) ?? null;
      delete (parent as Record<string, unknown>)[k];
    }
  });
  return { root: newRoot, removed };
}

// ── move / reparent ─────────────────────────────────────────────────────
//
// Convention: `op.after = { from, to }` are the JSON Pointers used to apply
// THIS op (read+remove the element at `from`, insert it at `to`).
// `op.before = { from: to, to: from }` is the pre-swapped pair that, when
// used the same way, reverts the move. invertOp for move/reparent is then a
// generic before<->after swap (see invertOp below).

interface MovePointers {
  from: string;
  to: string;
}

function applyMoveOp<T>(root: T, op: Op): T {
  const { from, to } = op.after as unknown as MovePointers;
  const { root: afterRemove, removed } = removeByPointer(root, from);
  return insertByPointer(afterRemove, to, removed);
}

// ── group / ungroup ─────────────────────────────────────────────────────
//
// Forward ("group"):
//   path  = pointer to the parent array holding the members being grouped
//   before = { indices: number[] }       — original ascending sibling indices
//   after  = { group: Json; at: number } — the pre-built group node (with its
//            children already populated) and its insertion index into `path`
//
// Inverse ("ungroup"), produced by invertOp:
//   before = { at: number; group: Json } — where the group node sits, and the
//            group node itself (for a further invert back to "group")
//   after  = { indices: number[] }       — where the group's children go when
//            unpacked back into `path`, ascending
//
// The two shapes are distinguished structurally: a forward op has
// `after.group` defined; an inverse (ungroup) op has `before.group` defined.

interface GroupAfter {
  group: Json;
  at: number;
}

interface UngroupBefore {
  at: number;
  group: Json;
}

function isGroupForward(op: Op): boolean {
  const after = op.after as Partial<GroupAfter> | null;
  return !!after && typeof after === "object" && "group" in after;
}

function isUngroup(op: Op): boolean {
  const before = op.before as Partial<UngroupBefore> | null;
  return !!before && typeof before === "object" && "group" in before;
}

function applyGroupOp<T>(root: T, op: Op): T {
  if (isGroupForward(op)) {
    const { indices } = op.before as unknown as { indices: number[] };
    const { group, at } = op.after as unknown as GroupAfter;
    let result = root;
    // Remove members descending so earlier removals don't shift later indices.
    const descending = [...indices].sort((a, b) => b - a);
    for (const idx of descending) {
      result = removeByPointer(result, `${op.path}/${idx}`).root;
    }
    return insertByPointer(result, `${op.path}/${at}`, group);
  }
  if (isUngroup(op)) {
    const { at } = op.before as unknown as UngroupBefore;
    const { indices } = op.after as unknown as { indices: number[] };
    const { root: afterRemove, removed: groupNode } = removeByPointer(root, `${op.path}/${at}`);
    const children = ((groupNode as { children?: Json[] } | null)?.children ?? []) as Json[];
    let result = afterRemove;
    // Insert ascending: each insertion's target index already accounts for
    // the prior insertions (standard "insert N items at final positions").
    const ascending = [...indices].sort((a, b) => a - b);
    for (let i = 0; i < ascending.length; i++) {
      result = insertByPointer(result, `${op.path}/${ascending[i]}`, children[i]);
    }
    return result;
  }
  throw new Error('malformed "group" op: before/after match neither group nor ungroup shape');
}

function invertGroupOp(op: Op): Op {
  if (isGroupForward(op)) {
    const { indices } = op.before as unknown as { indices: number[] };
    const { group, at } = op.after as unknown as GroupAfter;
    return { ...op, before: { at, group } as unknown as Json, after: { indices } as unknown as Json };
  }
  if (isUngroup(op)) {
    const { at, group } = op.before as unknown as UngroupBefore;
    const { indices } = op.after as unknown as { indices: number[] };
    return { ...op, before: { indices } as unknown as Json, after: { group, at } as unknown as Json };
  }
  throw new Error('malformed "group" op: before/after match neither group nor ungroup shape');
}

// ── dispatch ─────────────────────────────────────────────────────────────

/** Applies `op` to `comp`, returning a new Composition. Pure. */
export function applyOp<T>(comp: T, op: Op): T {
  switch (op.type) {
    case "set":
      return setByPointer(comp, op.path, op.after);
    case "add":
      return insertByPointer(comp, op.path, op.after);
    case "remove":
      return removeByPointer(comp, op.path).root;
    case "move":
    case "reparent":
      return applyMoveOp(comp, op);
    case "group":
      return applyGroupOp(comp, op);
    default:
      throw new Error(`unknown op type: ${(op as Op).type}`);
  }
}

/** Returns the inverse of `op`: applying it undoes `op`'s effect. */
export function invertOp(op: Op): Op {
  switch (op.type) {
    case "set":
      return { ...op, before: op.after, after: op.before };
    case "add":
      return { ...op, type: "remove", before: op.after, after: op.before };
    case "remove":
      return { ...op, type: "add", before: op.after, after: op.before };
    case "move":
    case "reparent":
      return { ...op, before: op.after, after: op.before };
    case "group":
      return invertGroupOp(op);
    default:
      throw new Error(`unknown op type: ${(op as Op).type}`);
  }
}
