import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

const Torso = forwardRef(function Torso(
  { width = 90, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 90;
  return (
    <g
      ref={ref}
      data-rig-part="torso"
      style={{ transformOrigin: '50% 0%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* shirt + tie behind jacket (V-neck reveal) */}
        <path d="M30 10 L60 10 L54 28 L45 34 L36 28 Z" fill={C.shirt}/>
        <path d="M30 10 L36 28 L45 34 L54 28 L48 10 Q44 14 42 10 Z" fill={C.shirtShade} opacity="0.4"/>
        {/* tie knot */}
        <path d="M40 20 L50 20 L52 30 L45 38 L38 30 Z" fill={C.tie}/>
        <path d="M40 20 L43 22 L43 30 L41 30 Z" fill={C.tieShade} opacity="0.8"/>
        {/* tie below knot (peeks below jacket V) */}
        <path d="M41 36 L49 36 L48 46 L42 46 Z" fill={C.tie}/>

        {/* jacket body — broad shoulder silhouette */}
        <path d="M10 12
                 L26 6
                 L30 12
                 L34 26
                 L45 32
                 L56 26
                 L60 12
                 L64 6
                 L80 12
                 Q88 18 88 30
                 L86 100
                 Q88 108 78 108
                 L12 108
                 Q2 108 4 100
                 L2 30
                 Q2 18 10 12 Z"
              fill={C.jacket} stroke={C.jacketLine} strokeWidth="1.4"/>

        {/* lapel highlights */}
        <path d="M30 12 L34 26 L40 22 L36 14 Z" fill={C.jacketHi} opacity="0.5"/>
        <path d="M60 12 L56 26 L50 22 L54 14 Z" fill={C.jacketHi} opacity="0.5"/>
        {/* lapel edges */}
        <path d="M30 12 L34 26 L45 32" stroke={C.jacketLine} strokeWidth="1.2" fill="none"/>
        <path d="M60 12 L56 26 L45 32" stroke={C.jacketLine} strokeWidth="1.2" fill="none"/>

        {/* side body shading (left edge) */}
        <path d="M2 30 Q4 60 2 100 Q8 80 6 50 Q4 38 2 30 Z" fill={C.jacketShade} opacity="0.7"/>
        {/* side body shading (right edge) */}
        <path d="M88 30 Q86 60 88 100 Q82 80 84 50 Q86 38 88 30 Z" fill={C.jacketShade} opacity="0.7"/>

        {/* center seam */}
        <path d="M45 34 L45 105" stroke={C.jacketLine} strokeWidth="0.7" opacity="0.6"/>

        {/* buttons */}
        <circle cx="45" cy="54" r="2"   fill={C.jacketHi} stroke={C.jacketLine} strokeWidth="0.5"/>
        <circle cx="45" cy="72" r="2"   fill={C.jacketHi} stroke={C.jacketLine} strokeWidth="0.5"/>
        <circle cx="45" cy="90" r="2"   fill={C.jacketHi} stroke={C.jacketLine} strokeWidth="0.5"/>

        {/* shoulder hi-light */}
        <ellipse cx="20" cy="20" rx="8" ry="3" fill={C.jacketHi} opacity="0.4"/>
        <ellipse cx="70" cy="20" rx="8" ry="3" fill={C.jacketHi} opacity="0.4"/>

        {/* fabric crease near hem */}
        <path d="M6 96 Q45 100 84 96" stroke={C.jacketShade} strokeWidth="0.7" fill="none" opacity="0.7"/>
      </g>
    </g>
  );
});

export default Torso;
