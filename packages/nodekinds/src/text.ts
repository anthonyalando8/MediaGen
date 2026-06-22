// packages/nodekinds/src/text.ts
import { z } from "zod";
import type { NodeKind } from "core";
import { ColorOKLCHSchema, WHITE, layout } from "./common";

export const AlignSchema = z.enum(["left", "center", "right"]);

/**
 * Text kind. `props.fontSize` and `props.fill` are animatable (Deliverable
 * 10). `render()` emits one RenderNode of SDF glyph runs via `layout()`.
 */
export const textKind: NodeKind = {
  kind: "text",
  displayName: "Text",
  category: "text",
  schema: {
    props: z.object({
      text: z.string(),
      fontFamily: z.string(),
      fontSize: z.number(),
      weight: z.number(),
      align: AlignSchema,
      fill: ColorOKLCHSchema,
      tracking: z.number(),
      lineHeight: z.number(),
    }),
    channels: [
      { path: "props.fontSize", type: "scalar", label: "Size", default: 64 },
      { path: "props.fill", type: "color", label: "Color", default: WHITE },
    ],
    inspector: [
      { path: "props.text", label: "Text", control: "textarea" },
      { path: "props.fontFamily", label: "Font", control: "select" },
      { path: "props.fontSize", label: "Size", control: "number" },
      { path: "props.weight", label: "Weight", control: "number" },
      { path: "props.align", label: "Align", control: "select", options: ["left", "center", "right"] },
      { path: "props.fill", label: "Color", control: "color" },
      { path: "props.tracking", label: "Tracking", control: "number" },
      { path: "props.lineHeight", label: "Line height", control: "number" },
    ],
  },
  defaults: () => ({
    name: "Text",
    props: {
      text: "Text",
      fontFamily: "Inter",
      fontSize: 64,
      weight: 400,
      align: "left",
      fill: WHITE,
      tracking: 0,
      lineHeight: 1.2,
    },
  }),
  render: (node) => [
    {
      id: node.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // placeholder — applyWorld overwrites
      opacity: 1, // placeholder — applyWorld overwrites
      blend: "normal", // placeholder — applyWorld overwrites
      t: "text",
      runs: layout(node.props),
    },
  ],
};