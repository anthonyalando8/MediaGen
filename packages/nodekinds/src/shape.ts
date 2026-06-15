// packages/nodekinds/src/shape.ts
import { z } from "zod";
import type { NodeKind, Scalar } from "core";
import type { ColorOKLCH, ShapeGeom, Stroke } from "contract";
import { ColorOKLCHSchema } from "./common";

export const ShapeTypeSchema = z.enum(["rect", "ellipse", "line"]);

/** Arbitrary default fill — a muted blue accent, easy to spot on a dark canvas. */
const DEFAULT_FILL: ColorOKLCH = { l: 0.6, c: 0.15, h: 250 };

/**
 * Builds the renderer-facing geometry from `props`. `props.shape === "line"`
 * has no `length` field in the shared shape props (Deliverable 10 lists
 * width/height/radius for all shapes) — for a line, `width` is reused as the
 * line's length and `height` is ignored. Path-point channels (arbitrary
 * polylines) are P2.
 */
function geomFromProps(props: Record<string, Scalar>): ShapeGeom {
  const width = Number(props.width ?? 0);
  const height = Number(props.height ?? 0);
  const radius = Number(props.radius ?? 0);
  switch (props.shape) {
    case "ellipse":
      return { kind: "ellipse", width, height };
    case "line":
      return { kind: "line", length: width };
    case "rect":
    default:
      return { kind: "rect", width, height, radius };
  }
}

/**
 * Builds the optional Stroke from `props`. DESIGN NOTE: the blueprint's
 * `stroke{color,width}` is flattened to `strokeColor`/`strokeWidth` here —
 * `Node.props` is `Record<string, Scalar>` (Deliverable 05.3, normative) and
 * `Scalar = string|number|boolean|ColorOKLCH` has no slot for a nested
 * `{color,width}` object. Flattening keeps both independently animatable
 * scalars, addressable as "props.strokeColor"/"props.strokeWidth" if needed
 * later. A stroke is present only when `strokeWidth > 0`.
 */
function strokeFromProps(props: Record<string, Scalar>): Stroke | undefined {
  const width = Number(props.strokeWidth ?? 0);
  if (width <= 0) return undefined;
  const color = (props.strokeColor as ColorOKLCH | undefined) ?? { l: 0, c: 0, h: 0 };
  return { color, width };
}

/**
 * Vector kind. `props.fill` (color) and `props.radius` (scalar) are
 * animatable (Deliverable 10).
 */
export const shapeKind: NodeKind = {
  kind: "shape",
  displayName: "Shape",
  category: "vector",
  schema: {
    props: z.object({
      shape: ShapeTypeSchema,
      width: z.number(),
      height: z.number(),
      radius: z.number(),
      fill: ColorOKLCHSchema,
      strokeColor: ColorOKLCHSchema.optional(),
      strokeWidth: z.number().optional(),
    }),
    channels: [
      { path: "props.fill", type: "color", label: "Fill", default: DEFAULT_FILL },
      { path: "props.radius", type: "scalar", label: "Corner radius", default: 0 },
    ],
    inspector: [
      { path: "props.shape", label: "Shape", control: "select", options: ["rect", "ellipse", "line"] },
      { path: "props.width", label: "Width", control: "number" },
      { path: "props.height", label: "Height", control: "number" },
      { path: "props.radius", label: "Corner radius", control: "number" },
      { path: "props.fill", label: "Fill", control: "color" },
      { path: "props.strokeColor", label: "Stroke color", control: "color" },
      { path: "props.strokeWidth", label: "Stroke width", control: "number" },
    ],
  },
  defaults: () => ({
    name: "Shape",
    props: { shape: "rect", width: 200, height: 200, radius: 0, fill: DEFAULT_FILL },
  }),
  render: (node) => [
    {
      id: node.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // placeholder — applyWorld overwrites
      opacity: 1, // placeholder — applyWorld overwrites
      blend: "normal", // placeholder — applyWorld overwrites
      t: "shape",
      geom: geomFromProps(node.props),
      fill: node.props.fill as ColorOKLCH | undefined,
      stroke: strokeFromProps(node.props),
    },
  ],
};