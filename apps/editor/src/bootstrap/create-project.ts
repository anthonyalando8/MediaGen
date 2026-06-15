// apps/editor/src/bootstrap/create-project.ts
import { createComposition, createId } from "core";
import type { Project } from "core";
import { CURRENT_SCHEMA_VERSION } from "schema";

/** A fresh, single-composition Project — the editor's initial document (Tier 1). */
export function createBlankProject(): Project {
  const comp = createComposition({ name: "Main" });
  return {
    id: createId(),
    schema: CURRENT_SCHEMA_VERSION,
    name: "Untitled Project",
    comps: { [comp.id]: comp },
    rootCompId: comp.id,
    assets: [],
    opLog: [],
  };
}