// packages/nodekinds/src/null.ts
//
// "Null" kind — a transform-only node that renders nothing. Its entire
// purpose is to be a parentId target: parent other nodes to it, move the
// null, and all parented children follow (Phase 2 §4.4 "AE nulls/rigs").
// Unlike "group", a null is NOT a container (no children[] compositing
// scope) — it only contributes a world matrix via the parentId mechanism
// in evaluator/parenting.ts. It renders as a transparent/empty shape so
// the TransformGizmo can still select and manipulate it.

import { z } from "zod";
import type { NodeKind } from "core";

export const nullKind: NodeKind = {
  kind: "null",
  displayName: "Null",
  category: "container",
  schema: {
    props: z.object({}),
    channels: [],
    inspector: [],
  },
  defaults: () => ({ name: "Null", props: {} }),
  // Renders a zero-size transparent rect — invisible in output but
  // selectable via TransformGizmo so the user can reposition it.
  render: (node) => [
    {
      id: node.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      opacity: 0,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 40, height: 40, radius: 0 },
    },
  ],
  bounds: () => ({ x: 0, y: 0, width: 40, height: 40 }),
};