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

import type { Composition, Json, Node } from "core";
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

// ─────────────────────────────────────────────────────────────────────────────
// Rescale-on-resize — the fix for "Frame Size just changes the canvas
// dimensions; every existing node's absolute pixel position/scale stays
// untouched." A scene authored at 3840×2160 and switched to 1920×1080 left
// text ~2x too large and clipped, since nothing about the actual layout
// adapted to the new size.
//
// WHICH NODES GET TOUCHED — this is the load-bearing part, verified against
// the actual render code (packages/nodekinds/src/image.ts, text.ts,
// shape.ts), not assumed:
//
//   - "image"/"video" nodes: NEVER touched. Their on-screen box comes from
//     imageBox() (image.ts:64-89), which reads `ctx.size` — the CURRENT
//     composition size — fresh on every frame, completely independent of
//     any ancestor transform. When the asset's native dimensions aren't
//     known (the common case — stock photos are embedded without them, see
//     scene_export.py's comment on why), it just returns the full current
//     frame. These nodes ALREADY self-adjust perfectly to any resize; an
//     earlier version of this fix scaled their ANCESTOR group, which then
//     got composed on TOP of imageBox's already-correct box by the
//     renderer's ordinary parent*child matrix multiplication — double-
//     applying the resize and producing a shrunk, off-center image.
//   - "group" nodes: their OWN transform/channels are never touched either
//     (they stay exactly as authored — identity position/scale plus
//     whatever relative camera-move/fade animation they already had, which
//     is resolution-independent by nature and doesn't need adjusting). We
//     still recurse into their children, but a group's transform must stay
//     inert here specifically BECAUSE we're rescaling descendants directly
//     rather than relying on ancestor propagation — touching both would
//     double-scale every non-media child.
//   - everything else (text, shape, ...): rescaled directly — their own
//     `transform.position`/`transform.scale` (and matching keyframes) are
//     literal, ancestor-independent pixel/multiplier values (confirmed:
//     text.ts's layout() takes no frame-size input; shape.ts's
//     geomFromProps() reads only literal props.width/height, unaffected by
//     this fix since we scale via transform, not by touching those props
//     directly — scaling a node's own transform.scale already resizes its
//     own rendered geometry through the same matrix math that resizes a
//     group's descendants).
//
// Uniform-scale + letterbox (not independent X/Y stretch) for aspect-ratio
// CHANGES: text/shape content scales by the same factor on both axes and
// centers. Background/video media isn't letterboxed at all — it always
// fills the new frame edge-to-edge on its own (imageBox's existing
// behavior), same as before any of this fix existed.
//
// STABLE REFERENCE (comp.resizeRef) — required, not optional: computing
// `scale = min(newW/oldW, newH/oldH)` from whatever `comp.size` currently
// is compounds across repeated aspect-ratio-changing resizes, because after
// the FIRST letterboxed resize, `comp.size` (the frame) no longer matches
// how big the TEXT content visually is — every later resize computed "how
// much smaller" relative to the frame, not the content, so alternating
// between two aspect ratios a few times shrinks everything toward nothing.
// `resizeRef.baseSize` is captured once (the first time content is ever
// rescaled) and never changes again; `appliedScale/appliedOffsetX/appliedOffsetY`
// record the cumulative transform CURRENTLY baked into non-media nodes,
// relative to that base. Each call here first divides that out, then
// applies the NEW scale/offset computed fresh from `baseSize` — so cycling
// back to a previously-used size returns content to EXACTLY its prior scale
// and position, no matter how many resizes happened in between.
export function rescaleRootOp(comp: Composition, oldW: number, oldH: number, newW: number, newH: number): { rootOp: Op; resizeRefOp: Op } {
  const prevRef = comp.resizeRef ?? { baseSize: { width: oldW, height: oldH }, appliedScale: 1, appliedOffsetX: 0, appliedOffsetY: 0 };
  const { width: baseW, height: baseH } = prevRef.baseSize;

  const newScale = Math.min(newW / baseW, newH / baseH);
  const newOffX  = (newW - baseW * newScale) / 2;
  const newOffY  = (newH - baseH * newScale) / 2;

  // Composed transform: undo prevRef (subtract its offset, divide out its
  // scale), then apply the new one, as a single scale+offset pair.
  const ratio = newScale / prevRef.appliedScale;
  const deltaOffX = newOffX - prevRef.appliedOffsetX * ratio;
  const deltaOffY = newOffY - prevRef.appliedOffsetY * ratio;

  const rescaled = comp.root.map((node) => rescaleTree(node, ratio, deltaOffX, deltaOffY));
  const newRef = { baseSize: prevRef.baseSize, appliedScale: newScale, appliedOffsetX: newOffX, appliedOffsetY: newOffY };

  const txn = createId();
  return {
    rootOp: createOp({
      type: "set", compId: comp.id, path: "/root",
      before: comp.root as unknown as Json,
      after:  rescaled as unknown as Json,
      txn,
    }),
    resizeRefOp: createOp({
      type: "set", compId: comp.id, path: "/resizeRef",
      before: (comp.resizeRef ?? null) as unknown as Json,
      after:  newRef as unknown as Json,
      txn,
    }),
  };
}

/** Recurses through the WHOLE tree (not just top-level), skipping
 * image/video nodes entirely and leaving group nodes' own transform inert
 * — see the module doc above for exactly why each of those matters. */
function rescaleTree(node: Node, scale: number, offX: number, offY: number): Node {
  if (node.kind === "image" || node.kind === "video") {
    return node; // imageBox() self-adjusts to the current comp size already
  }
  const rescaledSelf = node.kind === "group" ? node : rescaleNode(node, scale, offX, offY);
  if (node.children && node.children.length > 0) {
    return { ...rescaledSelf, children: node.children.map((c) => rescaleTree(c, scale, offX, offY)) };
  }
  return rescaledSelf;
}

function rescaleNode(node: Node, scale: number, offX: number, offY: number): Node {
  const t = node.transform;
  const position = { ...t.position, x: offX + t.position.x * scale, y: offY + t.position.y * scale };
  const nodeScale = { ...t.scale, x: t.scale.x * scale, y: t.scale.y * scale };
  const channels = (node.channels ?? []).map((ch) => {
    if (ch.path === "transform.position") {
      return {
        ...ch,
        keys: ch.keys.map((k) => {
          const v = k.value as { x: number; y: number; z?: number };
          return { ...k, value: { ...v, x: offX + v.x * scale, y: offY + v.y * scale } };
        }),
      };
    }
    if (ch.path === "transform.scale") {
      return {
        ...ch,
        keys: ch.keys.map((k) => {
          const v = k.value as { x: number; y: number };
          return { ...k, value: { ...v, x: v.x * scale, y: v.y * scale } };
        }),
      };
    }
    return ch;
  });
  return { ...node, transform: { ...t, position, scale: nodeScale }, channels };
}
