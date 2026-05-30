import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Leg — single tapered pant leg + a shoe as a footRef child (matches the rig:
 * one leg ref per side, foot is a nested ref, no separate knee/upper/lower).
 *   leg  viewBox 46×170, pivot 50% 0% (hip joint)
 *   foot viewBox 56×30,  pivot 50% 0% (ankle), placed near the leg bottom
 * Drawn before the hip (hip hides the leg-top seam). Soft knee + inner shade.
 */
const Leg = forwardRef(function Leg(
  { legWidth = 46, mirror = false, style = {}, className = '', footRef = null, ...rest },
  ref
) {
  const s     = legWidth / 46;
  const legH  = 170 * s;
  const footW = legWidth * (56 / 46);
  const footS = footW / 56;
  const mirrorT = mirror ? `scale(-1,1) translate(${-legWidth}, 0)` : '';
  return (
    <g
      ref={ref}
      data-rig-part="leg"
      style={{ transformOrigin: '50% 0%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      {/* Pant leg */}
      <g transform={`scale(${s}) ${mirrorT}`}>
        <path d="M7 5
                 C 5 5, 4 9, 5 16
                 C 6 60, 7 105, 9 142
                 C 10 154, 13 163, 18 163
                 L 28 163
                 C 33 163, 36 154, 37 142
                 C 39 105, 40 60, 41 16
                 C 42 9, 41 5, 39 5
                 C 30 3, 16 3, 7 5 Z"
              fill={C.pants}/>
        {/* inner-edge shade */}
        <path d="M6 16 C 7 60, 8 105, 10 142 C 11 153, 13 161, 17 162
                 C 14 150, 13 105, 12 60 C 11 38, 10 22, 11 16
                 C 11 12, 6 12, 6 16 Z"
              fill={C.pantsShade} opacity="0.5"/>
        {/* knee soft highlight */}
        <ellipse cx="24" cy="92" rx="9" ry="13" fill={C.pantsHi} opacity="0.22"/>
        {/* knee crease */}
        <path d="M9 104 Q23 108 37 104" stroke={C.pantsShade} strokeWidth="0.8"
              fill="none" opacity="0.5" strokeLinecap="round"/>
        {/* ankle hem fold */}
        <path d="M11 152 Q23 156 35 152" stroke={C.pantsShade} strokeWidth="0.8"
              fill="none" opacity="0.5" strokeLinecap="round"/>
      </g>

      {/* Foot — flat sneaker */}
      <g
        ref={footRef}
        data-rig-part="foot"
        transform={`translate(${-footW * 0.16}, ${legH - 4})`}
        style={{ transformOrigin: '50% 0%', transformBox: 'fill-box' }}
      >
        <g transform={`scale(${footS}) ${mirror ? `scale(-1,1) translate(${-56}, 0)` : ''}`}>
          {/* sole (teal accent) */}
          <path d="M3 21 Q3 29 12 29 L49 29 Q55 29 54 21 Q54 19 51 19 L6 19 Q3 19 3 21 Z"
                fill={C.shoeSole}/>
          <path d="M3 24 L54 24" stroke={C.shoeSoleSh} strokeWidth="1.4" opacity="0.5" strokeLinecap="round"/>
          {/* upper (off-white) */}
          <path d="M5 21
                   C 5 13, 11 9, 19 8
                   C 32 6, 45 12, 52 19
                   C 53 21, 51 22, 49 22
                   L 9 22 C 6 22, 5 22, 5 21 Z"
                fill={C.shoe}/>
          {/* upper inner shade */}
          <path d="M6 21 C 6 14, 11 10, 18 9 C 12 12, 9 16, 9 22 L 6 22 Z"
                fill={C.shoeShade} opacity="0.7"/>
          {/* lace hints */}
          <path d="M22 14 L31 13" stroke={C.shoeShade} strokeWidth="1.3" strokeLinecap="round"/>
          <path d="M21 17 L31 16" stroke={C.shoeShade} strokeWidth="1.3" strokeLinecap="round"/>
          {/* ankle collar */}
          <path d="M5 20 C 5 14, 9 10, 14 9 L 16 13 C 11 14, 9 17, 9 21 Z"
                fill={C.shoeShade} opacity="0.8"/>
        </g>
      </g>
    </g>
  );
});

export default Leg;
