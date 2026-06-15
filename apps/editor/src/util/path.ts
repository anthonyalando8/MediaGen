// apps/editor/src/util/path.ts

/**
 * Reads a dotted path (e.g. "props.fill", "transform.position.x") off
 * `obj`, returning `undefined` if any segment is missing or the path
 * traverses into a non-object. Used for both `InspectorField.path`
 * (Deliverable 09 §9.1, Week 8) and `setNodeProp`'s `before` capture —
 * unlike core's `getByPointer` (JSON Pointer, throws on missing paths),
 * this is a lenient reader for UI/diagnostics.
 */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/** Converts a dotted path to an RFC6901 JSON Pointer suffix (no leading composition path), e.g. "transform.position.x" -> "transform/position/x". */
export function dottedToPointer(path: string): string {
  return path.split(".").join("/");
}