// packages/nodekinds/src/group.ts
import { z } from "zod";
import type { NodeKind } from "core";

/**
 * Container kind. No kind-specific props or channels — universal
 * transform/opacity/blend only. `render()` contributes only the group's own
 * RenderNode; the Evaluator's recursion (evaluate-node.ts) fills `children`
 * by pushing each child's RenderNode(s) into the flat output array, so
 * `children` here always stays `[]` — see the P1 flat-array note in
 * `core/src/evaluator/evaluate-node.ts`.
 */
export const groupKind: NodeKind = {
  kind: "group",
  displayName: "Group",
  category: "container",
  container: true,
  schema: {
    props: z.object({}),
    channels: [],
    // Universal panel only (name, blend, opacity) — no kind-specific fields.
    inspector: [],
  },
  defaults: () => ({ name: "Group", props: {}, children: [] }),
  render: (node) => [
    {
      id: node.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // placeholder — applyWorld overwrites
      opacity: 1, // placeholder — applyWorld overwrites
      blend: "normal", // placeholder — applyWorld overwrites
      t: "group",
      children: [],
    },
  ],
};