// apps/editor/src/components/AudioInspectorPanel.tsx
//
// Inspector view shown when an AUDIO TRACK is selected (audio-selection
// context). Redesign of AudioPanel's AudioInspectorPanel — same store surface
// (setAudioTrackPropOp / removeAudioTrackOp), now grouped into Levels / Fades /
// Source Trim sections with a kind badge, matching the layer inspector's
// section rhythm. Render it from InspectorPanel:
//
//   const { selectedAudioId } = useAudioSelection();
//   const track = getAudioTracks(activeComp(state)).find(t => t.id === selectedAudioId);
//   return track
//     ? <AudioInspectorPanel track={track} />
//     : <NodeInspector ... />;   // existing node inspector

import { Trash2 } from "lucide-react";
import type { AudioTrack } from "core";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { removeAudioTrackOp, setAudioTrackPropOp } from "../commands/audio-ops";
import { RangeSlider } from "./RangeSlider";
import { audioKindMeta } from "./audio-kinds";
import { useAudioSelection } from "./audio-selection";

export function AudioInspectorPanel({
  track, audioDuration,
}: {
  track: AudioTrack;
  audioDuration?: number;
}) {
  const store = useEditorStoreApi();
  const { clearAudio } = useAudioSelection();
  const meta = audioKindMeta(track);
  const Icon = meta.icon;
  const maxTrim = audioDuration ?? 3600;

  function set<K extends keyof AudioTrack>(key: K, value: AudioTrack[K]) {
    const state = store.getState();
    state.apply(setAudioTrackPropOp(activeComp(state), track.id, key, value as never));
  }

  function handleRemove() {
    const state = store.getState();
    state.apply(removeAudioTrackOp(activeComp(state), track.id));
    clearAudio();
  }

  return (
    <div className="audio-inspector">
      {/* Header — kind badge + name */}
      <div className="inspector__header">
        <span className="kind-chip kind-chip--lg" style={{ color: meta.color, background: `${meta.color}22`, border: `1px solid ${meta.color}` }}>
          <Icon size={16} />
        </span>
        <div className="inspector__heading">
          <input
            className="inspector__name-input"
            value={track.name}
            onChange={(e) => set("name", e.target.value)}
          />
          <p className="inspector__kind">{meta.label} track</p>
        </div>
      </div>

      {/* Levels */}
      <section className="insp-section">
        <div className="insp-section__head" style={{ cursor: "default" }}>
          <span className="insp-section__title" style={{ marginLeft: 0 }}>Levels</span>
        </div>
        <div className="insp-section__body">
          <RangeSlider label="Volume" value={track.volume} min={0} max={2} step={0.01}
            onChange={(v) => set("volume", v as number)} />
          <div className="audio-inspector__toggles">
            <label className="audio-inspector__toggle">
              <input type="checkbox" checked={track.muted} onChange={(e) => set("muted", e.target.checked)} /> Mute
            </label>
            <label className="audio-inspector__toggle">
              <input type="checkbox" checked={track.solo} onChange={(e) => set("solo", e.target.checked)} /> Solo
            </label>
            <label className="audio-inspector__toggle">
              <input type="checkbox" checked={track.loop} onChange={(e) => set("loop", e.target.checked)} /> Loop
            </label>
          </div>
        </div>
      </section>

      {/* Fades */}
      <section className="insp-section">
        <div className="insp-section__head" style={{ cursor: "default" }}>
          <span className="insp-section__title" style={{ marginLeft: 0 }}>Fades</span>
        </div>
        <div className="insp-section__body">
          <RangeSlider label="Fade In" value={track.fadeIn} min={0} max={10} step={0.1} unit="s"
            onChange={(v) => set("fadeIn", v as number)} />
          <RangeSlider label="Fade Out" value={track.fadeOut} min={0} max={10} step={0.1} unit="s"
            onChange={(v) => set("fadeOut", v as number)} />
        </div>
      </section>

      {/* Source Trim */}
      <section className="insp-section">
        <div className="insp-section__head" style={{ cursor: "default" }}>
          <span className="insp-section__title" style={{ marginLeft: 0 }}>Source Trim</span>
        </div>
        <div className="insp-section__body">
          <RangeSlider label="Trim In" value={track.trimIn} min={0} max={maxTrim} step={0.1} unit="s"
            onChange={(v) => set("trimIn", v as number)} />
          <RangeSlider label="Trim Out" value={track.trimOut ?? maxTrim} min={0} max={maxTrim} step={0.1} unit="s"
            onChange={(v) => set("trimOut", v as number)} />
        </div>
      </section>

      <div style={{ padding: 14 }}>
        <button className="btn btn-outline btn-danger" style={{ width: "100%", justifyContent: "center" }} onClick={handleRemove}>
          <Trash2 size={13} /> Remove Track
        </button>
      </div>
    </div>
  );
}
