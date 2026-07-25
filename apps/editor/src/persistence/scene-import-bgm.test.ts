// apps/editor/src/persistence/scene-import-bgm.test.ts
//
// Background music compilation (see apps/python/assets/bgm/README.md and
// docs/architecture/phase5-6-longform-ingest-audio.md). `scene.bgm` is
// entirely opt-in server-side — these tests lock in both the "present"
// path (a real looped AudioTrack) and the "absent" path (today's exact
// pre-BGM behavior, unchanged).
import { describe, expect, it } from "vitest";
import { compileSceneToProject } from "./scene-import";
import type { SceneDoc } from "./scene-import";

function baseScene(overrides: Partial<SceneDoc> = {}): SceneDoc {
  return {
    video_id: "test", schema: "scene/2.0", fps: 30, width: 1080, height: 1920,
    brand: "SeaBytes",
    assets: [
      { id: "img_0", kind: "image", url: "data:image/png;base64,AAAA" },
      { id: "vo_0", kind: "audio", url: "data:audio/wav;base64,AAAA" },
      { id: "bgm", kind: "audio", url: "data:audio/wav;base64,BBBB" },
    ],
    beats: [
      {
        id: "beat_0", archetype: "text_over_dimmed", keyword: "KW", body: "Some body text.",
        duration_ms: 3000, layout: "left",
        visual: { asset_id: "img_0", fit: "cover" },
        audio: { asset_id: "vo_0" },
      },
    ],
    ...overrides,
  };
}

describe("compileSceneToProject — background music", () => {
  it("compiles scene.bgm into a looped AudioTrack spanning the whole composition", () => {
    const project = compileSceneToProject(baseScene({ bgm: { asset_id: "bgm", volume: 0.15 } }));
    const comp = project.comps[project.rootCompId];
    const bgmTrack = comp.audioTracks.find((t) => t.name === "Background music");

    expect(bgmTrack).toBeDefined();
    expect(bgmTrack!.assetId).toBe("bgm");
    expect(bgmTrack!.volume).toBe(0.15);
    expect(bgmTrack!.loop).toBe(true);
    expect(bgmTrack!.startFrame).toBe(0);
    expect(bgmTrack!.endFrame).toBe(comp.duration);
    // Separate lane from the per-beat VO tracks so they don't collide in the timeline UI.
    const voTrack = comp.audioTracks.find((t) => t.assetId === "vo_0");
    expect(voTrack!.lane).not.toBe(bgmTrack!.lane);
  });

  it("defaults volume to 0.1 when scene.bgm omits it", () => {
    const project = compileSceneToProject(baseScene({ bgm: { asset_id: "bgm" } }));
    const comp = project.comps[project.rootCompId];
    const bgmTrack = comp.audioTracks.find((t) => t.name === "Background music");
    expect(bgmTrack!.volume).toBe(0.1);
  });

  it("adds no bgm track at all when scene.bgm is absent — back-compat with every scene generated before this feature existed", () => {
    const project = compileSceneToProject(baseScene());
    const comp = project.comps[project.rootCompId];
    expect(comp.audioTracks.find((t) => t.name === "Background music")).toBeUndefined();
    // Only the per-beat VO track should exist.
    expect(comp.audioTracks).toHaveLength(1);
  });

  it("ignores scene.bgm if its asset_id doesn't resolve to a real audio asset (defensive — shouldn't happen from a well-formed server response)", () => {
    const project = compileSceneToProject(baseScene({ bgm: { asset_id: "does_not_exist" } }));
    const comp = project.comps[project.rootCompId];
    expect(comp.audioTracks.find((t) => t.name === "Background music")).toBeUndefined();
  });
});
