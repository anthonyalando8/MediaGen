// apps/editor/src/store/document.test.ts
import { describe, expect, it } from "vitest";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { addNode } from "../commands/add-node";
import { createEditorStore } from "./index";
import { activeComp } from "./selectors";

describe("document slice (Tier 1)", () => {
  it("apply() adds a node, advances the cursor, and appends to opLog", () => {
    const registry = createRegistry();
    const store = createEditorStore(createBlankProject());

    const op = addNode(activeComp(store.getState()), registry, "shape");
    store.getState().apply(op);

    const state = store.getState();
    expect(activeComp(state).root).toHaveLength(1);
    expect(activeComp(state).root[0].kind).toBe("shape");
    expect(state.document.opLog).toEqual([op]);
    expect(state.document.cursor).toBe(1);
    expect(state.canUndo()).toBe(true);
    expect(state.canRedo()).toBe(false);
  });

  it("undo() reverts the last op and redo() re-applies it", () => {
    const registry = createRegistry();
    const store = createEditorStore(createBlankProject());

    const op = addNode(activeComp(store.getState()), registry, "shape");
    store.getState().apply(op);

    store.getState().undo();
    let state = store.getState();
    expect(activeComp(state).root).toHaveLength(0);
    expect(state.document.cursor).toBe(0);
    expect(state.canUndo()).toBe(false);
    expect(state.canRedo()).toBe(true);

    store.getState().redo();
    state = store.getState();
    expect(activeComp(state).root).toHaveLength(1);
    expect(state.document.cursor).toBe(1);
    expect(state.canRedo()).toBe(false);
  });

  it("apply() after undo() drops the redo branch", () => {
    const registry = createRegistry();
    const store = createEditorStore(createBlankProject());

    const op1 = addNode(activeComp(store.getState()), registry, "shape");
    store.getState().apply(op1);
    store.getState().undo();

    const op2 = addNode(activeComp(store.getState()), registry, "text");
    store.getState().apply(op2);

    const state = store.getState();
    expect(state.document.opLog).toEqual([op2]);
    expect(state.document.cursor).toBe(1);
    expect(state.canRedo()).toBe(false);
    expect(activeComp(state).root).toHaveLength(1);
    expect(activeComp(state).root[0].kind).toBe("text");
  });

  it("undo()/redo() are no-ops at the ends of the log", () => {
    const store = createEditorStore(createBlankProject());

    store.getState().undo();
    expect(store.getState().document.cursor).toBe(0);

    store.getState().redo();
    expect(store.getState().document.cursor).toBe(0);
  });
});