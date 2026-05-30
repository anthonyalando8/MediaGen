import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Hip / pelvis — top of the pants. viewBox 88×56.
 * Drawn AFTER the legs so its opaque bottom hides the leg-top seams; the bottom
 * edge splits into two leg openings with a soft crotch notch.
 * Pivot 50% 0% (spine base) so the lower body sways from the waist.
 */
const Hip = forwardRef(function Hip(
  { width = 88, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 88;
  return (
    <g
      ref={ref}
      data-rig-part="hip"
      style={{ transformOrigin: '50% 0%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* pelvis */}
        <path d="M7 9
                 C 5 4, 9 2, 13 2
                 L 75 2
                 C 79 2, 83 4, 81 9
                 C 83 24, 81 40, 77 52
                 C 75 56, 69 56, 67 52
                 C 60 44, 53 42, 47 48
                 C 45 51, 43 51, 41 48
                 C 35 42, 28 44, 21 52
                 C 19 56, 13 56, 11 52
                 C 7 40, 5 24, 7 9 Z"
              fill={C.pants}/>

        {/* away-side (left) shade */}
        <path d="M7 9 C 5 24, 7 40, 11 52 C 13 55, 17 55, 19 53
                 C 15 40, 13 24, 14 10 C 14 6, 8 6, 7 9 Z"
              fill={C.pantsShade} opacity="0.5"/>

        {/* waistband */}
        <path d="M7 9 C 5 4, 9 2, 13 2 L 75 2 C 79 2, 83 4, 81 9
                 C 81 13, 80 14, 77 14 L 11 14 C 8 14, 7 13, 7 9 Z"
              fill={C.pantsShade}/>
        <path d="M9 6 L 79 6" stroke={C.pantsHi} strokeWidth="1"
              opacity="0.4" strokeLinecap="round"/>

        {/* center seam / fly */}
        <path d="M44 15 L 44 47" stroke={C.pantsShade} strokeWidth="1.1"
              opacity="0.55" strokeLinecap="round"/>
      </g>
    </g>
  );
});

export default Hip;
