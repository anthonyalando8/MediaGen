// apps/editor/src/components/SpanAnimPanel.tsx
//
// Per-span animation UI shown in the inspector's Text tab when a text node
// is selected. Lists every span with its text content, lets the user:
//   - Set a time window (start frame + duration)
//   - Apply a motion preset (Fade In, Slide Up, Slide Down, Pop, Type On)
//   - Clear animation on a span
//   - Auto-stagger: distributes spans across time with a configurable offset
//
// No canvas interaction needed — all driven from inspector.

import { useState, useSyncExternalStore } from "react";
import type { Node } from "core";
import type { TextSpan } from "core";
import type { Frame } from "core";
import {
  clearSpanAnimationOp,
  setSpanChannelsOp,
  setSpanTimeOp,
  spanPresetChannels,
} from "../commands/set-span-animation";
import { splitSpansIntoWordsOp } from "../commands/text-span-ops";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import { getActiveSpanIndex, subscribeActiveSpan } from "../store/active-span-handle";
import { getActiveEditor, subscribeActiveEditor } from "../store/editor-handle";

const PRESETS = [
  { id: "fadeIn",    label: "Fade In"    },
  { id: "slideUp",   label: "Slide Up"   },
  { id: "slideDown", label: "Slide Down" },
  { id: "pop",       label: "Pop"        },
  { id: "typeOn",    label: "Type On"    },
] as const;

interface SpanRowProps {
  span: TextSpan;
  index: number;
  nodeId: import("core").Id;
  fps: number;
}

function SpanRow({ span, index, nodeId, fps }: SpanRowProps) {
  const store = useEditorStoreApi();
  const hasAnim = Boolean(span.channels?.length || span.time);
  const [dur, setDur] = useState(span.time?.duration ?? 15);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const fillMode = span.time?.fillMode ?? "forwards";

  function applyPreset(preset: typeof PRESETS[number]["id"]) {
    const state = store.getState();
    const comp = activeComp(state);
    const start = (span.time?.start ?? 0) as Frame;
    const channels = spanPresetChannels(preset, dur);
    state.apply(setSpanChannelsOp(comp, nodeId, index, channels));
    const afterComp = activeComp(store.getState());
    state.apply(setSpanTimeOp(afterComp, nodeId, index, start, dur as Frame, fillMode));
    setActivePreset(preset);
  }

  function setStart(v: number) {
    const state = store.getState();
    const comp = activeComp(state);
    state.apply(setSpanTimeOp(comp, nodeId, index, v as Frame, (span.time?.duration ?? dur) as Frame, fillMode));
  }

  function setFillMode(fm: "none" | "forwards" | "backwards" | "both") {
    if (!span.time) return;
    const state = store.getState();
    const comp = activeComp(state);
    // Pre-hide and Wrap only have visible effect BEFORE the start frame.
    // If start is 0, auto-advance it to 30f so the pre-hidden state is visible.
    const currentStart = span.time.start as number;
    const newStart = (fm === "backwards" || fm === "both") && currentStart === 0
      ? 30
      : currentStart;
    state.apply(setSpanTimeOp(comp, nodeId, index, newStart as Frame, span.time.duration, fm));
  }

  function clearAnim() {
    const state = store.getState();
    state.apply(clearSpanAnimationOp(activeComp(state), nodeId, index));
    setActivePreset(null);
  }

  const preview = span.text.length > 20 ? span.text.slice(0, 18) + "…" : span.text;
  const startF = span.time?.start ?? 0;
  const startSec = (startF / fps).toFixed(2);

  return (
    <div className={`span-anim-row ${hasAnim ? "span-anim-row--active" : ""}`}>
      <div className="span-anim-row__header">
        <span className="span-anim-row__index">#{index + 1}</span>
        <span className="span-anim-row__text" title={span.text}>"{preview}"</span>
        {hasAnim && (
          <button className="btn btn-xs btn-danger" onClick={clearAnim} title="Remove animation">✕</button>
        )}
      </div>

      <div className="span-anim-row__fields">
        <label className="span-anim-field">
          <span>Start</span>
          <input
            type="number" min={0} step={1} value={startF}
            className="insp-number"
            onChange={(e) => setStart(Number(e.target.value))}
          />
          <span className="span-anim-field__unit">{startSec}s</span>
        </label>
        <label className="span-anim-field">
          <span>Transition</span>
          <input
            type="number" min={1} max={120} step={1} value={dur}
            className="insp-number"
            onChange={(e) => setDur(Number(e.target.value))}
          />
          <span className="span-anim-field__unit">f</span>
        </label>
      </div>

      {/* Fill mode — only show when a time window exists */}
      {span.time && (
        <div className="span-anim-row__fillmode">
          <span className="span-anim-field__label">After</span>
          {(["forwards", "none", "backwards", "both"] as const).map((fm) => (
            <button
              key={fm}
              className={`btn btn-xs ${fillMode === fm ? "btn-active" : ""}`}
              title={
                fm === "forwards"  ? "Hold — stays visible after animating in" :
                fm === "none"      ? "Return — goes back to first keyframe state (e.g. invisible) after playing" :
                fm === "backwards" ? "Pre-hide — hidden before start frame, stays visible after. Needs start > 0 to be visible." :
                                     "Wrap — hidden before AND returns to first keyframe after. Needs start > 0."
              }
              onClick={() => setFillMode(fm)}
            >
              {fm === "forwards"  ? "Hold"     :
               fm === "none"      ? "Return"   :
               fm === "backwards" ? "Pre-hide" : "Wrap"}
            </button>
          ))}
        </div>
      )}

      <div className="span-anim-row__presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`btn btn-xs ${activePreset === p.id ? "btn-active" : ""}`}
            onClick={() => applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SpanAnimPanelProps {
  node: Node;
}

export function SpanAnimPanel({ node }: SpanAnimPanelProps) {
  const store = useEditorStoreApi();
  const spans = (node.props.spans as unknown as TextSpan[] | undefined) ?? [];
  const fps = useEditorStore((s) => activeComp(s).fps);
  const [staggerF, setStaggerF] = useState(8);
  const [showAll, setShowAll] = useState(false);

  // Track which span the cursor is currently in (set by RichTextEditor)
  const activeSpanIndex = useSyncExternalStore(subscribeActiveSpan, getActiveSpanIndex);

  function handleSplit() {
    const state = store.getState();
    state.apply(splitSpansIntoWordsOp(activeComp(state), node.id));
  }

  const hasText = Boolean(node.props.text || spans.length);

  if (spans.length === 0) {
    return (
      <div className="span-anim-empty">
        {hasText ? (
          <>
            <p>This text has no spans yet.</p>
            <button className="btn btn-sm" style={{ marginTop: 8, width: "100%" }} onClick={handleSplit}>
              ✦ Split into words
            </button>
          </>
        ) : (
          <p>Double-click the text on canvas to enter editing. Then click Split into words to animate each word independently.</p>
        )}
      </div>
    );
  }

  const editorSnapshot = useSyncExternalStore(subscribeActiveEditor, getActiveEditor);
  const editorIsOpen = editorSnapshot.handle !== null;
  // -1 = selection exists but not yet a named span; 0..N = named span
  const hasSelection = activeSpanIndex !== null;
  const focusedIndex = (activeSpanIndex !== null && activeSpanIndex >= 0 && activeSpanIndex < spans.length)
    ? activeSpanIndex : null;
  // When editor open: show only focused span (or nothing if unselected)
  // When editor closed: show all
  const visibleSpans = (editorIsOpen && !showAll)
    ? (focusedIndex !== null ? [{ span: spans[focusedIndex], i: focusedIndex }] : [])
    : spans.map((span, i) => ({ span, i }));

  function applyStagger(preset: typeof PRESETS[number]["id"]) {
    const state = store.getState();
    let comp = activeComp(state);
    for (let i = 0; i < spans.length; i++) {
      const start = (i * staggerF) as Frame;
      const channels = spanPresetChannels(preset, 15);
      state.apply(setSpanChannelsOp(comp, node.id, i, channels));
      comp = activeComp(store.getState());
      state.apply(setSpanTimeOp(comp, node.id, i, start, 15 as Frame));
      comp = activeComp(store.getState());
    }
  }

  return (
    <div className="span-anim-panel">
      <div className="span-anim-actions">
        <button className="btn btn-sm" style={{ flex: 1 }} onClick={handleSplit} title="Re-split text into one span per word">
          ✦ Split into words
        </button>
        <span className="span-anim-actions__count">{spans.length} span{spans.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Focus indicator — shown when editor is open */}
      {editorIsOpen && (
        <div className="span-anim-focus-bar">
          {focusedIndex !== null
            ? <><span>"{spans[focusedIndex].text.trim().slice(0, 20)}"</span>
                <button className="btn btn-xs" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Selected only" : `All ${spans.length}`}
                </button></>
            : <span style={{ color: "var(--text-2)" }}>Select a word to animate it</span>
          }
        </div>
      )}

      {/* Stagger — only when showing all */}
      {(focusedIndex === null || showAll) && (
        <>
          <div className="span-anim-stagger">
            <div className="span-anim-stagger__header">
              <span className="insp-label">Stagger all</span>
              <label className="span-anim-field">
                <span>Offset</span>
                <input type="number" min={1} max={60} value={staggerF} className="insp-number"
                  onChange={(e) => setStaggerF(Number(e.target.value))} />
                <span className="span-anim-field__unit">f</span>
              </label>
            </div>
            <div className="span-anim-stagger__presets">
              {PRESETS.map((p) => (
                <button key={p.id} className="btn btn-sm" onClick={() => applyStagger(p.id)}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="insp-divider" />
        </>
      )}

      <div className="span-anim-list">
        {visibleSpans.map(({ span, i }) => (
          <SpanRow key={span.id ?? i} span={span} index={i} nodeId={node.id} fps={fps} />
        ))}
      </div>
    </div>
  );
}