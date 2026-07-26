// apps/editor/src/persistence/scene-import-layer-text.test.ts
//
// Coverage for the scene/3.0 layer archetypes' text sizing/placement
// (buildBeatGroupFromLayers), per docs/scene-composer-text-fixes.md:
//   • kinetic_type / quote_card: a long body no longer renders as a hero-sized
//     blob — it's capped (heroSub / body role) and shrinks to fit a centered
//     box ≤ MAX_BLOCK_H of the frame height.
//   • stat_callout / poster_card: the two text blocks are stacked by MEASURED
//     height, so the hero/headline block never overlaps the label/subtext.
import { describe, expect, it } from "vitest";
import { compileSceneToProject } from "./scene-import";
import type { SceneDoc } from "./scene-import";

const TYPE_BASE = 1080;
const px = (ref: number, W: number, H: number) => Math.round((ref * Math.min(W, H)) / TYPE_BASE);
const MAX_BLOCK_H = 0.62;

const LONG =
  "You were never the problem and you never will be, not then and not now, and not for a single moment in between.";

function scene(beat: Record<string, unknown>, W = 1080, H = 1920): SceneDoc {
  return {
    video_id: "t", schema: "scene/2.0", fps: 30, width: W, height: H, brand: "SeaBytes",
    assets: [],
    beats: [{ id: "beat_1", duration_ms: 5000, layout: "center", ...beat }],
  } as unknown as SceneDoc;
}

function beatChildren(project: ReturnType<typeof compileSceneToProject>) {
  const comp = project.comps[project.rootCompId];
  const group = comp.root.find((n) => n.name?.startsWith("Beat 1"));
  return (group?.children ?? []) as unknown as Array<{
    kind: string; name?: string; transform: { position: { y: number } }; props: Record<string, unknown>;
  }>;
}
const textNodes = (children: ReturnType<typeof beatChildren>, match: string) =>
  children.filter((n) => n.kind === "text" && n.name?.includes(match) && !n.name.includes("brand"));

describe("layer archetypes — text sizing", () => {
  it("kinetic_type: a long body is capped at heroSub and never exceeds the max block height", () => {
    const W = 1080, H = 1920;
    const project = compileSceneToProject(
      scene({ archetype: "kinetic_type", layers: [
        { role: "background", source: {}, in: 0, out: null },
        { role: "text", text: LONG, reveal: "kinetic", size: "hero", in: 0, out: 5000 },
      ] }, W, H),
    );
    const lines = textNodes(beatChildren(project), "kinetic · line");
    expect(lines.length).toBeGreaterThan(0);
    const fs = Number(lines[0].props.fontSize);
    expect(fs).toBeLessThanOrEqual(px(52, W, H)); // heroSub cap, not hero
    const ys = lines.map((n) => n.transform.position.y);
    const blockH = Math.max(...ys) - Math.min(...ys) + fs * 1.2;
    expect(blockH).toBeLessThanOrEqual(H * MAX_BLOCK_H + 2);
  });

  it("quote_card: a long quote is capped at body scale and fits inside the frame", () => {
    const W = 1080, H = 1920;
    const project = compileSceneToProject(
      scene({ archetype: "quote_card", layers: [
        { role: "background", source: {}, in: 0, out: null },
        { role: "text", text: LONG, reveal: "fade", in: 0, out: 5000 },
      ] }, W, H),
    );
    const lines = textNodes(beatChildren(project), "quote · line");
    expect(lines.length).toBeGreaterThan(0);
    const fs = Number(lines[0].props.fontSize);
    expect(fs).toBeLessThanOrEqual(px(50, W, H)); // body cap
    expect(fs).toBeGreaterThanOrEqual(px(26, W, H)); // readable floor
    const maxY = Math.max(...lines.map((n) => n.transform.position.y));
    expect(maxY + fs * 1.3).toBeLessThanOrEqual(H + 1);
  });

  it("poster_card: headline and subtext blocks never overlap (measured stacking)", () => {
    const W = 1080, H = 1920;
    const project = compileSceneToProject(
      scene({ archetype: "poster_card", layers: [
        { role: "background", source: {}, in: 0, out: null },
        { role: "scrim", shape: "rect", opacity: 0.5, in: 0, out: null },
        { role: "text", text: "TRY THIRTY NIGHTS FREE ON US", size: "hero", anchor_y: 0.46, in: 0, out: 5000 },
        { role: "text", text: "If it doesn't work, send it back — no questions asked whatsoever.", size: "normal", anchor_y: 0.58, in: 0, out: 5000 },
      ] }, W, H),
    );
    const children = beatChildren(project);
    const headline = textNodes(children, "· hero");
    const subtext = textNodes(children, "· label");
    expect(headline.length).toBeGreaterThan(0);
    expect(subtext.length).toBeGreaterThan(0);
    const headlineFs = Number(headline[0].props.fontSize);
    const headlineBottom = Math.max(...headline.map((n) => n.transform.position.y)) + headlineFs;
    const subtextTop = Math.min(...subtext.map((n) => n.transform.position.y));
    expect(subtextTop).toBeGreaterThan(headlineBottom); // no overlap
  });

  it("stat_callout: hero figure sits entirely above the label", () => {
    const W = 1080, H = 1920;
    const project = compileSceneToProject(
      scene({ archetype: "stat_callout", layers: [
        { role: "background", source: {}, in: 0, out: null },
        { role: "text", text: "73%", size: "hero", anchor_y: 0.42, in: 0, out: 5000 },
        { role: "text", text: "of readers never finish the article they open on their phone.", size: "normal", anchor_y: 0.62, in: 0, out: 5000 },
      ] }, W, H),
    );
    const children = beatChildren(project);
    const figure = textNodes(children, "· hero");
    const label = textNodes(children, "· label");
    const figureFs = Number(figure[0].props.fontSize);
    const figureBottom = Math.max(...figure.map((n) => n.transform.position.y)) + figureFs;
    const labelTop = Math.min(...label.map((n) => n.transform.position.y));
    expect(labelTop).toBeGreaterThan(figureBottom);
  });

  it("landscape kinetic_type is sized the same as portrait (min-dim keying) and still fits", () => {
    const W = 1920, H = 1080;
    const project = compileSceneToProject(
      scene({ archetype: "kinetic_type", layers: [
        { role: "background", source: {}, in: 0, out: null },
        { role: "text", text: LONG, reveal: "kinetic", size: "hero", in: 0, out: 5000 },
      ] }, W, H),
    );
    const lines = textNodes(beatChildren(project), "kinetic · line");
    const fs = Number(lines[0].props.fontSize);
    expect(fs).toBeLessThanOrEqual(px(52, W, H)); // 52 (min-dim 1080), NOT width-driven 0.10*1920
    const ys = lines.map((n) => n.transform.position.y);
    const blockH = Math.max(...ys) - Math.min(...ys) + fs * 1.2;
    expect(blockH).toBeLessThanOrEqual(H * MAX_BLOCK_H + 2);
  });
});
