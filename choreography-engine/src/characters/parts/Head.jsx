import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Head — viewBox 76×92.
 * Includes a NECK STUB at the bottom (y≈62→92) so there is no separate neck
 * part; SVGPuppet overlaps the head over the torso collar to hide the seam.
 * Pivot: 50% 100% (neck base) so head-tilt/nod rotates around the neck.
 * Face is drawn symmetric so eye/brow mirroring stays valid.
 */
const Head = forwardRef(function Head(
  { width = 76, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 76;
  return (
    <g
      ref={ref}
      data-rig-part="head"
      style={{ transformOrigin: '50% 100%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* ── NECK (drawn first, behind the jaw) ───────────────── */}
        <path d="M30 60 L46 60 L48 86 Q48 92 42 92 L34 92 Q28 92 28 86 Z"
              fill={C.skin}/>
        {/* neck core shadow (cast by jaw) */}
        <path d="M30 60 L46 60 L46 67 Q38 71 30 67 Z" fill={C.skinShade} opacity="0.8"/>
        {/* neck side shade (away side) */}
        <path d="M28 70 Q27 82 31 90 Q29 80 30 70 Z" fill={C.skinShade} opacity="0.6"/>

        {/* ── EARS ─────────────────────────────────────────────── */}
        <path d="M13 38 Q6 38 7 47 Q8 54 15 53 Z" fill={C.skin}/>
        <path d="M11 43 Q10 47 13 50" stroke={C.skinDeep} strokeWidth="1" fill="none" opacity="0.6" strokeLinecap="round"/>
        <path d="M63 38 Q70 38 69 47 Q68 54 61 53 Z" fill={C.skin}/>
        <path d="M65 43 Q66 47 63 50" stroke={C.skinDeep} strokeWidth="1" fill="none" opacity="0.6" strokeLinecap="round"/>

        {/* ── FACE (soft rounded silhouette) ───────────────────── */}
        <path d="M38 7
                 C 21 7, 12 19, 12 36
                 C 12 55, 23 73, 38 73
                 C 53 73, 64 55, 64 36
                 C 64 19, 55 7, 38 7 Z"
              fill={C.skin}/>

        {/* cheek shade on the away (left) side — single soft cel shape */}
        <path d="M14 36 C 13 54, 22 71, 33 73 C 23 69, 17 55, 17 38 C 17 33, 15 33, 14 36 Z"
              fill={C.skinShade} opacity="0.55"/>
        {/* under-fringe forehead shadow */}
        <path d="M16 30 Q38 36 60 30 Q40 33 18 31 Z" fill={C.skinDeep} opacity="0.18"/>

        {/* blush */}
        <ellipse cx="23" cy="52" rx="6" ry="3.2" fill={C.blush} opacity="0.5"/>
        <ellipse cx="53" cy="52" rx="6" ry="3.2" fill={C.blush} opacity="0.5"/>

        {/* tiny soft nose */}
        <path d="M38 44 Q36.5 50 39 52" stroke={C.skinDeep} strokeWidth="1.1"
              fill="none" strokeLinecap="round" opacity="0.5"/>

        {/* ── HAIR — modern short, soft side-swept fringe ──────── */}
        {/* main mass: crown + sides */}
        <path d="M12 44
                 C 8 22, 19 5, 38 5
                 C 57 5, 68 22, 64 44
                 C 63 37, 61 32, 57 30
                 C 60 25, 55 20, 47 23
                 C 42 25, 39 29, 33 28
                 C 27 26, 21 25, 18 31
                 C 15 35, 13 39, 16 44
                 C 15 39, 16 35, 19 33
                 C 16 36, 14 40, 12 44 Z"
              fill={C.hairBase}/>
        {/* fringe sweep (front lock crossing the forehead) */}
        <path d="M55 29
                 C 58 26, 56 21, 49 22
                 C 41 23, 36 29, 28 28
                 C 33 31, 41 30, 47 28
                 C 51 27, 54 27, 55 29 Z"
              fill={C.hairShade} opacity="0.65"/>
        {/* crown sheen */}
        <path d="M24 13 Q38 7 52 13 Q40 11 30 13 Q26 13.5 24 13 Z"
              fill={C.hairHi} opacity="0.8"/>
        <path d="M22 17 Q34 11 46 12" stroke={C.hairHi} strokeWidth="1.2"
              fill="none" opacity="0.6" strokeLinecap="round"/>
      </g>
    </g>
  );
});

export default Head;
