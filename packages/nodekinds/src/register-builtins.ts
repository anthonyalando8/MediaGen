// packages/nodekinds/src/register-builtins.ts
import type { NodeKindRegistry } from "core";
import { groupKind } from "./group";
import { imageKind } from "./image";
import { videoKind } from "./video";
import { textKind } from "./text";
import { shapeKind } from "./shape";
import { nullKind } from "./null";

/** All Phase 1 + Phase 2 §4.4 NodeKinds, in registration order. */
export const builtinKinds = [groupKind, imageKind, videoKind, textKind, shapeKind, nullKind] as const;

export function registerBuiltins(reg: NodeKindRegistry): void {
  for (const kind of builtinKinds) {
    reg.register(kind);
  }
}