import { forwardRef } from "react";

// Native viewBox: 0 0 36 24
const VB_W = 36;

const Eye = forwardRef(function Eye(
  { width = VB_W, mirror = false, style = {}, className = "", ...rest },
  ref
) {
  const s = width / VB_W;
  const mirrorT = mirror ? `scale(-1,1) translate(${-width}, 0)` : "";
  return (
    <g
      ref={ref}
      data-rig-part="eye"
      style={{ transformOrigin: "50% 50%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {/* Eye — viewBox 36×24 */}
        <ellipse cx="18" cy="12" rx="16" ry="11" fill="white" stroke="#C0A0A4" strokeWidth="1.5"/>
        <ellipse cx="18" cy="12" rx="9"  ry="9"  fill="#4A7FB5"/>
        <ellipse cx="18" cy="12" rx="5"  ry="5"  fill="#1A1A1A"/>
        <ellipse cx="22" cy="9"  rx="2.5" ry="2.5" fill="white" opacity="0.9"/>
        <path d="M2 12 Q18 2 34 12" stroke="#C0A0A4" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </g>
    </g>
  );
});

export default Eye;