// apps/api/src/routes/asset.test.ts
import { describe, expect, it } from "vitest";
import { createId } from "core";
import type { AssetRef } from "core";
import { buildApp } from "../index";

function imageAsset(): AssetRef {
  return { id: createId(), hash: "deadbeef", kind: "image", master: "https://example.com/image.png" };
}

describe("asset routes", () => {
  it("POST /assets registers an asset, then GET /assets/:id returns it", async () => {
    const app = buildApp();
    const asset = imageAsset();

    const post = await app.inject({ method: "POST", url: "/assets", payload: asset });
    expect(post.statusCode).toBe(201);
    expect(post.json()).toEqual(asset);

    const get = await app.inject({ method: "GET", url: `/assets/${asset.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(asset);
  });

  it("GET /assets lists registered assets", async () => {
    const app = buildApp();
    const a = imageAsset();
    const b = imageAsset();

    await app.inject({ method: "POST", url: "/assets", payload: a });
    await app.inject({ method: "POST", url: "/assets", payload: b });

    const list = await app.inject({ method: "GET", url: "/assets" });
    expect(list.json()).toHaveLength(2);
  });

  it("GET /assets/:id 404s for an unknown asset", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/assets/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("POST /assets 400s on a schema-invalid body", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/assets", payload: { id: "x", kind: "image" } });
    expect(res.statusCode).toBe(400);
  });
});