// apps/editor/src/inspector/fields.ts
//
// Schema-driven InspectorPanel (Deliverable 09 §9.1, Week 8): every field
// the panel renders comes from `InspectorField` (path/label/control/options
// — core/registry/node-kind.ts), either universal (COMMON_INSPECTOR_FIELDS,
// below) or kind-specific (`NodeKind.schema.inspector`, populated by each
// nodekind in `packages/nodekinds`). InspectorPanel.tsx never branches on
// `node.kind` — it just renders whatever `getInspectorFields` returns. This
// is also gate 12.1's "6th NodeKind" property: a new kind's
// `schema.inspector` entries show up here for free.

import type { InspectorField, Node, NodeKindRegistry } from "core";
import { getByPath } from "../util/path";

/**
 * Fields shown for every node regardless of kind — `transform`/`opacity`/
 * `blend`/`name` are universal (Deliverable 10). `BlendMode`'s options
 * mirror `contract/src/primitives.ts`'s union.
 */
export const COMMON_INSPECTOR_FIELDS: InspectorField[] = [
  { path: "name", label: "Name", control: "text" },
  { path: "opacity", label: "Opacity", control: "number" },
  {
    path: "blend",
    label: "Blend",
    control: "select",
    options: ["normal", "multiply", "screen", "overlay", "add", "darken", "lighten"],
  },
  { path: "transform.position.x", label: "X", control: "number" },
  { path: "transform.position.y", label: "Y", control: "number" },
  { path: "transform.scale.x", label: "Scale X", control: "number" },
  { path: "transform.scale.y", label: "Scale Y", control: "number" },
  { path: "transform.rotation", label: "Rotation", control: "number" },
];

export interface InspectorFieldValue extends InspectorField {
  /** `node`'s current value at `path` — `undefined` if unset (e.g. an optional prop never written). */
  value: unknown;
}

/** COMMON_INSPECTOR_FIELDS followed by `registry.get(node.kind).schema.inspector`, each resolved against `node`'s current values. */
export function getInspectorFields(node: Node, registry: NodeKindRegistry): InspectorFieldValue[] {
  const fields = [...COMMON_INSPECTOR_FIELDS, ...registry.get(node.kind).schema.inspector];
  return fields.map((field) => ({ ...field, value: getByPath(node, field.path) }));
}