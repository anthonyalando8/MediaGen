import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Torso — crewneck top. viewBox 120×150.
 * Broad, gently-sloped shoulders → clear waist taper → slight hem flare for the
 * hip transition (flat Storyset silhouette; no bulbous belly).
 * Attachment zones: neck (top-centre notch x46–74), shoulders (upper sides),
 * hip (opaque bottom edge that overlaps the pants waistband).
 * Pivot 50% 0% (neck/spine top).
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
        {/* ── BODY ───────────────────────────────────────────────────── */}
        <path
          d="M 12 34
             C 10 21, 18 15, 28 15
             C 35 15, 41 17, 46 20
             C 52 24, 68 24, 74 20
             C 79 17, 85 15, 92 15
             C 102 15, 110 21, 108 34
             C 105 56, 100 78, 95 98
             C 92 114, 90 132, 87 145
             C 85 150, 81 151, 72 151
             L 48 151
             C 39 151, 35 150, 33 145
             C 30 132, 28 114, 25 98
             C 20 78, 15 56, 12 34 Z"
          fill={C.top}
        />

        {/* away-side (left) body shade — single soft cel shape */}
        <path
          d="M 12 34 C 15 56, 20 78, 25 98 C 28 114, 30 132, 33 145
             C 29 134, 27 112, 24 90 C 21 66, 17 44, 16 32
             C 15 24, 11 27, 12 34 Z"
          fill={C.topShade}
          opacity="0.5"
        />

        {/* near-side (right) shoulder/chest highlight */}
        <path
          d="M 86 18 C 98 17, 107 23, 106 33 C 102 25, 95 21, 86 22 Z"
          fill={C.topHi}
          opacity="0.45"
        />

        {/* crew neckline collar */}
        <path
          d="M 46 19 C 52 26, 68 26, 74 19 C 68 31, 52 31, 46 19 Z"
          fill={C.collar}
        />
        <path
          d="M 48 20 C 54 26, 66 26, 72 20"
          stroke={C.topHi}
          strokeWidth="1"
          fill="none"
          opacity="0.5"
          strokeLinecap="round"
        />

        {/* sleeve seam hints where the arms tuck in */}
        <path
          d="M 18 32 Q 24 46 27 64"
          stroke={C.topShade}
          strokeWidth="1.3"
          fill="none"
          opacity="0.4"
          strokeLinecap="round"
        />
        <path
          d="M 102 32 Q 96 46 93 64"
          stroke={C.topShade}
          strokeWidth="1.3"
          fill="none"
          opacity="0.4"
          strokeLinecap="round"
        />

        {/* gentle hem fold */}
        <path
          d="M 34 140 Q 60 146 86 140"
          stroke={C.topShade}
          strokeWidth="1.1"
          fill="none"
          opacity="0.35"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
});

export default Torso;
