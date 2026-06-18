// apps/editor/src/components/TimelinePlaceholder.tsx
//
// Transport (play/pause + time readout) + the clip-arrangement timeline
// (TimelineRuler/TimelineTrack — new scope, see TimelineTrack.tsx's
// module doc). Filename kept as-is (it's referenced from App.tsx and the
// rename isn't worth the churn) even though this is no longer a
// placeholder — it now hosts a real per-layer timeline with drag-to-move,
// drag-to-trim, and transition-boundary markers, replacing the single
// global scrub slider this used to be.

import { Pause, Play } from "lucide-react";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";

/** Pixels per frame at the timeline's (currently fixed) zoom level — 4px/frame puts a typical 150-frame/5s comp at 600px of scrollable content, comfortably draggable down to single-frame precision without crowding the ruler's tick labels. A zoom control is a natural follow-up, not added here to keep this change scoped to "can author and see a transition." */
const PIXELS_PER_FRAME = 4;

export function TimelinePlaceholder() {
  const store = useEditorStoreApi();
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const duration = useEditorStore((s) => activeComp(s).duration);

  return (
    <div className="timeline-panel">
      <div className="timeline">
        <button
          className="btn btn-icon"
          title={playing ? "Pause" : "Play"}
          onClick={() => (playing ? store.getState().pause() : store.getState().play())}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="timeline__time">
          {playhead} / {duration}
        </span>
      </div>
      <div className="timeline-scroll">
        <TimelineRuler pixelsPerFrame={PIXELS_PER_FRAME} />
        <TimelineTrack pixelsPerFrame={PIXELS_PER_FRAME} />
      </div>
    </div>
  );
}