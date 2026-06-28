// packages/renderer-webgl/src/passes/pass-resolver.ts
//
// Resolves a `PassSpec` (contract — sampled data the Evaluator emits, see
// its doc) to a compiled Pixi `Filter`. This is the ONE place a `ref`
// string becomes an actual shader — kept separate from scene-graph.ts so
// later weeks (5-6: masks/mattes/adjustment) only need to add cases here,
// never touch the reconciliation logic itself.
//
// uTIME AUTO-INJECTION (added alongside overlay effects)
// -------------------------------------------------------
// `uTime` (seconds since comp start) and `uFrame` (integer frame) are
// injected into every effect's uniforms automatically via setTimeContext().
// SceneGraphAdapter.reconcile() calls setTimeContext({ frame, fps }) before
// any resolvePass call, so overlay effects (rain, snow, embers etc.) animate
// with the playhead without the user keyframing anything.
// Effects that don't declare these uniforms in their GLSL simply ignore them.

import { Filter, GlProgram } from "pixi.js";
import type { Json, PassSpec } from "contract";
import { EffectRegistry, registerBuiltinEffects } from "effects";
import type { EffectDef } from "effects";
import { buildMatteFilter } from "./matte-pass";
import type { MatteType } from "./matte-pass";

export const DEFAULT_VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const IDENTITY_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
void main() {
    finalColor = texture(uTexture, vTextureCoord);
}
`;

const effectRegistry = new EffectRegistry();
registerBuiltinEffects(effectRegistry);
export { effectRegistry };

let identityProgram: GlProgram | undefined;
let identityProgramFailed = false;

function getIdentityProgram(): GlProgram | undefined {
  if (identityProgram || identityProgramFailed) return identityProgram;
  try {
    identityProgram = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: IDENTITY_FRAGMENT, name: "seabytes-identity" });
  } catch {
    identityProgramFailed = true;
  }
  return identityProgram;
}

const effectPrograms = new Map<string, GlProgram | null>();

function getEffectProgram(def: EffectDef): GlProgram | undefined {
  if (effectPrograms.has(def.effect)) return effectPrograms.get(def.effect) ?? undefined;
  try {
    const program = new GlProgram({ vertex: DEFAULT_VERTEX, fragment: def.glsl, name: `seabytes-effect-${def.effect}` });
    effectPrograms.set(def.effect, program);
    return program;
  } catch {
    effectPrograms.set(def.effect, null);
    return undefined;
  }
}

function toUniformValue(value: Json): { value: unknown; type: string } | null {
  if (typeof value === "number") return { value, type: "f32" };
  if (typeof value === "boolean") return { value: value ? 1 : 0, type: "f32" };
  if (value && typeof value === "object" && !Array.isArray(value) && "l" in value && "c" in value && "h" in value) {
    const c = value as { l: number; c: number; h: number };
    return { value: [c.l, c.c, c.h], type: "vec3<f32>" };
  }
  return null;
}

function uniformName(propKey: string): string {
  return `u${propKey.charAt(0).toUpperCase()}${propKey.slice(1)}`;
}

export function buildEffectUniforms(props: Record<string, Json>): Record<string, { value: unknown; type: string }> {
  const uniforms: Record<string, { value: unknown; type: string }> = {};
  for (const [key, value] of Object.entries(props)) {
    const mapped = toUniformValue(value);
    if (mapped) uniforms[uniformName(key)] = mapped;
  }
  return uniforms;
}

// ── Time context ──────────────────────────────────────────────────────────────
// Set by SceneGraphAdapter.reconcile() before resolvePass is called each frame.

export interface TimeContext { frame: number; fps: number; }
let _time: TimeContext = { frame: 0, fps: 30 };
export function setTimeContext(ctx: TimeContext): void { _time = ctx; }

function directionForPass(index: number, passCount: number): { value: [number, number]; type: string } {
  if (passCount <= 1) return { value: [0, 0], type: "vec2<f32>" };
  return { value: index === 0 ? [1, 0] : [0, 1], type: "vec2<f32>" };
}

function buildEffectFilters(pass: PassSpec): Filter[] {
  const def = effectRegistry.tryGet(pass.ref);
  if (!def) return [];

  const program = getEffectProgram(def);
  if (!program) return [];

  const props = pass.uniforms && typeof pass.uniforms === "object" && !Array.isArray(pass.uniforms)
    ? pass.uniforms
    : {};
  const baseUniforms = buildEffectUniforms(props as Record<string, Json>);

  // Inject time uniforms — overlay effects use uTime for animation.
  // Effects that don't declare these uniforms in their GLSL ignore them safely.
  const timeSeconds = _time.fps > 0 ? _time.frame / _time.fps : 0;
  baseUniforms.uTime  = { value: timeSeconds,  type: "f32" };
  baseUniforms.uFrame = { value: _time.frame,  type: "f32" };

  const passCount = def.passes ?? 1;
  const filters: Filter[] = [];
  for (let index = 0; index < passCount; index++) {
    const uniforms = { ...baseUniforms, uDirection: directionForPass(index, passCount) };
    filters.push(new Filter({ glProgram: program, resources: { effectUniforms: uniforms } }));
  }
  return filters;
}

export function resolvePass(pass: PassSpec, getMatteTexture?: (srcNodeId: string) => import("pixi.js").Texture | undefined): Filter[] {
  if (pass.ref === "identity") {
    const program = getIdentityProgram();
    return program ? [new Filter({ glProgram: program, resources: {} })] : [];
  }
  if (pass.kind === "effect") {
    return buildEffectFilters(pass);
  }
  if (pass.kind === "matte" && pass.srcNodeId && getMatteTexture) {
    const tex = getMatteTexture(pass.srcNodeId);
    if (!tex) return [];
    const type = (pass.uniforms as { type?: string }).type ?? "alpha";
    const filter = buildMatteFilter(type as MatteType, tex);
    return filter ? [filter] : [];
  }
  return [];
}