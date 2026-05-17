import { forwardRef } from "react";

// leg viewBox: 0 0 38 80   foot viewBox: 0 0 54 30
const LEG_VB_W  = 38;
const LEG_VB_H  = 80;
const FOOT_VB_W = 54;

const Leg = forwardRef(function Leg(
  { legWidth = LEG_VB_W, mirror = false, style = {}, className = "", footRef = null, ...rest },
  ref
) {
  const s         = legWidth / LEG_VB_W;
  const legH      = LEG_VB_H * s;
  const footW     = legWidth * (FOOT_VB_W / LEG_VB_W);
  const footS     = footW / FOOT_VB_W;
  const mirrorT   = mirror ? `scale(-1,1) translate(${-legWidth}, 0)` : "";

  return (
    <g
      ref={ref}
      data-rig-part="leg"
      style={{ transformOrigin: "50% 0%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      {/* Thigh */}
      <g transform={`scale(${s}) ${mirrorT}`}>
        <path d="M4 2 Q2 2 2 8 L2 72 Q2 78 8 78 L30 78 Q36 78 36 72 L36 8 Q36 2 34 2 Z"
              fill="#2A4480" stroke="#1A3060" strokeWidth="1.5"/>
        <path d="M19 10 L19 74" stroke="#1A3060" strokeWidth="1" opacity="0.4"/>
      </g>

      {/* Foot — positioned at bottom of leg in stage-space coords */}
      <g
        ref={footRef}
        data-rig-part="foot"
        transform={`translate(${-footW * 0.1}, ${legH - 2})`}
        style={{ transformOrigin: "50% 0%", transformBox: "fill-box" }}
      >
        <g transform={`scale(${footS})`}>
          <path d="M2 22 Q2 28 10 28 L46 28 Q54 28 52 22 L48 14 Q44 8 36 8 L10 8 Q4 10 2 16 Z"
                fill="#2A1A0A" stroke="#1A0A00" strokeWidth="1.2"/>
          <path d="M10 8 Q16 2 26 2 L36 8" fill="#3A2A1A" stroke="#1A0A00" strokeWidth="1.2"/>
          <line x1="16" y1="10" x2="30" y2="10" stroke="#E8E0D0" strokeWidth="1" strokeLinecap="round"/>
          <line x1="14" y1="14" x2="32" y2="14" stroke="#E8E0D0" strokeWidth="1" strokeLinecap="round"/>
        </g>
      </g>
    </g>
  );
});

export default Leg;