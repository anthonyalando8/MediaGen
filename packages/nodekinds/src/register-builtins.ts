// packages/nodekinds/src/register-builtins.ts
import type { NodeKindRegistry } from "core";
import { groupKind } from "./group";
import { imageKind } from "./image";
import { videoKind } from "./video";
import { textKind } from "./text";
import { shapeKind } from "./shape";

/** All five Phase 1 NodeKinds, in registration order. */
export const builtinKinds = [groupKind, imageKind, videoKind, textKind, shapeKind] as const;

/**
 * Registers every Phase 1 NodeKind into `reg`. Called once at bootstrap
 * (apps/editor/src/bootstrap/register-kinds.ts, and again in the render
 * worker) — see the "bootstrap, not global singleton" note on
 * NodeKindRegistry.
 */
export function registerBuiltins(reg: NodeKindRegistry): void {
  for (const kind of builtinKinds) {
    reg.register(kind);
  }
}