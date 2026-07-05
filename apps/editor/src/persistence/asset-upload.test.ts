// apps/editor/src/persistence/asset-upload.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetTranscodeError, assetKindForFile, fileToAssetRef, fileToAssetRefViaServerOrLocal, uploadAssetToServer } from "./asset-upload";

describe("assetKindForFile", () => {
  it("maps image/* and video/* MIME types to AssetRef.kind", () => {
    expect(assetKindForFile(new File([], "a.png", { type: "image/png" }))).toBe("image");
    expect(assetKindForFile(new File([], "a.mp4", { type: "video/mp4" }))).toBe("video");
  });

  it("throws for unsupported MIME types", () => {
    expect(() => assetKindForFile(new File([], "a.pdf", { type: "application/pdf" }))).toThrow();
    expect(() => assetKindForFile(new File([], "a"))).toThrow(); // no type at all
  });
});

describe("fileToAssetRef", () => {
  it("builds an AssetRef with a data: URL master that round-trips the file's bytes", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const file = new File([bytes], "tiny.png", { type: "image/png" });

    const asset = await fileToAssetRef(file);

    expect(asset.kind).toBe("image");
    expect(asset.provenance).toBe("upload");
    expect(asset.master).toMatch(/^data:image\/png;base64,/);

    // Decode the data URL and check the bytes round-trip.
    const base64 = asset.master.split(",")[1];
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it("gives each upload a unique id but a deterministic hash for identical content", async () => {
    const file = (): File => new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });

    const a = await fileToAssetRef(file());
    const b = await fileToAssetRef(file());

    expect(a.id).not.toEqual(b.id);
    expect(a.hash).toEqual(b.hash);
  });

  it("accepts an onProgress callback without breaking the no-FileReader fallback (vitest's Node environment)", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const calls: unknown[] = [];

    const asset = await fileToAssetRef(file, (p) => calls.push(p));

    expect(asset.kind).toBe("image");
    // FileReader is unavailable here, so the "reading" stage's progress
    // events don't fire — but "detecting-dimensions" still does, since it's
    // reported unconditionally before detectDimensions() runs.
    expect(calls).toContainEqual({ stage: "detecting-dimensions" });
  });

  it("reports byte-level 'reading' progress via FileReader.onprogress when FileReader is available", async () => {
    // A minimal fake FileReader exercising readAsDataURL's real progress
    // path (readAsDataURL itself isn't exported — this is the only way to
    // cover that branch from outside the module).
    class FakeFileReader {
      onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      error: Error | null = null;
      readAsDataURL(file: File): void {
        this.onprogress?.({ lengthComputable: true, loaded: file.size / 2, total: file.size });
        this.result = "data:image/png;base64,AQID";
        this.onload?.();
      }
    }
    const original = globalThis.FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = FakeFileReader;

    try {
      const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
      const progressFractions: number[] = [];

      const asset = await fileToAssetRef(file, (p) => {
        if (p.stage === "reading") progressFractions.push(p.fraction);
      });

      expect(progressFractions).toEqual([0.5, 1]); // mid-read (50%), then completion (1) on load
      expect(asset.master).toBe("data:image/png;base64,AQID");
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
});

describe("uploadAssetToServer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads, polls, and resolves with the ready AssetRef, with URLs rewritten absolute against apiBaseUrl", async () => {
    const pending = { id: "asset-1", hash: "h", kind: "image", master: "/assets/asset-1/object/master", meta: { status: "pending" } };
    const ready = { ...pending, proxy: "/assets/asset-1/object/proxy", meta: { status: "ready" } };

    let pollCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify(pending), { status: 202 });
      }
      pollCount += 1;
      const body = pollCount < 2 ? pending : ready; // pending on first poll, ready on second — proves it actually polls, not just resolves on the first check
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const progress: string[] = [];
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });

    const result = await uploadAssetToServer(file, { apiBaseUrl: "http://api.local", pollIntervalMs: 1, onProgress: (p) => progress.push(p.stage) });

    expect(result.master).toBe("http://api.local/assets/asset-1/object/master");
    expect(result.proxy).toBe("http://api.local/assets/asset-1/object/proxy");
    expect(pollCount).toBe(2);
    expect(progress).toEqual(["uploading", "transcoding", "ready"]);
  });

  it("throws AssetTranscodeError when the asset ends up failed", async () => {
    const pending = { id: "asset-2", hash: "h", kind: "video", master: "/assets/asset-2/object/master", meta: { status: "pending" } };
    const failed = { ...pending, meta: { status: "failed", error: "ffmpeg exploded" } };

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify(pending), { status: 202 });
      return new Response(JSON.stringify(failed), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1])], "x.mp4", { type: "video/mp4" });

    await expect(uploadAssetToServer(file, { apiBaseUrl: "http://api.local", pollIntervalMs: 1 })).rejects.toThrow(AssetTranscodeError);
    await expect(uploadAssetToServer(file, { apiBaseUrl: "http://api.local", pollIntervalMs: 1 })).rejects.toThrow("ffmpeg exploded");
  });

  it("throws when the initial upload request itself fails", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    await expect(uploadAssetToServer(file, { apiBaseUrl: "http://api.local" })).rejects.toThrow(/upload failed \(500\)/);
  });

  it("throws when polling times out before the asset becomes ready", async () => {
    const pending = { id: "asset-3", hash: "h", kind: "image", master: "/assets/asset-3/object/master", meta: { status: "pending" } };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify(pending), { status: 202 });
      return new Response(JSON.stringify(pending), { status: 200 }); // never becomes ready
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    await expect(uploadAssetToServer(file, { apiBaseUrl: "http://api.local", pollIntervalMs: 1, timeoutMs: 5 })).rejects.toThrow(/timed out/);
  });
});

describe("fileToAssetRefViaServerOrLocal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the local data: URL path when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed"); // simulates no server listening at all
      })
    );

    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const asset = await fileToAssetRefViaServerOrLocal(file, "http://api.local");

    expect(asset.master).toMatch(/^data:image\/png;base64,/);
  });

  it("does not fall back when the backend reachably rejects the upload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad file", { status: 400 })));

    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    await expect(fileToAssetRefViaServerOrLocal(file, "http://api.local")).rejects.toThrow(/upload failed \(400\)/);
  });

  it("does not fall back when the transcode itself fails server-side", async () => {
    const pending = { id: "asset-4", hash: "h", kind: "image", master: "/assets/asset-4/object/master", meta: { status: "pending" } };
    const failed = { ...pending, meta: { status: "failed", error: "bad codec" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(JSON.stringify(pending), { status: 202 });
        return new Response(JSON.stringify(failed), { status: 200 });
      })
    );

    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    await expect(fileToAssetRefViaServerOrLocal(file, "http://api.local")).rejects.toThrow(AssetTranscodeError);
  });

  it("returns the server AssetRef (not a local one) when upload succeeds, with URLs resolved absolute", async () => {
    const pending = { id: "asset-5", hash: "h", kind: "image", master: "/assets/asset-5/object/master", meta: { status: "pending" } };
    const ready = { ...pending, proxy: "/assets/asset-5/object/proxy", meta: { status: "ready" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(JSON.stringify(pending), { status: 202 });
        return new Response(JSON.stringify(ready), { status: 200 });
      })
    );

    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const asset = await fileToAssetRefViaServerOrLocal(file, "http://api.local", undefined);

    expect(asset.id).toBe("asset-5");
    expect(asset.master).toBe("http://api.local/assets/asset-5/object/master");
    expect(asset.proxy).toBe("http://api.local/assets/asset-5/object/proxy");
  });
});