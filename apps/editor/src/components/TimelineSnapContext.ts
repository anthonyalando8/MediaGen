// apps/editor/src/components/TimelineSnapContext.ts
//
// Shared snap state between TimelineTrack (sets litFrame during drags) and
// TimelineGrid (reads litFrame to highlight the snap line).

import { createContext, useContext } from "react";

export interface TimelineSnapCtx {
  litFrame: number | null;
  setLitFrame: (frame: number | null) => void;
}

export const TimelineSnapContext = createContext<TimelineSnapCtx>({
  litFrame: null,
  setLitFrame: () => {},
});

export function useTimelineSnap() {
  return useContext(TimelineSnapContext);
}