import { forwardRef } from "react";

// Native viewBox: 0 0 48 16
const VB_W = 48;

const Brow = forwardRef(function Brow(
  { width = VB_W, mirror = false, style = {}, className = "", ...rest },
  ref
) {
  const s = width / VB_W;
  const mirrorT = mirror ? `scale(-1,1) translate(${-width}, 0)` : "";
  return (
    <g
      ref={ref}
      data-rig-part="brow"
      style={{ transformOrigin: "50% 50%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {/* Brow — viewBox 48×16 */}
        <path d="M4 12 Q12 4 24 5 Q36 4 44 10"
              stroke="#5C3D2E" strokeWidth="5"
              strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </g>
    </g>
  );
});

export default Brow;