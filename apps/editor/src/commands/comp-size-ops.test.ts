// apps/editor/src/commands/comp-size-ops.test.ts
//
// Regression coverage for three related bugs, fixed in sequence:
//
// 1. "changing Frame Size doesn't rescale existing content" — setCompSizeOp
//    only ever changed `/size` and touched nothing else.
// 2. "repeated aspect-ratio switches shrink content toward nothing" — the
//    first fix computed each resize's scale relative to whatever
//    `comp.size` currently was, which after one letterboxed resize no
//    longer matched how big the content visually was. Fixed via
//    `comp.resizeRef` (a stable base size + cumulative applied transform).
// 3. "4K got worse, 1:1/9:16 render tiny and off-center" — the SECOND fix
//    scaled the beat's ancestor GROUP node, which the renderer then
//    composed on top of image/video nodes' OWN already-correct,
//    self-adjusting box (imageBox() in packages/nodekinds/src/image.ts
//    reads the CURRENT comp size directly, independent of ancestor
//    transforms) — double-applying the resize to backgrounds specifically.
//    Fixed by recursing the whole tree, skipping image/video nodes
//    entirely, and leaving group nodes' own transform inert (rescaling
//    text/shape descendants directly instead of relying on ancestor
//    propagation, which would double-scale them if the group also moved).
import { describe, expect, it } from "vitest";
import { rescaleRootOp, setCompSizeOp } from "./comp-size-ops";
import type { Composition, Node } from "core";

function fakeNode(overrides: Record<string, unknown> = {}): Node {
  return {
    id: "n1", kind: "text", name: "text",
    transform: { position: { x: 100, y: 200, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    opacity: 1, blend: "normal",
    time: { start: 0, duration: 90 },
    origin: "user",
    props: {},
    channels: [],
    ...overrides,
  } as unknown as Node;
}

/** A realistic beat group: identity transform + a camera-move channel (like
 * cameraChannels in scene-import.ts), a background image child, and a text
 * child — the actual shape buildBeatGroup produces. */
function fakeBeatGroup(): Node {
  return fakeNode({
    id: "beat1", kind: "group", name: "Beat 1",
    transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
    channels: [
      { id: "cam", path: "transform.scale", type: "vec2", keys: [
        { frame: 0, value: { x: 1.0, y: 1.0 }, interp: "bezier" },
        { frame: 30, value: { x: 1.06, y: 1.06 }, interp: "linear" },
      ] },
    ],
    children: [
      fakeNode({ id: "bg", kind: "image", name: "bg", transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } }, channels: [] }),
      fakeNode({ id: "keyword", kind: "text", name: "keyword", transform: { position: { x: 100, y: 200, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } }, channels: [] }),
    ],
  });
}

function fakeComp(root: Node[], width: number, height: number, resizeRef?: Composition["resizeRef"]): Composition {
  return {
    id: "c1", name: "Main", size: { width, height }, fps: 30,
    duration: 90 as never, background: { l: 0, c: 0, h: 0 },
    root, audioTracks: [], resizeRef,
  } as unknown as Composition;
}

function resize(comp: Composition, nw: number, nh: number): Composition {
  const { width: ow, height: oh } = comp.size;
  const { rootOp, resizeRefOp } = rescaleRootOp(comp, ow, oh, nw, nh);
  return {
    ...comp,
    size: { width: nw, height: nh },
    root: rootOp.after as unknown as Node[],
    resizeRef: resizeRefOp.after as unknown as Composition["resizeRef"],
  };
}

describe("setCompSizeOp", () => {
  it("only touches /size — unaffected by the rescale fix", () => {
    const op = setCompSizeOp(fakeComp([], 1920, 1080), 3840, 2160);
    expect(op.path).toBe("/size");
    expect(op.after).toEqual({ width: 3840, height: 2160 });
  });
});

describe("rescaleRootOp — top-level non-group node (e.g. a manually-added shape/text)", () => {
  it("same-aspect-ratio resize (1920x1080 -> 3840x2160): exact 2x scale, zero letterbox offset", () => {
    const node = fakeNode({ kind: "shape" });
    const { rootOp } = rescaleRootOp(fakeComp([node], 1920, 1080), 1920, 1080, 3840, 2160);
    const after = rootOp.after as unknown as Node[];
    expect(after[0].transform.position.x).toBeCloseTo(200); // 100 * 2 + 0 offset
    expect(after[0].transform.position.y).toBeCloseTo(400); // 200 * 2 + 0 offset
    expect(after[0].transform.scale.x).toBeCloseTo(2);
  });

  it("aspect-ratio-CHANGING resize (1920x1080 -> 1080x1920): uniform scale by the smaller ratio, centered (letterboxed)", () => {
    const node = fakeNode({ kind: "shape", transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } } });
    const { rootOp } = rescaleRootOp(fakeComp([node], 1920, 1080), 1920, 1080, 1080, 1920);
    const after = rootOp.after as unknown as Node[];
    expect(after[0].transform.scale.x).toBeCloseTo(0.5625);
    expect(after[0].transform.position.x).toBeCloseTo(0);
    expect(after[0].transform.position.y).toBeCloseTo(656.25);
  });

  it("produces a single 'set' op on /root plus a companion /resizeRef op", () => {
    const comp = fakeComp([fakeNode({ kind: "shape" })], 1920, 1080);
    const { rootOp, resizeRefOp } = rescaleRootOp(comp, 1920, 1080, 3840, 2160);
    expect(rootOp.type).toBe("set");
    expect(rootOp.path).toBe("/root");
    expect(resizeRefOp.path).toBe("/resizeRef");
  });

  it("captures baseSize from the FIRST resize's old dimensions when comp.resizeRef doesn't exist yet", () => {
    const comp = fakeComp([fakeNode({ kind: "shape" })], 1920, 1080);
    const { resizeRefOp } = rescaleRootOp(comp, 1920, 1080, 3840, 2160);
    const ref = resizeRefOp.after as unknown as NonNullable<Composition["resizeRef"]>;
    expect(ref.baseSize).toEqual({ width: 1920, height: 1080 });
  });
});

describe("rescaleRootOp — image/video nodes are NEVER touched (imageBox self-adjusts to comp size already)", () => {
  it("a top-level image node's transform and channels are byte-for-byte unchanged", () => {
    const img = fakeNode({
      kind: "image",
      transform: { position: { x: 42, y: 99, z: 0 }, scale: { x: 1.3, y: 1.3 }, rotation: 0, anchor: { x: 0, y: 0 } },
      channels: [{ id: "kb", path: "transform.scale", type: "vec2", keys: [{ frame: 0, value: { x: 1.0, y: 1.0 }, interp: "bezier" }] }],
    });
    const { rootOp } = rescaleRootOp(fakeComp([img], 1920, 1080), 1920, 1080, 1080, 1920);
    expect(rootOp.after).toEqual([img]);
  });

  it("a video node nested inside a group is also left completely untouched", () => {
    const video = fakeNode({ kind: "video", id: "v1", transform: { position: { x: 10, y: 20, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } } });
    const group = fakeNode({
      kind: "group", id: "g1",
      transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0, y: 0 } },
      children: [video],
    });
    const { rootOp } = rescaleRootOp(fakeComp([group], 1920, 1080), 1920, 1080, 1080, 1920);
    const after = rootOp.after as unknown as Node[];
    expect(after[0].children![0]).toEqual(video);
  });
});

describe("rescaleRootOp — group nodes: own transform/channels stay inert, children get rescaled", () => {
  it("the beat group's own transform.position/scale is untouched", () => {
    const group = fakeBeatGroup();
    const { rootOp } = rescaleRootOp(fakeComp([group], 1920, 1080), 1920, 1080, 3840, 2160);
    const after = (rootOp.after as unknown as Node[])[0];
    expect(after.transform).toEqual(group.transform);
  });

  it("the beat group's own camera-move channel (relative, resolution-independent) is untouched", () => {
    const group = fakeBeatGroup();
    const { rootOp } = rescaleRootOp(fakeComp([group], 1920, 1080), 1920, 1080, 3840, 2160);
    const after = (rootOp.after as unknown as Node[])[0];
    expect(after.channels).toEqual(group.channels);
  });

  it("the group's background image child is untouched, but its text child IS rescaled — same beat, different treatment per node kind", () => {
    const group = fakeBeatGroup();
    const { rootOp } = rescaleRootOp(fakeComp([group], 1920, 1080), 1920, 1080, 3840, 2160);
    const after = (rootOp.after as unknown as Node[])[0];
    const bg = after.children!.find((c) => c.id === "bg")!;
    const keyword = after.children!.find((c) => c.id === "keyword")!;

    expect(bg.transform).toEqual(group.children![0].transform); // untouched

    expect(keyword.transform.position.x).toBeCloseTo(200); // 100 * 2 + 0 offset — rescaled
    expect(keyword.transform.position.y).toBeCloseTo(400);
    expect(keyword.transform.scale.x).toBeCloseTo(2);
  });
});

describe("rescaleRootOp — repeated resizes don't compound (the reported bug)", () => {
  it("switching 16:9 -> 9:16 -> back to the ORIGINAL 16:9 size restores the text child's EXACT original position and scale", () => {
    const original = fakeComp([fakeBeatGroup()], 1920, 1080);
    const afterPortrait = resize(original, 1080, 1920);
    const backToLandscape = resize(afterPortrait, 1920, 1080);

    const keyword = backToLandscape.root[0].children!.find((c) => c.id === "keyword")!;
    expect(keyword.transform.position.x).toBeCloseTo(100); // original untouched value
    expect(keyword.transform.position.y).toBeCloseTo(200);
    expect(keyword.transform.scale.x).toBeCloseTo(1);
  });

  it("cycling through FIVE different aspect ratios and back to the original does not shrink text content at all", () => {
    let comp = fakeComp([fakeBeatGroup()], 1920, 1080);
    const sizes: [number, number][] = [[1080, 1920], [1080, 1080], [3840, 2160], [1080, 1920], [1920, 1080]];
    for (const [w, h] of sizes) comp = resize(comp, w, h);

    const keyword = comp.root[0].children!.find((c) => c.id === "keyword")!;
    expect(keyword.transform.position.x).toBeCloseTo(100);
    expect(keyword.transform.position.y).toBeCloseTo(200);
    expect(keyword.transform.scale.x).toBeCloseTo(1);
  });

  it("the background image survives the same five-step chain completely untouched throughout (never accumulates any transform)", () => {
    let comp = fakeComp([fakeBeatGroup()], 1920, 1080);
    const originalBg = (fakeBeatGroup().children![0]).transform;
    const sizes: [number, number][] = [[1080, 1920], [1080, 1080], [3840, 2160], [1080, 1920], [1920, 1080]];
    for (const [w, h] of sizes) comp = resize(comp, w, h);

    const bg = comp.root[0].children!.find((c) => c.id === "bg")!;
    expect(bg.transform).toEqual(originalBg);
  });

  it("baseSize stays fixed across a whole resize chain, never drifting to an intermediate size", () => {
    let comp = fakeComp([fakeBeatGroup()], 1920, 1080);
    comp = resize(comp, 1080, 1920);
    comp = resize(comp, 1080, 1080);
    comp = resize(comp, 3840, 2160);
    expect(comp.resizeRef!.baseSize).toEqual({ width: 1920, height: 1080 });
  });
});
