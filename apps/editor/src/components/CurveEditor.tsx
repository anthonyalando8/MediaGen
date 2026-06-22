// apps/editor/src/components/CurveEditor.tsx
//
// Phase 2 §9.2 — keyframe/graph editor. Shows per-channel rows and a
// value-vs-time SVG graph for the selected node's channels.
// Every edit writes a set op on channel.keys[] via channel-ops.ts.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { interpolate, toFrame } from "core";
import type { Channel, Id, Node } from "core";
import type { Keyframe } from "core";
import {
  addKeyframeOp, deleteKeyframeOp, moveKeyframeOp,
  setKeyframeHandlesOp, applyEasingPresetOp, EASING_PRESETS,
} from "../commands/channel-ops";
import { useEditorStore, useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";

const GRAPH_H = 140;
const ROW_H = 28;
const LABEL_W = 120;
const KEY_R = 5;
const HANDLE_R = 3.5;

// ── Value range ────────────────────────────────────────────────────────────

function getValueRange(channel: Channel): [number, number] {
  if (channel.keys.length === 0) return [0, 1];
  const vals = channel.keys.map((k) => {
    const v = k.value;
    if (typeof v === "number") return v;
    if (typeof v === "object" && v !== null && "x" in v) return (v as { x: number }).x;
    return 0;
  });
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.2 || 1;
  return [min - pad, max + pad];
}

function scalarValue(k: Keyframe): number {
  if (typeof k.value === "number") return k.value;
  if (typeof k.value === "object" && k.value !== null && "x" in k.value) return (k.value as { x: number }).x;
  return 0;
}

// ── Channel graph row ──────────────────────────────────────────────────────

function ChannelGraph({
  channel, nodeId, duration, pixelsPerFrame, selectedKey, onSelectKey,
}: {
  channel: Channel;
  nodeId: Id;
  duration: number;
  pixelsPerFrame: number;
  selectedKey: { channelId: Id; keyIndex: number } | null;
  onSelectKey: (channelId: Id, keyIndex: number | null) => void;
}) {
  const store = useEditorStoreApi();
  const svgRef = useRef<SVGSVGElement>(null);
  const [vMin, vMax] = getValueRange(channel);
  const W = duration * pixelsPerFrame;

  function frameToX(f: number) { return f * pixelsPerFrame; }
  function valueToY(v: number) { return GRAPH_H - ((v - vMin) / (vMax - vMin)) * GRAPH_H; }
  function xToFrame(x: number) { return Math.round(x / pixelsPerFrame); }
  function yToValue(y: number) { return vMin + (1 - y / GRAPH_H) * (vMax - vMin); }

  // Build path for the curve
  let curvePath = "";
  if (channel.keys.length > 0) {
    const first = channel.keys[0];
    curvePath = `M ${frameToX(first.frame as number)} ${valueToY(scalarValue(first))}`;
    for (let i = 1; i < channel.keys.length; i++) {
      const k0 = channel.keys[i - 1];
      const k1 = channel.keys[i];
      const x0 = frameToX(k0.frame as number), y0 = valueToY(scalarValue(k0));
      const x1 = frameToX(k1.frame as number), y1 = valueToY(scalarValue(k1));
      if (k0.interp === "hold") {
        curvePath += ` H ${x1} V ${y1}`;
      } else if (k0.interp === "bezier") {
        const dx = x1 - x0;
        const out = k0.outHandle ?? [1/3, 1/3];
        const iin = k1.inHandle ?? [2/3, 2/3];
        const cp1x = x0 + dx * out[0], cp1y = y0 + (y1 - y0) * out[1];
        const cp2x = x0 + dx * iin[0], cp2y = y0 + (y1 - y0) * iin[1];
        curvePath += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x1} ${y1}`;
      } else {
        curvePath += ` L ${x1} ${y1}`;
      }
    }
  }

  function handleKeyPointerDown(e: ReactPointerEvent, keyIndex: number): void {
    e.preventDefault();
    e.stopPropagation();
    onSelectKey(channel.id, keyIndex);
    (e.target as Element).setPointerCapture(e.pointerId);

    const startX = e.clientX, startY = e.clientY;
    const key = channel.keys[keyIndex];
    const origFrame = key.frame as number;
    const origVal = scalarValue(key);
    let lastFrame = origFrame;

    function onMove(ev: PointerEvent): void {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      lastFrame = Math.max(0, origFrame + Math.round(dx / pixelsPerFrame));
      const newVal = origVal - (dy / GRAPH_H) * (vMax - vMin);
      const state = store.getState();
      const comp = activeComp(state);
      // Move frame + update value together
      const newKeys = comp.root.find((n) => n.id === nodeId)!
        .channels.find((c) => c.id === channel.id)!.keys
        .map((k, i) => i === keyIndex ? { ...k, frame: toFrame(lastFrame), value: newVal } : k)
        .sort((a, b) => (a.frame as number) - (b.frame as number));
      // Live preview via a direct apply (coalesced on pointerup into one op)
      void newKeys; // preview only — commit on up
    }

    function onUp(ev: PointerEvent): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ev.clientX - startX;
      const newFrame = Math.max(0, origFrame + Math.round(dx / pixelsPerFrame));
      if (newFrame !== origFrame) {
        const state = store.getState();
        state.apply(moveKeyframeOp(activeComp(state), nodeId, channel.id, keyIndex, newFrame));
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleGraphDblClick(e: React.MouseEvent): void {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const frame = xToFrame(x);
    const value = yToValue(y);
    const state = store.getState();
    state.apply(addKeyframeOp(activeComp(state), nodeId, channel.id, {
      frame: toFrame(frame), value, interp: "bezier",
    }));
  }

  const isSelected = (i: number) => selectedKey?.channelId === channel.id && selectedKey.keyIndex === i;

  return (
    <div className="curve-editor__channel">
      <svg ref={svgRef} className="curve-editor__graph" width={W} height={GRAPH_H} onDoubleClick={handleGraphDblClick}>
        {/* Zero line */}
        {vMin < 0 && vMax > 0 && (
          <line x1={0} y1={valueToY(0)} x2={W} y2={valueToY(0)} stroke="var(--border)" strokeWidth={1} strokeDasharray="4 2" />
        )}
        {/* Curve */}
        {curvePath && <path d={curvePath} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
        {/* Keyframes */}
        {channel.keys.map((k, i) => {
          const kx = frameToX(k.frame as number), ky = valueToY(scalarValue(k));
          const sel = isSelected(i);
          return (
            <g key={i}>
              {/* Bezier handle lines for selected key */}
              {sel && k.outHandle && i < channel.keys.length - 1 && (() => {
                const k1 = channel.keys[i + 1];
                const x1 = frameToX(k1.frame as number), y1 = valueToY(scalarValue(k1));
                const dx = x1 - kx;
                const hx = kx + dx * k.outHandle[0], hy = ky + (y1 - ky) * k.outHandle[1];
                return (
                  <g>
                    <line x1={kx} y1={ky} x2={hx} y2={hy} stroke="var(--accent)" strokeWidth={1} opacity={0.5} />
                    <circle cx={hx} cy={hy} r={HANDLE_R} fill="var(--accent)" opacity={0.8} />
                  </g>
                );
              })()}
              <rect
                x={kx - KEY_R} y={ky - KEY_R}
                width={KEY_R * 2} height={KEY_R * 2}
                fill={sel ? "var(--accent)" : "var(--surface-1)"}
                stroke="var(--accent)" strokeWidth={1.5}
                style={{ cursor: "grab", transform: `rotate(45deg)`, transformOrigin: `${kx}px ${ky}px` }}
                onPointerDown={(e) => handleKeyPointerDown(e, i)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const state = store.getState();
                  state.apply(deleteKeyframeOp(activeComp(state), nodeId, channel.id, i));
                }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Main CurveEditor ───────────────────────────────────────────────────────

export function CurveEditor({ node, pixelsPerFrame }: { node: Node; pixelsPerFrame: number }) {
  const store = useEditorStoreApi();
  const duration = useEditorStore((s) => activeComp(s).duration as number);
  const channels = node.channels;
  const [visibleChannels, setVisibleChannels] = useState<Set<Id>>(new Set(channels.map((c) => c.id)));
  const [selectedKey, setSelectedKey] = useState<{ channelId: Id; keyIndex: number } | null>(null);

  // Reset when channels are replaced (e.g. switching between motion presets)
  const channelSig = channels.map((c) => c.id).join(",");
  useEffect(() => {
    setVisibleChannels(new Set(channels.map((c) => c.id)));
    setSelectedKey(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSig]);

  if (channels.length === 0) {
    return (
      <div className="curve-editor__empty">
        No channels — apply a Motion preset to add keyframes.
      </div>
    );
  }

  function toggleChannel(id: Id): void {
    setVisibleChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleEasingChange(preset: string): void {
    if (!selectedKey) return;
    const state = store.getState();
    state.apply(applyEasingPresetOp(activeComp(state), node.id, selectedKey.channelId, selectedKey.keyIndex, preset));
  }

  return (
    <div className="curve-editor">
      <div className="curve-editor__header">
        <span className="curve-editor__title">Channels</span>
        {selectedKey && (
          <label className="curve-editor__easing">
            <span>Easing</span>
            <select onChange={(e) => handleEasingChange(e.target.value)}>
              <option value="">— preset —</option>
              {Object.keys(EASING_PRESETS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="curve-editor__body">
        {/* Channel label list */}
        <div className="curve-editor__labels" style={{ width: LABEL_W }}>
          {channels.map((ch) => (
            <div
              key={ch.id}
              className={`curve-editor__label ${visibleChannels.has(ch.id) ? "curve-editor__label--active" : ""}`}
              style={{ height: GRAPH_H }}
              onClick={() => toggleChannel(ch.id)}
            >
              <span className="curve-editor__label-dot" style={{ background: visibleChannels.has(ch.id) ? "var(--accent)" : "var(--border)" }} />
              <span className="curve-editor__label-text">{ch.path.split(".").pop()}</span>
              <span className="curve-editor__label-keys">{ch.keys.length}k</span>
            </div>
          ))}
        </div>
        {/* Graph area */}
        <div className="curve-editor__graphs" style={{ overflowX: "auto" }}>
          {channels.filter((ch) => visibleChannels.has(ch.id)).map((ch) => (
            <ChannelGraph
              key={ch.id}
              channel={ch}
              nodeId={node.id}
              duration={duration}
              pixelsPerFrame={pixelsPerFrame}
              selectedKey={selectedKey}
              onSelectKey={(cId, kIdx) => setSelectedKey(kIdx !== null ? { channelId: cId, keyIndex: kIdx } : null)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}