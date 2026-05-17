import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

const Hip = forwardRef(function Hip(
  { width = 90, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 90;
  return (
    <g
      ref={ref}
      data-rig-part="hip"
      style={{ transformOrigin: '50% 0%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* pants base */}
        <path d="M4 2 Q2 2 2 6 L2 34 Q2 38 6 38 L84 38 Q88 38 88 34 L88 6 Q88 2 86 2 Z"
              fill={C.pants} stroke={C.pantsShade} strokeWidth="1.3"/>
        {/* belt */}
        <path d="M2 2 L88 2 L88 11 Q88 13 86 13 L4 13 Q2 13 2 11 Z"
              fill={C.pantsShade} stroke={C.line} strokeWidth="0.6"/>
        {/* belt highlight */}
        <path d="M2 3 L88 3 L88 5 L2 5 Z" fill={C.pantsHi} opacity="0.5"/>
        {/* buckle */}
        <rect x="38" y="3" width="14" height="9" rx="1.5"
              fill="#D6B560" stroke="#7A5A20" strokeWidth="0.8"/>
        <rect x="40" y="5" width="10" height="5" rx="0.8"
              fill="#9B7530" stroke="#5A3F18" strokeWidth="0.4"/>
        <line x1="45" y1="5" x2="45" y2="10" stroke="#5A3F18" strokeWidth="0.5"/>

        {/* fly */}
        <path d="M45 14 L45 36" stroke={C.pantsShade} strokeWidth="0.8" opacity="0.7"/>
        <path d="M45 14 Q47 14 47 18" stroke={C.pantsShade} strokeWidth="0.5" opacity="0.6" fill="none"/>

        {/* fabric folds */}
        <path d="M14 28 Q40 32 76 28" stroke={C.pantsShade} strokeWidth="0.7" fill="none" opacity="0.6"/>

        {/* side shading */}
        <path d="M2 14 Q4 30 2 36 Q6 26 5 18 Q3 14 2 14 Z" fill={C.pantsShade} opacity="0.6"/>
        <path d="M88 14 Q86 30 88 36 Q84 26 85 18 Q87 14 88 14 Z" fill={C.pantsShade} opacity="0.6"/>

        {/* belt loops */}
        <rect x="22" y="2" width="2" height="11" rx="0.5" fill={C.line} opacity="0.7"/>
        <rect x="66" y="2" width="2" height="11" rx="0.5" fill={C.line} opacity="0.7"/>
      </g>
    </g>
  );
});

export default Hip;
