// apps/editor/src/commands/comp-size-ops.ts
//
// Command for changing a Composition's frame size (resolution). Follows the
// same Op pattern as audio-ops.ts / move-clip-time.ts's setCompDurationOp:
// createOp({ type, compId, path, before, after, txn }). `size` is a top-level
// `{ width, height }` on Composition (consumed by Viewport's fit transform and
// the renderer clip mask), so this is a single set on `/size`.
//
// This is the missing piece behind "the viewport is tied to 1920×1080": there
// was no command to change comp.size, so the resolution was effectively fixed.

import type { Composition, Json } from "core";
import { createId, createOp } from "core";
import type { Op } from "core";

export function setCompSizeOp(comp: Composition, width: number, height: number): Op {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  return createOp({
    type:   "set",
    compId: comp.id,
    path:   "/size",
    before: comp.size as unknown as Json,
    after:  { width: w, height: h } as unknown as Json,
    txn:    createId(),
  });
}
