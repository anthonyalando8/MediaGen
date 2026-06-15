// apps/editor/src/commands/add-media.ts
import type { AssetRef, Composition, NodeKindRegistry, Op } from "core";
import { appendNodeOp } from "./add-node";

/**
 * Adds an "image" or "video" node sourced from `asset` — the add-media
 * palette's action (Deliverable 11 Week 7: "add-media palette").
 */
export function addMediaNode(comp: Composition, registry: NodeKindRegistry, asset: AssetRef): Op {
  if (asset.kind !== "image" && asset.kind !== "video") {
    throw new Error(`addMediaNode: unsupported asset kind "${asset.kind}" (expected "image" or "video")`);
  }
  return appendNodeOp(comp, registry, asset.kind, { source: { assetId: asset.id } });
}