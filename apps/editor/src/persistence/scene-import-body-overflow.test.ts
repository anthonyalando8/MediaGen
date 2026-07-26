// apps/editor/src/persistence/scene-import-body-overflow.test.ts
//
// Regression coverage for a real reported bug: a text_over_dimmed beat with
// a long body ("UNKNOWN WORD" / beat_17 from a real generated project,
// C:\Users\Anthony Omukuyia\Downloads\Scene_031_e0326e9d.seabytes) rendered
// its last lines below the visible frame. Root cause: buildBeatGroup's body
// renderer (the word-synced captions path text_over_dimmed uses — a
// SEPARATE code path from layerTextNodes/fitWrappedLines, which only covers
// quote_card/title_card/stat_callout/kinetic_type) sized its font purely
// from frame WIDTH (`fs = W * 0.05`) with no check against how much height
// was actually available below the fixed `bodyTop` (0.6 * H). The overflow
// is proportional to frame size, not resolution-dependent on its own — the
// same relative clipping happens at any export resolution sharing the
// composition's aspect ratio.
import { describe, expect, it } from "vitest";
import { compileSceneToProject } from "./scene-import";
import type { SceneDoc } from "./scene-import";

const LONG_BODY =
  "When Elias explained that this building was a library, the visitor looked confused, as the word had no meaning in their modern vocabulary.";

function landscapeScene(body: string): SceneDoc {
  return {
    video_id: "test", schema: "scene/2.0", fps: 30, width: 1920, height: 1080,
    brand: "SeaBytes",
    assets: [
      { id: "img_0", kind: "image", url: "data:image/png;base64,AAAA" },
      { id: "vo_0", kind: "audio", url: "data:audio/wav;base64,AAAA" },
    ],
    beats: [
      {
        id: "beat_17", archetype: "text_over_dimmed", keyword: "UNKNOWN WORD",
        hud_tag: "// INSIGHT", body, duration_ms: 6000, layout: "left",
        visual: { asset_id: "img_0", fit: "cover" },
        audio: { asset_id: "vo_0" },
      },
    ],
  } as unknown as SceneDoc;
}

function bodyWordNodes(project: ReturnType<typeof compileSceneToProject>) {
  const comp = project.comps[project.rootCompId];
  const beatGroup = comp.root.find((n) => n.name?.startsWith("Beat 1"));
  const words = (beatGroup?.children ?? []).filter(
    (n) => n.kind === "text" && n.name?.includes(" · ") && !n.name.includes("hud") && !n.name.includes("keyword") && !n.name.includes("brand")
  );
  return words as unknown as Array<{ transform: { position: { y: number } }; props: Record<string, unknown> }>;
}

describe("buildBeatGroup — long body text height overflow", () => {
  it("reproduces beat_17 ('UNKNOWN WORD', 1920x1080 landscape): no word renders below the visible frame", () => {
    const project = compileSceneToProject(landscapeScene(LONG_BODY));
    const words = bodyWordNodes(project);
    expect(words.length).toBeGreaterThan(0);

    const H = 1080;
    const maxY = Math.max(...words.map((w) => w.transform.position.y));
    const fontSize = Number(words[0].props.fontSize);
    // The last line's baseline-ish y plus its own line height should stay
    // within the frame — previously this beat's real data overflowed by
    // well over 100px at the fixed fs=96 (W*0.05).
    expect(maxY + fontSize * 1.35).toBeLessThanOrEqual(H + 1); // +1 rounding slack
  });

  it("shrinks the font below the naive W*0.05 for a body long enough to otherwise overflow", () => {
    const project = compileSceneToProject(landscapeScene(LONG_BODY));
    const words = bodyWordNodes(project);
    const fontSize = Number(words[0].props.fontSize);
    expect(fontSize).toBeLessThan(Math.round(1920 * 0.05));
  });

  it("a short body that already fits is untouched (byte-for-byte fs, common case)", () => {
    const project = compileSceneToProject(landscapeScene("A short caption."));
    const words = bodyWordNodes(project);
    const fontSize = Number(words[0].props.fontSize);
    expect(fontSize).toBe(Math.round(1920 * 0.05));
  });

  it("portrait orientation (far more available height below bodyTop relative to width) doesn't need to shrink either", () => {
    const scene = landscapeScene(LONG_BODY);
    scene.width = 1080;
    scene.height = 1920;
    const project = compileSceneToProject(scene);
    const words = bodyWordNodes(project);
    const fontSize = Number(words[0].props.fontSize);
    expect(fontSize).toBe(Math.round(1080 * 0.05));
  });
});
