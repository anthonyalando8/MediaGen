// apps/editor/src/commands/add-media.test.ts
import { describe, expect, it } from "vitest";
import { applyOp, createId } from "core";
import type { AssetRef, Node } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { addMediaNode } from "./add-media";

function asset(kind: AssetRef["kind"]): AssetRef {
  return { id: createId(), hash: "deadbeef", kind, master: "blob:fake" };
}

describe("addMediaNode", () => {
  it("adds an 'image' node sourced from an image asset", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    const comp = project.comps[project.rootCompId];
    const imageAsset = asset("image");

    const op = addMediaNode(comp, registry, imageAsset);
    const next = applyOp(comp, op);

    const node = next.root[0] as Node;
    expect(node.kind).toBe("image");
    expect(node.source?.assetId).toBe(imageAsset.id);
  });

  it("adds a 'video' node sourced from a video asset", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    const comp = project.comps[project.rootCompId];
    const videoAsset = asset("video");

    const op = addMediaNode(comp, registry, videoAsset);
    const next = applyOp(comp, op);

    const node = next.root[0] as Node;
    expect(node.kind).toBe("video");
    expect(node.source?.assetId).toBe(videoAsset.id);
  });

  it("throws for unsupported asset kinds", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    const comp = project.comps[project.rootCompId];

    expect(() => addMediaNode(comp, registry, asset("audio"))).toThrow();
  });
});