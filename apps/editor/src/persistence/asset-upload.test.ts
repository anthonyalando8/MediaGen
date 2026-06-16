// apps/editor/src/persistence/asset-upload.test.ts
import { describe, expect, it } from "vitest";
import { assetKindForFile, fileToAssetRef } from "./asset-upload";

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