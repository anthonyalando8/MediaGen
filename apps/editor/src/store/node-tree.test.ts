// apps/editor/src/store/node-tree.test.ts
import { describe, expect, it } from "vitest";
import { baseNode } from "core";
import type { Node } from "core";
import { collectDescendantIds } from "./node-tree";

function node(id: string, children?: Node[]): Node {
  return { ...baseNode(), id: id as Node["id"], kind: children ? "group" : "shape", children };
}

describe("collectDescendantIds", () => {
  it("returns an empty set for a node with no children", () => {
    expect(collectDescendantIds(node("leaf"))).toEqual(new Set());
  });

  it("returns an empty set for a group with an empty children array", () => {
    expect(collectDescendantIds(node("g", []))).toEqual(new Set());
  });

  it("collects direct children's ids, not the node's own id", () => {
    const group = node("g", [node("a"), node("b")]);
    expect(collectDescendantIds(group)).toEqual(new Set(["a", "b"]));
  });

  it("recurses into nested groups", () => {
    const tree = node("outer", [node("a"), node("inner", [node("b"), node("c")])]);
    expect(collectDescendantIds(tree)).toEqual(new Set(["a", "inner", "b", "c"]));
  });
});