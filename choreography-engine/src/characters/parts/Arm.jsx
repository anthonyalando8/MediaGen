import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

const Arm = forwardRef(function Arm(
  { segment = 'upper', width, mirror = false, style = {}, className = '', ...rest },
  ref
) {
  const isUpper = segment === 'upper';
  const VB_W    = isUpper ? 32 : 28;
  const w       = width ?? VB_W;
  const s       = w / VB_W;
  const mirrorT = mirror ? `scale(-1,1) translate(${-w}, 0)` : '';
  return (
    <g
      ref={ref}
      data-rig-part={`${segment}_arm`}
      style={{ transformOrigin: '50% 0%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {isUpper ? (
          <>
            {/* upper arm — sleeve */}
            <path d="M6 2 Q2 4 2 10 L3 60 Q3 66 9 68 L23 68 Q29 66 29 60 L30 10 Q30 4 26 2 Q16 0 6 2 Z"
                  fill={C.jacket} stroke={C.jacketLine} strokeWidth="1.2"/>
            {/* shoulder cap */}
            <path d="M6 2 Q16 0 26 2 Q22 4 16 4 Q10 4 6 2 Z"
                  fill={C.jacketHi} opacity="0.55"/>
            {/* inner highlight band */}
            <path d="M9 8 Q11 32 11 60" stroke={C.jacketHi} strokeWidth="2.5"
                  fill="none" opacity="0.4" strokeLinecap="round"/>
            {/* outer shadow */}
            <path d="M28 10 Q26 36 27 64" stroke={C.jacketShade} strokeWidth="2.5"
                  fill="none" opacity="0.7" strokeLinecap="round"/>
            {/* shoulder seam */}
            <path d="M6 6 Q16 3 26 6" stroke={C.jacketLine} strokeWidth="0.7"
                  fill="none" opacity="0.7"/>
            {/* elbow hint */}
            <path d="M3 60 Q16 62 29 60" stroke={C.jacketLine} strokeWidth="0.6"
                  fill="none" opacity="0.5"/>
          </>
        ) : (
          <>
            {/* lower arm — sleeve continues */}
            <path d="M3 2 Q2 4 2 10 L2 50 L2 60 Q3 64 8 64 L20 64 Q25 64 26 60 L26 50 L26 10 Q26 4 25 2 Q14 0 3 2 Z"
                  fill={C.jacket} stroke={C.jacketLine} strokeWidth="1.2"/>
            {/* highlight band */}
            <path d="M7 6 Q9 28 9 56" stroke={C.jacketHi} strokeWidth="2.2"
                  fill="none" opacity="0.4" strokeLinecap="round"/>
            {/* outer shadow */}
            <path d="M24 8 Q22 32 23 58" stroke={C.jacketShade} strokeWidth="2.2"
                  fill="none" opacity="0.7" strokeLinecap="round"/>
            {/* cuff band */}
            <path d="M2 54 L26 54 L26 62 Q25 64 20 64 L8 64 Q3 64 2 62 Z"
                  fill={C.jacketShade} stroke={C.jacketLine} strokeWidth="1"/>
            {/* cuff button */}
            <circle cx="14" cy="58.5" r="1.4" fill={C.jacketHi} stroke={C.jacketLine} strokeWidth="0.4"/>
            {/* small skin peek at top (elbow inner) */}
            <path d="M3 4 Q14 1 25 4 Q14 3 3 4 Z" fill={C.jacketLine} opacity="0.5"/>
          </>
        )}
      </g>
    </g>
  );
});

export default Arm;
