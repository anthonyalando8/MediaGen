// packages/nodekinds/src/text.ts
import { z } from "zod";
import type { NodeKind } from "core";
import { ColorOKLCHSchema, WHITE, layout } from "./common";

export const AlignSchema = z.enum(["left", "center", "right"]);

const TextSpanSchema = z.object({
  text: z.string(),
  weight: z.number().optional(),
  italic: z.boolean().optional(),
  color: ColorOKLCHSchema.optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  underline: z.boolean().optional(),
});

export const textKind: NodeKind = {
  kind: "text",
  displayName: "Text",
  category: "text",
  schema: {
    props: z.object({
      text: z.string(),
      spans: z.array(TextSpanSchema).optional(),
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
      { path: "props.fontFamily", label: "Font", control: "font" },
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
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      opacity: 1,
      blend: "normal",
      t: "text",
      runs: layout(node.props),
    },
  ],
};