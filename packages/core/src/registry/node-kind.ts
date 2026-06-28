// packages/core/src/registry/node-kind.ts
//
// The open/closed seam (Deliverable 05.6 / Deliverable 06's "core iterates
// kinds it has never heard of"). A NodeKind packages everything specific to
// one kind of layer: its props schema, its animatable channels, its
// inspector UI description, how to create one, and how to render it.

import type { ZodType } from "zod";
import type { Rect } from "../types/primitives";
import type { Id } from "../types/ids";
import type { Frame } from "../types/ids";
import type { ChannelValue } from "../types/keyframe";
import type { ChannelType } from "../types/channel";
import type { Node, NodeKindId } from "../types/node";
import type { Composition } from "../types/composition";
import type { RenderNode } from "contract";

/** Describes one animatable property a NodeKind exposes to the timeline/UI. */
export interface ChannelSpec {
  /** Dotted path into the sampled node, e.g. "props.fontSize". */
  path: string;
  type: ChannelType;
  label: string;
  default: ChannelValue;
}

/** Describes one field the InspectorPanel should render for this kind (P1 Week 8). */
export interface InspectorField {
  path: string;
  label: string;
  control: "text" | "textarea" | "number" | "color" | "font" | "select" | "toggle" | "asset" | "shape";
  options?: string[];
  /** For control:"number" — when both min+max are set, renders as a bounded slider. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface NodeSchema {
  /** Validates `node.props`. */
  props: ZodType;
  channels: ChannelSpec[];
  inspector: InspectorField[];
}

/** Context passed to NodeKind.render / bounds by the Evaluator. */
export interface EvalCtx {
  fps: number;
  size: { width: number; height: number };
  /**
   * Resolves a precomp's Composition by id (P2). In Phase 1 this throws —
   * see evaluate-composition.ts.
   */
  resolveComp(id: Id): Composition;
  /**
   * Looks up an asset's native decoded pixel dimensions by id (from
   * `Project.assets[].width/height` — see project.ts's `AssetRef` doc).
   * `image.ts`/`video.ts`'s `imageBox` uses this to size `RenderNode.box`
   * to the asset's actual aspect ratio. Returns `undefined` if the asset
   * is unknown or its dimensions haven't been recorded yet, in which case
   * `imageBox` falls back to the composition's frame size (P1 default).
   *
   * Optional — `evaluateComposition` only supplies this when called with
   * a `resolveAsset` of its own (apps/editor's `renderTreeAt` selector
   * passes one built from `project.assets`); callers that don't care about
   * accurate image/video boxes (most core/nodekinds unit tests) can omit
   * it entirely.
   */
  resolveAsset?(assetId: Id): { width: number; height: number } | undefined;
}

/**
 * One kind of layer (Deliverable 10: group/image/video/text/shape in P1).
 * `render` is the only render method — core never branches on `node.kind`.
 */
export interface NodeKind {
  kind: NodeKindId;
  displayName: string;
  category: "media" | "text" | "vector" | "container" | "audio";
  /** True for kinds that hold `children` (e.g. "group"). */
  container?: boolean;
  schema: NodeSchema;
  /** Seeds a new node of this kind, merged with universal defaults by the registry. */
  defaults(): Partial<Node>;
  /**
   * Produces zero or more RenderNodes for this node at `frame`. `node` has
   * already been time-gated and channel-sampled by evaluateNode; the
   * `matrix`/`opacity`/`blend` fields of the returned RenderCommon are
   * placeholders — evaluateNode's `applyWorld` overwrites them with the
   * world transform and sampled opacity/blend.
   */
  render(node: Node, frame: Frame, ctx: EvalCtx): RenderNode[];
  /** Selection/snap bounding box in the node's local space (P1 Week 7). */
  bounds?(node: Node, frame: Frame, ctx: EvalCtx): Rect;
}