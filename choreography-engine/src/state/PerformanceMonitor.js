import { gsap } from "gsap";

/**
 * PerformanceMonitor.js
 * ---------------------
 * Tracks runtime performance metrics:
 *   - Actual FPS (requestAnimationFrame delta)
 *   - Active GSAP tween count
 *   - Timeline count
 *   - Frame budget warnings (< 24fps = yellow, < 15fps = red)
 *   - Tween budget warnings (> 80 active tweens = yellow)
 *
 * ── Usage ────────────────────────────────────────────────────────
 *   const monitor = new PerformanceMonitor();
 *   monitor.start();
 *
 *   // Read metrics:
 *   monitor.fps        → 58.4
 *   monitor.tweenCount → 12
 *   monitor.status     → "ok" | "warn" | "critical"
 *
 *   // Subscribe to updates:
 *   monitor.onUpdate((metrics) => { ... });
 *
 *   monitor.stop();
 */
export class PerformanceMonitor {
  constructor({ sampleRate = 500 } = {}) {
    this._sampleRate  = sampleRate;  // ms between metric samples
    this._running     = false;
    this._rafId       = null;
    this._sampleTimer = null;
    this._listeners   = [];

    // Rolling FPS buffer (last 10 samples)
    this._fpsBuffer   = [];
    this._lastFrame   = 0;
    this._frameCount  = 0;

    // Public metrics
    this.fps        = 0;
    this.tweenCount = 0;
    this.tlCount    = 0;
    this.status     = "ok";
    this.warnings   = [];
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running  = true;
    this._lastFrame = performance.now();
    this._loop();
    this._sampleTimer = setInterval(() => this._sample(), this._sampleRate);
    return this;
  }

  stop() {
    this._running = false;
    if (this._rafId)       cancelAnimationFrame(this._rafId);
    if (this._sampleTimer) clearInterval(this._sampleTimer);
    this._rafId       = null;
    this._sampleTimer = null;
  }

  // ── Public metrics ────────────────────────────────────────────

  getMetrics() {
    return {
      fps:        this.fps,
      tweenCount: this.tweenCount,
      tlCount:    this.tlCount,
      status:     this.status,
      warnings:   [...this.warnings],
      timestamp:  Date.now(),
    };
  }

  onUpdate(handler) {
    this._listeners.push(handler);
    return () => {
      this._listeners = this._listeners.filter(h => h !== handler);
    };
  }

  // ── Internals ─────────────────────────────────────────────────

  _loop() {
    if (!this._running) return;

    const now = performance.now();
    const delta = now - this._lastFrame;
    this._lastFrame = now;
    this._frameCount++;

    // Instantaneous FPS from this frame delta
    const instantFPS = delta > 0 ? 1000 / delta : 60;
    this._fpsBuffer.push(instantFPS);
    if (this._fpsBuffer.length > 10) this._fpsBuffer.shift();

    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _sample() {
    if (!this._running) return;

    // Average FPS from buffer
    if (this._fpsBuffer.length > 0) {
      const sum  = this._fpsBuffer.reduce((a, b) => a + b, 0);
      this.fps   = Math.round(sum / this._fpsBuffer.length);
    }

    // GSAP tween count (via GSAP globalTimeline introspection)
    try {
      this.tweenCount = gsap.globalTimeline.getChildren(true, true, false).length;
      this.tlCount    = gsap.globalTimeline.getChildren(true, false, true).length;
    } catch {
      this.tweenCount = 0;
      this.tlCount    = 0;
    }

    // Evaluate status
    this.warnings = [];

    if (this.fps < 15) {
      this.status = "critical";
      this.warnings.push(`Critical FPS: ${this.fps}fps (target ≥24)`);
    } else if (this.fps < 24) {
      this.status = "warn";
      this.warnings.push(`Low FPS: ${this.fps}fps`);
    } else {
      this.status = "ok";
    }

    if (this.tweenCount > 80) {
      this.status = this.status === "critical" ? "critical" : "warn";
      this.warnings.push(`High tween count: ${this.tweenCount} active tweens`);
    }

    // Notify listeners
    const metrics = this.getMetrics();
    this._listeners.forEach(h => { try { h(metrics); } catch {} });
  }
}

// ── Singleton ────────────────────────────────────────────────────
export const Monitor = new PerformanceMonitor();
export default Monitor;