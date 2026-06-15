// apps/editor/src/components/kind-icons.tsx
//
// Visual identity for NodeKindIds (Deliverable 09 §9.1 UI pass) — shared by
// LayerPanel, MediaPalette, and InspectorPanel so a given kind always reads
// the same way. `NodeKindId` is an open string (core/types/node.ts); unknown
// kinds fall back to `Boxes` rather than rendering nothing, so a future
// NodeKind (gate 12.1's "6th NodeKind") still gets an icon for free.

import { Boxes, Group, Image, Square, Type, Video } from "lucide-react";
import type { NodeKindId } from "core";

const KIND_ICONS: Record<string, typeof Square> = {
  shape: Square,
  text: Type,
  group: Group,
  image: Image,
  video: Video,
};

export function getKindIcon(kind: NodeKindId): typeof Square {
  return KIND_ICONS[kind] ?? Boxes;
}