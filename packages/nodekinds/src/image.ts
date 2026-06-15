// packages/nodekinds/src/image.ts
import { z } from "zod";
import type { NodeKind } from "core";

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
  render: (node) => [
    {
      id: node.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // placeholder — applyWorld overwrites
      opacity: 1, // placeholder — applyWorld overwrites
      blend: "normal", // placeholder — applyWorld overwrites
      t: "image",
      tex: { assetId: node.source?.assetId ?? "" },
      fit: (node.props.fit as Fit) ?? "contain",
    },
  ],
  bounds: (_node, _frame, ctx) => ({
    // P1 fallback: the composition's frame, until the TextureManager (Week
    // 5/7) can report the asset's native size for accurate selection bounds.
    x: 0,
    y: 0,
    width: ctx.size.width,
    height: ctx.size.height,
  }),
};