import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Torso — crewneck top. viewBox 120×150.
 *
 * Redesigned for a healthy adult male silhouette:
 *   - Broader shoulders / chest (full width ~120px native)
 *   - Lat flare gives a subtle V-taper
 *   - Slightly widened lower abdomen for a natural hip transition
 *   - Subtle pec highlight, oblique shading, and mid-chest fold
 *   - Clean attachment zones: neck (top-center), shoulders (upper sides), hips (bottom edge)
 *
 * Pivot 50% 0% (neck/spine top) — torso leans/breathes from the top.
 * Native width = 120; pass `width` prop to scale uniformly.
 */
const Torso = forwardRef(function Torso(
  { width = 120, style = {}, className = "", ...rest },
  ref
) {
  const s = width / 120;
  return (
    <g
      ref={ref}
      data-rig-part="torso"
      style={{ transformOrigin: "50% 0%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>

        {/*
          ── MAIN BODY ──────────────────────────────────────────────────────────
          Broad chest at top (x≈8–112), lat flare peaks around y=28–40,
          tapers to waist (x≈22–98 at y≈80), widens slightly to lower abdomen
          (x≈18–102 at y≈130) for hip connection.
          Shoulder attachment zones sit at roughly x=8–22 (left) and x=98–112 (right).
          Neck attachment: top-center notch between x≈46–74.
        */}
        <path
          d="
            M 20 30
            C 8  12,  14  6,  22  6
            C 28  6,  36 10,  44 16
            C 48 20,  56 20,  76 16
            C 84 10,  92  6,  98  6
            C 106  6, 112 12, 100 30
            C  96 48,  94 72,  92 102
            C  90 120,  88 138,  84 148
            C  82 150,  80 152,  66 152
            L  54 152
            C  40 152,  38 150,  36 148
            C  32 138,  30 120,  28 102
            C  26  72,  24  48,  20  30 Z
          "
          fill={C.top}
        />

        {/*
          ── LAT / AWAY-SIDE SHADE (left) ───────────────────────────────────────
          Soft cel shadow running down the left edge to suggest the lat mass
          and body turn.
        */}
        <path
          d="
            M 20 30
            C 24 48, 26 72, 28 102
            C 30 120, 32 138, 36 148
            C 32 140, 30 118, 28 95
            C 26 68,  24 44,  22 30
            C 18 20,  14 24,  20 30 Z
          "
          fill={C.topShade}
          opacity="0.55"
        />

        {/*
          ── RIGHT SHOULDER / LAT HIGHLIGHT ────────────────────────────────────
          Warm highlight on the near-side upper chest/shoulder to suggest roundness.
        */}
        <path
          d="M 80 10 C 94 9, 106 16, 104 28 C 100 20, 94 14, 84 15 Z"
          fill={C.topHi}
          opacity="0.48"
        />

        {/*
          ── PEC DEFINITION ────────────────────────────────────────────────────
          A soft inner highlight suggesting the lower pec shelf.
          Sits below the collar and above the mid-chest fold line.
          Slight asymmetry (right pec catches light) keeps it natural.
        */}
        <path
          d="
            M 54 30
            C 60 28,  70 30,  78 36
            C 74 40,  64 40,  56 38
            C 52 36,  52 32,  54 30 Z
          "
          fill={C.topHi}
          opacity="0.3"
        />

        {/*
          ── OBLIQUE SHADING (right side) ──────────────────────────────────────
          Narrow shadow strip along the right flank from lat down to hip,
          suggesting the oblique / side of the torso.
        */}
        <path
          d="
            M 98  42
            C 96  62,  94  88,  92 110
            C 90 126,  88 140,  86 148
            C 90 140,  92 124,  94 106
            C 96  82,  98  56, 100  38
            C 100  38,  100  40,  98  42 Z
          "
          fill={C.topShade}
          opacity="0.35"
        />

        {/*
          ── CREW NECKLINE COLLAR ───────────────────────────────────────────────
          Sits between x=46–74 at top, creating the neck stub attachment seam.
          Head drawn on top hides the seam.
        */}
        <path
          d="M 46 16 C 52 23, 68 23, 74 16 C 68 28, 52 28, 46 16 Z"
          fill={C.collar}
        />
        <path
          d="M 48 17 C 54 23, 66 23, 72 17"
          stroke={C.topHi}
          strokeWidth="1"
          fill="none"
          opacity="0.5"
          strokeLinecap="round"
        />

        {/*
          ── SLEEVE SEAM HINTS ─────────────────────────────────────────────────
          Light stitch lines at the shoulder attachment edges.
          Left arm attaches around x=8–22, right arm around x=98–112.
        */}
        <path
          d="M 18 28 Q 24 42, 26 60"
          stroke={C.topShade}
          strokeWidth="1.4"
          fill="none"
          opacity="0.45"
          strokeLinecap="round"
        />
        <path
          d="M 102 28 Q 96 42, 94 60"
          stroke={C.topShade}
          strokeWidth="1.4"
          fill="none"
          opacity="0.45"
          strokeLinecap="round"
        />

        {/*
          ── MID-CHEST HORIZONTAL FOLD ─────────────────────────────────────────
          Subtle fabric line across the chest suggesting pec mass below the collar.
        */}
        <path
          d="M 38 52 Q 60 56, 82 52"
          stroke={C.topShade}
          strokeWidth="1.0"
          fill="none"
          opacity="0.3"
          strokeLinecap="round"
        />

        {/*
          ── HEM FOLD ──────────────────────────────────────────────────────────
          Gentle fabric fold at the lower hem where torso meets hips.
        */}
        <path
          d="M 36 142 Q 60 148, 84 142"
          stroke={C.topShade}
          strokeWidth="1.2"
          fill="none"
          opacity="0.4"
          strokeLinecap="round"
        />

      </g>
    </g>
  );
});

export default Torso;