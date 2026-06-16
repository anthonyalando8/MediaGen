// packages/nodekinds/src/image.ts
import { z } from "zod";
import type { NodeKind, Rect } from "core";

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
      box: imageBox(ctx),
    },
  ],
  bounds: (_node, _frame, ctx) => imageBox(ctx),
};

/**
 * P1 fallback: the composition's full frame, until the TextureManager
 * (Week 5/7) can report the asset's decoded native size for a tighter box.
 * Shared by `render` (so the Sprite is actually sized/positioned to this —
 * see scene-graph.ts's `updateSprite`) and `bounds` (so <TransformGizmo>'s
 * outline matches what's drawn) — previously these two diverged: `bounds`
 * used this same fallback but `render` emitted no box at all, so a sprite
 * rendered at its raw texture pixel size with no relation to the (tiny,
 * frame-sized-but-mispositioned) gizmo outline.
 */
export function imageBox(ctx: { size: { width: number; height: number } }): Rect {
  return { x: 0, y: 0, width: ctx.size.width, height: ctx.size.height };
}