// apps/editor/src/persistence/text/build-text-region.ts
//
// The single entry point the compiler calls. Replaces the "// ── Text layers"
// block inside buildBeatGroupFromLayers: given a beat, it selects ONE
// representation and returns its Node[]. Composition (media/scrim/divider/
// brand/camera) stays in scene-import.ts — this owns only the words.

import type { ColorOKLCH, Node } from "core";
import type { SceneBeat } from "./scene-types";
import { intentOf, fieldsOf } from "./intent";
import { select } from "./selector";
import { safeBox } from "./services/layout";
import "./index"; // ensure representations are registered

export interface BuildTextRegionArgs {
  beat: SceneBeat;
  archetype: string;
  size: { width: number; height: number };
  startFrame: number;
  durationFrames: number;   // already linger-extended by the caller
  fps: number;
  palette: { accent: ColorOKLCH; spike: ColorOKLCH; fg: ColorOKLCH };
  /** Recent representation ids (for the variety guard). Optional. */
  used?: string[];
  maxConsecutive?: number;
}

/** Returns the text-region nodes AND the chosen representation id (push the id
 * onto your `used` list to drive variety across a scene). */
export function buildTextRegion(args: BuildTextRegionArgs): { nodes: Node[]; representationId: string | null } {
  const { beat, archetype, size, startFrame, durationFrames, fps, palette } = args;
  const textLayers = (beat.layers ?? []).filter((l) => l.role === "text" && !!l.text);
  if (!textLayers.length) return { nodes: [], representationId: null };

  const intent = intentOf(beat, archetype, textLayers);
  const fields = fieldsOf(beat, textLayers);
  const rep = select(intent, { fields, used: args.used, maxConsecutive: args.maxConsecutive });
  if (!rep) return { nodes: [], representationId: null };

  const fill = beat.accent_override === "spike" ? palette.spike : palette.fg;
  const nodes = rep.build({
    beat,
    archetype,
    textLayers,
    fields,
    frame: { W: size.width, H: size.height, fps },
    time: { startFrame, durationFrames },
    palette,
    fill,
    safe: safeBox(size.width, size.height),
  });
  return { nodes, representationId: rep.id };
}
