// packages/schema/src/schemas.test.ts
import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateProject } from "./migrate";
import { CompositionSchema, NodeSchema, ProjectSchema } from "./schemas";

function sampleNode(overrides: Partial<Parameters<typeof NodeSchema.parse>[0]> = {}) {
  return {
    id: "node_rect_01",
    kind: "shape",
    name: "Rectangle",
    transform: {
      position: { x: 100, y: 200, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0, y: 0 },
    },
    opacity: 1,
    blend: "normal",
    time: { start: 0, duration: 150 },
    origin: "user",
    props: { shape: "rect", width: 200, height: 100, radius: 8 },
    channels: [
      {
        id: "chan_opacity",
        path: "opacity",
        type: "scalar",
        keys: [
          { frame: 0, value: 0, interp: "linear" },
          { frame: 30, value: 1, interp: "bezier", inHandle: [0.25, 1], outHandle: [0.75, 0] },
        ],
      },
    ],
    ...overrides,
  };
}

function sampleComposition() {
  return {
    id: "comp_root",
    name: "Main",
    size: { width: 1080, height: 1920 },
    fps: 30,
    duration: 150,
    root: [sampleNode()],
  };
}

function sampleProject() {
  return {
    id: "proj_01",
    schema: CURRENT_SCHEMA_VERSION,
    name: "Untitled",
    comps: { comp_root: sampleComposition() },
    rootCompId: "comp_root",
    assets: [],
    opLog: [],
  };
}

describe("schemas", () => {
  it("round-trips a node through NodeSchema", () => {
    const result = NodeSchema.safeParse(sampleNode());
    expect(result.success).toBe(true);
  });

  it("round-trips a composition through CompositionSchema", () => {
    const result = CompositionSchema.safeParse(sampleComposition());
    expect(result.success).toBe(true);
  });

  it("round-trips audioTracks through CompositionSchema instead of silently stripping them", () => {
    // Regression test: CompositionSchema didn't declare `audioTracks` at
    // all, and Zod's z.object() strips unrecognized keys by default —
    // audioTracks were written correctly (audio-ops.ts) and saved to
    // localStorage correctly (raw JSON.stringify), but vanished on the
    // very next load, once safeParse() ran. AssetRefSchema never had this
    // gap, which is why the audio ASSET itself always survived while the
    // TRACK placing it on the timeline silently didn't.
    const comp = {
      ...sampleComposition(),
      audioTracks: [
        {
          id: "track_1",
          assetId: "asset_1",
          name: "Voiceover",
          startFrame: 0,
          trimIn: 0,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          loop: false,
          muted: false,
          solo: false,
          lane: 0,
        },
      ],
    };

    const result = CompositionSchema.safeParse(comp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audioTracks).toHaveLength(1);
      expect(result.data.audioTracks?.[0]?.assetId).toBe("asset_1");
    }
  });

  it("round-trips a project through ProjectSchema", () => {
    const result = ProjectSchema.safeParse(sampleProject());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rootCompId).toBe("comp_root");
      expect(result.data.comps.comp_root.root).toHaveLength(1);
    }
  });

  it("rejects a node with an invalid blend mode", () => {
    const result = NodeSchema.safeParse(sampleNode({ blend: "not-a-blend-mode" } as never));
    expect(result.success).toBe(false);
  });

  it("supports nested children via the recursive NodeSchema", () => {
    const group = sampleNode({
      id: "node_group",
      kind: "group",
      props: {},
      channels: [],
      children: [sampleNode({ id: "node_child" })],
    });
    const result = NodeSchema.safeParse(group);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.children?.[0]?.id).toBe("node_child");
    }
  });
});

describe("Phase 2 — effects, masks, mattes, adjustment, transitions, exposed props", () => {
  it("round-trips a node with an effect stack (incl. a keyframed uniform)", () => {
    const node = sampleNode({
      effects: [
        {
          id: "fx_blur_01",
          effect: "blur",
          enabled: true,
          props: { amount: 0 },
          channels: [
            {
              id: "chan_blur_amount",
              path: "fx.fx_blur_01.amount",
              type: "scalar",
              keys: [
                { frame: 0, value: 0, interp: "linear" },
                { frame: 30, value: 20, interp: "linear" },
              ],
            },
          ],
        },
      ],
    });

    const result = NodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.effects?.[0].effect).toBe("blur");
      expect(result.data.effects?.[0].channels?.[0].path).toBe("fx.fx_blur_01.amount");
    }
  });

  it("round-trips a node with a mask (Bezier path, feather, inverted)", () => {
    const node = sampleNode({
      masks: [
        {
          id: "mask_01",
          mode: "add",
          path: {
            closed: true,
            points: [
              { point: { x: 0, y: 0 }, outHandle: { x: 10, y: 0 } },
              { point: { x: 100, y: 0 }, inHandle: { x: -10, y: 0 } },
              { point: { x: 50, y: 100 } },
            ],
          },
          feather: 4,
          opacity: 1,
          inverted: false,
        },
      ],
    });

    const result = NodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.masks?.[0].path.points).toHaveLength(3);
      expect(result.data.masks?.[0].path.points[0].outHandle).toEqual({ x: 10, y: 0 });
    }
  });

  it("round-trips a node with a track matte (all 4 type variants)", () => {
    for (const type of ["alpha", "luma", "alpha-inv", "luma-inv"] as const) {
      const result = NodeSchema.safeParse(sampleNode({ matte: { sourceNodeId: "node_other", type } }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects a track matte with an unknown type", () => {
    const result = NodeSchema.safeParse(sampleNode({ matte: { sourceNodeId: "node_other", type: "chroma" } as never }));
    expect(result.success).toBe(false);
  });

  it("round-trips an adjustment layer flag", () => {
    const result = NodeSchema.safeParse(sampleNode({ isAdjustment: true }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isAdjustment).toBe(true);
  });

  it("round-trips transitionIn/transitionOut", () => {
    const result = NodeSchema.safeParse(
      sampleNode({
        transitionIn: { preset: "slam", durationF: 15, props: { intensity: 0.5 } },
        transitionOut: { preset: "wipe", durationF: 10, props: {} },
      })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transitionIn?.preset).toBe("slam");
      expect(result.data.transitionOut?.preset).toBe("wipe");
    }
  });

  it("round-trips a Composition's exposed prop bindings (precomp instance overrides)", () => {
    const comp = { ...sampleComposition(), exposed: [{ key: "title", label: "Title", target: { nodeId: "node_rect_01", path: "props.text" }, type: "text" as const }] };

    const result = CompositionSchema.safeParse(comp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exposed?.[0].key).toBe("title");
      expect(result.data.exposed?.[0].target).toEqual({ nodeId: "node_rect_01", path: "props.text" });
    }
  });
});

describe("migrate", () => {
  it("passes through a document already at the current version", () => {
    const project = sampleProject();
    const migrated = migrateProject(project);
    expect(migrated.schema).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated).toEqual(project);
  });

  it("throws for a schema version newer than this build supports", () => {
    const project = { ...sampleProject(), schema: "99.0.0" };
    expect(() => migrateProject(project)).toThrowError(/newer than this build supports/);
  });
});

describe("Phase 2 fitness gate (blueprint §12.1) — Phase 1 documents load unmigrated", () => {
  /**
   * A project shaped exactly like a Phase-1-only document: none of the
   * Phase 2 fields (effects/masks/matte/isAdjustment/transitionIn/
   * transitionOut/exposed) are present anywhere, since a real P1 editor
   * session never wrote them. Schema/type changes for Phase 2 fields must
   * stay purely additive (all-optional) — this project must keep loading,
   * unmigrated, at CURRENT_SCHEMA_VERSION ("1.0.0"), forever.
   */
  function p1OnlyProject() {
    return {
      id: "proj_p1",
      schema: "1.0.0",
      name: "Pre-Phase-2 Project",
      comps: {
        comp_root: {
          id: "comp_root",
          name: "Main",
          size: { width: 1080, height: 1920 },
          fps: 30,
          duration: 150,
          root: [
            {
              id: "node_rect",
              kind: "shape",
              name: "Rectangle",
              transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
              opacity: 1,
              blend: "normal",
              time: { start: 0, duration: 150 },
              origin: "user",
              props: { shape: "rect", width: 200, height: 100, radius: 8 },
              channels: [],
            },
          ],
        },
      },
      rootCompId: "comp_root",
      assets: [],
      opLog: [],
    };
  }

  it("a P1-only project (no Phase 2 fields anywhere) parses successfully", () => {
    const result = ProjectSchema.safeParse(p1OnlyProject());
    expect(result.success).toBe(true);
  });

  it("migrateProject passes a P1-only project through unmigrated (still schema 1.0.0)", () => {
    const project = p1OnlyProject();
    const migrated = migrateProject(project);
    expect(migrated.schema).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated).toEqual(project);
  });

  it("a P1-only node round-trips with every Phase 2 field absent (not just empty)", () => {
    const result = NodeSchema.safeParse(p1OnlyProject().comps.comp_root.root[0]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.effects).toBeUndefined();
      expect(result.data.masks).toBeUndefined();
      expect(result.data.matte).toBeUndefined();
      expect(result.data.isAdjustment).toBeUndefined();
      expect(result.data.transitionIn).toBeUndefined();
      expect(result.data.transitionOut).toBeUndefined();
    }
  });
});