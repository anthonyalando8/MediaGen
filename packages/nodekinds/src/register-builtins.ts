// packages/nodekinds/src/register-builtins.ts
import type { NodeKindRegistry } from "core";
import { groupKind } from "./group";
import { imageKind } from "./image";
import { videoKind } from "./video";
import { textKind } from "./text";
import { shapeKind } from "./shape";
import { nullKind } from "./null";
import { compKind } from "./comp";

/** All Phase 1 + Phase 2 NodeKinds in registration order. */
export const builtinKinds = [groupKind, imageKind, videoKind, textKind, shapeKind, nullKind, compKind] as const;

export function registerBuiltins(reg: NodeKindRegistry): void {
  for (const kind of builtinKinds) {
    reg.register(kind);
  }
}