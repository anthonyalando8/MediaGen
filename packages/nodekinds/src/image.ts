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
    props: z.object({ fit: FitSchema }),
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
  const assetId = node.source?.assetId;
  const dims = assetId ? ctx.resolveAsset?.(assetId) : undefined;
  const { width: frameW, height: frameH } = ctx.size;

  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return { x: 0, y: 0, width: frameW, height: frameH };
  }

  const scale = Math.min(frameW / dims.width, frameH / dims.height);
  const width = dims.width * scale;
  const height = dims.height * scale;
  return { x: (frameW - width) / 2, y: (frameH - height) / 2, width, height };
}