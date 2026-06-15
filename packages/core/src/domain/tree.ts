// packages/core/src/domain/tree.ts
import type { Id } from "../types/ids";
import type { Node } from "../types/node";

export interface WalkEntry {
  node: Node;
  /** null when `node` is a top-level child of `root`. */
  parent: Node | null;
  /** Index within `parent.children` (or `root`, for top-level nodes). */
  index: number;
}

/** Depth-first, pre-order traversal of every node in the tree. */
export function* walk(root: Node[], parent: Node | null = null): Generator<WalkEntry> {
  for (let index = 0; index < root.length; index++) {
    const node = root[index];
    yield { node, parent, index };
    if (node.children) {
      yield* walk(node.children, node);
    }
  }
}

/** Finds a node anywhere in the tree by id. */
export function findNode(root: Node[], id: Id): Node | undefined {
  for (const entry of walk(root)) {
    if (entry.node.id === id) return entry.node;
  }
  return undefined;
}

/**
 * Finds the parent of the node with `id`. Returns `null` if the node is a
 * top-level member of `root`, or `undefined` if no node with `id` exists.
 */
export function findParent(root: Node[], id: Id): Node | null | undefined {
  for (const entry of walk(root)) {
    if (entry.node.id === id) return entry.parent;
  }
  return undefined;
}

/**
 * The z-order index of the node with `id` within its parent's children (or
 * `root`, if top-level). Returns `undefined` if no node with `id` exists.
 */
export function zIndex(root: Node[], id: Id): number | undefined {
  for (const entry of walk(root)) {
    if (entry.node.id === id) return entry.index;
  }
  return undefined;
}
