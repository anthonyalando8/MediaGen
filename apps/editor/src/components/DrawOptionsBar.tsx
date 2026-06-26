// apps/editor/src/components/DrawOptionsBar.tsx
// Floating options bar shown when tool === "draw". Controls stroke width,
// color, and smoothness. Uses module-level state (no store) — ephemeral.

import { useState } from "react";

export interface DrawOptions {
  strokeWidth: number;
  strokeHex: string;
  epsilon: number;
  tension: number;
}

let _opts: DrawOptions = { strokeWidth: 3, strokeHex: "#ffffff", epsilon: 3, tension: 0.4 };
const _listeners: Array<() => void> = [];

export function getDrawOptions(): DrawOptions { return _opts; }
export function setDrawOptions(o: Partial<DrawOptions>) {
  _opts = { ..._opts, ...o };
  _listeners.forEach((l) => l());
}
export function subscribeDrawOptions(l: () => void) {
  _listeners.push(l);
  return () => { const i = _listeners.indexOf(l); if (i >= 0) _listeners.splice(i, 1); };
}

export function DrawOptionsBar() {
  const [opts, setOpts] = useState<DrawOptions>(_opts);

  function update(partial: Partial<DrawOptions>) {
    const next = { ...opts, ...partial };
    setOpts(next);
    setDrawOptions(partial);
  }

  return (
    <div className="draw-options-bar">
      <label className="draw-options-bar__field">
        <span>Width</span>
        <input
          type="range" min={1} max={40} step={1} value={opts.strokeWidth}
          onChange={(e) => update({ strokeWidth: Number(e.target.value) })}
        />
        <span className="draw-options-bar__val">{opts.strokeWidth}px</span>
      </label>
      <label className="draw-options-bar__field">
        <span>Color</span>
        <input
          type="color" value={opts.strokeHex}
          onChange={(e) => update({ strokeHex: e.target.value })}
        />
      </label>
      <label className="draw-options-bar__field">
        <span>Smooth</span>
        <input
          type="range" min={0.1} max={1} step={0.05} value={opts.tension}
          onChange={(e) => update({ tension: Number(e.target.value) })}
        />
      </label>
      <label className="draw-options-bar__field">
        <span>Simplify</span>
        <input
          type="range" min={0.5} max={12} step={0.5} value={opts.epsilon}
          onChange={(e) => update({ epsilon: Number(e.target.value) })}
        />
      </label>
      <span className="draw-options-bar__hint">Draw on canvas · B to toggle · Esc = select</span>
    </div>
  );
}