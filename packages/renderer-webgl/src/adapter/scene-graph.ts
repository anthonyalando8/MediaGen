// packages/renderer-webgl/src/adapter/scene-graph.ts
//
// "Reconcile a RenderTree into Pixi Container/Sprite/Text/Graphics by id
// (keyed diff)" (Deliverable 08). NO domain types cross this boundary —
// only `contract` (RenderTree/RenderNode) and `pixi.js`.

import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { Filter } from "pixi.js";
import type { ColorOKLCH, GlyphRun, PassSpec, RenderNode, RenderTree, ShapeGeom, Stroke } from "contract";
import { oklchToHex } from "../color";
import { toPixiMatrix } from "../matrix";
import type { TextureManager } from "../textures/manager";
import { resolvePass } from "../passes/pass-resolver";

type Display = Container;

/** Per-effectGroup nested reconciliation state — see SceneGraphAdapter's `groups` map doc. */
interface EffectGroupState {
  displays: Map<string, Display>;
  kinds: Map<string, RenderNode["t"]>;
}

/** Upper bound for `Text.resolution` (updateText) — caps texture memory for extreme zoom/scale. */
const MAX_TEXT_RESOLUTION = 8;

/**
 * Reconciles a RenderTree into Pixi Container/Sprite/Text/Graphics, keyed
 * by `RenderNode.id`. The top-level `tree.nodes` array IS the z-order
 * (Deliverable 07: "Iterates root in z-order"), applied via `zIndex` on
 * `root` (`sortableChildren = true`).
 *
 * "group" RenderNodes carry no visual content — `children` is always `[]`
 * and a group only contributes its transform/opacity to descendants during
 * evaluation (see the flat-array note in
 * core/src/evaluator/evaluate-node.ts). They are skipped here entirely;
 * nothing is created or destroyed for them.
 *
 * "effectGroup" (Phase 2 §5) is the opposite: genuinely RECURSIVE —
 * `children` stays nested, and this adapter creates a real Pixi `Container`
 * holding its own nested keyed-diff of `children`, exactly as it does for
 * the top-level `tree.nodes`. The shared recursion lives in
 * `reconcileChildren` (below) so the top-level `reconcile()` and a nested
 * `effectGroup` use identical create/update/destroy logic — the only
 * difference is which `Map`s (displays/kinds) and which target `Container`
 * they operate against, since each level needs its OWN keyed-diff state
 * (a node id is only unique within its level — see `EffectGroupState`).
 */
export class SceneGraphAdapter {
  readonly root = new Container();
  private displays = new Map<string, Display>();
  private kinds = new Map<string, RenderNode["t"]>();
  /** Per-effectGroup nested reconciliation state, keyed by the effectGroup's own RenderNode.id. */
  private groups = new Map<string, EffectGroupState>();

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
    this.reconcileChildren(this.root, tree.nodes, this.displays, this.kinds);
  }

  /**
   * The shared keyed-diff loop — operates on `nodes` (in z-order) against
   * `target` (a Pixi Container), using `displays`/`kinds` as this level's
   * own identity maps. Used for both the top-level `tree.nodes` (via
   * `reconcile`) and a nested `effectGroup.children` (via
   * `reconcileEffectGroup`).
   */
  private reconcileChildren(target: Container, nodes: RenderNode[], displays: Map<string, Display>, kinds: Map<string, RenderNode["t"]>): void {
    const seen = new Set<string>();

    nodes.forEach((node, index) => {
      if (node.t === "group") return; // P1: no visual content — see class doc.
      seen.add(node.id);

      let display = displays.get(node.id);
      if (display && kinds.get(node.id) !== node.t) {
        this.destroyDisplay(node.id, display, displays, kinds);
        display = undefined;
      }
      if (!display) {
        display = this.createDisplay(node);
        displays.set(node.id, display);
        kinds.set(node.id, node.t);
        target.addChild(display);
      }

      display.zIndex = index;
      display.setFromMatrix(toPixiMatrix(node.matrix));
      display.alpha = node.opacity;
      display.blendMode = node.blend;
      this.updateContent(display, node);
    });

    for (const [id, display] of [...displays]) {
      if (!seen.has(id)) this.destroyDisplay(id, display, displays, kinds);
    }
  }

  /** Releases every Pixi display object owned by this adapter, including nested effectGroups. */
  destroy(): void {
    for (const [id, display] of [...this.displays]) this.destroyDisplay(id, display, this.displays, this.kinds);
  }

  private destroyDisplay(id: string, display: Display, displays: Map<string, Display>, kinds: Map<string, RenderNode["t"]>): void {
    const group = this.groups.get(id);
    if (group) {
      // Recursively tear down the nested level FIRST — its own children's
      // displays are children of `display` (this group's Container) and
      // would otherwise be destroyed redundantly/in an undefined order by
      // the outer `display.destroy({children:true})` below.
      for (const [childId, childDisplay] of [...group.displays]) {
        this.destroyDisplay(childId, childDisplay, group.displays, group.kinds);
      }
      this.groups.delete(id);
    }
    display.parent?.removeChild(display);
    display.destroy({ children: true });
    displays.delete(id);
    kinds.delete(id);
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
      case "effectGroup":
        // An ordinary Container — `reconcileEffectGroup` (called from
        // `updateContent`) populates it with this group's own nested
        // keyed-diff of `children`, and assigns `filters` from `passes`.
        return new Container();
      default:
        // "group" is filtered out by reconcileChildren() before this is called.
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
      case "effectGroup":
        this.reconcileEffectGroup(display, node);
        break;
    }
  }

  /**
   * Recurses into an "effectGroup" RenderNode: keyed-diffs `node.children`
   * into `container` using this group's OWN identity maps (a fresh
   * `EffectGroupState` per group id, created lazily and reused across
   * frames — exactly like the top-level `displays`/`kinds`, just scoped to
   * this nesting level instead of global), then assigns `container.filters`
   * from `node.passes` (resolved via `resolvePass`, passes/pass-resolver.ts
   * — Week 1-2 ships the mechanism only; real effect/mask/matte/adjustment
   * shaders land in their scheduled weeks per the Phase 2 blueprint §12).
   *
   * `node.isolate` is currently always honored by virtue of Pixi's own
   * `filters` mechanism: ANY non-empty `container.filters` already renders
   * `container`'s full subtree to a pooled texture before compositing
   * (Pixi's documented filter behavior — see Filter.d.ts). When
   * `node.passes` is empty (e.g. a `comp` precomp instance with no
   * mask/effect/matte of its own, Week 7-8), `isolate: true` still implies
   * an isolated composite — Week 1-2's test proves this specific case via
   * an explicit identity-shader pass, since an EMPTY `filters` array
   * degrades to "no isolation at all" in Pixi (nothing to prove the RTT
   * path executed). A real `isolate`-without-passes precomp will need that
   * same identity-pass fallback; tracked for Week 7-8.
   */
  private reconcileEffectGroup(container: Container, node: Extract<RenderNode, { t: "effectGroup" }>): void {
    let group = this.groups.get(node.id);
    if (!group) {
      group = { displays: new Map(), kinds: new Map() };
      this.groups.set(node.id, group);
    }

    this.reconcileChildren(container, node.children, group.displays, group.kinds);

    const filters = node.passes.map((pass) => resolvePass(pass)).filter((f): f is Filter => f !== null);
    container.filters = filters;
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