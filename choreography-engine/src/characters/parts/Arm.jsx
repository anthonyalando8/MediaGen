import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Arm — tapered sleeve with pronounced shoulder cap (deltoid).
 *
 *   upper: viewBox 52×92
 *     The viewBox is WIDER than before (52 vs 38) to accommodate the shoulder
 *     cap that bulges inward (toward the torso). The arm body sits in the outer
 *     ~36px; the inner ~16px is the deltoid overlap region that tucks behind the
 *     torso shoulder edge. SVGPuppet positions the arm so this overlap hides
 *     the seam and creates a natural shoulder socket.
 *
 *     Layout (non-mirrored / right arm convention):
 *       x=0..16  → deltoid cap / shoulder mass (overlaps torso)
 *       x=16..52 → arm body (outer, free-hanging)
 *       Arm body centerline at ~x=34
 *       Pivot 50% 0% (top-center of full viewBox)
 *
 *   lower: viewBox 32×86  — unchanged (elbow → cuff at wrist)
 *
 * Mirror flag flips the deltoid to the correct inner side for each arm.
 * Shade runs down the outer edge (away from torso after mirroring).
 */
const Arm = forwardRef(function Arm(
  { segment = "upper", width, mirror = false, style = {}, className = "", ...rest },
  ref
) {
  const isUpper = segment === "upper";
  // Upper arm viewBox is now 52 wide to include deltoid cap
  const VB_W = isUpper ? 52 : 32;
  const w = width ?? VB_W;
  const s = w / VB_W;
  // Mirror: flip horizontally around the component's own width
  const mirrorT = mirror ? `scale(-1,1) translate(${-w}, 0)` : "";

  return (
    <g
      ref={ref}
      data-rig-part={`${segment}_arm`}
      style={{ transformOrigin: "50% 0%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {isUpper ? (
          <>
            {/*
              ── SHOULDER CAP / DELTOID ──────────────────────────────────────
              A rounded teardrop that bridges the arm-to-torso seam.
              Its left edge (x≈0) tucks BEHIND the torso (torso drawn over it).
              Its right edge blends into the arm body.
              Slightly darker than the arm body to suggest muscle mass.
            */}
            <path
              d="
                M 4 6
                C 2 2, 10 0, 18 2
                C 28 4, 34 10, 34 22
                C 34 32, 30 40, 24 44
                C 18 48, 12 46, 8 40
                C 4 34, 2 22, 4 6 Z
              "
              fill={C.top}
            />
            {/* deltoid highlight — upper-right catch-light */}
            <path
              d="M 14 4 C 22 2, 30 6, 32 16 C 28 10, 20 6, 14 4 Z"
              fill={C.topHi}
              opacity="0.5"
            />
            {/* deltoid inner shadow — left edge toward torso, suggests depth */}
            <path
              d="M 4 6 C 2 18, 4 30, 8 40 C 6 30, 5 18, 7 8 Z"
              fill={C.topShade}
              opacity="0.4"
            />

            {/*
              ── UPPER ARM BODY ─────────────────────────────────────────────
              Tapered cylinder from shoulder (x≈16..48) to elbow (x≈20..46).
              Top is open (covered by shoulder cap above); bottom is rounded.
            */}
            <path
              d="
                M 16 18
                C 16 8, 48 8, 48 18
                C 49 42, 48 66, 47 78
                C 47 87, 40 91, 36 91
                C 32 91, 25 87, 25 78
                C 24 66, 23 42, 16 18 Z
              "
              fill={C.top}
            />
            {/* arm body — outer-edge shade (stays on outer side after mirror) */}
            <path
              d="
                M 48 20
                C 49 44, 48 68, 47 78
                C 47 85, 43 89, 39 90
                C 43 78, 44 46, 44 22
                C 44 16, 49 16, 48 20 Z
              "
              fill={C.topShade}
              opacity="0.45"
            />
            {/* shoulder seam hint — the join line between cap and body */}
            <path
              d="M 16 18 Q 28 28 34 44"
              stroke={C.topShade}
              strokeWidth="1.2"
              fill="none"
              opacity="0.35"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            {/* lower sleeve — unchanged geometry */}
            <path
              d="M6 12 C 6 2, 26 2, 26 12
                 C 27 36, 25 60, 24 74
                 C 24 82, 20 84, 16 84
                 C 12 84, 8 82, 8 74
                 C 7 60, 5 36, 6 12 Z"
              fill={C.top}
            />
            {/* inner-edge shade */}
            <path
              d="M7 14 C 6 36, 7 58, 8 74 C 8 80, 11 83, 14 83
                 C 11 70, 11 42, 11 16 C 11 12, 7 11, 7 14 Z"
              fill={C.topShade}
              opacity="0.5"
            />
            {/* cuff band */}
            <path
              d="M7 68 C 12 71, 20 71, 25 68 L 24 78
                 C 24 83, 20 84, 16 84 C 12 84, 8 82, 8 78 Z"
              fill={C.topShade}
            />
            <path
              d="M8 70 Q16 73 24 70"
              stroke={C.topHi}
              strokeWidth="0.9"
              fill="none"
              opacity="0.4"
              strokeLinecap="round"
            />
          </>
        )}
      </g>
    </g>
  );
});

export default Arm;