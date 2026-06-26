// packages/nodekinds/src/shape.ts
import { z } from "zod";
import type { NodeKind, Scalar } from "core";
import type { ColorOKLCH, ShapeGeom, Stroke } from "contract";
import { ColorOKLCHSchema } from "./common";

export const ShapeTypeSchema = z.enum([
  "rect", "ellipse", "line", "polygon",
  "triangle", "diamond", "star", "ngon", "arrow",
]);

const DEFAULT_FILL: ColorOKLCH = { l: 0.6, c: 0.15, h: 250 };

// ── Polygon generators ────────────────────────────────────────────────────

type Pt = { point: { x: number; y: number } };

/** Regular n-gon centered in (width × height), with optional inner radius for star. */
function regularNgon(cx: number, cy: number, rx: number, ry: number, sides: number, offsetAngle = -Math.PI / 2): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = offsetAngle + (i / sides) * Math.PI * 2;
    return { point: { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) } };
  });
}

/** Star: alternates outer/inner radius. */
function starPoints(cx: number, cy: number, rx: number, ry: number, points: number, innerRatio: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : innerRatio;
    pts.push({ point: { x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) } });
  }
  return pts;
}

/** Right-pointing arrow. headRatio = fraction of width that is the arrowhead. */
function arrowPoints(w: number, h: number, headRatio: number, shaftRatio: number): Pt[] {
  const hx = w * headRatio;
  const sy = h * (1 - shaftRatio) / 2;
  return [
    { point: { x: 0,    y: sy      } },
    { point: { x: w-hx, y: sy      } },
    { point: { x: w-hx, y: 0       } },
    { point: { x: w,    y: h / 2   } },
    { point: { x: w-hx, y: h       } },
    { point: { x: w-hx, y: h - sy  } },
    { point: { x: 0,    y: h - sy  } },
  ];
}

// ── geomFromProps ─────────────────────────────────────────────────────────

function geomFromProps(props: Record<string, Scalar>): ShapeGeom {
  const width  = Number(props.width  ?? 200);
  const height = Number(props.height ?? 200);
  const radius = Number(props.radius ?? 0);
  const cx = width / 2, cy = height / 2;

  switch (props.shape) {
    case "ellipse":
      return { kind: "ellipse", width, height };

    case "line":
      return { kind: "line", length: width };

    case "polygon": {
      type PolygonGeom = Extract<ShapeGeom, { kind: "polygon" }>;
      const raw = props.pathPoints as unknown;
      const pts = Array.isArray(raw) ? raw as PolygonGeom["points"] : [];
      const closed = (props.pathClosed as unknown as boolean | undefined) ?? true;
      return { kind: "polygon", points: pts, closed };
    }

    case "triangle":
      return {
        kind: "polygon", closed: true,
        points: regularNgon(cx, cy, cx, cy, 3, -Math.PI / 2),
      };

    case "diamond":
      return {
        kind: "polygon", closed: true,
        points: regularNgon(cx, cy, cx, cy, 4, 0),
      };

    case "ngon": {
      const sides = Math.max(3, Math.round(Number(props.sides ?? 6)));
      return {
        kind: "polygon", closed: true,
        points: regularNgon(cx, cy, cx, cy, sides, -Math.PI / 2),
      };
    }

    case "star": {
      const starPts   = Math.max(3, Math.round(Number(props.points  ?? 5)));
      const innerRatio = Math.max(0.1, Math.min(0.9, Number(props.innerRatio ?? 0.45)));
      return {
        kind: "polygon", closed: true,
        points: starPoints(cx, cy, cx, cy, starPts, innerRatio),
      };
    }

    case "arrow": {
      const headRatio  = Math.max(0.1, Math.min(0.9, Number(props.headRatio  ?? 0.35)));
      const shaftRatio = Math.max(0.1, Math.min(0.9, Number(props.shaftRatio ?? 0.45)));
      return {
        kind: "polygon", closed: true,
        points: arrowPoints(width, height, headRatio, shaftRatio),
      };
    }

    case "rect":
    default:
      return { kind: "rect", width, height, radius };
  }
}

// ── strokeFromProps ───────────────────────────────────────────────────────

function strokeFromProps(props: Record<string, Scalar>): Stroke | undefined {
  const width = Number(props.strokeWidth ?? 0);
  if (width <= 0) return undefined;
  const color = (props.strokeColor as ColorOKLCH | undefined) ?? { l: 0, c: 0, h: 0 };
  return { color, width };
}

// ── NodeKind ──────────────────────────────────────────────────────────────

export const shapeKind: NodeKind = {
  kind: "shape",
  displayName: "Shape",
  category: "vector",
  schema: {
    props: z.object({
      shape:       ShapeTypeSchema,
      width:       z.number(),
      height:      z.number(),
      radius:      z.number(),
      fill:        ColorOKLCHSchema,
      strokeColor: ColorOKLCHSchema.optional(),
      strokeWidth: z.number().optional(),
      // ngon
      sides:       z.number().optional(),
      // star
      points:      z.number().optional(),
      innerRatio:  z.number().optional(),
      // arrow
      headRatio:   z.number().optional(),
      shaftRatio:  z.number().optional(),
      // polygon path
      pathPoints:  z.unknown().optional(),
      pathClosed:  z.boolean().optional(),
    }),
    channels: [
      { path: "props.fill",   type: "color",  label: "Fill",          default: DEFAULT_FILL },
      { path: "props.radius", type: "scalar", label: "Corner radius",  default: 0 },
    ],
    inspector: [
      // Shape picker rendered specially via ShapePicker component (control: "shape")
      { path: "props.shape",       label: "Shape",        control: "shape" as never },
      { path: "props.width",       label: "Width",        control: "number" },
      { path: "props.height",      label: "Height",       control: "number" },
      { path: "props.radius",      label: "Corner radius",control: "number" },
      { path: "props.sides",       label: "Sides",        control: "number" },
      { path: "props.points",      label: "Points",       control: "number" },
      { path: "props.innerRatio",  label: "Inner ratio",  control: "number" },
      { path: "props.headRatio",   label: "Head ratio",   control: "number" },
      { path: "props.shaftRatio",  label: "Shaft ratio",  control: "number" },
      { path: "props.fill",        label: "Fill",         control: "color" },
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
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: geomFromProps(node.props),
      fill: node.props.fill as ColorOKLCH | undefined,
      stroke: strokeFromProps(node.props),
    },
  ],
};