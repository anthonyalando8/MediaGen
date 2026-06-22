// apps/editor/src/inspector/fields.test.ts
import { describe, expect, it } from "vitest";
import { applyOp } from "core";
import { createBlankProject } from "../bootstrap/create-project";
import { createRegistry } from "../bootstrap/register-kinds";
import { appendNodeOp } from "../commands/add-node";
import { COMMON_INSPECTOR_FIELDS, getInspectorFields } from "./fields";

function nodeOfKind(kind: string) {
  const project = createBlankProject();
  const registry = createRegistry();
  const comp0 = project.comps[project.rootCompId];
  const comp = applyOp(comp0, appendNodeOp(comp0, registry, kind));
  return { node: comp.root[0], registry };
}

describe("getInspectorFields", () => {
  it("always includes the common universal fields first", () => {
    const { node, registry } = nodeOfKind("shape");
    const fields = getInspectorFields(node, registry);
    const commonPaths = COMMON_INSPECTOR_FIELDS.map((f) => f.path);
    expect(fields.slice(0, commonPaths.length).map((f) => f.path)).toEqual(commonPaths);
  });

  it("resolves common field values from the node", () => {
    const { node, registry } = nodeOfKind("shape");
    const fields = getInspectorFields(node, registry);

    expect(fields.find((f) => f.path === "name")!.value).toBe(node.name);
    expect(fields.find((f) => f.path === "opacity")!.value).toBe(node.opacity);
    expect(fields.find((f) => f.path === "transform.position.x")!.value).toBe(node.transform.position.x);
    expect(fields.find((f) => f.path === "transform.scale.y")!.value).toBe(node.transform.scale.y);
  });

  it("appends shape's kind-specific inspector fields with resolved values", () => {
    const { node, registry } = nodeOfKind("shape");
    const fields = getInspectorFields(node, registry);

    const width = fields.find((f) => f.path === "props.width")!;
    expect(width.control).toBe("number");
    expect(width.value).toBe(node.props.width);

    const fill = fields.find((f) => f.path === "props.fill")!;
    expect(fill.control).toBe("color");
    expect(fill.value).toEqual(node.props.fill);
  });

  it("appends text's kind-specific inspector fields, including a select with options", () => {
    const { node, registry } = nodeOfKind("text");
    const fields = getInspectorFields(node, registry);

    const text = fields.find((f) => f.path === "props.text")!;
    expect(text.control).toBe("textarea");
    expect(text.value).toBe(node.props.text);

    const align = fields.find((f) => f.path === "props.align")!;
    expect(align.control).toBe("select");
    expect(align.options).toEqual(["left", "center", "right"]);
    expect(align.value).toBe(node.props.align);
  });

  it("appends image's 'asset' control field, resolving an unset source.assetId to undefined", () => {
    const { node, registry } = nodeOfKind("image");
    const fields = getInspectorFields(node, registry);

    const asset = fields.find((f) => f.path === "source.assetId")!;
    expect(asset.control).toBe("asset");
    expect(asset.value).toBeUndefined();

    const fit = fields.find((f) => f.path === "props.fit")!;
    expect(fit.control).toBe("select");
    expect(fit.value).toBe("contain");
  });

  it("group has no kind-specific fields beyond the common ones", () => {
    const { node, registry } = nodeOfKind("group");
    const fields = getInspectorFields(node, registry);
    expect(fields).toHaveLength(COMMON_INSPECTOR_FIELDS.length);
  });
});