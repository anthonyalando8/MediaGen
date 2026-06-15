// packages/core/src/registry/registry.test.ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NodeKindRegistry } from "./registry";
import type { NodeKind } from "./node-kind";
import { IDENTITY } from "../evaluator/compose-transform";

const testKind: NodeKind = {
  kind: "test-kind",
  displayName: "Test Kind",
  category: "vector",
  schema: {
    props: z.object({ foo: z.string() }),
    channels: [],
    inspector: [],
  },
  defaults: () => ({ name: "Test Node", props: { foo: "bar" } }),
  render: (node) => [
    {
      id: node.id,
      matrix: IDENTITY,
      opacity: 1,
      blend: "normal",
      t: "shape",
      geom: { kind: "rect", width: 10, height: 10, radius: 0 },
    },
  ],
};

describe("NodeKindRegistry", () => {
  it("registers and retrieves a kind", () => {
    const reg = new NodeKindRegistry();
    reg.register(testKind);
    expect(reg.has("test-kind")).toBe(true);
    expect(reg.get("test-kind")).toBe(testKind);
    expect(reg.list()).toEqual([testKind]);
  });

  it("throws on duplicate registration", () => {
    const reg = new NodeKindRegistry();
    reg.register(testKind);
    expect(() => reg.register(testKind)).toThrowError(/duplicate NodeKind: test-kind/);
  });

  it("throws on unknown kind (fail loud)", () => {
    const reg = new NodeKindRegistry();
    expect(() => reg.get("nope")).toThrowError(/unknown NodeKind: nope/);
    expect(reg.has("nope")).toBe(false);
  });

  it("create() merges baseNode defaults, kind defaults, and a patch", () => {
    const reg = new NodeKindRegistry();
    reg.register(testKind);

    const node = reg.create("test-kind");
    expect(node.kind).toBe("test-kind");
    expect(node.name).toBe("Test Node"); // from kind.defaults()
    expect(node.props).toEqual({ foo: "bar" }); // from kind.defaults()
    expect(node.opacity).toBe(1); // from baseNode()
    expect(node.origin).toBe("user"); // from baseNode()
    expect(typeof node.id).toBe("string");
    expect(node.id.length).toBeGreaterThan(0);

    const patched = reg.create("test-kind", { name: "Custom Name", opacity: 0.5 });
    expect(patched.name).toBe("Custom Name"); // patch wins over kind.defaults()
    expect(patched.opacity).toBe(0.5); // patch wins over baseNode()
    expect(patched.kind).toBe("test-kind"); // kind id always wins, even over patch
  });

  it("create() ids are unique per call", () => {
    const reg = new NodeKindRegistry();
    reg.register(testKind);
    const a = reg.create("test-kind");
    const b = reg.create("test-kind");
    expect(a.id).not.toBe(b.id);
  });

  it("validate() checks node.props against the kind's zod schema", () => {
    const reg = new NodeKindRegistry();
    reg.register(testKind);

    const valid = reg.create("test-kind", { props: { foo: "hello" } });
    expect(reg.validate(valid).success).toBe(true);

    const invalid = reg.create("test-kind", { props: { foo: 123 as unknown as string } });
    expect(reg.validate(invalid).success).toBe(false);
  });
});
