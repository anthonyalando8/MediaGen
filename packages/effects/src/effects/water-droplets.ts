// packages/effects/src/effects/water-droplets.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// WATER DROPLETS ON LENS — Procedural overlay effect
// ─────────────────────────────────────────────────────────────────────────────
//
// TECHNIQUE
// ---------
// Real water droplets on a lens act as tiny convex lenses — they refract
// the scene behind them, producing a magnified, inverted view of their
// local area. This is implemented as:
//
//   1. Grid of potential droplet positions (random per cell)
//   2. Each droplet is a circle defined by an SDF (signed distance field)
//   3. Within the droplet, UVs are displaced to simulate refraction:
//        • The displacement is proportional to the surface normal of a sphere
//        • Normal at point p on a unit sphere: n = normalize(p)
//        • Refraction offset: uv_displaced = uv + normal.xy * refraction
//   4. The droplet edge gets a specular highlight (bright rim)
//   5. Droplets slide slowly downward, leaving a wet trail
//
// REFRACTION MODEL
// ----------------
// For a droplet centred at C with radius R:
//   local = (uv - C) / R             ← normalised position in [-1,1]
//   height = sqrt(1 - dot(local,local)) ← sphere surface height
//   normal = normalize(vec3(local, height))
//   refracted_uv = uv + normal.xy * refractionStrength
//
// The height calculation gives the z-component of the sphere normal, which
// determines how strongly the rim refracts vs the centre.

import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uDensity;     // number of droplets per grid cell (0-1)
uniform float uSize;        // droplet radius scale (0-1)
uniform float uRefraction;  // strength of lens distortion inside drop (0-1)
uniform float uSlide;       // how fast drops slide down (0-1)
uniform float uTime;        // animation

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 17.5);
    return fract(p.x * p.y);
}

// Correct UVs for non-square textures: scale by aspect ratio before
// grid operations, then unscale. This keeps droplets circular.
vec2 aspectUV(vec2 uv) {
    float aspect = uInputSize.x / uInputSize.y;
    return vec2(uv.x * aspect, uv.y);
}

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);

    float aspect    = uInputSize.x / uInputSize.y;
    vec2  uvAspect  = aspectUV(vTextureCoord);

    float gridScale = mix(4.0, 18.0, uDensity);
    float maxRadius = mix(0.015, 0.07, uSize) * aspect;

    vec4  result    = src;

    // Check droplet contribution from the 3x3 neighbourhood of cells to
    // avoid missing large drops that span cell boundaries.
    // Unrolled (no dynamic array indexing) — 9 cells × 3×3 grid offsets.
    // We use a macro to repeat the logic per neighbour offset.

    // For each neighbouring cell, compute whether this pixel is inside a drop.
    // If it is, accumulate the refracted sample.

    float totalWeight = 0.0;
    vec4  accumColor  = vec4(0.0);

    // Process 9 grid neighbours (3x3) — unrolled to avoid loop-variable indexing.
    #define DROP(OX, OY) { \
        vec2  cell    = floor(uvAspect * gridScale + vec2(float(OX), float(OY))); \
        vec2  cellPos = (cell + vec2( \
                            hash21(cell) * 0.8 + 0.1, \
                            hash21(cell + vec2(3.7, 1.4)) * 0.8 + 0.1 \
                        )) / gridScale; \
        /* Slide: drops move down slowly, reset at bottom */ \
        float slideOffset = fract(uTime * uSlide * 0.03 \
                          + hash21(cell + vec2(9.1, 2.3)) * 0.8); \
        cellPos.y = fract(cellPos.y / aspect + slideOffset) * aspect; \
        float radius = maxRadius * (0.5 + hash21(cell + vec2(4.2, 7.8)) * 0.5); \
        vec2  delta  = uvAspect - vec2(cellPos.x * aspect, cellPos.y); \
        float dist   = length(delta); \
        if (dist < radius) { \
            /* Sphere normal at this point on the droplet surface */ \
            vec2  localN = delta / radius;              \
            float h      = sqrt(max(0.0, 1.0 - dot(localN, localN))); \
            vec3  normal = normalize(vec3(localN, h));  \
            /* Refract UVs — invert to get correct convex lens behaviour */ \
            float refStr = uRefraction * 0.15 * (radius / maxRadius); \
            vec2  refUV  = vTextureCoord - normal.xy * refStr * (1.0 - h); \
            refUV        = clamp(refUV, 0.0, 1.0); \
            vec4  refCol = texture(uTexture, refUV); \
            /* Specular rim: bright highlight near the edge of the drop */ \
            float rim    = smoothstep(0.7, 1.0, dist / radius); \
            float spec   = pow(max(0.0, dot(normal, normalize(vec3(-0.5, -0.8, 0.5)))), 8.0); \
            refCol.rgb  += vec3(spec * 0.6 + rim * 0.3); \
            /* Darken slightly at the very edge (shadow) */ \
            refCol.rgb  *= mix(1.0, 0.7, rim); \
            /* Blend this drop into the accumulation */ \
            float w      = smoothstep(radius, radius * 0.9, dist); \
            accumColor  += refCol * w; \
            totalWeight += w; \
        } \
    }

    DROP(-1,-1) DROP(0,-1) DROP(1,-1)
    DROP(-1, 0) DROP(0, 0) DROP(1, 0)
    DROP(-1, 1) DROP(0, 1) DROP(1, 1)
    #undef DROP

    // Composite: where drops are present, show refracted view; elsewhere show source
    if (totalWeight > 0.0) {
        result = accumColor / totalWeight;
        // Slight overall tint — wet glass has a cool, slightly desaturated look
        float srcLum = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
        result.rgb   = mix(result.rgb, result.rgb, 0.95);
    }

    finalColor = result;
}
`;

export const waterDropletsEffect: EffectDef = {
  effect: "water-droplets",
  displayName: "Water Droplets",
  category: "overlay",
  schema: {
    props: z.object({
      density:    z.number().min(0).max(1).default(0.5),
      size:       z.number().min(0).max(1).default(0.5),
      refraction: z.number().min(0).max(1).default(0.6),
      slide:      z.number().min(0).max(1).default(0.3),
      time:       z.number().default(0),
    }),
    channels: [
      { path: "props.density",    type: "scalar", label: "Density",    default: 0.5 },
      { path: "props.size",       type: "scalar", label: "Size",       default: 0.5 },
      { path: "props.refraction", type: "scalar", label: "Refraction", default: 0.6 },
      { path: "props.slide",      type: "scalar", label: "Slide",      default: 0.3 },
      { path: "props.time",       type: "scalar", label: "Time",       default: 0   },
    ],
    inspector: [
      { path: "props.density",    label: "Density",    control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.size",       label: "Size",       control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.refraction", label: "Refraction", control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.slide",      label: "Slide",      control: "number", min: 0, max: 1,    step: 0.01 },
      { path: "props.time",       label: "Time",       control: "number", min: 0, max: 1000, step: 0.1  },
    ],
  },
  glsl: FRAGMENT,
};