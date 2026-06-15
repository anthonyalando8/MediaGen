// apps/editor/src/store/selectors.test.ts
import { describe, expect, it } from "vitest";
import { createId, toFrame } from "core";
import type { Node } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { createEditorStore } from "./index";
import { activeComp, renderTreeAt } from "./selectors";

describe("activeComp", () => {
  it("returns the project's root composition", () => {
    const project = createBlankProject();
    const store = createEditorStore(project);

    const comp = activeComp(store.getState());

    expect(comp.id).toBe(project.rootCompId);
  });
});

describe("renderTreeAt", () => {
  it("blank project renders: an empty RenderTree matching the composition's size", () => {
    const project = createBlankProject();
    const registry = createRegistry();
    const store = createEditorStore(project);

    const tree = renderTreeAt(store.getState(), toFrame(0), registry);

    expect(tree.nodes).toEqual([]);
    expect(tree.size).toEqual(activeComp(store.getState()).size);
  });

  it("playhead scrubs: an animated opacity channel samples differently at different frames", () => {
    const registry = createRegistry();
    const project = createBlankProject();
    const comp = project.comps[project.rootCompId];

    const node: Node = {
      ...registry.create("shape"),
      channels: [
        {
          id: createId(),
          path: "opacity",
          type: "scalar",
          keys: [
            { frame: toFrame(0), value: 0, interp: "linear" },
            { frame: toFrame(30), value: 1, interp: "linear" },
          ],
        },
      ],
    };
    project.comps[project.rootCompId] = { ...comp, root: [node] };

    const store = createEditorStore(project);

    const at0 = renderTreeAt(store.getState(), toFrame(0), registry);
    const at15 = renderTreeAt(store.getState(), toFrame(15), registry);

    expect(at0.nodes).toHaveLength(1);
    expect(at0.nodes[0].opacity).toBe(0);
    expect(at15.nodes[0].opacity).toBeCloseTo(0.5);
    expect(at0.nodes[0].opacity).not.toBe(at15.nodes[0].opacity);
  });
});