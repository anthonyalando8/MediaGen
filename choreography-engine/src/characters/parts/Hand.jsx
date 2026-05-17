import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

const Hand = forwardRef(function Hand(
  { width = 36, mirror = false, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 36;
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
        {/* palm + 4 fingers as a single rounded silhouette (no shelf-y tips) */}
        <path d="M5 8
                 Q5 4 10 4
                 Q11 2.5 13 2.5 Q14 2.5 15 4
                 Q16 2 18 2 Q20 2 21 4
                 Q22 2.2 24 2.2 Q25 2.5 26 4.2
                 Q27 3.2 29 3.5 Q31 4 31 6
                 L31 22
                 Q31 32 26 36
                 Q19 39 12 36
                 Q5 32 5 22 Z"
              fill={C.skin} stroke={C.skinLine} strokeWidth="1"/>

        {/* finger separations — grooves between fingers, only mid-finger to base */}
        <path d="M12.5 6 L13 22" stroke={C.skinLine} strokeWidth="0.6" fill="none" opacity="0.8"/>
        <path d="M17 6 L17.5 24" stroke={C.skinLine} strokeWidth="0.6" fill="none" opacity="0.8"/>
        <path d="M22 6 L22 24" stroke={C.skinLine} strokeWidth="0.6" fill="none" opacity="0.8"/>
        <path d="M27 6 L27 22" stroke={C.skinLine} strokeWidth="0.6" fill="none" opacity="0.8"/>

        {/* finger nails (tiny crescents at tips) */}
        <ellipse cx="11.5" cy="3.8" rx="1.2" ry="0.6" fill={C.skinShade} opacity="0.5"/>
        <ellipse cx="17"   cy="3.4" rx="1.3" ry="0.6" fill={C.skinShade} opacity="0.5"/>
        <ellipse cx="22"   cy="3.6" rx="1.3" ry="0.6" fill={C.skinShade} opacity="0.5"/>
        <ellipse cx="27"   cy="4.4" rx="1.1" ry="0.5" fill={C.skinShade} opacity="0.5"/>

        {/* knuckle crease line (middle of fingers, where the second joint is) */}
        <path d="M11 11 Q18 9.5 28 11" stroke={C.skinDeep} strokeWidth="0.5"
              fill="none" opacity="0.55"/>

        {/* thumb — distinct mass on the left side */}
        <path d="M5 14
                 Q1 16 1 22
                 Q1 28 6 29
                 Q9 28 9 24
                 L8 18 Q7 14 5 14 Z"
              fill={C.skin} stroke={C.skinLine} strokeWidth="0.9"/>
        <path d="M3 20 Q4 25 7 27" stroke={C.skinDeep} strokeWidth="0.5"
              fill="none" opacity="0.7"/>

        {/* palm cel-shade */}
        <path d="M9 22 Q18 26 27 22 Q24 33 18 34 Q12 33 9 22 Z"
              fill={C.skinShade} opacity="0.55"/>
        {/* palm crease */}
        <path d="M10 24 Q18 28 26 24" stroke={C.skinDeep} strokeWidth="0.5"
              fill="none" opacity="0.65"/>
        {/* wrist crease */}
        <path d="M7 7 Q18 5 29 7" stroke={C.skinDeep} strokeWidth="0.5"
              fill="none" opacity="0.6"/>
      </g>
    </g>
  );
});

export default Hand;
