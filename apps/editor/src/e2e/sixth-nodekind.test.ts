// apps/editor/src/e2e/sixth-nodekind.test.ts
//
// Deliverable 12.1, gate 3: "Adding a 6th NodeKind requires no edit to
// core, evaluator, inspector, or store — proven by adding a throwaway
// rect-test kind in a test." `rectTestKind` below is defined entirely
// within this test file — it's registered into a fresh `NodeKindRegistry`
// alongside the 5 builtins and exercised through the exact same
// create -> apply -> evaluate -> inspect pipeline every builtin kind goes
// through, with zero changes to any `packages/core`, `packages/nodekinds`'s
// builtins, `apps/editor/src/inspector/*`, or `apps/editor/src/store/*`
// source files.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IDENTITY, NodeKindRegistry, applyOp, evaluateComposition, toFrame } from "core";
import type { NodeKind } from "core";
import { registerBuiltins } from "nodekinds";
import { createBlankProject } from "../bootstrap/create-project";
import { appendNodeOp } from "../commands/add-node";
import { setNodeProp } from "../commands/set-node-prop";
import { getInspectorFields } from "../inspector/fields";

const rectTestKind: NodeKind = {
  kind: "rect-test",
  displayName: "Rect Test",
  category: "vector",
  schema: {
    props: z.object({ label: z.string(), size: z.number() }),
    channels: [],
    inspector: [
      { path: "props.label", label: "Label", control: "text" },
      { path: "props.size", label: "Size", control: "number" },
    ],
  },
  defaults: () => ({ name: "Rect Test", props: { label: "hello", size: 50 } }),
  render: (node) => [
    {
      id: node.id,
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: Number(node.props.size), height: Number(node.props.size), radius: 0 },
      fill: { l: 0.5, c: 0, h: 0 },
    },
  ],
};

describe("12.1: adding a 6th NodeKind needs no core/evaluator/inspector/store edits", () => {
  it("registers, creates, applies ops, evaluates, and produces inspector fields", () => {
    const registry = new NodeKindRegistry();
    registerBuiltins(registry); // the 5 P1 builtins
    registry.register(rectTestKind); // the 6th, defined entirely in this test

    const project = createBlankProject();
    const comp0 = project.comps[project.rootCompId];

    // create + apply, via the same Op path the store's `apply()` uses
    const comp1 = applyOp(comp0, appendNodeOp(comp0, registry, "rect-test"));
    const node = comp1.root[0];
    expect(node.kind).toBe("rect-test");
    expect(node.props).toEqual({ label: "hello", size: 50 });

    // evaluator: produces a "shape" RenderNode via the generic render() dispatch — no kind-specific branching in core
    const evaluated1 = evaluateComposition(comp1, toFrame(0), registry).nodes;
    expect(evaluated1[0].t).toBe("shape");
    if (evaluated1[0].t === "shape" && evaluated1[0].geom.kind === "rect") {
      expect(evaluated1[0].geom.width).toBe(50);
    }

    // inspector: schema.inspector entries resolve with current values, alongside the universal fields
    const fields = getInspectorFields(node, registry);
    expect(fields.find((f) => f.path === "props.label")).toMatchObject({ control: "text", value: "hello" });
    expect(fields.find((f) => f.path === "props.size")).toMatchObject({ control: "number", value: 50 });

    // commands/set-node-prop.ts: a generic "set" op on the 6th kind's own prop
    const comp2 = applyOp(comp1, setNodeProp(comp1, node.id, "props.size", 120));
    const evaluated2 = evaluateComposition(comp2, toFrame(0), registry).nodes;
    if (evaluated2[0].t === "shape" && evaluated2[0].geom.kind === "rect") {
      expect(evaluated2[0].geom.width).toBe(120);
    }
  });
});