// apps/editor/src/commands/convert-to-path.ts
//
// "Convert to path" — bakes a rect or ellipse into a polygon ShapeGeom
// so individual anchor points can be edited. The result is semantically
// identical to the original shape but stored as bezier points.
//
// Rect → 4 corner anchors, no handles (straight edges).
//   Optional radius → corner handles approximated as 0.552 * radius
//   (the standard cubic bezier circle approximation constant).
//
// Ellipse → 4 anchors at N/E/S/W with handles that approximate the
//   ellipse via cubic beziers (k = 0.5523 * radius).

import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import { findNodeIndex } from "./find-node-index";

/** Cubic bezier approximation constant for a quarter circle. */
const K = 0.5523;

interface BPoint {
  point: { x: number; y: number };
  inHandle?: { x: number; y: number };
  outHandle?: { x: number; y: number };
}

function rectToPoints(width: number, height: number, radius: number): BPoint[] {
  if (radius <= 0) {
    return [
      { point: { x: 0,     y: 0      } },
      { point: { x: width, y: 0      } },
      { point: { x: width, y: height } },
      { point: { x: 0,     y: height } },
    ];
  }

  const r = Math.min(radius, width / 2, height / 2);
  const k = K * r;

  // 8 anchor points — two per corner (start and end of the rounded arc),
  // with handles pulling toward the arc centre
  return [
    // Top edge — left to right
    { point: { x: r,         y: 0          }, outHandle: { x:  k,  y:  0 } },
    { point: { x: width - r, y: 0          }, inHandle:  { x: -k,  y:  0 }, outHandle: { x: k,  y: 0   } },
    // Top-right corner
    { point: { x: width,     y: r          }, inHandle:  { x:  0,  y: -k }, outHandle: { x: 0,  y: k   } },
    // Right edge
    { point: { x: width,     y: height - r }, inHandle:  { x:  0,  y: -k }, outHandle: { x: 0,  y: k   } },
    // Bottom-right corner
    { point: { x: width - r, y: height     }, inHandle:  { x:  k,  y:  0 }, outHandle: { x: -k, y: 0   } },
    // Bottom edge
    { point: { x: r,         y: height     }, inHandle:  { x:  k,  y:  0 }, outHandle: { x: -k, y: 0   } },
    // Bottom-left corner
    { point: { x: 0,         y: height - r }, inHandle:  { x:  0,  y:  k }, outHandle: { x: 0,  y: -k  } },
    // Left edge
    { point: { x: 0,         y: r          }, inHandle:  { x:  0,  y:  k }, outHandle: { x: 0,  y: -k  } },
  ];
}

function ellipseToPoints(width: number, height: number): BPoint[] {
  const rx = width / 2;
  const ry = height / 2;
  const kx = K * rx;
  const ky = K * ry;
  const cx = rx, cy = ry;
  return [
    // Top
    { point: { x: cx,      y: 0      }, inHandle: { x: -kx, y: 0   }, outHandle: { x: kx,  y: 0  } },
    // Right
    { point: { x: cx + rx, y: cy     }, inHandle: { x: 0,   y: -ky }, outHandle: { x: 0,   y: ky } },
    // Bottom
    { point: { x: cx,      y: cy * 2 }, inHandle: { x: kx,  y: 0   }, outHandle: { x: -kx, y: 0  } },
    // Left
    { point: { x: 0,       y: cy     }, inHandle: { x: 0,   y: ky  }, outHandle: { x: 0,   y: -ky} },
  ];
}

/**
 * Converts any parametric shape to a polygon path for node editing.
 * Reads the current rendered geometry and extracts its points.
 */
export function convertToPathOp(comp: Composition, nodeId: Id): Op | null {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  const shape = node.props.shape as string;
  if (shape === "polygon") return null;
  if (shape === "line") return null;

  const width  = Number(node.props.width  ?? 200);
  const height = Number(node.props.height ?? 200);
  const radius = Number(node.props.radius ?? 0);
  const cx = width / 2, cy = height / 2;

  let points: BPoint[];

  if (shape === "ellipse") {
    points = ellipseToPoints(width, height);
  } else if (shape === "rect") {
    points = rectToPoints(width, height, radius);
  } else {
    // For generated polygon shapes (triangle, diamond, star, ngon, arrow)
    // we need to import and call the same generators.
    // Instead, re-derive via the shape NodeKind's geomFromProps output.
    // We dynamically import nodekinds to avoid circular deps.
    // Simpler: just call the same math inline.
    points = parametricToPoints(shape, node.props as Record<string, number | string | boolean>);
  }

  const before = node.props as unknown as Json;
  const after = {
    ...(node.props as object),
    shape: "polygon",
    pathPoints: points,
    pathClosed: true,
  } as unknown as Json;

  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/props`,
    before,
    after,
    txn: createId(),
  });
}

function parametricToPoints(shape: string, props: Record<string, number | string | boolean>): BPoint[] {
  const width  = Number(props.width  ?? 200);
  const height = Number(props.height ?? 200);
  const cx = width / 2, cy = height / 2;

  function ngon(sides: number): BPoint[] {
    return Array.from({ length: sides }, (_, i) => {
      const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
      return { point: { x: cx + cx * Math.cos(a), y: cy + cy * Math.sin(a) } };
    });
  }

  switch (shape) {
    case "triangle": return ngon(3);
    case "diamond":  return ngon(4);
    case "ngon": {
      const sides = Math.max(3, Math.round(Number(props.sides ?? 6)));
      return ngon(sides);
    }
    case "star": {
      const starPts    = Math.max(3, Math.round(Number(props.points ?? 5)));
      const innerRatio = Math.max(0.1, Math.min(0.9, Number(props.innerRatio ?? 0.45)));
      const pts: BPoint[] = [];
      for (let i = 0; i < starPts * 2; i++) {
        const a = -Math.PI / 2 + (i / (starPts * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? 1 : innerRatio;
        pts.push({ point: { x: cx + cx * r * Math.cos(a), y: cy + cy * r * Math.sin(a) } });
      }
      return pts;
    }
    case "arrow": {
      const hr = Math.max(0.1, Math.min(0.9, Number(props.headRatio ?? 0.35)));
      const sr = Math.max(0.1, Math.min(0.9, Number(props.shaftRatio ?? 0.45)));
      const hx = width * hr;
      const sy = height * (1 - sr) / 2;
      return [
        { point: { x: 0,       y: sy         } },
        { point: { x: width-hx,y: sy         } },
        { point: { x: width-hx,y: 0          } },
        { point: { x: width,   y: height / 2 } },
        { point: { x: width-hx,y: height     } },
        { point: { x: width-hx,y: height-sy  } },
        { point: { x: 0,       y: height-sy  } },
      ];
    }
    default: return [];
  }
}