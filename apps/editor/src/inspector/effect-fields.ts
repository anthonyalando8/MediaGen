// apps/editor/src/inspector/effect-fields.ts
//
// The effect-stack panel's equivalent of fields.ts's `getInspectorFields`
// — but resolved against a single `EffectRef` (`node.effects[i]`), not the
// whole `node`. Per Phase 2 §6 ("the inspector is free"): an `EffectDef`'s
// `schema.inspector` carries the SAME `InspectorField` shape `NodeKind`
// does, so this reuses `InspectorFieldValue`/`FieldControl`/`FieldRow`
// (InspectorPanel.tsx) directly — only the field-RESOLUTION step differs.
//
// Path convention: `EffectDef.schema.inspector` entries are
// "props.<key>", scoped to within one EffectRef (registry.test.ts's
// structural-sanity tests guarantee this). This module returns paths
// PREFIXED to `effects.<effectIndex>.props.<key>` — the dotted-path form
// `setNodeProp` already understands unmodified (it converts to a JSON
// Pointer via `dottedToPointer` and `core`'s reducer already handles
// numeric array-index segments generically, e.g.
// "/root/0/effects/2/props/amount" — no new command needed for this
// panel).

import type { EffectRegistry } from "effects";
import type { InspectorFieldValue } from "./fields";
import type { Node } from "core";
import { getByPath } from "../util/path";

/** One effect's resolved inspector fields, plus enough identity to address it (for the toggle/remove controls and setNodeProp's path). */
export interface EffectStackEntry {
  effectIndex: number;
  refId: string;
  effect: string;
  displayName: string;
  enabled: boolean;
  fields: InspectorFieldValue[];
}

/**
 * One `EffectStackEntry` per `node.effects[]` entry, in stacking order. An
 * effect whose `effect` key isn't in `registry` (e.g. a project saved with
 * a since-removed effect) is skipped — the panel can't render controls
 * for a definition it doesn't have, but the underlying `EffectRef` is left
 * untouched in the document (no data loss, just nothing to show for it).
 */
export function getEffectStackEntries(node: Node, registry: EffectRegistry): EffectStackEntry[] {
  if (!node.effects) return [];

  const entries: EffectStackEntry[] = [];
  node.effects.forEach((ref, effectIndex) => {
    const def = registry.tryGet(ref.effect);
    if (!def) return;

    const fields = def.schema.inspector.map((field) => ({
      ...field,
      path: `effects.${effectIndex}.${field.path}`,
      value: getByPath(ref, field.path),
    }));

    entries.push({ effectIndex, refId: ref.id, effect: ref.effect, displayName: def.displayName, enabled: ref.enabled, fields });
  });

  return entries;
}