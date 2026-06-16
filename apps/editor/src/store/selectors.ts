// apps/editor/src/store/selectors.ts
//
// Tier 2 · DERIVED (selectors, never stored) — Deliverable 09 §9.2:
// "activeComp(), renderTreeAt(frame) — memoized selectors, recomputed from
// tier 1". P1: plain recompute-on-call functions. Memoization (caching keyed
// on document.project identity + frame) can be layered on later without
// changing this surface — <Viewport>'s RAF loop (Week 6) already calls
// renderTreeAt() once per frame regardless.

import { evaluateComposition, findComposition } from "core";
import type { Composition, Frame, NodeKindRegistry } from "core";
import type { RenderTree } from "contract";
import type { EditorState } from "./index";

/** Phase 1 has no nested compositions/precomps — "active" is always the project's root composition. */
export function activeComp(state: Pick<EditorState, "document">): Composition {
  const { project } = state.document;
  const comp = findComposition(project, project.rootCompId);
  if (!comp) throw new Error(`activeComp: rootCompId "${project.rootCompId}" not found in project.comps`);
  return comp;
}

/** Evaluates the active composition at `frame` into a RenderTree (Deliverable 07). */
export function renderTreeAt(state: Pick<EditorState, "document">, frame: Frame, registry: NodeKindRegistry): RenderTree {
  const { assets } = state.document.project;
  const resolveAsset = (assetId: string): { width: number; height: number } | undefined => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset || asset.width === undefined || asset.height === undefined) return undefined;
    return { width: asset.width, height: asset.height };
  };
  return evaluateComposition(activeComp(state), frame, registry, resolveAsset);
}