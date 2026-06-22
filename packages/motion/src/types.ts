import type { Channel, Id, TimeSpan } from "core";
import type { Transform } from "core";

export interface MotionCtx {
  nodeId: Id;
  span: TimeSpan;
  fps: number;
  size: { width: number; height: number };
  /** Node's current transform — presets use this as baseline. */
  transform: Transform;
}

export type Motion = (ctx: MotionCtx) => Channel[];

// ── Control schema ────────────────────────────────────────────────────────
// Each preset declares its own controls so MotionPanel can render them
// generically — same principle as EffectDef.schema.inspector.

export interface MotionControlNumber {
  type: "number";
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface MotionControlSelect {
  type: "select";
  key: string;
  label: string;
  default: string;
  options: { value: string; label: string }[];
}

export type MotionControl = MotionControlNumber | MotionControlSelect;

/** A preset with an associated controls schema and a factory that accepts option values. */
export interface MotionPreset {
  id: string;
  label: string;
  controls: MotionControl[];
  /** Builds a Motion from the current control values (already defaulted). */
  build(options: Record<string, number | string>): Motion;
}