// apps/editor/src/persistence/text/representations/hero-title.ts
//
// P1 · Big centered title (title_card's text, size:"hero"). Verbatim routing:
// centeredTextNodes at the "hero" role, weight 800.
//
// ─────────────────────────────────────────────────────────────────────────
// FIX (P5) — two text layers rendered on top of each other
// ─────────────────────────────────────────────────────────────────────────
// `build` loops `ctx.textLayers` and gives EACH layer `blockBox(anchor_y ?? 0.5)`.
// With one layer that's correct. With two — a title_card beat carrying both a
// keyword and a body, a hand-authored scene, or any layer the user adds in the
// editor — every layer with no `anchor_y` resolves to the SAME box and they
// render exactly overlapping ("MEET GRIDPULSE" over "Interactive energy grid
// simulations.").
//
// Why it isn't caught elsewhere: editorial-lede is the representation that
// stacks a title + body properly, but it requires BOTH `keyword` and `body`
// fields; when a beat has two text layers without both fields present, the
// selector falls through to hero-title, which had no multi-layer path at all.
//
// IMPORTANT — an earlier revision of this fix only stacked when the anchors
// were EQUAL. That is not enough. `blockBox` returns a box of up to
// MAX_BLOCK_H (62% of frame height) — ~1190px on a 1920 frame — so two boxes
// anchored at 0.24 and 0.46 still overlap by most of their height, and the
// vertically-centred text inside them collides. Real case: a poster_card CTA
// beat ("FREE SYSTEM DEMO" @0.24 over "Upgrade your business operations…"
// @0.46) routed here because its intent was `takeaway`, numbered-list claims
// takeaway but requires `items` (null on that beat), and hero-title scores 0.6
// on `size: "hero"`. Both layers rendered as hero blocks, overlapping.
//
// So: stack whenever there is MORE THAN ONE layer. `anchor_y` is still
// honoured — as the position of the WHOLE stack (`shiftStackToward`), which
// keeps a headline-high/subtext-low pair sitting high — but never again as an
// independent per-layer centre. The lead layer takes display size, the rest
// body size, and the stack is shrink-to-fit inside the safe box.

import type { Node } from "core";
import { register } from "../registry";
import type { TextBuildContext, TextRepresentation } from "../types";
import { rolePx, floorPxFor } from "../services/type-scale";
import { MAX_BLOCK_H, stackByHeight, shiftStackToward, anchorCenterPx } from "../services/layout";
import { centeredTextNodes, emitCenteredBlock } from "../services/nodes";
import { layerWindow } from "../services/timing";

function blockBox(ctx: TextBuildContext, anchorY: number) {
  const { H } = ctx.frame;
  const sb = ctx.safe;
  const boxH = Math.min(sb.h, Math.round(H * MAX_BLOCK_H));
  const boxTop = Math.max(sb.y, Math.min(Math.round(anchorY * H - boxH / 2), sb.y + sb.h - boxH));
  return { x: sb.x, y: boxTop, w: sb.w, h: boxH };
}

export const heroTitle: TextRepresentation = {
  id: "hero-title",
  fields: ["keyword"],
  region: "full",
  // hasBody defers to editorial-lede (never renders a body) and
  // hasAccentSpan defers to accent-headline (never tints a span) — both are
  // real rendering-capability gaps, not preference.
  //
  // ROUTING FIX (P5): a multi-layer beat is deferred to the representations
  // built for a stacked pair. hero-title is a SINGLE-title representation, but
  // it scored 0.6 on `size: "hero"` — outbidding stat-figure's 0.4 for
  // `textLayerCount >= 2` — so a poster_card CTA carrying a hero headline plus
  // a subtext line landed here and rendered both as overlapping hero blocks.
  // Dropping to 0.3 in that case lets stat-figure (purpose-built for exactly
  // this pair, with its own measured stacking) win, while hero-title still
  // wins every single-layer hero beat at 0.6.
  supports: (i) => (
    i.intent === "title"
      ? (i.hasBody || i.hasAccentSpan ? 0.5 : 1)
      : i.size === "hero"
        ? (i.textLayerCount >= 2 ? 0.3 : 0.6)
        : 0.2
  ),
  build(ctx: TextBuildContext): Node[] {
    const { W, H, fps } = ctx.frame;
    const layers = ctx.textLayers;

    // ── Stacked path: ANY beat with 2+ text layers ────────────────────────
    if (layers.length > 1) {
      const measured = stackByHeight(ctx.safe, W, H, layers.map((l, i) => ({
        text: l.text,
        tier: i === 0 ? "displayM" : "bodyL",
        weight: i === 0 ? 800 : 400,
        maxWFrac: i === 0 ? 1 : 0.9,
      })));
      const stack = shiftStackToward(
        measured, ctx.safe, anchorCenterPx(layers.map((l) => l.anchor_y), H),
      );
      // `stackByHeight` drops empty blocks, so re-align the placed blocks with
      // the layers that actually produced them to keep per-layer timing.
      const kept = layers.filter((l) => !!l.text && l.text.trim().length > 0);
      return stack.flatMap((b, i) => {
        const layer = kept[i] ?? kept[kept.length - 1];
        const win = layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps);
        return emitCenteredBlock(
          b.fit, b.box.y, b.box, win.start, win.dur, ctx.fill,
          b.weight ?? 800, `${ctx.beat.id ?? "beat"} · title ${i + 1}`,
        );
      });
    }

    // ── Original per-layer path (single layer, or distinct anchors) ────────
    const out: Node[] = [];
    for (const layer of layers) {
      const win = layerWindow(layer, ctx.time.startFrame, ctx.time.durationFrames, fps);
      const box = blockBox(ctx, layer.anchor_y ?? 0.5);
      out.push(...centeredTextNodes(
        layer.text!, win.start, win.dur, box, ctx.fill,
        rolePx("hero", W, H), floorPxFor("display", W, H), 800, ctx.beat.id ?? "",
      ));
    }
    return out;
  },
};

register(heroTitle);
