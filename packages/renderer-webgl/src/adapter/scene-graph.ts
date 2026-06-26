// packages/renderer-webgl/src/adapter/scene-graph.ts
//
// "Reconcile a RenderTree into Pixi Container/Sprite/Text/Graphics by id
// (keyed diff)" (Deliverable 08). NO domain types cross this boundary —
// only `contract` (RenderTree/RenderNode) and `pixi.js`.

import { Container, Graphics, Matrix, Rectangle, RenderTexture, Sprite, Text } from "pixi.js";
import type { Renderer } from "pixi.js";
import type { ColorOKLCH, GlyphRun, PassSpec, RenderNode, RenderTree, ShapeGeom, Stroke } from "contract";
import { oklchToHex } from "../color";
import { toPixiMatrix, inverseTransformRect } from "../matrix";
import type { TextureManager } from "../textures/manager";
import { resolvePass } from "../passes/pass-resolver";
import { resolveTransitionFilter, destroyTransitionFilter } from "../passes/transition-resolver";
import { buildMaskFilter } from "../passes/mask-pass";
import type { MaskSpec } from "../passes/mask-pass";

type Display = Container;

/**
 * One nesting level's complete keyed-diff state, bundled together. A node
 * id is only unique WITHIN its level — an effectGroup wrapper and the
 * single child it wraps even share the exact same id by construction
 * (core/evaluator/evaluate-node.ts: the wrapper takes `id: node.id`, and
 * so does its sole un-wrapped child). Bundling `displays`/`kinds`/`groups`
 * into one object that's threaded through the recursion as a single unit
 * (rather than three separately-defaulted parameters, where `groups`
 * previously silently fell back to a single always-global `this.groups`)
 * makes it IMPOSSIBLE to accidentally pair a child level's
 * `displays`/`kinds` with the WRONG level's `groups` map — exactly the bug
 * that caused `destroyDisplay` to recurse into itself infinitely when an
 * effectGroup's id collided with its own child's id across two different
 * levels. An effectGroup's own nested state (`EffectGroupState`) is the
 * exact same shape — a group is itself just another complete level — so
 * the two are the same type, not two parallel ones.
 */
interface LevelState {
  displays: Map<string, Display>;
  kinds: Map<string, RenderNode["t"]>;
  groups: Map<string, LevelState>;
  /** Per-id "transitionGroup" state — see TransitionGroupState's doc. Threaded through the recursion exactly like `groups`, for the identical id-scoping reason (LevelState's own doc). */
  transitionGroups: Map<string, TransitionGroupState>;
  /** Offscreen RenderTextures for matte sources, keyed by "${effectGroupId}:${srcNodeId}". Created lazily when a matte pass resolves; destroyed when the effectGroup is torn down. */
  matteTextures?: Map<string, RenderTexture>;
  /** Offscreen Canvas2D elements for mask rasterisation, keyed by effectGroup node id. Reused across frames for efficiency. */
  maskCanvases?: Map<string, HTMLCanvasElement>;
}

/** An effectGroup's own nested reconciliation state — structurally identical to a LevelState (a group IS a level), kept as a named alias for readability at call sites that specifically mean "one group's state." */
type EffectGroupState = LevelState;

function createLevelState(): LevelState {
  return { displays: new Map(), kinds: new Map(), groups: new Map(), transitionGroups: new Map() };
}

/**
 * Per-"transitionGroup" state — kept in its own map (`transitionGroups`,
 * parallel to `LevelState.groups`) rather than folded into `LevelState`
 * itself, since a transitionGroup's shape is genuinely different: TWO
 * independent nested levels (`fromLevel`/`toLevel`, one per side) plus a
 * persistent GPU resource (`toTexture`) that needs explicit `.destroy()`
 * on teardown — none of which any other RenderNode variant needs.
 */
interface TransitionGroupState {
  fromLevel: LevelState;
  toLevel: LevelState;
  /** The TO side's offscreen render target — re-rendered every reconcile (its content may itself be animated), destroyed when this transitionGroup is torn down. */
  toTexture: RenderTexture;
  /** A throwaway Container the TO side's keyed-diff renders into, then is rendered (via the real Pixi Renderer) into `toTexture` — never added to the visible tree itself. */
  toContainer: Container;
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
  /** The top-level keyed-diff state — see LevelState's doc. */
  private level: LevelState = createLevelState();
  /** `tree.size` from the most recent `reconcile()` call — needed to size a "transitionGroup"'s render-textures correctly (reconcileTransitionGroup). Defaults to a harmless placeholder before the first reconcile. */
  private compSize = { width: 1, height: 1 };

  /** Whether the timeline is currently playing — passed down to `textures.get()` so video elements play naturally during playback rather than being seek-driven every frame. */
  private playing = false;

  constructor(
    private readonly textures: TextureManager,
    private readonly getRenderer: () => Renderer | undefined = () => undefined,
    private fps = 30
  ) {
    this.root.sortableChildren = true;
  }

  setFps(fps: number): void {
    this.fps = fps;
  }

  reconcile(tree: RenderTree, playing = false): void {
    this.compSize = tree.size;
    this.playing = playing;
    this.reconcileChildren(this.root, tree.nodes, this.level);
  }

  /**
   * The shared keyed-diff loop — operates on `nodes` (in z-order) against
   * `target` (a Pixi Container), using `level`'s own identity maps. Used
   * for both the top-level `tree.nodes` (via `reconcile`) and a nested
   * `effectGroup.children` (via `reconcileEffectGroup`) — each call site
   * passes ITS OWN `LevelState`, never a parent's or a global default (see
   * LevelState's doc on why that distinction is load-bearing).
   */
  private reconcileChildren(target: Container, nodes: RenderNode[], level: LevelState): void {
    const { displays, kinds } = level;
    const seen = new Set<string>();

    nodes.forEach((node, index) => {
      if (node.t === "group") return; // P1: no visual content — see class doc.
      seen.add(node.id);

      let display = displays.get(node.id);
      if (display && kinds.get(node.id) !== node.t) {
        this.destroyDisplay(node.id, display, level);
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
      this.updateContent(display, node, level);
    });

    for (const [id, display] of [...displays]) {
      if (!seen.has(id)) this.destroyDisplay(id, display, level);
    }
  }

  /** Releases every Pixi display object owned by this adapter, including nested effectGroups. */
  destroy(): void {
    for (const [id, display] of [...this.level.displays]) this.destroyDisplay(id, display, this.level);
  }

  /**
   * Tears down `id`'s display, recursing into its nested effectGroup state
   * FIRST if it has one — looked up from `level.groups` (THIS level's own
   * map), never a different level's. Previously this looked up a single
   * always-global `this.groups`, which meant tearing down a CHILD whose id
   * happened to collide with its OWN PARENT effectGroup's id (exactly the
   * wrapper/child id-sharing case above) would incorrectly find the
   * parent's group state again and recurse into destroying it — which
   * recurses into destroying ITS child again — infinitely. Threading the
   * correct `level` through eliminates the collision: the child's
   * `level.groups` (its OWN level) simply has no entry for that id unless
   * the child itself is genuinely an effectGroup.
   */
  private destroyDisplay(id: string, display: Display, level: LevelState): void {
    const group = level.groups.get(id);
    if (group) {
      for (const [childId, childDisplay] of [...group.displays]) {
        this.destroyDisplay(childId, childDisplay, group);
      }
      // Destroy any matte textures this effectGroup owned
      if (group.matteTextures) {
        for (const tex of group.matteTextures.values()) tex.destroy(true);
        group.matteTextures.clear();
      }
      // Release any mask rasterisation canvases
      if (group.maskCanvases) group.maskCanvases.clear();
      level.groups.delete(id);
    }
    const transitionGroup = level.transitionGroups.get(id);
    if (transitionGroup) {
      for (const [childId, childDisplay] of [...transitionGroup.fromLevel.displays]) {
        this.destroyDisplay(childId, childDisplay, transitionGroup.fromLevel);
      }
      for (const [childId, childDisplay] of [...transitionGroup.toLevel.displays]) {
        this.destroyDisplay(childId, childDisplay, transitionGroup.toLevel);
      }
      transitionGroup.toContainer.destroy({ children: true });
      transitionGroup.toTexture.destroy(true);
      destroyTransitionFilter(id);
      level.transitionGroups.delete(id);
    }
    display.parent?.removeChild(display);
    display.destroy({ children: true });
    level.displays.delete(id);
    level.kinds.delete(id);
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
      case "transitionGroup":
        // The FROM side's own Container — `reconcileTransitionGroup`
        // (called from `updateContent`) populates it with the FROM
        // subtree's keyed-diff and assigns the transition `Filter` to it.
        // The TO side gets its OWN separate, off-tree Container
        // (`TransitionGroupState.toContainer`, created lazily inside
        // `reconcileTransitionGroup` itself, not here) — never added to
        // this display's children, since it's rendered to a texture
        // instead of drawn directly.
        return new Container();
      default:
        // "group" is filtered out by reconcileChildren() before this is called.
        throw new Error(`unhandled RenderNode type: ${(node as RenderNode).t}`);
    }
  }

  private updateContent(display: Display, node: RenderNode, level: LevelState): void {
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
        this.reconcileEffectGroup(display, node, level);
        break;
      case "transitionGroup":
        this.reconcileTransitionGroup(display, node, level);
        break;
    }
  }

  /**
   * Recurses into an "effectGroup" RenderNode: keyed-diffs `node.children`
   * into `container` using a FRESH, NESTED `LevelState` of its own (created
   * lazily and reused across frames, exactly like the top-level `level`,
   * just scoped one level deeper) — registered into `parentLevel.groups`
   * (the level the effectGroup ITSELF was just reconciled within, passed
   * in from `updateContent`/`reconcileChildren`), never a single global
   * map. This is what makes the wrapper/child id-sharing case safe: the
   * wrapper's entry lives in `parentLevel.groups`, while its child's
   * (possibly identical) id is looked up against THIS group's OWN
   * `level.groups` one level down — two distinct maps, so a shared id
   * between them can never collide.
   *
   * Then assigns `container.filters` from `node.passes` (resolved via
   * `resolvePass`, passes/pass-resolver.ts — Week 3-4 ships real "effect"
   * passes; mask/matte/adjustment shaders land in their scheduled weeks
   * per the Phase 2 blueprint §12).
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
  private reconcileEffectGroup(container: Container, node: Extract<RenderNode, { t: "effectGroup" }>, parentLevel: LevelState): void {
    let group = parentLevel.groups.get(node.id);
    if (!group) {
      group = createLevelState();
      parentLevel.groups.set(node.id, group);
    }

    this.reconcileChildren(container, node.children, group);

    // For matte passes: render the source node's display into an offscreen
    // RenderTexture so the matte shader can sample it. The source display
    // lives in the PARENT level (a sibling, per blueprint §4.2 "sibling's
    // alpha/luma stencils this node"). Degrades gracefully if the renderer
    // isn't ready yet or the source id is unknown — same "next frame picks
    // it up" tolerance as transitionGroup.
    const mattePasses = node.passes.filter((p) => p.kind === "matte" && p.srcNodeId);
    const maskPasses = node.passes.filter((p) => p.kind === "mask");

    // LOCAL-space rect covering the whole comp, in THIS container's own
    // local coordinate space — see matrix.ts's inverseTransformRect doc.
    // Computed once, used as the coordinate space for BOTH the mask
    // rasterisation canvas AND the matte source render target, matching
    // the Filter's filterArea (set below) so vTextureCoord lines up
    // between uTexture and uMask/uMatte.
    const needsLocalRect = mattePasses.length > 0 || maskPasses.length > 0;
    const localRect = needsLocalRect
      ? inverseTransformRect(node.matrix, { x: 0, y: 0, width: this.compSize.width, height: this.compSize.height })
      : null;

    const getMatteTexture = (srcNodeId: string): import("pixi.js").Texture | undefined => {
      const renderer = this.getRenderer();
      if (!renderer || !localRect) return undefined;
      const srcDisplay = parentLevel.displays.get(srcNodeId);
      if (!srcDisplay) return undefined;

      const key = `${node.id}:${srcNodeId}`;
      if (!parentLevel.matteTextures) parentLevel.matteTextures = new Map();
      const texWidth = Math.max(1, Math.ceil(localRect.width));
      const texHeight = Math.max(1, Math.ceil(localRect.height));
      let tex = parentLevel.matteTextures.get(key);
      if (!tex) {
        tex = RenderTexture.create({ width: texWidth, height: texHeight });
        parentLevel.matteTextures.set(key, tex);
      }
      if (tex.width !== texWidth || tex.height !== texHeight) {
        tex.resize(texWidth, texHeight);
      }
      // Offset the render by -localRect.x/y so the texture's pixel grid
      // origin (0,0) aligns with filterArea's origin — srcDisplay's own
      // worldTransform already positions it in comp space; this additional
      // translation re-roots that into the SAME local space the masked/
      // matted node's filterArea uses.
      const offsetTransform = new Matrix(1, 0, 0, 1, -localRect.x, -localRect.y);
      renderer.render({ container: srcDisplay as Container, target: tex, transform: offsetTransform });
      return tex;
    };

    const filters = node.passes.flatMap((pass) => resolvePass(pass, getMatteTexture));

    // MASK passes: rasterise all mask specs together onto a single Canvas2D
    // stencil (multiple masks composite on the same canvas via
    // globalCompositeOperation — see mask-pass.ts). The resulting Filter
    // is prepended before any matte/effect filters since masks clip the
    // node's own content FIRST.
    let allFilters = filters;
    if (maskPasses.length > 0 && localRect) {
      const maskSpecs: MaskSpec[] = maskPasses.map((p) => {
        const u = p.uniforms as { path: unknown; feather: number; mode: string; opacity: number; inverted: boolean };
        return {
          path: u.path as import("contract").MaskPath,
          mode: (u.mode ?? "add") as MaskSpec["mode"],
          feather: u.feather ?? 0,
          opacity: u.opacity ?? 1,
          inverted: Boolean(u.inverted),
        };
      });
      if (!parentLevel.maskCanvases) parentLevel.maskCanvases = new Map();
      const maskResult = buildMaskFilter(maskSpecs, localRect, parentLevel.maskCanvases.get(node.id));
      if (maskResult) {
        parentLevel.maskCanvases.set(node.id, maskResult.canvas);
        allFilters = [maskResult.filter, ...filters];
      }
    }

    container.filters = allFilters;
    if (localRect) {
      container.filterArea = new Rectangle(localRect.x, localRect.y, localRect.width, localRect.height);
    }
  }

  /**
   * Recurses into a "transitionGroup" RenderNode (contract's doc — the
   * one two-input compositing primitive): keyed-diffs `node.from` into
   * `container` (THIS display, added to the visible tree exactly like any
   * other node) and `node.to` into a separate, lazily-created, never-
   * added-to-the-tree `toContainer`. Every reconcile, `toContainer` is
   * rendered into a `RenderTexture` (`toTexture`, resized to the comp's
   * own `compSize` — see its field doc) via the REAL Pixi Renderer
   * (`this.getRenderer()` — see canvas-host.ts's doc on why this can be
   * `undefined` before the GPU context is ready, degrading to "this
   * transitionGroup doesn't render this frame" rather than throwing, the
   * same tolerance every GL-context-dependent construction in this
   * package already has). `container.filters` is then set to the
   * transition's own `Filter` (transition-resolver.ts's
   * `resolveTransitionFilter`) — which reads `container`'s own rendered
   * subtree (the FROM side) as its implicit input, and `toTexture` as an
   * added resource (`uTo`).
   *
   * `node.from`/`node.to` are each a COMPLETE RenderNode (contract's doc:
   * "typically the two z-order-adjacent siblings... already independently
   * evaluated") — keyed-diffed via `reconcileChildren` against a
   * single-element array, exactly like any other nested level, so a
   * "from"/"to" side that's itself a "group" or "effectGroup" recurses
   * correctly through the EXACT same machinery as everywhere else in this
   * file.
   */
  private reconcileTransitionGroup(container: Container, node: Extract<RenderNode, { t: "transitionGroup" }>, parentLevel: LevelState): void {
    let state = parentLevel.transitionGroups.get(node.id);
    if (!state) {
      const toContainer = new Container();
      const toTexture = RenderTexture.create({ width: this.compSize.width, height: this.compSize.height });
      state = { fromLevel: createLevelState(), toLevel: createLevelState(), toTexture, toContainer };
      parentLevel.transitionGroups.set(node.id, state);
    }

    // `toTexture`'s size can only be known once `compSize` has actually
    // been set by a real `reconcile()` call (constructor-time default is
    // a harmless 1x1 placeholder) — resize whenever the comp's own output
    // size changes (composition resize, or simply differs from the
    // placeholder on this transitionGroup's first real frame).
    if (state.toTexture.width !== this.compSize.width || state.toTexture.height !== this.compSize.height) {
      state.toTexture.resize(this.compSize.width, this.compSize.height);
    }

    this.reconcileChildren(state.toContainer, [node.to], state.toLevel);
    this.reconcileChildren(container, [node.from], state.fromLevel);

    // CRITICAL — without this, Pixi's default filter-bounds behavior
    // (FilterSystem.mjs's `_calculateFilterArea`: no `filterArea` set ->
    // `getGlobalRenderableBounds`/`getFastGlobalBounds`) sizes the
    // filter's OWN input texture (and the `uOutputFrame`/`uInputSize`
    // uniforms DEFAULT_VERTEX derives `vTextureCoord` from) to the FROM
    // content's own rendered bounding box — e.g. a single 200x200 shape,
    // NOT the full composition. `uTo` (this.compSize-sized, built
    // independently above) and `uFrom` (Pixi's implicit input) would then
    // be sampled with the SAME `vTextureCoord` but represent two
    // DIFFERENT coordinate spaces — `uTo` ends up sampled through a tiny
    // sliver of itself, reading transparent/garbage pixels for most of
    // the frame. This is the actual cause of a transitioning shape
    // rendering as fully invisible once a real overlap existed (only
    // reachable with a real GPU — the headless mocked-renderer tests
    // never executed Pixi's actual bounds-fitting code, so this never
    // surfaced until manual browser testing). Fixing the filter's input
    // area to the WHOLE comp guarantees `vTextureCoord` is in the same
    // comp-pixel space for both samplers, matching the convention every
    // transition's own GLSL already assumes (`uFrom`/`uTo` sampled at the
    // SAME `vTextureCoord` — dip.ts/wipe.ts/etc.).
    container.filterArea = new Rectangle(0, 0, this.compSize.width, this.compSize.height);

    const renderer = this.getRenderer();
    if (!renderer) {
      // GPU context not ready yet (canvas-host.ts's async-init doc) —
      // degrade to "no filter this frame" rather than throwing; the FROM
      // side still renders normally (just without the transition blend),
      // and the next reconcile (once ready) picks up correctly.
      container.filters = [];
      return;
    }
    renderer.render({ container: state.toContainer, target: state.toTexture });

    const filter = resolveTransitionFilter(String(node.id), node.ref, node.uniforms, node.progress, state.toTexture);
    container.filters = filter ? [filter] : [];
  }

  private updateSprite(container: Container, node: Extract<RenderNode, { t: "image" | "video" }>): void {
    const sprite = container.children[0] as Sprite;
    const texture = this.textures.get(node.tex, this.fps, this.playing);
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
      text.style.fontStyle = run.italic ? "italic" : "normal";
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
      case "polygon": {
        const pts = geom.points;
        if (pts.length < 2) break;
        graphics.moveTo(pts[0].point.x, pts[0].point.y);
        for (let i = 0; i < pts.length; i++) {
          const curr = pts[i];
          const next = pts[(i + 1) % pts.length];
          if (i === pts.length - 1 && !geom.closed) break;
          // Cubic bezier: curr.outHandle → next.inHandle
          const cp1 = curr.outHandle
            ? { x: curr.point.x + curr.outHandle.x, y: curr.point.y + curr.outHandle.y }
            : curr.point;
          const cp2 = next.inHandle
            ? { x: next.point.x + next.inHandle.x, y: next.point.y + next.inHandle.y }
            : next.point;
          graphics.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, next.point.x, next.point.y);
        }
        if (geom.closed) graphics.closePath();
        break;
      }
    }
    if (fill && geom.kind !== "line") {
      graphics.fill(oklchToHex(fill));
    }
    if (stroke) {
      graphics.stroke({ width: stroke.width, color: oklchToHex(stroke.color) });
    } else if (geom.kind === "line") {
      graphics.stroke({ width: 1, color: fill ? oklchToHex(fill) : 0x000000 });
    }
  }
}