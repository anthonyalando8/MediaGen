import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

const Leg = forwardRef(function Leg(
  { legWidth = 38, mirror = false, style = {}, className = '', footRef = null, ...rest },
  ref
) {
  const s     = legWidth / 38;
  const legH  = 80 * s;
  const footW = legWidth * (54 / 38);
  const footS = footW / 54;
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
        <path d="M4 2 Q2 2 2 8 L2 72 Q2 78 8 78 L30 78 Q36 78 36 72 L36 8 Q36 2 34 2 Z"
              fill={C.pants} stroke={C.pantsShade} strokeWidth="1.3"/>
        {/* highlight stripe down center */}
        <path d="M14 10 L14 76" stroke={C.pantsHi} strokeWidth="2.2"
              fill="none" opacity="0.35" strokeLinecap="round"/>
        {/* outer shadow */}
        <path d="M32 8 Q30 40 33 76" stroke={C.pantsShade} strokeWidth="2.5"
              fill="none" opacity="0.7" strokeLinecap="round"/>
        {/* knee crease */}
        <path d="M4 44 Q19 47 34 44" stroke={C.pantsShade} strokeWidth="0.7" fill="none" opacity="0.55"/>
        {/* small fabric folds at hem */}
        <path d="M4 72 Q19 75 34 72" stroke={C.pantsShade} strokeWidth="0.6" fill="none" opacity="0.5"/>
      </g>

      {/* Foot — sneaker */}
      <g
        ref={footRef}
        data-rig-part="foot"
        transform={`translate(${-footW * 0.1}, ${legH - 2})`}
        style={{ transformOrigin: '50% 0%', transformBox: 'fill-box' }}
      >
        <g transform={`scale(${footS}) ${mirror ? `scale(-1,1) translate(${-54}, 0)` : ''}`}>
          {/* white midsole stripe (sits BEHIND upper) */}
          <path d="M2 22 Q2 28 10 28 L46 28 Q53 28 52 22 L2 22 Z"
                fill={C.shoeSole} stroke={C.line} strokeWidth="0.8"/>

          {/* shoe upper — sneaker silhouette */}
          <path d="M3 22
                   Q3 16 7 14
                   L18 8
                   Q22 6 26 6
                   L38 8
                   Q44 10 47 14
                   L51 20
                   Q53 22 51 24
                   L8 24
                   Q3 24 3 22 Z"
                fill={C.shoe} stroke={C.line} strokeWidth="1"/>

          {/* white toe cap */}
          <path d="M40 14 Q47 17 51 22 L48 24 Q43 22 38 22 Q36 18 40 14 Z"
                fill={C.shoeSole} stroke={C.line} strokeWidth="0.8"/>

          {/* tongue (peeks out top) */}
          <path d="M16 10 L26 6 L30 14 L19 16 Z"
                fill={C.shoeShade} stroke={C.line} strokeWidth="0.7"/>
          <path d="M20 11 L25 8 L28 13 L21 14 Z" fill={C.shoe} opacity="0.8"/>

          {/* laces (3 crossing pairs) */}
          <line x1="15" y1="14" x2="30" y2="12" stroke={C.shoeLace} strokeWidth="1.1" strokeLinecap="round"/>
          <line x1="14" y1="17" x2="31" y2="15" stroke={C.shoeLace} strokeWidth="1.1" strokeLinecap="round"/>
          <line x1="13" y1="20" x2="32" y2="18" stroke={C.shoeLace} strokeWidth="1.1" strokeLinecap="round"/>
          {/* lace knot */}
          <circle cx="22" cy="13" r="0.8" fill={C.shoeLace}/>

          {/* swoosh / side stripe (anime sneaker accent) */}
          <path d="M8 20 Q18 22 38 20" stroke={C.shoeSole} strokeWidth="1.3"
                fill="none" strokeLinecap="round"/>

          {/* heel cap */}
          <path d="M3 22 Q3 14 7 12 L11 16 L9 22 Z"
                fill={C.shoeShade} stroke={C.line} strokeWidth="0.6"/>
          {/* heel highlight */}
          <path d="M5 14 Q6 18 7 20" stroke={C.shoeLace} strokeWidth="0.4"
                fill="none" opacity="0.5"/>

          {/* ankle hole (back) */}
          <path d="M3 14 Q5 11 9 11 L11 14 Q7 13 4 15 Z"
                fill={C.line} opacity="0.6"/>
        </g>
      </g>
    </g>
  );
});

export default Leg;
