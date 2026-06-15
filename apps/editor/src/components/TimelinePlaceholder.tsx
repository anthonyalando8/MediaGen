// apps/editor/src/components/TimelinePlaceholder.tsx
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
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderTop: "1px solid #333" }}>
      <button onClick={() => (playing ? store.getState().pause() : store.getState().play())}>
        {playing ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, duration - 1)}
        value={playhead}
        onChange={(e) => store.getState().setPlayhead(toFrame(Number(e.target.value)))}
        style={{ flex: 1 }}
      />
      <span>
        {playhead} / {duration}
      </span>
    </div>
  );
}