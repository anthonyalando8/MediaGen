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

/** Also syncs props.text (plain-text fallback) from spans for backwards-compat. */
export function setSpansAndTextOp(comp: Composition, nodeId: Id, spans: TextSpan[]): import("core").Op {
  const idx = findNodeIndex(comp, nodeId);
  const node = comp.root[idx];
  const plainText = spans.map((s) => s.text).join("");
  // Write the whole props object in one op for atomicity
  const before = node.props as unknown as Json;
  const after = { ...(node.props as object), spans, text: plainText } as unknown as Json;
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${idx}/props`,
    before,
    after,
    txn: createId(),
  });
}