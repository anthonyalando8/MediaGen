// packages/renderer-webgl/src/passes/matte-pass.ts
//
// Track matte renderer — uses a sibling node's pre-rendered texture as a
// stencil for the current node. Four modes:
//   alpha     — stencil alpha directly masks this node
//   alpha-inv — inverted stencil alpha
//   luma      — stencil luminance (Rec.709) becomes this node's alpha
//   luma-inv  — inverted luma
//
// Implemented as a Filter (same proven mechanism as effects/transitions) with
// the stencil as an extra texture resource `uMatte`. Applied to the node's
// own effectGroup Container, so Pixi's implicit `uTexture` is the node's own
// rendered content and `uMatte` is the pre-rasterised stencil texture
// (rendered off-tree via renderer.render({container, target}) by
// reconcileEffectGroup when it detects a matte pass in node.passes).
//
// The stencil Container is rendered at full comp size (filterArea forced to
// compSize, same reason as reconcileTransitionGroup) so UV coordinates are
// consistent between uTexture and uMatte.

import { Filter, GlProgram, RenderTexture } from "pixi.js";
import type { Renderer, Container, Texture } from "pixi.js";
import { DEFAULT_VERTEX } from "./pass-resolver";

// ── GLSL ──────────────────────────────────────────────────────────────────

const ALPHA_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMatte;
uniform float uInvert;

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);
    vec4 matte = texture(uMatte, vTextureCoord);
    float stencil = mix(matte.a, 1.0 - matte.a, uInvert);
    finalColor = src * stencil;
}
`;

const LUMA_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMatte;
uniform float uInvert;

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);
    vec4 matte = texture(uMatte, vTextureCoord);
    // Rec.709 luminance
    float luma = dot(matte.rgb, vec3(0.2126, 0.7152, 0.0722)) * matte.a;
    float stencil = mix(luma, 1.0 - luma, uInvert);
    finalColor = src * stencil;
}
`;

// ── Program cache (lazy, same fail-tolerant pattern as pass-resolver.ts) ───

let alphaProgram: GlProgram | null | undefined;
let lumaProgram: GlProgram | null | undefined;

function getAlphaProgram(): GlProgram | undefined {
  if (alphaProgram !== undefined) return alphaProgram ?? undefined;
  try {
    alphaProgram = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: ALPHA_FRAGMENT, name: "seabytes-matte-alpha" });
  } catch {
    alphaProgram = null;
  }
  return alphaProgram ?? undefined;
}

function getLumaProgram(): GlProgram | undefined {
  if (lumaProgram !== undefined) return lumaProgram ?? undefined;
  try {
    lumaProgram = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: LUMA_FRAGMENT, name: "seabytes-matte-luma" });
  } catch {
    lumaProgram = null;
  }
  return lumaProgram ?? undefined;
}

// ── Public API ─────────────────────────────────────────────────────────────

export type MatteType = "alpha" | "luma" | "alpha-inv" | "luma-inv";

/**
 * Builds the matte Filter given a pre-rendered stencil texture. Returns
 * undefined if the GlProgram can't be compiled (headless env — same degrade
 * gracefully pattern as every other pass in this package).
 */
export function buildMatteFilter(type: MatteType, matteTexture: Texture): Filter | undefined {
  const isLuma = type === "luma" || type === "luma-inv";
  const isInvert = type === "alpha-inv" || type === "luma-inv";
  const program = isLuma ? getLumaProgram() : getAlphaProgram();
  if (!program) return undefined;

  return new Filter({
    glProgram: program,
    resources: {
      matteUniforms: { uInvert: { value: isInvert ? 1.0 : 0.0, type: "f32" } },
      uMatte: matteTexture,
    },
  });
}

/**
 * Renders `sourceContainer` into a comp-sized `RenderTexture` and returns it.
 * The caller is responsible for destroying the texture when the matte source
 * changes or is removed.
 */
export function renderMatteTexture(
  renderer: Renderer,
  sourceContainer: Container,
  compWidth: number,
  compHeight: number,
  existing?: RenderTexture
): RenderTexture {
  const tex = existing ?? RenderTexture.create({ width: compWidth, height: compHeight });
  if (tex.width !== compWidth || tex.height !== compHeight) {
    tex.resize(compWidth, compHeight);
  }
  renderer.render({ container: sourceContainer, target: tex });
  return tex;
}
