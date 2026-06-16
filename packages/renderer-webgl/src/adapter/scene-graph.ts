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

/** Upper bound for `Text.resolution` (updateText) — caps texture memory for extreme zoom/scale. */
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
      case "video": {
        // A Container wrapping one child Sprite — NOT a bare Sprite — so
        // `reconcile()`'s `setFromMatrix(toPixiMatrix(node.matrix))` (the
        // node's own move/scale/rotate transform) can be applied to this
        // outer Container while `updateSprite` independently positions/
        // scales the inner Sprite to `node.box` per `fit`, exactly the
        // pattern `updateText` already uses for its child `Text` objects.
        // A single Sprite can't do both: `setFromMatrix` and a `fit` scale
        // would both be writing to the same `position`/`scale`, clobbering
        // one another.
        const container = new Container();
        container.addChild(new Sprite());
        return container;
      }
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
        this.updateSprite(display as Container, node);
        break;
      case "text":
        this.updateText(display, node.runs);
        break;
      case "shape":
        this.updateShape(display as Graphics, node.geom, node.fill, node.stroke);
        break;
    }
  }

  private updateSprite(container: Container, node: Extract<RenderNode, { t: "image" | "video" }>): void {
    const sprite = container.children[0] as Sprite;
    const texture = this.textures.get(node.tex, this.fps);
    if (sprite.texture !== texture) sprite.texture = texture;

    // Sizes/positions the INNER sprite to `node.box` (its local-space
    // target box, contract's render-node.ts doc) per `fit` — matches
    // <TransformGizmo>'s outline, which reads the SAME box via
    // NodeKind.bounds() (image.ts's `imageBox`/video.ts).
    //
    // This must NOT touch the OUTER `container`'s own position/scale —
    // that's already set by `reconcile()`'s `setFromMatrix(toPixiMatrix(
    // node.matrix))` (the node's move/scale/rotate transform from the
    // gizmo). createDisplay's doc explains why a bare Sprite can't do
    // both: a single Pixi object's `position`/`scale` can't carry both
    // `node.matrix` and a `fit` scale at once without one clobbering the
    // other — so this sprite is a CHILD of that container instead, with
    // its own independent position/scale in the container's local space
    // (where (0,0) is `node.matrix`'s origin, exactly the convention
    // `getOrientedCorners` uses for every node kind's bounds).
    const texW = texture.width || 1;
    const texH = texture.height || 1;
    const { width: boxW, height: boxH } = node.box;

    let scaleX: number;
    let scaleY: number;
    switch (node.fit) {
      case "fill":
        scaleX = boxW / texW;
        scaleY = boxH / texH;
        break;
      case "cover": {
        const s = Math.max(boxW / texW, boxH / texH);
        scaleX = scaleY = s;
        break;
      }
      case "contain":
      default: {
        const s = Math.min(boxW / texW, boxH / texH);
        scaleX = scaleY = s;
        break;
      }
    }

    // Anchored at the texture's center, then positioned at the box's
    // center: this is correct for all three `fit` modes — including
    // "cover"/"contain", where the scaled texture doesn't exactly fill the
    // box and needs to be centered within it, not pinned to a corner.
    sprite.anchor.set(0.5);
    sprite.scale.set(scaleX, scaleY);
    sprite.position.set(node.box.x + boxW / 2, node.box.y + boxH / 2);
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