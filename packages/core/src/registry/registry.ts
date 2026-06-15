// packages/core/src/registry/registry.ts
//
// A single instance per app, populated at bootstrap (apps/editor/src/
// bootstrap/register-kinds.ts, and again in the render worker). NOT a
// module-level global singleton — that breaks SSR, tests, and the render
// worker. The instance is passed into the Evaluator and the renderer via
// context/injection.
//
// core iterates kinds it has never heard of — this is the open/closed seam
// (Deliverable 12.1: adding a 6th NodeKind requires no edit here).

import type { SafeParseReturnType } from "zod";
import { baseNode } from "../domain/node";
import type { Node, NodeKindId } from "../types/node";
import type { NodeKind } from "./node-kind";

export type SafeParseReturn = SafeParseReturnType<unknown, unknown>;

export class NodeKindRegistry {
  private kinds = new Map<NodeKindId, NodeKind>();

  register(kind: NodeKind): void {
    if (this.kinds.has(kind.kind)) throw new Error(`duplicate NodeKind: ${kind.kind}`);
    this.kinds.set(kind.kind, kind);
  }

  get(id: NodeKindId): NodeKind {
    const k = this.kinds.get(id);
    if (!k) throw new Error(`unknown NodeKind: ${id}`); // fail loud
    return k;
  }

  has(id: NodeKindId): boolean {
    return this.kinds.has(id);
  }

  list(): NodeKind[] {
    return [...this.kinds.values()];
  }

  /** Validates a node's props against its kind's zod schema. */
  validate(node: Node): SafeParseReturn {
    return this.get(node.kind).schema.props.safeParse(node.props);
  }

  /** Seeds a new node of `id`, merged with universal defaults. */
  create(id: NodeKindId, patch?: Partial<Node>): Node {
    return { ...baseNode(), ...this.get(id).defaults(), ...patch, kind: id };
  }
}
