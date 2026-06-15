// apps/editor/src/persistence/local-storage.test.ts
import { describe, expect, it } from "vitest";
import { createBlankProject } from "../bootstrap/create-project";
import { clearProject, loadProject, saveProject } from "./local-storage";
import type { KeyValueStorage } from "./local-storage";

/** In-memory `Storage`-shaped fake — `localStorage` doesn't exist in vitest's default (non-jsdom) environment. */
function fakeStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

describe("saveProject / loadProject", () => {
  it("round-trips a project", () => {
    const storage = fakeStorage();
    const project = createBlankProject();

    saveProject(project, storage);
    const loaded = loadProject(storage);

    expect(loaded).toEqual(project);
  });

  it("returns undefined when nothing has been saved", () => {
    expect(loadProject(fakeStorage())).toBeUndefined();
  });

  it("returns undefined for corrupt JSON", () => {
    const storage = fakeStorage();
    storage.setItem("seabytes:project", "{not json");
    expect(loadProject(storage)).toBeUndefined();
  });

  it("returns undefined for JSON that fails ProjectSchema", () => {
    const storage = fakeStorage();
    storage.setItem("seabytes:project", JSON.stringify({ id: "p1", name: "missing required fields" }));
    expect(loadProject(storage)).toBeUndefined();
  });

  it("clearProject removes the stored project", () => {
    const storage = fakeStorage();
    const project = createBlankProject();

    saveProject(project, storage);
    clearProject(storage);

    expect(loadProject(storage)).toBeUndefined();
  });

  it("is a no-op when no storage is available (e.g. SSR)", () => {
    expect(() => saveProject(createBlankProject(), undefined)).not.toThrow();
    expect(loadProject(undefined)).toBeUndefined();
  });
});