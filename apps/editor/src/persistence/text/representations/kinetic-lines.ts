// apps/editor/src/persistence/text/representations/kinetic-lines.ts
//
// P1 · Animated typography, per-line staggered pop-in (kinetic_type).
// Verbatim routing: kineticTextNodes starting at the "heroSub" role.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor } from "../services/type-scale";
import { MAX_BLOCK_H } from "../services/layout";
import { kineticTextNodes } from "../services/nodes";
import { layerWindow } from "../services/timing";

export const kineticLines: TextRepresentation = {
  id: "kinetic-lines",
  fields: ["body"],
  region: "full",
  supports: (i) => (i.intent === "emphasis" ? 1 : i.reveal === "kinetic" ? 0.9 : i.intent === "title" ? 0.4 : 0.2),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const sb = ctx.safe;
    const out: Node[] = [];
    for (const layer of ctx.textLayers) {
      const win = layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps);
      const boxH = Math.min(sb.h, Math.round(H * MAX_BLOCK_H));
      const centerY = layer.anchor_y ?? 0.5;
      const boxTop = Math.max(sb.y, Math.min(Math.round(centerY * H - boxH / 2), sb.y + sb.h - boxH));
      out.push(...kineticTextNodes(
        layer.text!, win.start, win.dur, { x: sb.x, y: boxTop, w: sb.w, h: boxH },
        ctx.fill, rolePx("heroSub", W, H), floorPxFor("display", W, H), ctx.beat.id ?? "",
      ));
    }
    return out;
  },
};

register(kineticLines);
