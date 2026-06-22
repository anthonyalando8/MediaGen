
// packages/nodekinds/src/comp.ts
//
// Phase 2 §8 — "comp" NodeKind. Instances another Composition.
//
// Unlike most NodeKinds, comp's actual rendering is NOT done via render()
// here — it's intercepted in evaluate-node.ts (which has access to the
// NodeKindRegistry and all context needed by evalCompNode). render() returns
// an empty placeholder that evaluate-node.ts replaces before it ever reaches
// the renderer. This mirrors group.ts's pattern: group.render() also returns
// a hollow placeholder that the evaluator fills by recursing into children.

import { z } from "zod";
import type { NodeKind } from "core";

export const compKind: NodeKind = {
  kind: "comp",
  displayName: "Composition",
  category: "container",

  schema: {
    props: z.object({}),
    channels: [],
    inspector: [],
  },

  defaults: () => ({ name: "Composition", props: {} }),

  // Placeholder — evaluate-node.ts intercepts kind="comp" before this
  // render() is ever called, delegating to evalCompNode instead.
  render: () => [],

  bounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
};