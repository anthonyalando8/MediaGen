// apps/editor/src/e2e/evaluator-purity.test.ts
//
// Deliverable 12.1, gate 4: "evaluateComposition is pure: identical input ->
// deep-equal output (property test)." Builds a composition containing one
// of each of the 5 builtin kinds (plus a write to a transform channel,
// exercising sample-channels.ts), then for a spread of frames across the
// timeline checks that (a) calling `evaluateComposition` twice with the
// same `(comp, frame, registry)` produces deep-equal `RenderTree`s, and (b)
// the input `Composition` is never mutated.

import { describe, expect, it } from "vitest";
import { applyOp, evaluateComposition, toFrame } from "core";
import type { Composition } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "../commands/add-node";
import { setNodeProp } from "../commands/set-node-prop";

const BUILTIN_KINDS = ["group", "image", "video", "text", "shape"] as const;
const FRAMES = [0, 1, 30, 75, 149];

function buildFixtureComp(): Composition {
  const registry = createRegistry();
  const project = createBlankProject();
  let comp = project.comps[project.rootCompId];

  for (const kind of BUILTIN_KINDS) {
    comp = applyOp(comp, appendNodeOp(comp, registry, kind));
  }

  // Touch a transform field on the shape node so evaluation exercises
  // sample-channels.ts/interpolate.ts's static-value path too (Week 6's
  // opacity-scrub precedent).
  const shapeId = comp.root.find((n) => n.kind === "shape")!.id;
  comp = applyOp(comp, setNodeProp(comp, shapeId, "transform.scale.x", 1.5));

  return comp;
}

describe("12.1: evaluateComposition is pure", () => {
  it("identical (comp, frame, registry) -> deep-equal RenderTree, across multiple frames and all 5 builtin kinds", () => {
    const registry = createRegistry();
    const comp = buildFixtureComp();

    for (const frame of FRAMES) {
      const a = evaluateComposition(comp, toFrame(frame), registry);
      const b = evaluateComposition(comp, toFrame(frame), registry);
      expect(a).toEqual(b);
    }
  });

  it("does not mutate the input Composition", () => {
    const registry = createRegistry();
    const comp = buildFixtureComp();
    const before = JSON.parse(JSON.stringify(comp));

    for (const frame of FRAMES) {
      evaluateComposition(comp, toFrame(frame), registry);
    }

    expect(JSON.parse(JSON.stringify(comp))).toEqual(before);
  });
});