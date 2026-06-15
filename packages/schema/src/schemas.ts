// packages/schema/src/schemas.ts
//
// Zod mirrors of packages/core/src/types/*. This package has no dependency on
// `core` (core depends on `schema`, not the reverse — Deliverable 02), so the
// shapes below are independently defined but must stay structurally
// compatible with the TS interfaces in core/src/types.
//
// Used to validate documents coming from storage/the network before they are
// trusted as a `Project`, and as the input to migrate.ts.

import { z } from "zod";

export const Vec2Schema = z.object({ x: z.number(), y: z.number() });
export const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const ColorOKLCHSchema = z.object({
  l: z.number(),
  c: z.number(),
  h: z.number(),
  alpha: z.number().optional(),
});

export const BlendModeSchema = z.enum([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "add",
  "darken",
  "lighten",
]);

/** P2 — path-typed channels; inert in P1. */
export const PathDataSchema = z.object({
  points: z.array(Vec2Schema),
  closed: z.boolean(),
});

export const TimeSpanSchema = z.object({
  start: z.number(),
  duration: z.number(),
  in: z.number().optional(),
  out: z.number().optional(),
});

export const TransformSchema = z.object({
  position: Vec3Schema,
  scale: Vec2Schema,
  rotation: z.number(),
  anchor: Vec2Schema,
});

export const ChannelTypeSchema = z.enum(["scalar", "vec2", "vec3", "color", "angle", "path"]);
export const InterpSchema = z.enum(["hold", "linear", "bezier"]);

export const ChannelValueSchema = z.union([
  z.number(),
  Vec2Schema,
  Vec3Schema,
  ColorOKLCHSchema,
  PathDataSchema,
]);

export const KeyframeSchema = z.object({
  frame: z.number(),
  value: ChannelValueSchema,
  interp: InterpSchema,
  inHandle: z.tuple([z.number(), z.number()]).optional(),
  outHandle: z.tuple([z.number(), z.number()]).optional(),
});

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const JsonSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(JsonSchema), z.record(JsonSchema)])
);

export const ChannelSchema = z.object({
  id: z.string(),
  path: z.string(),
  type: ChannelTypeSchema,
  additive: z.boolean().optional(),
  keys: z.array(KeyframeSchema),
  generator: z
    .object({ id: z.string(), params: JsonSchema, baked: z.boolean() })
    .optional(),
});

export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), ColorOKLCHSchema]);

export const SourceSchema = z.object({
  assetId: z.string().optional(),
  generator: z.string().optional(),
  compId: z.string().optional(),
});

// P2 — reserved, inert in P1
export const EffectRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  params: z.record(ScalarSchema),
});

export const MaskSchema = z.object({
  id: z.string(),
  geom: JsonSchema,
  mode: z.enum(["add", "subtract", "intersect"]),
});

export const TrackMatteRefSchema = z.object({
  nodeId: z.string(),
  mode: z.enum(["alpha", "luma"]),
});

export interface NodeDoc {
  id: string;
  kind: string;
  name: string;
  transform: z.infer<typeof TransformSchema>;
  opacity: number;
  blend: z.infer<typeof BlendModeSchema>;
  time: z.infer<typeof TimeSpanSchema>;
  parentId?: string;
  lane?: string;
  locked?: boolean;
  hidden?: boolean;
  origin: "user" | "source";
  props: Record<string, z.infer<typeof ScalarSchema>>;
  channels: z.infer<typeof ChannelSchema>[];
  source?: z.infer<typeof SourceSchema>;
  children?: NodeDoc[];
  effects?: z.infer<typeof EffectRefSchema>[];
  masks?: z.infer<typeof MaskSchema>[];
  matte?: z.infer<typeof TrackMatteRefSchema>;
  isAdjustment?: boolean;
}

export const NodeSchema: z.ZodType<NodeDoc> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.string(),
    name: z.string(),
    transform: TransformSchema,
    opacity: z.number(),
    blend: BlendModeSchema,
    time: TimeSpanSchema,
    parentId: z.string().optional(),
    lane: z.string().optional(),
    locked: z.boolean().optional(),
    hidden: z.boolean().optional(),
    origin: z.enum(["user", "source"]),
    props: z.record(ScalarSchema),
    channels: z.array(ChannelSchema),
    source: SourceSchema.optional(),
    children: z.array(NodeSchema).optional(),
    effects: z.array(EffectRefSchema).optional(),
    masks: z.array(MaskSchema).optional(),
    matte: TrackMatteRefSchema.optional(),
    isAdjustment: z.boolean().optional(),
  })
);

/** P2 — precomp-overridable params; inert in P1. */
export const PropBindingSchema = z.object({
  path: z.string(),
  exposedAs: z.string(),
  default: JsonSchema,
});

export const CompositionSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.object({ width: z.number(), height: z.number() }),
  fps: z.number(),
  duration: z.number(),
  background: ColorOKLCHSchema.optional(),
  root: z.array(NodeSchema),
  exposed: z.array(PropBindingSchema).optional(),
});

export const AssetRefSchema = z.object({
  id: z.string(),
  hash: z.string(),
  kind: z.enum(["video", "image", "audio", "font", "lottie", "rig", "glb", "svg"]),
  master: z.string(),
  proxy: z.string().optional(),
  poster: z.string().optional(),
  waveform: z.string().optional(),
  provenance: z.enum(["upload", "stock", "generated"]).optional(),
  meta: z.record(JsonSchema).optional(),
});

export const OpSchema = z.object({
  id: z.string(),
  type: z.enum(["add", "remove", "set", "move", "reparent", "group"]),
  compId: z.string(),
  path: z.string(),
  before: JsonSchema,
  after: JsonSchema,
  txn: z.string(),
  ts: z.number(),
});

export const ProjectSchema = z.object({
  id: z.string(),
  schema: z.string(),
  name: z.string(),
  comps: z.record(CompositionSchema),
  rootCompId: z.string(),
  assets: z.array(AssetRefSchema),
  opLog: z.array(OpSchema),
  sceneRef: z.string().optional(),
});

export type ProjectDoc = z.infer<typeof ProjectSchema>;
