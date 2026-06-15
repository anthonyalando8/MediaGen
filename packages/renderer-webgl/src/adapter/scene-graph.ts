// packages/renderer-webgl/src/adapter/scene-graph.ts
//
// "Reconcile a RenderTree into Pixi Container/Sprite/Text/Graphics by id
// (keyed diff)" (Deliverable 08). NO domain types cross this boundary —
// only `contract` (RenderTree/RenderNode) and `pixi.js`.

import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { ColorOKLCH, GlyphRun, RenderNode, RenderTree, ShapeGeom, Stroke } from "contract";
import { oklchToHex } from "../color";
import { toPixiMatrix } from "../matrix";
import type { TextureManager } from "../textures/manager";

type Display = Container;
const MAX_TEXT_RESOLUTION = 8;
/**
 * Reconciles a flat RenderTree into a single flat Pixi Container (`root`),
 * keyed by `RenderNode.id`. The flat array IS the z-order (Deliverable 07:
 * "Iterates root in z-order"), applied via `zIndex` on `root`
 * (`sortableChildren = true`).
 *
 * "group" RenderNodes carry no visual content in P1 — `children` is always
 * `[]` and a group only contributes its transform/opacity to descendants
 * during evaluation (see the flat-array note in
 * core/src/evaluator/evaluate-node.ts). They are skipped here entirely;
 * nothing is created or destroyed for them.
 */
export class SceneGraphAdapter {
  readonly root = new Container();
  private displays = new Map<string, Display>();
  private kinds = new Map<string, RenderNode["t"]>();

  constructor(
    private readonly textures: TextureManager,
    private fps = 30
  ) {
    this.root.sortableChildren = true;
  }

  setFps(fps: number): void {
    this.fps = fps;
  }

  reconcile(tree: RenderTree): void {
    const seen = new Set<string>();

    tree.nodes.forEach((node, index) => {
      if (node.t === "group") return; // P1: no visual content — see class doc.
      seen.add(node.id);

      let display = this.displays.get(node.id);
      if (display && this.kinds.get(node.id) !== node.t) {
        this.destroyDisplay(node.id, display);
        display = undefined;
      }
      if (!display) {
        display = this.createDisplay(node);
        this.displays.set(node.id, display);
        this.kinds.set(node.id, node.t);
        this.root.addChild(display);
      }

      display.zIndex = index;
      display.setFromMatrix(toPixiMatrix(node.matrix));
      display.alpha = node.opacity;
      display.blendMode = node.blend;
      this.updateContent(display, node);
    });

    for (const [id, display] of [...this.displays]) {
      if (!seen.has(id)) this.destroyDisplay(id, display);
    }
  }

  /** Releases every Pixi display object owned by this adapter. */
  destroy(): void {
    for (const [id, display] of [...this.displays]) this.destroyDisplay(id, display);
  }

  private destroyDisplay(id: string, display: Display): void {
    this.root.removeChild(display);
    display.destroy({ children: true });
    this.displays.delete(id);
    this.kinds.delete(id);
  }

  private createDisplay(node: RenderNode): Display {
    switch (node.t) {
      case "image":
      case "video":
        return new Sprite();
      case "text":
        return new Container(); // holds one PIXI.Text per GlyphRun
      case "shape":
        return new Graphics();
      default:
        // "group" is filtered out by reconcile() before this is called.
        throw new Error(`unhandled RenderNode type: ${(node as RenderNode).t}`);
    }
  }

  private updateContent(display: Display, node: RenderNode): void {
    switch (node.t) {
      case "image":
      case "video":
        this.updateSprite(display as Sprite, node);
        break;
      case "text":
        this.updateText(display, node.runs);
        break;
      case "shape":
        this.updateShape(display as Graphics, node.geom, node.fill, node.stroke);
        break;
    }
  }

  private updateSprite(sprite: Sprite, node: Extract<RenderNode, { t: "image" | "video" }>): void {
    const texture = this.textures.get(node.tex, this.fps);
    if (sprite.texture !== texture) sprite.texture = texture;
    // P1: rendered at the texture's native size, scaled/positioned by
    // `node.matrix` only. `fit` (cover/contain/fill) needs a target box that
    // image/video RenderNodes don't carry yet — see the Week 5 design note
    // (recommend an ADR adding `box: Rect` to these RenderNode variants).
  }

  private updateText(container: Container, runs: GlyphRun[]): void {
    // `Text` rasterizes to a bitmap at `resolution` px per CSS px, then
    // `reconcile()`'s `setFromMatrix(toPixiMatrix(node.matrix))` (above)
    // stretches `container` (and its Text children) by `transform.scale`.
    // Without this, scaling a text node up (Deliverable 09 Week 7's resize
    // gizmo) stretches the existing bitmap and visibly pixelates it —
    // re-rasterize at a resolution that covers the current scale, capped to
    // bound texture memory for extreme zooms.
    const dpr = typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
    const resolution = Math.min(Math.max(Math.abs(container.scale.x), Math.abs(container.scale.y), 1) * dpr, MAX_TEXT_RESOLUTION);

    while (container.children.length > runs.length) {
      const extra = container.children[container.children.length - 1];
      container.removeChild(extra);
      extra.destroy();
    }
    runs.forEach((run, i) => {
      let text = container.children[i] as Text | undefined;
      if (!text) {
        text = new Text({ text: run.text, style: {} });
        container.addChild(text);
      }
      text.text = run.text;
      text.position.set(run.x, run.y);
      text.style.fontFamily = run.fontFamily;
      text.style.fontSize = run.fontSize;
      text.style.fontWeight = String(run.weight) as Text["style"]["fontWeight"];
      text.style.fill = oklchToHex(run.color);
      if (text.resolution !== resolution) text.resolution = resolution;
    });
  }

  private updateShape(graphics: Graphics, geom: ShapeGeom, fill?: ColorOKLCH, stroke?: Stroke): void {
    graphics.clear();
    switch (geom.kind) {
      case "rect":
        graphics.roundRect(0, 0, geom.width, geom.height, geom.radius);
        break;
      case "ellipse":
        graphics.ellipse(geom.width / 2, geom.height / 2, geom.width / 2, geom.height / 2);
        break;
      case "line":
        graphics.moveTo(0, 0).lineTo(geom.length, 0);
        break;
    }
    if (fill && geom.kind !== "line") {
      graphics.fill(oklchToHex(fill));
    }
    if (stroke) {
      graphics.stroke({ width: stroke.width, color: oklchToHex(stroke.color) });
    } else if (geom.kind === "line") {
      // An unstroked line is invisible — fall back to a 1px stroke in `fill`'s color (or black).
      graphics.stroke({ width: 1, color: fill ? oklchToHex(fill) : 0x000000 });
    }
  }
}