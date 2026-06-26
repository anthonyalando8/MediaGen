## Project Summary

This repository is a monorepo for a visual content editor / rendering system, likely a browser-based editor with a render worker and backend API. It uses `pnpm` with `turbo` to coordinate builds/test across apps and packages.

---

## Root

- package.json
  - Defines workspace tooling: `turbo`, `typescript`, `vitest`, `dependency-cruiser`.
  - Scripts:
    - `build`: `turbo run build`
    - `test`: `turbo run test`
    - `lint`: `turbo run lint`
    - `lint:boundaries`: dependency-cruiser analysis across packages and apps
- pnpm-workspace.yaml
  - Includes all workspaces under `apps/*` and `packages/*`.

---

## Apps

### editor
A React-based editor application.

- package.json dependencies:
  - Workspace packages: `contract`, `core`, `effects`, `motion`, `media`, `nodekinds`, `renderer-webgl`, `schema`, `ui`
  - External libs: `react`, `react-dom`, `zustand`, `immer`, `lucide-react`, `vite`, `zod`
- Role:
  - UI frontend for authoring and editing scenes or compositions.
  - Likely contains the main app state, editor commands, and UI components.
- Key files/folders:
  - `src/main.tsx`: Vite React entrypoint
  - `src/index.ts`: barrel exporting non-UI pieces for reuse/test
  - `bootstrap/`: project initialization, registration of node kinds
  - `commands/`: editor actions like add-node
  - `components/`: editor UI components and overlays
  - `store/`: state management, likely using Zustand + Immer
  - `viewport/`: canvas or scene preview rendering host
  - `inspector/`: property inspector panels
  - `persistence/`: save/load or local project persistence
  - `util/`: shared utilities
- Relationship:
  - Uses `core` and `contract` for domain models and typed scene contracts.
  - Uses `renderer-webgl` as a rendering backend for preview.
  - Uses `ui` for editor UI primitives.
  - Uses `effects`, `motion`, `media`, and `nodekinds` for scene content, animation, media assets, and node definitions.

### api
A backend API service.

- package.json dependencies:
  - `core`, `schema`, `fastify`
- Role:
  - Likely serves the editor or other services, maybe for persistence, project metadata, or schema validation over HTTP.
- Key file:
  - `src/index.ts`
- Relationship:
  - Uses `core` and `schema` for domain types and validation.
  - Could expose backend endpoints for editor data or asset management.

### renderworker
A worker process for rendering.

- package.json dependencies:
  - `core`, `contract`, `renderer-webgl`, `media`
- Role:
  - Offloads rendering or export work from the main app.
  - Could run in a separate thread/process to render scenes or generate output.
- Key file:
  - `src/index.ts`
- Relationship:
  - Uses `renderer-webgl` plus shared models to produce render output from scene data.

---

## Packages

### core
Foundation domain layer, shared across many modules.

- Key exports:
  - `types`
  - `domain`
  - `registry`
  - `evaluator`
  - `oplog`
- Dependencies:
  - `contract`, `schema`, `zod`
- Role:
  - Central engine for scene graph domain logic, evaluation, registries for node kinds or effects, and operational logs.
- Relation:
  - Used by editor, API, render worker, and many feature packages.

### contract
Shared data contracts / scene schema definitions.

- Files:
  - `src/index.ts`
  - `src/primitives.ts`
  - `src/render-node.ts`
  - `src/mask.ts`
- Role:
  - Defines core data structures for scene nodes, render nodes, masks, and primitives.
  - Serves as stable typed contracts for packages and apps.
- Relation:
  - Base dependency for `core`, `effects`, `media`, `renderer-*`, `editor`, `renderworker`, etc.

### schema
Schema validation and migration for persisted scene data.

- Files:
  - `src/schemas.ts`
  - `src/migrate.ts`
  - `src/index.ts`
- Role:
  - Defines validation schemas and migration utilities.
- Relation:
  - Used by `core`, `api`, `sources`, `editor`, and perhaps persistence.

### ui
Reusable UI primitives for the editor.

- Key export:
  - `canvas-host`
- Role:
  - Provides editor UI pieces such as layer tree, timeline, inspector framework, and canvas hosting.
- Relation:
  - Used by editor to construct the editor interface.

### effects
Effect definitions and registries.

- Files:
  - `src/effects/`
  - `src/transitions/`
  - `src/register-builtins.ts`
  - `src/registry.ts`
- Role:
  - Defines reusable visual effects and transitions.
  - Registers built-in effect kinds for use by scene nodes.
- Relation:
  - Used by `renderer-webgl`, `editor`, `core`, and possibly `motion`.

### nodekinds
Definition of node types supported by the editor and renderer.

- Files:
  - `src/common.ts`
  - `src/comp.ts`
  - `src/group.ts`
  - `src/image.ts`
  - `src/shape.ts`
  - `src/text.ts`
  - `src/video.ts`
  - `src/null.ts`
  - `src/register-builtins.ts`
- Role:
  - Defines node kinds like group, image, text, video, shapes, and compositions.
  - Registers built-in node types for the core editor domain.
- Relation:
  - Used by editor and the rendering pipeline.

### media
Media asset handling.

- Files:
  - `src/decoder.ts`
  - `src/texture-source.ts`
  - `src/index.ts`
- Role:
  - Handles media decoding and texture sources for images/video.
- Relation:
  - Used by renderers and editor asset loading.

### motion
Motion/animation utilities.

- Files:
  - `src/bake.ts`
  - `src/generators/`
  - `src/presets/`
  - `src/types.ts`
- Role:
  - Provides motion generation, presets, and baking routines.
- Relation:
  - Used by editor and perhaps rendering/export pipelines.

### renderer-webgl
WebGL renderer backend built on Pixi.js.

- Files:
  - `src/renderer.ts`
  - `src/host/`
  - `src/adapter/`
  - `src/textures/`
  - `src/matrix.ts`
  - `src/color.ts`
- Role:
  - Renders scenes using WebGL, likely for preview and export.
- Relation:
  - Used by editor, `renderworker`, and `export`.

### renderer-three
Three.js renderer support.

- Files:
  - `src/index.ts`
- Role:
  - Alternative renderer based on Three.js.
- Relation:
  - Used by packages like `characters` and maybe visualization.

### characters
Character-specific rendering or content integration.

- Files:
  - `src/index.ts`
- Role:
  - Likely provides character assets or scene builds.
- Relation:
  - Depends on `core`, `contract`, `renderer-three`.

### collab
Collaboration support using Yjs.

- Files:
  - `src/index.ts`
- Role:
  - Adds real-time collaborative syncing.
- Relation:
  - Uses core shared state machinery.

### export
Export pipeline / render output.

- Files:
  - `src/index.ts`
- Role:
  - Provides export workflow or utilities to generate final output.
- Relation:
  - Depends on `renderer-webgl`, `core`, `contract`, `media`.

### sources
Scene/source management utilities.

- Files:
  - `src/index.ts`
- Role:
  - Likely handles external scene sources or import/export integration.
- Relation:
  - Uses `core` and `schema`.

### plugin-sdk
Developer-facing SDK or plugin interfaces.

- Files:
  - `src/index.ts`
- Role:
  - Likely exposes APIs to extend the editor with plugins.
- Relation:
  - Depends on central contracts and core domain.

---

## How files relate

- `contract` defines data contracts that all runtime packages consume.
- `schema` validates and migrates those data contracts.
- `core` builds domain logic, registry systems, and evaluation on top of contract/schema.
- `nodekinds` and `effects` define built-in scene content and visual effects.
- `media` provides asset decoding and texture sources used by renderers.
- `renderer-webgl` is the main rendering engine for live display and export; `renderer-three` is a secondary renderer.
- `motion` provides animation logic that can be applied to node properties and baked into scenes.
- `ui` provides editor UI host components; the `editor` app composes these with state, commands, and render previews.
- `renderworker` uses shared core/renderer packages to do rendering off-thread.
- `api` uses shared core/schema types to host backend endpoints.

---

## Summary view

- editor: main editor UI
- api: backend service
- renderworker: worker renderer
- core: domain engine
- contract: scene contracts/types
- schema: validation + migrations
- ui: editor UI primitives
- effects: effect definitions
- nodekinds: node types
- media: media loading/decoding
- motion: animation tools
- renderer-webgl: Pixi-based render engine
- renderer-three: Three.js renderer
- characters: character content layer
- collab: collaboration layer
- export: export/render output layer
- sources: source/import utilities
- plugin-sdk: plugin extension API

If you want, I can also produce a concise diagram-style dependency map or explain one folder in more detail.