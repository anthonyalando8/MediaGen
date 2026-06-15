// packages/core/src/domain/node.ts
import { createId, toFrame } from "../types/ids";
import type { Node } from "../types/node";

/**
 * Universal defaults for a new Node, before a NodeKind's `defaults()` and
 * any caller patch are merged in (see NodeKindRegistry.create). `kind` is
 * left as an empty placeholder — the registry always overwrites it with the
 * requested kind id.
 */
export function baseNode(): Node {
  return {
    id: createId(),
    kind: "",
    name: "Layer",
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0, y: 0 },
    },
    opacity: 1,
    blend: "normal",
    // 5s @ 30fps — a reasonable starting span; callers/commands typically
    // override this to match the composition's fps/duration.
    time: { start: toFrame(0), duration: toFrame(150) },
    origin: "user",
    props: {},
    channels: [],
  };
}
