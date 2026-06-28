// packages/effects/src/effects/water-droplets.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// WATER DROPLETS ON LENS — Production rewrite
// ─────────────────────────────────────────────────────────────────────────────
//
// DESIGN DECISIONS
// ─────────────────
//
// 1. FOUR SIZE LAYERS
//    Real condensation has a power-law size distribution — many tiny drops,
//    few large ones. Four explicit layers give artist control over this:
//      Layer 0: micro (majority, static)
//      Layer 1: small (common, very slow drift)
//      Layer 2: medium (less common, moderate slide)
//      Layer 3: large (rare, fast slide, leave trails)
//    Each layer uses a DIFFERENT grid scale and seed so layers never align.
//
// 2. PHYSICALLY-BASED REFRACTION
//    A convex water drop acts as a diverging lens when viewed from outside.
//    The refracted UV samples from the opposite side of the drop centre:
//      refUV = centre - localN * bendStrength * h
//    where h = sqrt(1 - |localN|²) is the sphere height (1 at apex, 0 at edge).
//    This correctly:
//      • Inverts the image inside the drop (convergent lens effect)
//      • Magnifies (samples a smaller UV region, mapped to the drop area)
//      • Refracts most at the centre (thickest glass) not the edge
//
// 3. THREE-COMPONENT LIGHTING
//    Specular: Phong with light at upper-left — tiny bright dot
//    Rim: pow(1-h, 6) edge glow — separates drop from background
//    Shadow: directional darkening at bottom — gravity shading
//
// 4. TRAILS
//    Only large drops (sizeRel > 0.5) leave trails.
//    Trail = vertical streak below drop, width = 30% of drop radius.
//    Colour = slightly cool, desaturated version of background.
//    Fades with configurable exponent (trailFade prop).
//
// 5. SIZE-DEPENDENT PHYSICS
//    Slide speed = uSlideSpeed * slideRate * sizeRel
//    So small drops barely move, large drops slide fastest.
//    Sway = smoothed noise — no abrupt direction changes.
//
// 6. ASPECT RATIO
//    All distances in aspect-corrected UV space (u *= aspect).
//    All radii specified in this space — circular on any resolution.
//
// 7. NESTED FOR LOOPS in PROCESS_LAYER
//    The 3×3 neighbourhood check uses `for (int _nx=-1; _nx<=1; _nx++)` —
//    loop bounds are compile-time constants so this is valid in ES1 compat
//    mode (Pixi's compatibility shim handles it). No dynamic indexing.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;

uniform float uDensity;
uniform float uSize;
uniform float uSizeVariation;
uniform float uRefraction;
uniform float uHighlight;
uniform float uEdgeDark;
uniform float uSlideSpeed;
uniform float uTrailLength;
uniform float uTrailFade;
uniform float uSeed;
uniform float uTime;

// ── Hash ──────────────────────────────────────────────────────────────────────

float hash11(float p) {
    return fract(sin(p * 127.1 + uSeed * 43.7) * 43758.5453);
}

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7) + uSeed * 0.17);
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// Smooth noise for continuous sway — no visual discontinuities
float smoothNoise(float t) {
    float i = floor(t);
    float f = fract(t);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), u);
}

// ── Single droplet ────────────────────────────────────────────────────────────
//
// Returns vec4(colour.rgb, weight).
// weight = 0 outside the drop (caller skips texture sample).

vec4 dropContrib(
    vec2 uvA,         // aspect-corrected UV of current pixel
    vec2 uvOrig,      // original [0,1] UV
    vec2 centre,      // drop centre (aspect-corrected)
    float radius,     // drop radius (aspect-corrected)
    float refStr,     // refraction strength
    float hlStr,      // highlight strength
    float edgeDark,   // edge shadow strength
    float sizeRel,    // relative size [0,1] in this layer
    float trailLen,   // trail length below drop
    float trailFade   // trail fade exponent
) {
    float aspect = uInputSize.x / uInputSize.y;
    vec2  delta  = uvA - centre;
    float dist   = length(delta);

    // ── Trail: rendered for pixels BELOW the drop ──────────────────────────
    float trailW = 0.0;
    if (sizeRel > 0.5 && trailLen > 0.001) {
        float belowDist = uvA.y - (centre.y + radius * 0.85);
        float sideX     = abs(delta.x);
        float tWidth    = radius * 0.28;
        if (belowDist > 0.0 && belowDist < trailLen && sideX < tWidth) {
            float xF = 1.0 - (sideX / tWidth);
            float yF = pow(max(0.0, 1.0 - belowDist / trailLen), trailFade * 2.0 + 0.5);
            trailW   = xF * yF * (sizeRel - 0.5) * 2.0 * 0.3;
        }
    }

    // ── Outside drop body ──────────────────────────────────────────────────
    if (dist >= radius) {
        if (trailW > 0.001) {
            vec4 bg   = texture(uTexture, uvOrig);
            float lum = dot(bg.rgb, vec3(0.2126, 0.7152, 0.0722));
            // Trail = cool, slightly darker and desaturated
            vec3 tr   = mix(bg.rgb, vec3(lum * 0.85), 0.35) * vec3(0.94, 0.97, 1.0);
            return vec4(tr * trailW, trailW);
        }
        return vec4(0.0);
    }

    // ── Inside drop body ───────────────────────────────────────────────────

    vec2  localN = delta / radius;                  // [-1,1] normalised position
    float r2     = dot(localN, localN);             // 0 at centre, 1 at edge
    float h      = sqrt(max(0.0, 1.0 - r2));       // sphere height
    vec3  normal = vec3(localN, h);                 // sphere surface normal (unnorm)

    // REFRACTION: convex lens inverts and magnifies.
    // Sample from the opposite side of the centre (inverted image).
    // Bend is strongest at centre (h=1) and zero at edge (h=0).
    float bend   = refStr * h * h;
    vec2  refUV  = uvOrig - vec2(localN.x / aspect, localN.y) * bend;
    refUV        = clamp(refUV, 0.001, 0.999);
    vec4  refCol = texture(uTexture, refUV);

    // SPECULAR: Phong, light at upper-left
    vec3  L      = normalize(vec3(-0.6, -0.8, 0.5));
    float nDotL  = max(0.0, dot(normalize(normal), L));
    float spec   = pow(nDotL, 28.0) * hlStr * 1.5;
    // Constrain highlight to upper-left region
    float hlMask = smoothstep(0.0, 0.6, 0.5 - localN.x * 0.35 - localN.y * 0.55);

    // RIM: edge glow (Fresnel-like — strongest where sphere normal faces sideways)
    float rim    = pow(max(0.0, 1.0 - h), 5.0) * hlStr * 0.45;

    // SHADOW: subtle darkening at bottom of drop
    float shadow = (localN.y * 0.5 + 0.5) * edgeDark * 0.22;

    // EDGE softening: smooth alpha at drop boundary
    float edge   = smoothstep(radius, radius * 0.87, dist);

    // Assemble colour
    vec3 col = refCol.rgb * (1.0 - shadow);
    col     += vec3(spec * hlMask);
    col     += vec3(rim * 0.65, rim * 0.78, rim);   // blue-tinted rim

    // Blend in trail near the drop base
    if (trailW > 0.0) {
        float lum = dot(refCol.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3  tr  = mix(refCol.rgb, vec3(lum * 0.85), 0.3) * vec3(0.94, 0.97, 1.0);
        col       = mix(col, tr, trailW * 0.25);
    }

    return vec4(col * edge, edge);
}

void main(void) {
    vec4  src     = texture(uTexture, vTextureCoord);
    float aspect  = uInputSize.x / uInputSize.y;
    vec2  uvA     = vec2(vTextureCoord.x * aspect, vTextureCoord.y);

    // Base radius and grid density from user params
    float baseR   = mix(0.003, 0.022, uSize);
    float baseG   = mix(14.0, 48.0, uDensity);

    float totalWeight = 0.0;
    vec3  accumColor  = vec3(0.0);

    // ── Layer 0: Micro-droplets (static, very small, very dense) ──────────
    {
        float gScale = baseG * 2.6;
        float maxR   = baseR * 0.32;
        float lSeedX = 0.0; float lSeedY = 0.0;
        for (int nx = -1; nx <= 1; nx++) {
        for (int ny = -1; ny <= 1; ny++) {
            vec2 cell  = floor(uvA * gScale + vec2(float(nx), float(ny)));
            vec2 csd   = cell + vec2(lSeedX, lSeedY);
            float jx   = hash21(csd) * 0.82 + 0.09;
            float jy   = hash21(csd + vec2(5.3, 2.1)) * 0.82 + 0.09;
            float sv   = 0.4 + hash21(csd + vec2(1.7, 8.4)) * uSizeVariation * 0.6;
            float r    = maxR * sv;
            vec2  cen  = (cell + vec2(jx, jy)) / gScale;
            vec4  c    = dropContrib(uvA, vTextureCoord, cen, r,
                           uRefraction * 0.08 * sv, uHighlight, uEdgeDark,
                           sv, 0.0, uTrailFade);
            accumColor  += c.rgb * c.a;
            totalWeight += c.a;
        }}
    }

    // ── Layer 1: Small droplets (very slow drift) ─────────────────────────
    {
        float gScale = baseG * 1.3;
        float maxR   = baseR * 0.62;
        float slideR = 0.12;
        float lSeedX = 7.3; float lSeedY = 2.1;
        for (int nx = -1; nx <= 1; nx++) {
        for (int ny = -1; ny <= 1; ny++) {
            vec2 cell  = floor(uvA * gScale + vec2(float(nx), float(ny)));
            vec2 csd   = cell + vec2(lSeedX, lSeedY);
            float jx   = hash21(csd) * 0.82 + 0.09;
            float jy   = hash21(csd + vec2(5.3, 2.1)) * 0.82 + 0.09;
            float sv   = 0.4 + hash21(csd + vec2(1.7, 8.4)) * uSizeVariation * 0.6;
            float r    = maxR * sv;
            float ph   = hash21(csd + vec2(3.1, 6.9));
            float sw   = (smoothNoise(uTime * 0.25 * slideR + ph * 17.3) * 2.0 - 1.0) * 0.006;
            float sY   = fract(uTime * slideR * uSlideSpeed * 0.04 + ph);
            vec2  cen  = vec2(fract((cell.x + jx) / gScale + sw),
                              fract((cell.y + jy) / gScale + sY));
            float tLen = uTrailLength * sv * slideR * 0.1;
            vec4  c    = dropContrib(uvA, vTextureCoord, vec2(cen.x * aspect, cen.y), r,
                           uRefraction * 0.1 * sv, uHighlight, uEdgeDark,
                           sv, tLen, uTrailFade * 1.5 + 0.5);
            accumColor  += c.rgb * c.a;
            totalWeight += c.a;
        }}
    }

    // ── Layer 2: Medium droplets (moderate slide) ─────────────────────────
    {
        float gScale = baseG * 0.65;
        float maxR   = baseR * 1.0;
        float slideR = 0.45;
        float lSeedX = 3.7; float lSeedY = 9.5;
        for (int nx = -1; nx <= 1; nx++) {
        for (int ny = -1; ny <= 1; ny++) {
            vec2 cell  = floor(uvA * gScale + vec2(float(nx), float(ny)));
            vec2 csd   = cell + vec2(lSeedX, lSeedY);
            float jx   = hash21(csd) * 0.82 + 0.09;
            float jy   = hash21(csd + vec2(5.3, 2.1)) * 0.82 + 0.09;
            float sv   = 0.4 + hash21(csd + vec2(1.7, 8.4)) * uSizeVariation * 0.6;
            float r    = maxR * sv;
            float ph   = hash21(csd + vec2(3.1, 6.9));
            float sw   = (smoothNoise(uTime * 0.3 * slideR + ph * 17.3) * 2.0 - 1.0) * 0.009;
            float sY   = fract(uTime * slideR * uSlideSpeed * 0.04 + ph);
            vec2  cen  = vec2(fract((cell.x + jx) / gScale + sw),
                              fract((cell.y + jy) / gScale + sY));
            float tLen = uTrailLength * sv * slideR * 0.11;
            vec4  c    = dropContrib(uvA, vTextureCoord, vec2(cen.x * aspect, cen.y), r,
                           uRefraction * 0.11 * sv, uHighlight, uEdgeDark,
                           sv, tLen, uTrailFade * 1.5 + 0.5);
            accumColor  += c.rgb * c.a;
            totalWeight += c.a;
        }}
    }

    // ── Layer 3: Large drops (rare, fast slide, trails) ───────────────────
    {
        float gScale = baseG * 0.26;
        float maxR   = baseR * 1.75;
        float slideR = 1.0;
        float lSeedX = 11.2; float lSeedY = 5.8;
        for (int nx = -1; nx <= 1; nx++) {
        for (int ny = -1; ny <= 1; ny++) {
            vec2 cell  = floor(uvA * gScale + vec2(float(nx), float(ny)));
            vec2 csd   = cell + vec2(lSeedX, lSeedY);
            float jx   = hash21(csd) * 0.82 + 0.09;
            float jy   = hash21(csd + vec2(5.3, 2.1)) * 0.82 + 0.09;
            float sv   = 0.4 + hash21(csd + vec2(1.7, 8.4)) * uSizeVariation * 0.6;
            float r    = maxR * sv;
            float ph   = hash21(csd + vec2(3.1, 6.9));
            float sw   = (smoothNoise(uTime * 0.35 * slideR + ph * 17.3) * 2.0 - 1.0) * 0.012;
            float sY   = fract(uTime * slideR * uSlideSpeed * 0.04 + ph);
            vec2  cen  = vec2(fract((cell.x + jx) / gScale + sw),
                              fract((cell.y + jy) / gScale + sY));
            float tLen = uTrailLength * sv * slideR * 0.14;
            vec4  c    = dropContrib(uvA, vTextureCoord, vec2(cen.x * aspect, cen.y), r,
                           uRefraction * 0.13 * sv, uHighlight, uEdgeDark,
                           sv, tLen, uTrailFade * 1.5 + 0.5);
            accumColor  += c.rgb * c.a;
            totalWeight += c.a;
        }}
    }

    // ── Composite ─────────────────────────────────────────────────────────
    vec3 result;
    if (totalWeight > 0.001) {
        vec3 dropCol  = accumColor / totalWeight;
        float coverage= clamp(totalWeight, 0.0, 1.0);
        // Subtle wet-glass tint on uncovered areas
        float lum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3  wet = mix(src.rgb, vec3(lum) * vec3(0.96, 0.98, 1.0), 0.03);
        result    = mix(wet, dropCol, coverage);
    } else {
        float lum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
        result    = mix(src.rgb, vec3(lum) * vec3(0.97, 0.985, 1.0), 0.02);
    }

    finalColor = vec4(result, src.a);
}
`;

export const waterDropletsEffect: EffectDef = {
  effect: "water-droplets",
  displayName: "Water Droplets",
  category: "overlay",

  schema: {
    props: z.object({
      density:       z.number().min(0).max(1).default(0.45),
      size:          z.number().min(0).max(1).default(0.35),
      sizeVariation: z.number().min(0).max(1).default(0.75),
      refraction:    z.number().min(0).max(1).default(0.55),
      highlight:     z.number().min(0).max(1).default(0.60),
      edgeDark:      z.number().min(0).max(1).default(0.40),
      slideSpeed:    z.number().min(0).max(1).default(0.30),
      trailLength:   z.number().min(0).max(1).default(0.50),
      trailFade:     z.number().min(0).max(1).default(0.60),
      seed:          z.number().min(0).max(1).default(0),
    }),
    channels: [
      { path: "props.density",       type: "scalar", label: "Density",        default: 0.45 },
      { path: "props.size",          type: "scalar", label: "Size",           default: 0.35 },
      { path: "props.sizeVariation", type: "scalar", label: "Size Variation", default: 0.75 },
      { path: "props.refraction",    type: "scalar", label: "Refraction",     default: 0.55 },
      { path: "props.highlight",     type: "scalar", label: "Highlight",      default: 0.60 },
      { path: "props.edgeDark",      type: "scalar", label: "Edge Dark",      default: 0.40 },
      { path: "props.slideSpeed",    type: "scalar", label: "Slide Speed",    default: 0.30 },
      { path: "props.trailLength",   type: "scalar", label: "Trail Length",   default: 0.50 },
      { path: "props.trailFade",     type: "scalar", label: "Trail Fade",     default: 0.60 },
      { path: "props.seed",          type: "scalar", label: "Seed",           default: 0    },
    ],
    inspector: [
      { path: "props.density",       label: "Density",        control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.size",          label: "Size",           control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.sizeVariation", label: "Size Variation", control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.refraction",    label: "Refraction",     control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.highlight",     label: "Highlight",      control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.edgeDark",      label: "Edge Dark",      control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.slideSpeed",    label: "Slide Speed",    control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.trailLength",   label: "Trail Length",   control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.trailFade",     label: "Trail Fade",     control: "number", min: 0, max: 1, step: 0.01 },
      { path: "props.seed",          label: "Seed",           control: "number", min: 0, max: 1, step: 0.01 },
    ],
  },

  glsl: FRAGMENT,
};