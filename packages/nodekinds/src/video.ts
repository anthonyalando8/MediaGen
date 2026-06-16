// packages/nodekinds/src/video.ts
import { z } from "zod";
import type { NodeKind } from "core";
import { FitSchema, imageBox, type Fit } from "./image";
import { srcFrame } from "./common";

/**
 * Media kind backed by a video asset. `time.in`/`time.out` trim the source;
 * `render()` maps the current timeline frame to the source frame to display
 * via `srcFrame` (Deliverable 10: "maps timeline frame → source frame via
 * trim"). Per the v1.0 MVP shortcut, Phase 1 preview uploads frames from a
 * hidden `<video>` element behind the same `TexRef{assetId, frame}` contract
 * (see packages/media/src/texture-source.ts) — `tex.frame` here is the
 * *source* frame number the TextureManager should seek to.
 */
export const videoKind: NodeKind = {
  kind: "video",
  displayName: "Video",
  category: "media",
  schema: {
    props: z.object({ fit: FitSchema, volume: z.number().min(0).max(1) }),
    channels: [],
    inspector: [
      { path: "source.assetId", label: "Video", control: "asset" },
      { path: "props.fit", label: "Fit", control: "select", options: ["cover", "contain", "fill"] },
      { path: "props.volume", label: "Volume", control: "number" },
      // Trim handles are drawn on the timeline itself, not the inspector
      // (Deliverable 09: TimelinePlaceholder), so no inspector field here.
    ],
  },
  defaults: () => ({ name: "Video", props: { fit: "contain", volume: 1 }, source: {} }),
  render: (node, frame, ctx) => [
    {
      id: node.id,
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], // placeholder — applyWorld overwrites
      opacity: 1, // placeholder — applyWorld overwrites
      blend: "normal", // placeholder — applyWorld overwrites
      t: "video",
      tex: { assetId: node.source?.assetId ?? "", frame: srcFrame(node, frame) },
      fit: (node.props.fit as Fit) ?? "contain",
      box: imageBox(ctx),
    },
  ],
  bounds: (_node, _frame, ctx) => imageBox(ctx), // P1 fallback — see image.ts's imageBox doc.
};