// apps/editor/src/persistence/scene-import-body-overflow.test.ts
//
// Regression coverage for a real reported bug: a text_over_dimmed beat with
// a long body ("UNKNOWN WORD" / beat_17 from a real generated project)
// rendered its last lines below the visible frame. Root cause: buildBeatGroup's
// body renderer sized its font purely from frame WIDTH (`fs = W * 0.05`) with no
// check against available height below a fixed `bodyTop`.
//
// FIX (see docs/scene-composer-text-fixes.md): the word-synced caption body is
// now fitted by the shared aspect-aware `fitTextToBox` into an explicit bottom
// band (y 0.58–0.90), starting from the `caption` role cap (56px @ min-dim 1080)
// and shrinking to an ABSOLUTE readable floor. Because the size keys off the
// frame's SHORTER side, the base is the same (56) at portrait 1080-wide and
// landscape 1080-tall — the previous width-only base (96 at 1920 wide) is gone.
import { describe, expect, it } from "vitest";
import { compileSceneToProject } from "./scene-import";
import type { SceneDoc } from "./scene-import";

const LONG_BODY =
  "When Elias explained that this building was a library, the visitor looked confused, as the word had no meaning in their modern vocabulary.";

// Caption role cap = round(56 * min(W,H) / 1080). At both 1920x1080 and
// 1080x1920 the shorter side is 1080, so the base caption size is 56.
const CAPTION_BASE = 56;
// Absolute readable floor for captions = round(30 * min(W,H) / 1080) = 30 here.
const CAPTION_FLOOR = 30;

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
    // The last line's baseline-ish y plus its own line height stays within the
    // frame — previously this beat's real data overflowed by well over 100px.
    expect(maxY + fontSize * 1.35).toBeLessThanOrEqual(H + 1); // +1 rounding slack
  });

  it("sizes the body from the caption role cap (min-dim scale), well below the old W*0.05 landscape base", () => {
    const project = compileSceneToProject(landscapeScene(LONG_BODY));
    const words = bodyWordNodes(project);
    const fontSize = Number(words[0].props.fontSize);
    expect(fontSize).toBeLessThanOrEqual(CAPTION_BASE);
    expect(fontSize).toBeLessThan(Math.round(1920 * 0.05)); // old naive base = 96
    expect(fontSize).toBeGreaterThanOrEqual(CAPTION_FLOOR); // never shrinks below the readable floor
  });

  it("a short body that already fits sits at the caption base (56 at min-dim 1080)", () => {
    const project = compileSceneToProject(landscapeScene("A short caption."));
    const words = bodyWordNodes(project);
    const fontSize = Number(words[0].props.fontSize);
    expect(fontSize).toBe(CAPTION_BASE);
  });

  it("portrait orientation renders the body at the SAME caption base as landscape (min-dim keying)", () => {
    const scene = landscapeScene(LONG_BODY);
    scene.width = 1080;
    scene.height = 1920;
    const project = compileSceneToProject(scene);
    const words = bodyWordNodes(project);
    const H = 1920;
    const fontSize = Number(words[0].props.fontSize);
    const maxY = Math.max(...words.map((w) => w.transform.position.y));
    // Portrait has far more height, so a short-to-medium body sits at the base
    // and never overflows.
    expect(fontSize).toBe(CAPTION_BASE);
    expect(maxY + fontSize * 1.35).toBeLessThanOrEqual(H + 1);
  });

  it("a very long (calm_narrative-style) body still stays readable and inside the band", () => {
    const veryLong =
      "The library had stood for three hundred years, and in all that time the townspeople had come and gone, " +
      "borrowing its stories, leaving their own, until the building itself seemed to remember every visitor who had ever passed through its doors.";
    const scene = landscapeScene(veryLong);
    scene.width = 1080;
    scene.height = 1920;
    const project = compileSceneToProject(scene);
    const words = bodyWordNodes(project);
    const H = 1920;
    const fontSize = Number(words[0].props.fontSize);
    const maxY = Math.max(...words.map((w) => w.transform.position.y));
    expect(fontSize).toBeGreaterThanOrEqual(CAPTION_FLOOR);
    expect(maxY + fontSize * 1.35).toBeLessThanOrEqual(H + 1);
  });
});
