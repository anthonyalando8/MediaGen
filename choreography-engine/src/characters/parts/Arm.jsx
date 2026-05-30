import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Arm — slim tapered sleeve (long sleeve; the hand is a separate skin part).
 *   upper: viewBox 36×92  — narrow rounded top that hangs from the torso's
 *          shoulder corner (the TORSO is the shoulder; the arm is a clean tube).
 *          Centred shape → centreline = width/2.
 *   lower: viewBox 30×86  — elbow → cuff at wrist. Centred → centreline = width/2.
 * Pivot 50% 0% (top). Shade runs down the inner edge (stays inner after mirror).
 */
const Arm = forwardRef(function Arm(
  { segment = "upper", width, mirror = false, style = {}, className = "", ...rest },
  ref
) {
  const isUpper = segment === "upper";
  const VB_W = isUpper ? 36 : 30;
  const w = width ?? VB_W;
  const s = w / VB_W;
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
            {/* upper sleeve — slim tapered tube, gently rounded top */}
            <path
              d="M 7 16
                 C 7 9, 12 7, 18 7
                 C 24 7, 29 9, 29 16
                 C 30 40, 29 64, 28 78
                 C 28 87, 23 90, 18 90
                 C 13 90, 8 87, 8 78
                 C 7 64, 6 40, 7 16 Z"
              fill={C.top}
            />
            {/* inner-edge shade */}
            <path
              d="M 8 18 C 7 42, 8 64, 9 78 C 9 84, 12 88, 15 89
                 C 12 76, 12 44, 12 20 C 12 16, 8 15, 8 18 Z"
              fill={C.topShade}
              opacity="0.45"
            />
          </>
        ) : (
          <>
            {/* lower sleeve — slimmer than the upper arm, tapering to the wrist */}
            <path
              d="M 5 10 C 5 3, 25 3, 25 10
                 C 26 34, 24 58, 23 72
                 C 23 80, 19 82, 15 82
                 C 11 82, 7 80, 7 72
                 C 6 58, 4 34, 5 10 Z"
              fill={C.top}
            />
            {/* inner-edge shade */}
            <path
              d="M 6 12 C 5 34, 6 56, 7 72 C 7 78, 10 81, 13 81
                 C 10 68, 10 40, 10 14 C 10 10, 6 9, 6 12 Z"
              fill={C.topShade}
              opacity="0.5"
            />
            {/* cuff band */}
            <path
              d="M 6 66 C 11 69, 19 69, 24 66 L 23 76
                 C 23 81, 19 82, 15 82 C 11 82, 7 80, 7 76 Z"
              fill={C.topShade}
            />
            <path
              d="M 7 68 Q 15 71 23 68"
              stroke={C.topHi}
              strokeWidth="0.8"
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
