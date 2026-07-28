// apps/editor/src/persistence/text/registry.ts
//
// P1 · The representation registry. "Drop a module, get a representation."
// The pipeline never branches on a representation name — it reads this map.

import type { TextRepresentation } from "./types";

const _reg = new Map<string, TextRepresentation>();

export function register(r: TextRepresentation): void {
  if (_reg.has(r.id)) throw new Error(`[text] duplicate representation id: ${r.id}`);
  _reg.set(r.id, r);
}
export function get(id: string): TextRepresentation | undefined {
  return _reg.get(id);
}
export function has(id: string): boolean {
  return _reg.has(id);
}
export function list(): TextRepresentation[] {
  return [..._reg.values()];
}
export function ids(): string[] {
  return [..._reg.keys()];
}
