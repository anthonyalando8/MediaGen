/**
 * Enforces §2.1 of the Phase 1 blueprint — the dependency graph (Deliverable 02).
 * "core" is the domain layer: it must stay framework- and renderer-agnostic.
 * "contract" is the neutral seam: pure types, zero deps.
 */
module.exports = {
  forbidden: [
    {
      name: "core-no-react",
      comment: "core → react ❌ domain is UI-agnostic",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^(node_modules/)?react" },
    },
    {
      name: "core-no-renderer",
      comment: "core → pixi / three ❌ domain is renderer-agnostic",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^(node_modules/(pixi\\.js|three)|packages/renderer-)" },
    },
    {
      name: "core-no-node-or-dom",
      comment: "core → node:* / DOM ❌ must run in browser AND worker AND server",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^node:" },
    },
    {
      name: "contract-no-deps",
      comment: "contract → anything ❌ pure types, the neutral seam",
      severity: "error",
      from: { path: "^packages/contract" },
      to: { path: "^(packages|node_modules)", pathNot: "^packages/contract" },
    },
    {
      name: "nodekinds-no-renderer",
      comment: "nodekinds → renderer-* ❌ kinds emit RenderNodes (data), never draw",
      severity: "error",
      from: { path: "^packages/nodekinds" },
      to: { path: "^packages/renderer-" },
    },
    {
      name: "renderer-webgl-no-core",
      comment: "renderer-webgl → core ❌ renderer sees only contract (RenderTree)",
      severity: "error",
      from: { path: "^packages/renderer-webgl" },
      to: { path: "^packages/core" },
    },
    {
      name: "ui-no-renderer-webgl",
      comment: "ui → renderer-webgl ❌ canvas host takes a renderer via injection, not import",
      severity: "error",
      from: { path: "^packages/ui" },
      to: { path: "^packages/renderer-webgl" },
    },
    {
      name: "effects-no-renderer-webgl",
      comment: "effects → renderer-webgl ❌ (Phase 2 §2/§12.1) — effects ship GLSL + param schema as DATA; renderer-webgl/passes compiles and runs it. Keeps an effect addable without ever touching a renderer.",
      severity: "error",
      from: { path: "^packages/effects" },
      to: { path: "^packages/renderer-" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    doNotFollow: {
      path: "node_modules",
    },
  },
};
