// apps/editor/src/commands/text-span-ops.ts
//
// Commands for writing TextSpan[] back to node.props.spans via the op-log.

import { createId, createOp } from "core";
import type { Composition, Id, Json } from "core";
import type { TextSpan } from "core";
import { findNodeIndex } from "./find-node-index";

/** Replaces the entire spans array — the rich text editor's primary write path. */
export function setSpansOp(comp: Composition, nodeId: Id, spans: TextSpan[]): import("core").Op {
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const before = (node.props as Record<string, unknown>).spans ?? null;
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${idx}/props/spans`,
    before: before as Json,
    after: spans as unknown as Json,
    txn: createId(),
  });
}

/** Ensures every span has a stable id — assigned once, never overwritten. */
function ensureSpanIds(spans: TextSpan[]): TextSpan[] {
  return spans.map((s) => s.id ? s : { ...s, id: createId() });
}

/** Also syncs props.text (plain-text fallback) from spans for backwards-compat. */
export function setSpansAndTextOp(comp: Composition, nodeId: Id, spans: TextSpan[]): import("core").Op {
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const withIds = ensureSpanIds(spans);
  const plainText = withIds.map((s) => s.text).join("");
  const before = node.props as unknown as Json;
  const after = { ...(node.props as object), spans: withIds, text: plainText } as unknown as Json;
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${idx}/props`,
    before,
    after,
    txn: createId(),
  });
}

/**
 * Splits text content into one span per word, preserving existing styling
 * from the source span. Newlines become their own single-character spans.
 * Used by the "Split into words" button in SpanAnimPanel.
 */
export function splitSpansIntoWordsOp(comp: Composition, nodeId: Id): import("core").Op {
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const existing = (node.props.spans as unknown as TextSpan[] | undefined) ?? [];

  // Tokenise: split each span's text on word boundaries, keeping whitespace
  // attached to the preceding word (e.g. "Hello " + "World") so layout is
  // correct. Newlines become separate spans.
  const wordSpans: TextSpan[] = [];
  for (const span of existing) {
    // Split on newlines first, then on whitespace-inclusive word boundaries
    const lines = span.text.split("\n");
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) wordSpans.push({ text: "\n", id: createId() });
      const line = lines[li];
      if (!line) continue;
      // Match words + trailing whitespace as a single token
      const tokens = line.match(/\S+\s*/g) ?? [line];
      for (const token of tokens) {
        const { channels: _c, time: _t, text: _tx, id: _id, ...styleRest } = span;
        wordSpans.push({ text: token, ...styleRest, id: createId() });
      }
    }
  }

  const plainText = wordSpans.map((s) => s.text).join("");
  const before = node.props as unknown as Json;
  const after = { ...(node.props as object), spans: wordSpans, text: plainText } as unknown as Json;
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${idx}/props`,
    before,
    after,
    txn: createId(),
  });
}