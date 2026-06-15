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
