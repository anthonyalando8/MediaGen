// packages/nodekinds/src/image.ts
import { z } from "zod";
import type { EvalCtx, Node, NodeKind, Rect } from "core";

export const FitSchema = z.enum(["cover", "contain", "fill"]);
export type Fit = z.infer<typeof FitSchema>;

/**
 * Media kind backed by an image asset. `source.assetId` selects the asset;
 * the renderer's TextureManager (Week 5) resolves `tex` to a Pixi texture.
 */
export const imageKind: NodeKind = {
  kind: "image",
  displayName: "Image",
  category: "media",
  schema: {
    props: z.object({
      fit: FitSchema,
      // scene/3.0: fractional (0..1) sub-region of the frame — see imageBox().
      boxX: z.number().min(0).max(1).optional(),
      boxY: z.number().min(0).max(1).optional(),
      boxW: z.number().min(0).max(1).optional(),
      boxH: z.number().min(0).max(1).optional(),
    }),
    channels: [],
    inspector: [
      { path: "source.assetId", label: "Image", control: "asset" },
      { path: "props.fit", label: "Fit", control: "select", options: ["cover", "contain", "fill"] },
    ],
  },
  defaults: () => ({ name: "Image", props: { fit: "contain" }, source: {} }),
  render: (node, _frame, ctx) => [
    {
      id: node.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // placeholder — applyWorld overwrites
      opacity: 1, // placeholder — applyWorld overwrites
      blend: "normal", // placeholder — applyWorld overwrites
      t: "image",
      tex: { assetId: node.source?.assetId ?? "" },
      fit: (node.props.fit as Fit) ?? "contain",
      box: imageBox(node, ctx),
    },
  ],
  bounds: (node, _frame, ctx) => imageBox(node, ctx),
};

/**
 * The node's `RenderNode.box` — the asset's actual aspect ratio, scaled to
 * fit within the composition's frame and centered (letterboxed/pillarboxed
 * as needed), when `ctx.resolveAsset` knows the asset's native dimensions
 * (asset-upload.ts's `fileToAssetRef` records these at upload time — see
 * `AssetRef`'s doc in project.ts). Falls back to the composition's full
 * frame (the original P1 default) when dimensions aren't known — an asset
 * uploaded before this feature existed, or `ctx.resolveAsset` itself being
 * absent (most core/nodekinds unit tests, which don't care about exact
 * image/video boxes).
 *
 * Shared by `render` (so the Sprite is actually sized/positioned to this —
 * see scene-graph.ts's `updateSprite`) and `bounds` (so <TransformGizmo>'s
 * outline matches what's drawn) — these two must always agree, or the
 * gizmo outline and the visible content diverge (the original P1 bug this
 * function was introduced to fix).
 */
export function imageBox(node: Node, ctx: EvalCtx): Rect {
  const { width: frameW, height: frameH } = ctx.size;

  // scene/3.0 archetypes (split_screen today; PiP later): a node can claim a
  // fractional sub-region of the frame instead of the whole comp via
  // `props.boxX/boxY/boxW/boxH` (0..1 of frame). When present it IS the
  // target box outright — `fit` still crops/covers the asset into it exactly
  // like the full-frame case below, just smaller. Absent (every node before
  // this existed, and every node that doesn't opt in) falls through to the
  // unchanged full-frame behavior.
  const { boxX, boxY, boxW, boxH } = node.props;
  if (typeof boxX === "number" && typeof boxY === "number" && typeof boxW === "number" && typeof boxH === "number") {
    return { x: boxX * frameW, y: boxY * frameH, width: boxW * frameW, height: boxH * frameH };
  }

  const assetId = node.source?.assetId;
  const dims = assetId ? ctx.resolveAsset?.(assetId) : undefined;

  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return { x: 0, y: 0, width: frameW, height: frameH };
  }

  const scale = Math.min(frameW / dims.width, frameH / dims.height);
  const width = dims.width * scale;
  const height = dims.height * scale;
  return { x: (frameW - width) / 2, y: (frameH - height) / 2, width, height };
}