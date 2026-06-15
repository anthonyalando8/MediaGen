// packages/renderer-webgl/src/textures/manager.test.ts
import { describe, expect, it, vi } from "vitest";
import { Texture, TextureSource as PixiTextureSource } from "pixi.js";
import type { MediaAssetRef, TextureSource as MediaTextureSource } from "media";
import { TextureManager } from "./manager";

/** Lets one full microtask + macrotask turn pass so `load()`'s async chain settles. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeImageSource(id: string, dispose: () => void = () => {}): MediaTextureSource {
  return {
    kind: "image",
    assetId: id,
    width: 10,
    height: 10,
    bitmap: {} as unknown as ImageBitmap,
    dispose,
  };
}

function makeVideoSource(id: string, seek: (frame: number, fps: number) => Promise<void>): MediaTextureSource {
  return {
    kind: "video",
    assetId: id,
    width: 10,
    height: 10,
    element: {} as unknown as HTMLVideoElement,
    seek,
    currentFrame: () => ({}) as unknown as CanvasImageSource,
    dispose: () => {},
  };
}

const makeTexture = () => new Texture({ source: new PixiTextureSource({ width: 10, height: 10 }) });

describe("TextureManager", () => {
  it("returns Texture.EMPTY while loading, then the real texture once resolved", async () => {
    const asset: MediaAssetRef = { id: "a1", kind: "image", url: "blob:a1" };
    const source = makeImageSource("a1");

    const manager = new TextureManager(
      { resolveAsset: () => asset },
      { loadTexture: async () => source, createTexture: makeTexture }
    );

    expect(manager.get({ assetId: "a1" }, 30)).toBe(Texture.EMPTY);

    await flush();

    const texture = manager.get({ assetId: "a1" }, 30);
    expect(texture).not.toBe(Texture.EMPTY);
    expect(texture.width).toBe(10);
  });

  it("evicts the least-recently-used entry once maxEntries is exceeded", async () => {
    const dispose1 = vi.fn();
    const dispose2 = vi.fn();
    const dispose3 = vi.fn();
    const assets: Record<string, MediaAssetRef> = {
      a1: { id: "a1", kind: "image", url: "blob:a1" },
      a2: { id: "a2", kind: "image", url: "blob:a2" },
      a3: { id: "a3", kind: "image", url: "blob:a3" },
    };
    const sources: Record<string, MediaTextureSource> = {
      a1: makeImageSource("a1", dispose1),
      a2: makeImageSource("a2", dispose2),
      a3: makeImageSource("a3", dispose3),
    };

    const manager = new TextureManager(
      { resolveAsset: (id) => assets[id] },
      { maxEntries: 2, loadTexture: async (asset) => sources[asset.id], createTexture: makeTexture }
    );

    // Load a1, then a2 (each allowed to fully settle before the next starts,
    // so cache insertion order — and therefore lastUsed order — is a1 < a2).
    manager.get({ assetId: "a1" }, 30);
    await flush();
    manager.get({ assetId: "a2" }, 30);
    await flush();

    // Cache is now full (maxEntries=2) with a1 the least-recently-used.
    // Loading a3 should evict a1.
    manager.get({ assetId: "a3" }, 30);
    await flush();

    expect(dispose1).toHaveBeenCalledOnce();
    expect(dispose2).not.toHaveBeenCalled();
    expect(dispose3).not.toHaveBeenCalled();
  });

  it("seeks the video source and marks the texture for re-upload on frame change", async () => {
    const asset: MediaAssetRef = { id: "v1", kind: "video", url: "blob:v1" };
    const seek = vi.fn(async () => {});
    const source = makeVideoSource("v1", seek);
    let texture: Texture | undefined;

    const manager = new TextureManager(
      { resolveAsset: () => asset },
      {
        loadTexture: async () => source,
        createTexture: () => {
          texture = makeTexture();
          return texture;
        },
      }
    );

    manager.get({ assetId: "v1", frame: 0 }, 30);
    await flush();

    const updateSpy = vi.spyOn(texture!.source, "update");
    manager.get({ assetId: "v1", frame: 30 }, 30);
    await flush();

    expect(seek).toHaveBeenCalledWith(30, 30);
    expect(updateSpy).toHaveBeenCalled();
  });

  it("destroy() disposes every cached source and destroys every texture", async () => {
    const dispose = vi.fn();
    const asset: MediaAssetRef = { id: "a1", kind: "image", url: "blob:a1" };
    const source = makeImageSource("a1", dispose);
    let texture: Texture | undefined;

    const manager = new TextureManager(
      { resolveAsset: () => asset },
      {
        loadTexture: async () => source,
        createTexture: () => {
          texture = makeTexture();
          return texture;
        },
      }
    );

    manager.get({ assetId: "a1" }, 30);
    await flush();

    manager.destroy();
    expect(dispose).toHaveBeenCalledOnce();
    expect(texture!.destroyed).toBe(true);
  });
});