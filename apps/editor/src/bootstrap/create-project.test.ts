// apps/editor/src/bootstrap/create-project.test.ts
import { describe, expect, it } from "vitest";
import { ProjectSchema } from "schema";
import { createBlankProject } from "./create-project";

describe("createBlankProject", () => {
  it("round-trips through ProjectSchema", () => {
    const project = createBlankProject();
    const result = ProjectSchema.safeParse(project);
    expect(result.success).toBe(true);
  });

  it("has exactly one (empty) composition, set as rootCompId", () => {
    const project = createBlankProject();

    expect(Object.keys(project.comps)).toEqual([project.rootCompId]);

    const comp = project.comps[project.rootCompId];
    expect(comp.root).toEqual([]);
    expect(comp.name).toBe("Main");
  });

  it("starts with an empty op-log and no assets", () => {
    const project = createBlankProject();
    expect(project.opLog).toEqual([]);
    expect(project.assets).toEqual([]);
  });
});