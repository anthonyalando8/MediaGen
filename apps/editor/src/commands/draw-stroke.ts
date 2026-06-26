// apps/editor/src/commands/draw-stroke.ts
//
// Converts a raw freehand point stream into a smooth bezier polygon node,
// using Ramer-Douglas-Peucker simplification followed by Catmull-Rom → cubic
// bezier conversion for smooth curves through the key points.

import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import type { ColorOKLCH } from "core";

interface Pt { x: number; y: number }

// ── Ramer-Douglas-Peucker ─────────────────────────────────────────────────

function perpendicularDistance(pt: Pt, lineStart: Pt, lineEnd: Pt): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  const t = Math.max(0, Math.min(1, ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / len2));
  return Math.hypot(pt.x - (lineStart.x + t * dx), pt.y - (lineStart.y + t * dy));
}

function rdp(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length < 3) return pts;
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist <= epsilon) return [pts[0], pts[pts.length - 1]];
  return [
    ...rdp(pts.slice(0, maxIdx + 1), epsilon).slice(0, -1),
    ...rdp(pts.slice(maxIdx), epsilon),
  ];
}

// ── Catmull-Rom → cubic bezier ────────────────────────────────────────────
// Converts simplified key points into smooth bezier anchors with handles.

function catmullRomToBezier(pts: Pt[], tension = 0.5): Array<{
  point: Pt;
  inHandle?: Pt;
  outHandle?: Pt;
}> {
  if (pts.length < 2) return pts.map((p) => ({ point: p }));
  const result: Array<{ point: Pt; inHandle?: Pt; outHandle?: Pt }> = [];

  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[Math.min(pts.length - 1, i + 1)];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    // Catmull-Rom tangent for this point
    const inTangent  = i > 0 ? {
      x: (p2.x - p0.x) * tension / 3,
      y: (p2.y - p0.y) * tension / 3,
    } : undefined;
    const outTangent = i < pts.length - 1 ? {
      x: (p2.x - p0.x) * tension / 3,
      y: (p2.y - p0.y) * tension / 3,
    } : undefined;

    result.push({
      point: p1,
      inHandle:  inTangent  ? { x: -inTangent.x,  y: -inTangent.y  } : undefined,
      outHandle: outTangent ? { x:  outTangent.x,  y:  outTangent.y } : undefined,
    });
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────

export interface DrawStrokeOptions {
  /** Screen-space epsilon for RDP simplification. Higher = fewer points. */
  epsilon?: number;
  /** Catmull-Rom tension. 0 = straight lines, 1 = very smooth. */
  tension?: number;
  fill?: ColorOKLCH;
  strokeColor?: ColorOKLCH;
  strokeWidth?: number;
  closed?: boolean;
}

/**
 * Converts a raw point stream (in comp space) into an "add" op that creates
 * a new polygon shape node in the composition.
 */
export function drawStrokeOp(
  comp: Composition,
  rawPts: Pt[],
  opts: DrawStrokeOptions = {}
): Op | null {
  if (rawPts.length < 2) return null;

  const epsilon   = opts.epsilon   ?? 3;
  const tension   = opts.tension   ?? 0.4;
  const closed    = opts.closed    ?? false;
  const strokeW   = opts.strokeWidth ?? 3;
  const strokeCol = opts.strokeColor ?? { l: 0.0, c: 0.0, h: 0 };

  // Simplify
  const simplified = rdp(rawPts, epsilon);
  if (simplified.length < 2) return null;

  // Convert to bezier anchors
  const pathPoints = catmullRomToBezier(simplified, tension);

  // Bounding box — position the node at the centroid, points are relative to it
  const minX = Math.min(...simplified.map((p) => p.x));
  const minY = Math.min(...simplified.map((p) => p.y));
  const maxX = Math.max(...simplified.map((p) => p.x));
  const maxY = Math.max(...simplified.map((p) => p.y));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Shift points to be relative to centroid (node origin)
  const relPoints = pathPoints.map((bp) => ({
    point:     { x: bp.point.x - cx, y: bp.point.y - cy },
    inHandle:  bp.inHandle,
    outHandle: bp.outHandle,
  }));

  const newNode = {
    id: createId(),
    kind: "shape",
    name: "Stroke",
    hidden: false,
    locked: false,
    isAdjustment: false,
    opacity: 1,
    blend: "normal",
    transform: {
      position: { x: cx, y: cy, z: 0 },
      scale:    { x: 1, y: 1 },
      rotation: 0,
      anchor:   { x: 0, y: 0 },
    },
    time: { start: 0, duration: comp.duration },
    channels: [],
    effects: [],
    masks: [],
    props: {
      shape:       "polygon",
      width:       maxX - minX,
      height:      maxY - minY,
      radius:      0,
      fill:        opts.fill ?? null,
      strokeColor: strokeCol,
      strokeWidth: strokeW,
      pathPoints:  relPoints,
      pathClosed:  closed,
    },
  };

  return createOp({
    type: "add",
    compId: comp.id,
    path: `/root/${comp.root.length}`,
    before: null,
    after: newNode as unknown as Json,
    txn: createId(),
  });
}