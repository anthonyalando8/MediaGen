// apps/editor/src/components/SpanLaneContext.ts
// Shared expand/collapse state for span sub-lanes between
// TimelineTrackHeaders (left) and TimelineTrack (right).

import { createContext, useContext } from "react";

interface SpanLaneCtx {
  expanded: Set<string>;
  toggle: (nodeId: string) => void;
}

export const SpanLaneContext = createContext<SpanLaneCtx>({
  expanded: new Set(),
  toggle: () => {},
});

export function useSpanLanes() {
  return useContext(SpanLaneContext);
}