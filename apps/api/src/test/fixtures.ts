// apps/api/src/test/fixtures.ts
//
// `apps/api` is intentionally independent of `apps/editor` — no
// cross-app imports. This mirrors `apps/editor/src/bootstrap/
// create-project.ts`'s `createBlankProject()` (same `core`/`schema`
// building blocks) to produce a minimal schema-valid `Project` for route
// tests.

import { createComposition, createId } from "core";
import type { Project } from "core";
import { CURRENT_SCHEMA_VERSION } from "schema";

export function createBlankProjectFixture(): Project {
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