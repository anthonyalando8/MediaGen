import { forwardRef } from "react";

// Native viewBox: 0 0 36 40
const VB_W = 36;

const Hand = forwardRef(function Hand(
  { width = VB_W, mirror = false, style = {}, className = "", ...rest },
  ref
) {
  const s = width / VB_W;
  const mirrorT = mirror ? `scale(-1,1) translate(${-width}, 0)` : "";
  return (
    <g
      ref={ref}
      data-rig-part="hand"
      style={{ transformOrigin: "50% 0%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {/* Hand — viewBox 36×40 */}
        <ellipse cx="18" cy="26" rx="14" ry="12" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.5"/>
        <rect x="6"  y="6"  width="6" height="22" rx="3" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.2"/>
        <rect x="14" y="3"  width="6" height="25" rx="3" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.2"/>
        <rect x="22" y="4"  width="6" height="24" rx="3" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.2"/>
        <rect x="30" y="8"  width="5" height="18" rx="2.5" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.2"/>
        <ellipse cx="4" cy="26" rx="4" ry="7" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.2"
                 transform="rotate(-20 4 26)"/>
      </g>
    </g>
  );
});

export default Hand;