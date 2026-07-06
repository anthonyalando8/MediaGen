// apps/editor/src/store/playback.test.ts
//
// Covers the isExporting flag added alongside playing/playhead — set by
// Menubar.tsx's handleExportVideo around exportToMp4(), checked by
// Viewport.tsx's RAF loop to skip live rendering during export (see
// PlaybackSlice.isExporting's doc for why: avoiding two simultaneous
// active WebGL contexts, a documented cause of browser-initiated context
// loss under GPU memory pressure).

import { describe, expect, it } from "vitest";
import { createBlankProject } from "../bootstrap/create-project";
import { createEditorStore } from "./index";

describe("playback slice — isExporting", () => {
  it("defaults to false", () => {
    const store = createEditorStore(createBlankProject());
    expect(store.getState().isExporting).toBe(false);
  });

  it("setIsExporting(true/false) toggles the flag", () => {
    const store = createEditorStore(createBlankProject());

    store.getState().setIsExporting(true);
    expect(store.getState().isExporting).toBe(true);

    store.getState().setIsExporting(false);
    expect(store.getState().isExporting).toBe(false);
  });

  it("is independent of playing/playhead — toggling it doesn't affect them", () => {
    const store = createEditorStore(createBlankProject());
    store.getState().play();
    const playheadBefore = store.getState().playhead;

    store.getState().setIsExporting(true);

    expect(store.getState().playing).toBe(true);
    expect(store.getState().playhead).toBe(playheadBefore);
  });
});