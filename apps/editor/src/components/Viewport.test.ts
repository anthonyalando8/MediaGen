// apps/editor/src/components/Viewport.test.ts
import { describe, expect, it } from "vitest";
import { toFrame } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { addNode } from "../commands/add-node";
import { createEditorStore } from "../store";
import { activeComp, renderTreeAt } from "../store/selectors";
import { handleViewportClick } from "./Viewport";

describe("handleViewportClick", () => {
  describe("tool: select", () => {
    it("selects the topmost node hit at the click point", () => {
      const registry = createRegistry();
      const store = createEditorStore(createBlankProject());

      // a 200x200 shape at the default position (0,0) — see shape.ts's defaults.
      let state = store.getState();
      state.apply(addNode(activeComp(state), registry, "shape"));
      state = store.getState();
      const tree = renderTreeAt(state, toFrame(0), registry);

      handleViewportClick(state, registry, tree, { x: 100, y: 100 }); // inside the shape's 0,0-200,200 box

      expect(store.getState().selection).toEqual([activeComp(store.getState()).root[0].id]);
    });

    it("clears the selection when clicking empty canvas", () => {
      const registry = createRegistry();
      const store = createEditorStore(createBlankProject());

      let state = store.getState();
      state.apply(addNode(activeComp(state), registry, "shape"));
      state = store.getState();
      state.select([activeComp(state).root[0].id]);
      state = store.getState();
      const tree = renderTreeAt(state, toFrame(0), registry);

      handleViewportClick(state, registry, tree, { x: 9999, y: 9999 }); // well outside the shape

      expect(store.getState().selection).toEqual([]);
    });

    it("clears the selection when tree is null (e.g. before the first render)", () => {
      const registry = createRegistry();
      const store = createEditorStore(createBlankProject());
      const state = store.getState();

      handleViewportClick(state, registry, null, { x: 0, y: 0 });

      expect(store.getState().selection).toEqual([]);
    });

    it("does not change document.opLog/cursor — selection is Tier 3, not undoable", () => {
      const registry = createRegistry();
      const store = createEditorStore(createBlankProject());

      let state = store.getState();
      state.apply(addNode(activeComp(state), registry, "shape"));
      state = store.getState();
      const tree = renderTreeAt(state, toFrame(0), registry);
      const cursorBefore = state.document.cursor;

      handleViewportClick(state, registry, tree, { x: 100, y: 100 });

      expect(store.getState().document.cursor).toBe(cursorBefore);
    });
  });

  describe("tool: shape", () => {
    it("creates a shape node centered under the click point, selects it, and switches back to select", () => {
      const registry = createRegistry();
      const store = createEditorStore(createBlankProject());
      store.getState().setTool("shape");
      const state = store.getState();

      handleViewportClick(state, registry, null, { x: 500, y: 600 });

      const after = store.getState();
      expect(after.tool).toBe("select");
      const node = activeComp(after).root[0];
      expect(node.kind).toBe("shape");
      // default shape is 200x200 (shape.ts) — centered under (500,600) -> top-left at (400,500).
      expect(node.transform.position).toEqual({ x: 400, y: 500, z: 0 });
      expect(after.selection).toEqual([node.id]);
    });
  });

  describe("tool: text", () => {
    it("creates a text node with the click point as its top-left (insertion point), not centered", () => {
      const registry = createRegistry();
      const store = createEditorStore(createBlankProject());
      store.getState().setTool("text");
      const state = store.getState();

      handleViewportClick(state, registry, null, { x: 300, y: 400 });

      const after = store.getState();
      expect(after.tool).toBe("select");
      const node = activeComp(after).root[0];
      expect(node.kind).toBe("text");
      expect(node.transform.position).toEqual({ x: 300, y: 400, z: 0 });
      expect(after.selection).toEqual([node.id]);
    });

    it("the created node is a real, undoable op (document.cursor advances; undo removes it)", () => {
      const registry = createRegistry();
      const store = createEditorStore(createBlankProject());
      store.getState().setTool("text");
      const state = store.getState();
      const cursorBefore = state.document.cursor;

      handleViewportClick(state, registry, null, { x: 0, y: 0 });

      expect(store.getState().document.cursor).toBe(cursorBefore + 1);
      store.getState().undo();
      expect(activeComp(store.getState()).root).toHaveLength(0);
    });
  });
});