// packages/core/src/oplog/history.ts
import { applyOp, invertOp } from "./reducer";
import type { Op } from "./op";

/**
 * Linear undo/redo over an op-log, applied to an in-memory state of type T
 * (typically `Composition`). `apply` pushes a new op; `undo`/`redo` move
 * `cursor` without mutating `log`. A new `apply` after an `undo` drops the
 * redo branch (log is truncated to `cursor` first).
 */
export class History<T> {
  private log: Op[] = [];
  /** Number of ops in `log` that are currently applied (0..log.length). */
  private cursor = 0;
  private state: T;

  constructor(initial: T) {
    this.state = initial;
  }

  /** The current state, with all ops up to `cursor` applied. */
  get current(): T {
    return this.state;
  }

  /** Full log, including any redo-able (un-applied) ops past `cursor`. */
  get entries(): readonly Op[] {
    return this.log;
  }

  get position(): number {
    return this.cursor;
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.log.length;
  }

  /** Applies `op`, dropping any redo branch beyond the current cursor. */
  apply(op: Op): T {
    if (this.cursor < this.log.length) {
      this.log = this.log.slice(0, this.cursor);
    }
    this.state = applyOp(this.state, op);
    this.log.push(op);
    this.cursor++;
    return this.state;
  }

  /** Reverts the most recently applied op, if any. */
  undo(): T {
    if (!this.canUndo()) return this.state;
    const op = this.log[this.cursor - 1];
    this.state = applyOp(this.state, invertOp(op));
    this.cursor--;
    return this.state;
  }

  /** Re-applies the next op past the cursor, if any. */
  redo(): T {
    if (!this.canRedo()) return this.state;
    const op = this.log[this.cursor];
    this.state = applyOp(this.state, op);
    this.cursor++;
    return this.state;
  }
}
