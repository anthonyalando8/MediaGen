// packages/renderer-webgl/vitest.setup.ts
//
// pixi.js@8 calls isSafari() at module-evaluation time (inside
// glUploadVideoResource's top-level upload-strategy selection), which reads
// `navigator.userAgent` via `DOMAdapter.getNavigator() -> navigator`. Node
// >=21 ships a global `navigator`, but on earlier Node versions (no DOM, no
// flag) the bare identifier `navigator` is undeclared — so merely
// `import "pixi.js"` throws `ReferenceError: navigator is not defined`
// before any test runs. Polyfill a minimal `navigator` so pixi.js's
// browser-feature-detection no-ops cleanly in Node, regardless of version.
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node" },
    configurable: true,
  });
}