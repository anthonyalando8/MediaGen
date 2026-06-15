// apps/editor/src/e2e/exit-criteria.test.ts
//
// Deliverable 12 acceptance criteria, exercised end-to-end through the
// store + commands + selectors (no browser — see the Week 8 ADR note on
// "E2E" in this sandbox). Criterion 06 (group transform moves both
// children) is covered by commands/group-nodes.test.ts; 01/03/05/07 by
// Week 6/7's suites. This file covers 04, 08, 09, and 10.

import { describe, expect, it } from "vitest";
import { createId, toFrame } from "core";
import type { Node } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "../commands/add-node";
import { groupNodes } from "../commands/group-nodes";
import { reorderNode } from "../commands/reorder";
import { setNodeProp } from "../commands/set-node-prop";
import { moveNode } from "../commands/transform-node";
import { loadProject, saveProject } from "../persistence/local-storage";
import type { KeyValueStorage } from "../persistence/local-storage";
import { createEditorStore } from "../store";
import { activeComp, renderTreeAt } from "../store/selectors";

function fakeStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

describe("exit criterion 04: add text and edit content + size via the inspector", () => {
  it("setNodeProp on props.text/props.fontSize re-evaluates to a new GlyphRun", () => {
    const registry = createRegistry();
    const store = createEditorStore(createBlankProject());

    let state = store.getState();
    state.apply(appendNodeOp(activeComp(state), registry, "text"));

    state = store.getState();
    const nodeId = activeComp(state).root[0].id;
    state.apply(setNodeProp(activeComp(state), nodeId, "props.text", "Hello World"));

    state = store.getState();
    state.apply(setNodeProp(activeComp(state), nodeId, "props.fontSize", 96));

    state = store.getState();
    const tree = renderTreeAt(state, toFrame(0), registry);
    const textNode = tree.nodes[0];

    expect(textNode.t).toBe("text");
    if (textNode.t === "text") {
      expect(textNode.runs[0].text).toBe("Hello World");
      expect(textNode.runs[0].fontSize).toBe(96);
    }
  });
});

describe("exit criterion 08: scrubbing the playhead animates a keyframed scale", () => {
  it("a transform.scale vec2 channel samples differently at different frames", () => {
    const registry = createRegistry();
    const project = createBlankProject();
    const comp = project.comps[project.rootCompId];

    const node: Node = {
      ...registry.create("shape"),
      channels: [
        {
          id: createId(),
          path: "transform.scale",
          type: "vec2",
          keys: [
            { frame: toFrame(0), value: { x: 1, y: 1 }, interp: "linear" },
            { frame: toFrame(30), value: { x: 2, y: 2 }, interp: "linear" },
          ],
        },
      ],
    };
    project.comps[project.rootCompId] = { ...comp, root: [node] };
    const store = createEditorStore(project);

    const at0 = renderTreeAt(store.getState(), toFrame(0), registry);
    const at15 = renderTreeAt(store.getState(), toFrame(15), registry);
    const at30 = renderTreeAt(store.getState(), toFrame(30), registry);

    // matrix = [a,b,tx,c,d,ty,0,0,1] — scale.x feeds `a` (rotation=0, anchor=0).
    expect(at0.nodes[0].matrix[0]).toBeCloseTo(1);
    expect(at15.nodes[0].matrix[0]).toBeCloseTo(1.5);
    expect(at30.nodes[0].matrix[0]).toBeCloseTo(2);
    expect(at0.nodes[0].matrix[0]).not.toBe(at30.nodes[0].matrix[0]);
  });
});

describe("exit criterion 09: undo/redo restores the document exactly", () => {
  it("undoing every op restores the original composition; redoing restores the final one", () => {
    const registry = createRegistry();
    const store = createEditorStore(createBlankProject());

    const originalComp = structuredClone(activeComp(store.getState()));

    // 1: add shape
    let state = store.getState();
    state.apply(appendNodeOp(activeComp(state), registry, "shape"));

    // 2: add text
    state = store.getState();
    state.apply(appendNodeOp(activeComp(state), registry, "text"));

    // 3: reorder — move the text node (index 1) to the front
    state = store.getState();
    const [shape, text] = activeComp(state).root;
    state.apply(reorderNode(activeComp(state), text.id, 0));

    // 4: move the shape
    state = store.getState();
    state.apply(moveNode(activeComp(state), shape.id, 10, 20));

    // 5: edit the text's content via the inspector command
    state = store.getState();
    state.apply(setNodeProp(activeComp(state), text.id, "props.text", "Hi"));

    // 6: group both nodes
    state = store.getState();
    state.apply(groupNodes(activeComp(state), registry, [shape.id, text.id]));

    state = store.getState();
    const finalComp = structuredClone(activeComp(state));
    expect(state.document.cursor).toBe(6);

    for (let i = 0; i < 6; i++) store.getState().undo();
    expect(store.getState().document.cursor).toBe(0);
    expect(activeComp(store.getState())).toEqual(originalComp);

    for (let i = 0; i < 6; i++) store.getState().redo();
    expect(store.getState().document.cursor).toBe(6);
    expect(activeComp(store.getState())).toEqual(finalComp);
  });
});

describe("exit criterion 10: reload persists and re-renders identically", () => {
  it("saveProject -> loadProject round-trips the document, and re-evaluation is deep-equal", () => {
    const registry = createRegistry();
    const store = createEditorStore(createBlankProject());

    let state = store.getState();
    state.apply(appendNodeOp(activeComp(state), registry, "shape"));

    state = store.getState();
    const nodeId = activeComp(state).root[0].id;
    state.apply(setNodeProp(activeComp(state), nodeId, "props.fill", { l: 0.7, c: 0.1, h: 200 }));

    state = store.getState();
    const beforeTree = renderTreeAt(state, toFrame(0), registry);

    const storage = fakeStorage();
    saveProject(state.document.project, storage);
    const loaded = loadProject(storage);
    expect(loaded).toEqual(state.document.project);

    const reloadedStore = createEditorStore(loaded!);
    const afterTree = renderTreeAt(reloadedStore.getState(), toFrame(0), registry);

    expect(afterTree).toEqual(beforeTree);
  });
});