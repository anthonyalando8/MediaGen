// apps/editor/src/store/viewport-reset-handle.test.ts
//
// Regression coverage for the "old scene still plays after importing a new
// one" bug: `resetViewport()` bumps an epoch that NOTHING consumed (Viewport
// never keyed <CanvasHost> on it), so a full document swap never actually
// remounted the renderer. These tests pin the pure epoch/subscribe mechanics
// that Viewport.tsx now keys <CanvasHost> on — they can't verify the React
// remount itself (no component-render tests in this project's suite), but
// they do guarantee resetViewport() reliably produces a NEW value and
// notifies every subscriber, which is the contract the fix depends on.
import { describe, expect, it } from "vitest";
import { getViewportEpoch, resetViewport, subscribeViewportReset } from "./viewport-reset-handle";

describe("viewport-reset-handle", () => {
  it("resetViewport() always advances the epoch to a new, distinct value", () => {
    const before = getViewportEpoch();
    resetViewport();
    const after = getViewportEpoch();
    expect(after).not.toBe(before);
  });

  it("notifies every subscribed listener on reset", () => {
    let calls = 0;
    const unsubscribe = subscribeViewportReset(() => { calls += 1; });
    resetViewport();
    resetViewport();
    expect(calls).toBe(2);
    unsubscribe();
  });

  it("a listener stops receiving notifications after unsubscribing", () => {
    let calls = 0;
    const unsubscribe = subscribeViewportReset(() => { calls += 1; });
    resetViewport();
    unsubscribe();
    resetViewport();
    expect(calls).toBe(1); // only the reset before unsubscribe counted
  });

  it("two independent subscribers are both notified (Viewport isn't the only future consumer)", () => {
    let a = 0, b = 0;
    const unsubA = subscribeViewportReset(() => { a += 1; });
    const unsubB = subscribeViewportReset(() => { b += 1; });
    resetViewport();
    expect(a).toBe(1);
    expect(b).toBe(1);
    unsubA();
    unsubB();
  });
});
