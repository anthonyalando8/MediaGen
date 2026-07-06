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

// Phase 2 §4.1 — mirrors core/src/types/effect.ts.
export const EffectRefSchema = z.object({
  id: z.string(),
  effect: z.string(),
  enabled: z.boolean(),
  props: z.record(ScalarSchema),
  channels: z.array(ChannelSchema).optional(),
});

export const TransitionRefSchema = z.object({
  preset: z.string(),
  durationF: z.number(),
  props: z.record(ScalarSchema),
});

// Phase 2 §4.2 — mirrors core/src/types/mask.ts.
export const BezierPointSchema = z.object({
  point: Vec2Schema,
  inHandle: Vec2Schema.optional(),
  outHandle: Vec2Schema.optional(),
});

export const MaskPathSchema = z.object({
  points: z.array(BezierPointSchema),
  closed: z.boolean(),
});

export const MaskSchema = z.object({
  id: z.string(),
  mode: z.enum(["add", "subtract", "intersect"]),
  path: MaskPathSchema,
  feather: z.number(),
  opacity: z.number(),
  inverted: z.boolean(),
  channels: z.array(ChannelSchema).optional(),
});

// Phase 2 §4.2 — mirrors core/src/types/matte.ts.
export const TrackMatteRefSchema = z.object({
  sourceNodeId: z.string(),
  type: z.enum(["alpha", "luma", "alpha-inv", "luma-inv"]),
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
  transitionIn?: z.infer<typeof TransitionRefSchema>;
  transitionOut?: z.infer<typeof TransitionRefSchema>;
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
    transitionIn: TransitionRefSchema.optional(),
    transitionOut: TransitionRefSchema.optional(),
  })
);

// Phase 2 §4.3 — mirrors core/src/types/exposed.ts.
export const PropBindingSchema = z.object({
  key: z.string(),
  label: z.string(),
  target: z.object({ nodeId: z.string(), path: z.string() }),
  type: z.enum(["scalar", "color", "text", "asset"]),
});

export const AudioTrackSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  name: z.string(),
  startFrame: z.number(),
  endFrame: z.number().optional(),
  trimIn: z.number(),
  trimOut: z.number().optional(),
  volume: z.number(),
  fadeIn: z.number(),
  fadeOut: z.number(),
  loop: z.boolean(),
  muted: z.boolean(),
  solo: z.boolean(),
  lane: z.number(),
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
  // Bug fix: this field existed on core's `Composition` TypeScript type and
  // was written correctly by addAudioTrackOp (audio-ops.ts, `/audioTracks`
  // op path) the whole time, but was never added HERE. Zod's `z.object()`
  // strips unrecognized keys by default — so `ProjectSchema.safeParse()`
  // on load silently dropped every composition's audioTracks, even though
  // `JSON.stringify` on save wrote them out fine. Net effect: add an audio
  // track, refresh, and it vanishes from the timeline (the underlying
  // audio ASSET survived, since AssetRefSchema below was correctly kept in
  // sync with core's AssetRef — this field just never was).
  audioTracks: z.array(AudioTrackSchema).optional(),
});

export const AssetRefSchema = z.object({
  id: z.string(),
  hash: z.string(),
  kind: z.enum(["video", "image", "audio", "font", "lottie", "rig", "glb", "svg"]),
  master: z.string(),
  proxy: z.string().optional(),
  poster: z.string().optional(),
  waveform: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
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