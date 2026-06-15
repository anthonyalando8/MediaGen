// apps/editor/src/util/path.test.ts
import { describe, expect, it } from "vitest";
import { dottedToPointer, getByPath } from "./path";

describe("getByPath", () => {
  const obj = { transform: { position: { x: 1, y: 2 }, scale: { x: 1, y: 1 } }, props: { width: 100 }, name: "Layer" };

  it("reads a top-level field", () => {
    expect(getByPath(obj, "name")).toBe("Layer");
  });

  it("reads a nested field", () => {
    expect(getByPath(obj, "transform.position.x")).toBe(1);
    expect(getByPath(obj, "props.width")).toBe(100);
  });

  it("returns undefined for a missing field", () => {
    expect(getByPath(obj, "props.strokeColor")).toBeUndefined();
    expect(getByPath(obj, "transform.position.z")).toBeUndefined();
  });

  it("returns undefined when traversing into a non-object", () => {
    expect(getByPath(obj, "name.length")).toBeUndefined();
  });

  it("returns undefined for null/undefined input", () => {
    expect(getByPath(null, "name")).toBeUndefined();
    expect(getByPath(undefined, "name")).toBeUndefined();
  });
});

describe("dottedToPointer", () => {
  it("joins dotted segments with '/'", () => {
    expect(dottedToPointer("transform.position.x")).toBe("transform/position/x");
    expect(dottedToPointer("name")).toBe("name");
  });
});