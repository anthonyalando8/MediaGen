// packages/core/src/evaluator/transitions.ts
//
// Phase 2 §4.4/§5 — Node.transitionIn/transitionOut: "one node transitions
// in as the previous one transitions out, same durationF window"
// (TransitionRef's doc). Unlike effects/masks/mattes (all single-node
// concerns, wired in evaluate-node.ts), a transition fundamentally spans
// TWO siblings — so it can only be resolved at the level that sees both,
// after each has been independently evaluated. This module is that
// post-pass: called from evaluate-composition.ts (and, recursively, from
// any container's own children evaluation) over the ORIGINAL `Node[]`
// siblings array — never over already-flattened RenderNode[], which has
// lost per-node boundaries for any non-wrapped node (evaluate-node.ts's
// "flat RenderNode array, P1 known simplification" doc).
//
// DESIGN DECISION — the overlap window: TransitionRef carries only
// `durationF`, no separate "starts at" field. The only model consistent
// with that is the standard NLE convention: the transition's window IS
// the region where the outgoing clip's TimeSpan and the incoming clip's
// TimeSpan already overlap, and `durationF` is how much of that overlap
// the transition consumes (clamped to the actual overlap if the user sets
// durationF longer than what the two clips' positions actually overlap
// by — a degenerate-but-not-crashing authoring mistake, not a contract
// violation). `progress` is 0 at the start of the overlap, 1 at its end.
// Authoring a transition therefore requires the timeline UI to actually
// overlap two clips' spans at their boundary — exactly like every NLE.

import type { Frame, Id } from "../types/ids";
import type { Node } from "../types/node";
import type { TransitionRef } from "../types/effect";
import type { RenderNode } from "contract";

/** The actual overlap window two adjacent siblings' TimeSpans share, in frames — `null` if they don't overlap at all (a transition ref with no real overlap to render in). */
function overlapWindow(prev: Node, next: Node): { start: Frame; end: Frame } | null {
  const prevEnd = (prev.time.start as number) + (prev.time.duration as number);
  const nextStart = next.time.start as number;
  if (prevEnd <= nextStart) return null; // no overlap — nothing to transition across.
  return { start: nextStart as Frame, end: prevEnd as Frame };
}

/** 0 at the start of `window`, 1 at its end, clamped — `ref.durationF` only controls how much of the TAIL of the overlap the transition actually animates across (the rest holds at 0 or 1), so a transition shorter than the clips' overlap doesn't stretch across the whole thing. */
function sampleProgress(ref: TransitionRef, window: { start: Frame; end: Frame }, frame: Frame): number {
  const overlapLen = (window.end as number) - (window.start as number);
  const durationF = Math.min(ref.durationF as number, overlapLen); // clamp — see module doc.
  if (durationF <= 0) return 1; // degenerate (zero/negative duration) — treat as already-complete, never divide by zero.
  const windowStart = (window.end as number) - durationF; // transition occupies the TAIL of the overlap.
  const t = ((frame as number) - windowStart) / durationF;
  return Math.min(1, Math.max(0, t));
}

/** Wraps a multi-element evaluator output into ONE RenderNode (transitionGroup's `from`/`to` contract — see contract/render-node.ts's doc) — a bare passthrough "group" when there's more than one, or the single element itself unwrapped (no pointless extra Container) when there's exactly one. */
function wrapAsOne(out: RenderNode[], id: Id): RenderNode {
  if (out.length === 1) return out[0];
  return { id, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], opacity: 1, blend: "normal", t: "group", children: out };
}

/**
 * Scans `siblings` (the ORIGINAL Node[] in z-order, NOT yet evaluated) for
 * z-order-adjacent pairs where `next.transitionIn` (preferred) or
 * `prev.transitionOut` declares a transition spanning their boundary, and
 * a real overlap window exists between their TimeSpans that's ACTIVE at
 * `frame`. Returns a NEW RenderNode[] with each such pair's two
 * independently-evaluated outputs (already produced by the caller, passed
 * in via `evaluated`) replaced by one "transitionGroup" wrapping them —
 * every other sibling's already-evaluated output passes through
 * completely unchanged. A composition with no transitions anywhere
 * returns the same elements `evaluated` already contained, just
 * concatenated — Phase 1 documents, which never set transitionIn/Out, are
 * completely unaffected.
 *
 * A MIDDLE node can have BOTH `transitionIn` (from its previous sibling)
 * AND `transitionOut` (to its next sibling) set — a completely normal
 * timeline shape (A wipes into B, B later dissolves into C). At any given
 * `frame`, though, this function only ever consumes a node into AT MOST
 * ONE transitionGroup: it checks each boundary (i, i+1) in z-order, and
 * only forms a transitionGroup there if that boundary's OWN window is
 * actually active at `frame` — a node already consumed by the boundary
 * BEFORE it (lower `i`) is skipped for the boundary after it, rather than
 * one declared ref unconditionally shadowing the other regardless of
 * which window is actually active this frame (the bug this replaced: a
 * node's `transitionIn` ref previously won outright, even on a frame
 * where only its `transitionOut` boundary's window was active, silently
 * starving the second transition entirely).
 *
 * `evaluated[i]` MUST be `siblings[i]`'s own already-evaluated RenderNode[]
 * (same index correspondence) — the caller (evaluate-composition.ts) is
 * responsible for that pairing; this function stays a pure
 * pairing/windowing function over already-computed results, independently
 * testable without constructing a real NodeKindRegistry/EvalCtx.
 */
export function applyTransitions(siblings: Node[], evaluated: RenderNode[][], frame: Frame): RenderNode[] {
  const out: RenderNode[] = [];
  const consumed = new Set<number>(); // indices already wrapped into a transitionGroup at THIS frame.

  for (let i = 0; i < siblings.length - 1; i++) {
    if (consumed.has(i)) continue;
    const prev = siblings[i];
    const next = siblings[i + 1];
    const ref = next.transitionIn ?? prev.transitionOut;
    if (!ref) continue;

    const window = overlapWindow(prev, next);
    if (!window || frame < window.start || frame >= window.end) continue; // declared, but not active this frame.

    const progress = sampleProgress(ref, window, frame);
    out.push({
      id: prev.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      opacity: 1,
      blend: "normal",
      t: "transitionGroup",
      from: wrapAsOne(evaluated[i], `${prev.id}-from` as Id),
      to: wrapAsOne(evaluated[i + 1], `${next.id}-to` as Id),
      ref: ref.preset,
      uniforms: ref.props as never, // Record<string,Scalar> is always JSON-safe — see evaluate-node.ts's toJsonUniforms doc for the same justification.
      progress,
    });
    consumed.add(i);
    consumed.add(i + 1);
  }

  for (let i = 0; i < siblings.length; i++) {
    if (!consumed.has(i)) out.push(...evaluated[i]);
  }
  return out;
}