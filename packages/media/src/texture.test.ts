// packages/media/src/texture-source.test.ts
import { describe, expect, it } from "vitest";
import { dataUrlToObjectUrl } from "./texture-source";

describe("dataUrlToObjectUrl", () => {
  it("produces a blob: URL preserving the data URL's bytes and MIME type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 250]);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const dataUrl = `data:video/mp4;base64,${btoa(binary)}`;

    const objectUrl = dataUrlToObjectUrl(dataUrl);
    expect(objectUrl).toMatch(/^blob:/);

    const blob = await fetch(objectUrl).then((r) => r.blob());
    expect(blob.type).toBe("video/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);

    URL.revokeObjectURL(objectUrl);
  });
});