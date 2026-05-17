import { forwardRef } from "react";

// Native viewBox: 0 0 90 40
const VB_W = 90;

const Hip = forwardRef(function Hip(
  { width = VB_W, style = {}, className = "", ...rest },
  ref
) {
  const s = width / VB_W;
  return (
    <g
      ref={ref}
      data-rig-part="hip"
      style={{ transformOrigin: "50% 0%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* Hip — viewBox 90×40 */}
        <path d="M4 2 Q2 2 2 6 L2 34 Q2 38 6 38 L84 38 Q88 38 88 34 L88 6 Q88 2 86 2 Z"
              fill="#2A4480" stroke="#1A3060" strokeWidth="1.5"/>
        <rect x="2" y="2" width="86" height="10" rx="3" fill="#1A3060" opacity="0.6"/>
        <rect x="38" y="4" width="14" height="6" rx="2"
              fill="#C0A860" stroke="#A08840" strokeWidth="1"/>
      </g>
    </g>
  );
});

export default Hip;