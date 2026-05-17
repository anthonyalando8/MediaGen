import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

const Head = forwardRef(function Head(
  { width = 80, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 80;
  return (
    <g
      ref={ref}
      data-rig-part="head"
      style={{ transformOrigin: '50% 100%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* back hair (peeks behind ears) */}
        <path d="M10 28 Q4 36 6 52 Q8 64 14 70 L14 30 Z" fill={C.hairBase}/>
        <path d="M70 28 Q76 36 74 52 Q72 64 66 70 L66 30 Z" fill={C.hairBase}/>

        {/* ears */}
        <path d="M10 40 Q5 41 5 48 Q5 56 11 58 L13 50 Z"
              fill={C.skin} stroke={C.skinLine} strokeWidth="0.9"/>
        <path d="M8 46 Q8 50 11 53" stroke={C.skinDeep} strokeWidth="0.8" fill="none" opacity="0.7"/>
        <path d="M70 40 Q75 41 75 48 Q75 56 69 58 L67 50 Z"
              fill={C.skin} stroke={C.skinLine} strokeWidth="0.9"/>
        <path d="M72 46 Q72 50 69 53" stroke={C.skinDeep} strokeWidth="0.8" fill="none" opacity="0.7"/>

        {/* face — teardrop silhouette */}
        <path d="M14 28
                 Q12 20 18 16
                 Q20 14 24 14
                 Q30 12 40 12
                 Q50 12 56 14
                 Q60 14 62 16
                 Q68 20 66 28
                 Q68 38 66 50
                 Q64 62 58 70
                 Q50 76 40 76
                 Q30 76 22 70
                 Q16 62 14 50
                 Q12 38 14 28 Z"
              fill={C.skin} stroke={C.skinLine} strokeWidth="1.1"/>

        {/* cool-side cheek shadow (cel-shaded) */}
        <path d="M14 40 Q12 56 18 66 Q14 60 13 50 Q12 42 14 40 Z"
              fill={C.skinShade} opacity="0.7"/>
        {/* warm-side cheek (subtle) */}
        <path d="M62 42 Q68 56 60 68 Q66 60 66 50 Q66 44 62 42 Z"
              fill={C.skinShade} opacity="0.35"/>

        {/* jaw shading under chin */}
        <path d="M30 70 Q40 75 50 70 Q44 73 40 73 Q36 73 30 70 Z"
              fill={C.skinShade} opacity="0.45"/>

        {/* blush */}
        <ellipse cx="22" cy="54" rx="5.5" ry="2.6" fill={C.blush} opacity="0.55"/>
        <ellipse cx="58" cy="54" rx="5.5" ry="2.6" fill={C.blush} opacity="0.55"/>

        {/* nose — minimal anime hint */}
        <path d="M40 42 Q39 50 41 53" stroke={C.skinLine} strokeWidth="0.9"
              fill="none" strokeLinecap="round" opacity="0.8"/>
        <ellipse cx="40.5" cy="53" rx="1.6" ry="0.7" fill={C.skinDeep} opacity="0.55"/>

        {/* ── HAIR — single clean silhouette with hanging forelocks ── */}

        {/* MAIN MASS — one continuous path defining the entire hair shape.
           Top is smooth and rounded; bottom edge has 3 forelock scallops that
           dip into the forehead. */}
        <path d="M 8 28
                 Q 6 10 16 6
                 Q 26 2 40 3
                 Q 54 2 64 6
                 Q 74 10 72 28
                 L 70 20
                 Q 66 16 64 22
                 Q 60 26 56 18
                 L 52 26
                 Q 46 30 42 22
                 L 38 26
                 Q 32 30 28 22
                 L 26 26
                 Q 20 24 14 22
                 Q 10 22 8 28 Z"
              fill={C.hairBase} stroke={C.hairOutline} strokeWidth="0.4"/>

        {/* SECONDARY SMALLER FORELOCKS — fill gaps between the main bangs */}
        <path d="M 18 22 Q 20 18 22 22 L 21 26 Z" fill={C.hairBase}/>
        <path d="M 32 22 Q 34 18 36 22 L 35 26 Z" fill={C.hairBase}/>
        <path d="M 48 22 Q 50 18 52 22 L 51 26 Z" fill={C.hairBase}/>

        {/* AHOGE — single cowlick at the crown */}
        <path d="M 38 4 Q 42 -2 47 0 Q 44 4 41 7 Q 39 5 38 4 Z" fill={C.hairBase}/>

        {/* SIDEBURN WISPS — hair extending down past the ears */}
        <path d="M 9 28 Q 6 44 11 56 Q 12 48 11 40 Q 10 32 9 28 Z" fill={C.hairBase}/>
        <path d="M 71 28 Q 74 44 69 56 Q 68 48 69 40 Q 70 32 71 28 Z" fill={C.hairBase}/>

        {/* HIGHLIGHT RIBBON — cel-shaded sheen across the crown */}
        <path d="M 18 14
                 Q 28 9 42 9
                 Q 56 9 62 14
                 Q 56 12 50 11
                 Q 44 11 38 11.5
                 Q 30 12 24 13
                 Q 20 13.5 18 14 Z"
              fill={C.hairHi} opacity="0.85"/>

        {/* Strand highlights */}
        <path d="M 22 12 Q 30 9 38 9" stroke={C.hairHi} strokeWidth="0.6"
              fill="none" opacity="0.7" strokeLinecap="round"/>
        <path d="M 44 9 Q 52 9 58 12" stroke={C.hairHi} strokeWidth="0.6"
              fill="none" opacity="0.7" strokeLinecap="round"/>

        {/* Inner hair shadow (subtle base-tone darkening) */}
        <path d="M 10 24 Q 40 28 70 24 Q 50 26 30 26 Q 16 26 10 24 Z"
              fill={C.hairShade} opacity="0.5"/>

        {/* Subtle forehead shadow CAST by the forelocks (skin tone gets darker just under the bangs) */}
        <path d="M 14 26 Q 40 30 66 26 Q 50 28 32 28 Q 18 28 14 26 Z"
              fill={C.skinDeep} opacity="0.18"/>
      </g>
    </g>
  );
});

export default Head;
