import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Hand — simple soft mitt with a thumb (flat Storyset style). viewBox 40×46.
 * Pivot 50% 0% (wrist). Drawn after the lower arm so its top hides the cuff seam.
 * Thumb on the inner side; mirror keeps it inner for the other hand.
 */
const Hand = forwardRef(function Hand(
  { width = 40, mirror = false, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 40;
  const mirrorT = mirror ? `scale(-1,1) translate(${-width}, 0)` : '';
  return (
    <g
      ref={ref}
      data-rig-part="hand"
      style={{ transformOrigin: '50% 0%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {/* thumb (inner side) */}
        <path d="M9 19 C 4 20, 3 26, 7 29 C 11 30, 12 25, 12 21 Z"
              fill={C.skin}/>
        {/* palm + fingers as one soft rounded mass */}
        <path d="M13 3
                 C 11 3, 10 7, 10 11
                 C 8 13, 7 17, 7 23
                 C 7 34, 13 43, 20 43
                 C 28 43, 33 34, 33 23
                 C 33 16, 31 10, 29 6
                 C 28 3, 26 3, 25 5
                 C 21 7, 16 6, 13 3 Z"
              fill={C.skin}/>
        {/* inner-edge shade */}
        <path d="M8 22 C 8 33, 13 42, 19 43 C 14 39, 11 31, 11 23
                 C 11 18, 9 17, 8 22 Z"
              fill={C.skinShade} opacity="0.5"/>
        {/* soft finger grooves at the tip */}
        <path d="M16 41 Q17 36 18 33" stroke={C.skinDeep} strokeWidth="0.7"
              fill="none" opacity="0.4" strokeLinecap="round"/>
        <path d="M22 42 Q23 36 23 32" stroke={C.skinDeep} strokeWidth="0.7"
              fill="none" opacity="0.4" strokeLinecap="round"/>
        <path d="M27 40 Q28 35 28 31" stroke={C.skinDeep} strokeWidth="0.7"
              fill="none" opacity="0.4" strokeLinecap="round"/>
      </g>
    </g>
  );
});

export default Hand;
