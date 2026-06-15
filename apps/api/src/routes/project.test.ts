// apps/api/src/routes/project.test.ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../index";
import { createBlankProjectFixture } from "../test/fixtures";

describe("project routes", () => {
  it("PUT then GET round-trips a project (exit criterion 10: persists and re-renders identically)", async () => {
    const app = buildApp();
    const project = createBlankProjectFixture();

    const put = await app.inject({ method: "PUT", url: `/projects/${project.id}`, payload: project });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: `/projects/${project.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(project);
  });

  it("GET /projects lists stored projects", async () => {
    const app = buildApp();
    const a = createBlankProjectFixture();
    const b = createBlankProjectFixture();

    await app.inject({ method: "PUT", url: `/projects/${a.id}`, payload: a });
    await app.inject({ method: "PUT", url: `/projects/${b.id}`, payload: b });

    const list = await app.inject({ method: "GET", url: "/projects" });
    expect(list.json()).toHaveLength(2);
  });

  it("GET /projects/:id 404s for an unknown project", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/projects/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("PUT /projects/:id 400s on a schema-invalid body", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "PUT", url: "/projects/abc", payload: { id: "abc", name: "missing fields" } });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /projects/:id 400s when the body's id doesn't match the URL", async () => {
    const app = buildApp();
    const project = createBlankProjectFixture();
    const res = await app.inject({ method: "PUT", url: "/projects/some-other-id", payload: project });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /projects/:id removes a project, then GET 404s", async () => {
    const app = buildApp();
    const project = createBlankProjectFixture();

    await app.inject({ method: "PUT", url: `/projects/${project.id}`, payload: project });
    const del = await app.inject({ method: "DELETE", url: `/projects/${project.id}` });
    expect(del.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: `/projects/${project.id}` });
    expect(get.statusCode).toBe(404);
  });

  it("DELETE /projects/:id 404s for an unknown project", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "DELETE", url: "/projects/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});