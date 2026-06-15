// packages/core/src/types/time.ts
import type { Frame } from "./ids";

/**
 * A node's placement on its parent's timeline. `in`/`out` are source-trim
 * frames (P2 — only relevant once media decode honors trims); in Phase 1
 * `inSpan` only consults `start`/`duration`.
 */
export interface TimeSpan {
  start: Frame;
  duration: Frame;
  in?: Frame;
  out?: Frame;
}

/** True if `frame` falls within [start, start + duration). */
export function inSpan(time: TimeSpan, frame: Frame): boolean {
  return frame >= time.start && frame < (time.start as number) + (time.duration as number);
}
