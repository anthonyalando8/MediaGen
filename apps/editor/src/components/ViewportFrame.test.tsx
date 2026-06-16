// apps/editor/src/components/ViewportFrame.test.tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewportFrame } from "./ViewportFrame";

describe("ViewportFrame", () => {
  it("draws a rect at fit's screen-space frame position/size", () => {
    const html = renderToStaticMarkup(
      <ViewportFrame compSize={{ width: 1080, height: 1920 }} canvasSize={{ width: 800, height: 600 }} fit={{ scale: 0.3, x: 100, y: 50 }} />
    );

    // width = 1080 * 0.3 = 324, height = 1920 * 0.3 = 576
    expect(html).toContain('x="100"');
    expect(html).toContain('y="50"');
    expect(html).toContain('width="324"');
    expect(html).toContain('height="576"');
  });

  it("includes the composition's pixel dimensions as a label", () => {
    const html = renderToStaticMarkup(
      <ViewportFrame compSize={{ width: 1080, height: 1920 }} canvasSize={{ width: 800, height: 600 }} fit={{ scale: 0.3, x: 100, y: 50 }} />
    );

    expect(html).toContain("1080");
    expect(html).toContain("1920");
  });

  it("is purely decorative — the outer svg ignores pointer events", () => {
    const html = renderToStaticMarkup(
      <ViewportFrame compSize={{ width: 1080, height: 1920 }} canvasSize={{ width: 800, height: 600 }} fit={{ scale: 1, x: 0, y: 0 }} />
    );

    expect(html).toContain("pointer-events:none");
  });
});