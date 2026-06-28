// packages/effects/src/effects/neon.ts
//
// Neon — detects edges via a Sobel operator and draws them as glowing
// coloured lines against a dark/black background. The look: bright
// luminous outlines on a dark field, like neon tube signage.
//
// `edgeColor`: tint of the neon lines (ColorOKLCH)
// `glow`:      how much the edges bloom beyond the line (0-5)
// `threshold`: minimum edge strength to paint (0-1)
// `background`: darken amount — 1 = full black background (0-1)
import { z } from "zod";
import type { EffectDef } from "../registry";

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec3  uEdgeColor;
uniform float uGlow;
uniform float uThreshold;
uniform float uBackground;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main(void) {
    vec2 px = 1.0 / uInputSize.xy;

    // Sobel kernel — sample 8 neighbours
    float tl = luma(texture(uTexture, vTextureCoord + px * vec2(-1.0, -1.0)).rgb);
    float tc = luma(texture(uTexture, vTextureCoord + px * vec2( 0.0, -1.0)).rgb);
    float tr = luma(texture(uTexture, vTextureCoord + px * vec2( 1.0, -1.0)).rgb);
    float ml = luma(texture(uTexture, vTextureCoord + px * vec2(-1.0,  0.0)).rgb);
    float mr = luma(texture(uTexture, vTextureCoord + px * vec2( 1.0,  0.0)).rgb);
    float bl = luma(texture(uTexture, vTextureCoord + px * vec2(-1.0,  1.0)).rgb);
    float bc = luma(texture(uTexture, vTextureCoord + px * vec2( 0.0,  1.0)).rgb);
    float brr= luma(texture(uTexture, vTextureCoord + px * vec2( 1.0,  1.0)).rgb);

    float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + brr;
    float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + brr;
    float edge = sqrt(gx*gx + gy*gy);
    edge = smoothstep(uThreshold, uThreshold + 0.3, edge);

    // Glow: bloom the edge outward with nearby sample max
    float bloom = 0.0;
    for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
            float dist = float(i*i + j*j);
            float w    = exp(-dist * 0.3) * uGlow;
            vec2 off   = px * vec2(float(i), float(j)) * 2.0;
            float el   = luma(texture(uTexture, vTextureCoord + off).rgb);
            bloom      = max(bloom, el * w);
        }
    }

    vec4  src    = texture(uTexture, vTextureCoord);
    vec3  dark   = mix(src.rgb, vec3(0.0), uBackground);
    vec3  neon   = dark + uEdgeColor * (edge + bloom * 0.5);
    finalColor   = vec4(clamp(neon, 0.0, 1.0), src.a);
}
`;

export const neonEffect: EffectDef = {
  effect: "neon",
  displayName: "Neon",
  category: "stylize",
  schema: {
    props: z.object({
      edgeColor:  z.object({ l: z.number(), c: z.number(), h: z.number(), alpha: z.number().optional() })
                    .default({ l: 0.75, c: 0.25, h: 185 }), // teal neon
      glow:       z.number().min(0).max(5).default(1.5),
      threshold:  z.number().min(0).max(1).default(0.1),
      background: z.number().min(0).max(1).default(0.9),
    }),
    channels: [
      { path: "props.edgeColor",  type: "color",  label: "Color",      default: { l: 0.75, c: 0.25, h: 185 } },
      { path: "props.glow",       type: "scalar", label: "Glow",       default: 1.5 },
      { path: "props.threshold",  type: "scalar", label: "Threshold",  default: 0.1 },
      { path: "props.background", type: "scalar", label: "Background", default: 0.9 },
    ],
    inspector: [
      { path: "props.edgeColor",  label: "Color",      control: "color"                                    },
      { path: "props.glow",       label: "Glow",       control: "number", min: 0, max: 5,  step: 0.1  },
      { path: "props.threshold",  label: "Threshold",  control: "number", min: 0, max: 1,  step: 0.01 },
      { path: "props.background", label: "Background", control: "number", min: 0, max: 1,  step: 0.01 },
    ],
  },
  glsl: FRAGMENT,
};
