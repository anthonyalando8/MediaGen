// apps/editor/src/components/TimelinePlaceholder.tsx
import { Pause, Play } from "lucide-react";
import { toFrame } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

/**
 * Ruler + playhead + per-node bars (Deliverable 09 §9.1). P1 stub:
 * play/pause and a scrub slider over the active composition's duration —
 * exercises Tier 3 (`playhead`, `playing`). The ruler and per-node bars are
 * Week 7+ scope.
 */
export function TimelinePlaceholder() {
  const store = useEditorStoreApi();
  const playhead = useEditorStore((s) => s.playhead);
  const playing = useEditorStore((s) => s.playing);
  const duration = useEditorStore((s) => activeComp(s).duration);

  return (
    <div className="timeline">
      <button
        className="btn btn-icon"
        title={playing ? "Pause" : "Play"}
        onClick={() => (playing ? store.getState().pause() : store.getState().play())}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, duration - 1)}
        value={playhead}
        onChange={(e) => store.getState().setPlayhead(toFrame(Number(e.target.value)))}
      />
      <span className="timeline__time">
        {playhead} / {duration}
      </span>
    </div>
  );
}