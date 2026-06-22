// apps/editor/src/components/kind-icons.tsx
//
// Visual identity for NodeKindIds (Deliverable 09 §9.1 UI pass) — shared by
// LayerPanel, MediaPalette, InspectorPanel, and the timeline so a given kind
// always reads the same way. `NodeKindId` is an open string
// (core/types/node.ts); unknown kinds fall back to `Boxes` / a neutral color
// rather than rendering nothing, so a future NodeKind (gate 12.1's "6th
// NodeKind") still gets an icon + color for free.

// import { Boxes, Group, Image, MousePointer2, Square, Type, Video } from "lucide-react";
// import type { NodeKindId } from "core";

// const KIND_ICONS: Record<string, typeof Square> = {
//   shape: Square,
//   text: Type,
//   group: Group,
//   image: Image,
//   video: Video,
//   null: MousePointer2,
// };

// // Color-coding per kind (UI/UX redesign). Used as the layer/timeline chip
// // fill so the eye can scan kinds at a glance. Adjustment layers override to
// // a distinct hue at the call site (they are `shape` kind under the hood).
// const KIND_COLORS: Record<string, string> = {
//   shape: "#3fae8f",
//   text: "#e0a23a",
//   group: "#8a93a0",
//   image: "#9b8cff",
//   video: "#4aa3f0",
//   null: "#6b7480",
// };

// export const ADJUSTMENT_COLOR = "#f06bb0";

// export function getKindIcon(kind: NodeKindId): typeof Square {
//   return KIND_ICONS[kind] ?? Boxes;
// }

// export function getKindColor(kind: NodeKindId): string {
//   return KIND_COLORS[kind] ?? "#6b7480";
// }


// apps/editor/src/components/kind-icons.tsx
//
// Visual identity for NodeKindIds (Deliverable 09 §9.1 UI pass) — shared by
// LayerPanel, MediaPalette, and InspectorPanel so a given kind always reads
// the same way. `NodeKindId` is an open string (core/types/node.ts); unknown
// kinds fall back to `Boxes` rather than rendering nothing, so a future
// NodeKind (gate 12.1's "6th NodeKind") still gets an icon for free.

import { Boxes, Group, Image, Layers, MousePointer2, Square, Type, Video } from "lucide-react";
import type { NodeKindId } from "core";

const KIND_ICONS: Record<string, typeof Square> = {
  shape: Square,
  text: Type,
  group: Group,
  image: Image,
  video: Video,
  null: MousePointer2,
  comp: Layers,
};

export function getKindIcon(kind: NodeKindId): typeof Square {
  return KIND_ICONS[kind] ?? Boxes;
}

const KIND_COLORS: Record<string, string> = {
  shape: "#6366f1",
  text: "#f59e0b",
  group: "#10b981",
  image: "#3b82f6",
  video: "#8b5cf6",
  null: "#6b7280",
  comp: "#06b6d4",
};

export const ADJUSTMENT_COLOR = "#f97316";

export function getKindColor(kind: NodeKindId): string {
  return KIND_COLORS[kind] ?? "#6b7280";
}