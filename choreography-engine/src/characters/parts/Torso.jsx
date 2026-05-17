import { forwardRef } from "react";

// Native viewBox: 0 0 90 110
const VB_W = 90;

const Torso = forwardRef(function Torso(
  { width = VB_W, style = {}, className = "", ...rest },
  ref
) {
  const s = width / VB_W;
  return (
    <g
      ref={ref}
      data-rig-part="torso"
      style={{ transformOrigin: "50% 0%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* Torso — viewBox 90×110 */}
        <path d="M10 10 L80 10 Q88 10 88 20 L88 95 Q88 105 78 105 L12 105 Q2 105 2 95 L2 20 Q2 10 10 10 Z"
              fill="#3A6BBF" stroke="#2A4E99" strokeWidth="1.5"/>
        <path d="M30 10 Q45 24 60 10" fill="#2A4E99"/>
        <ellipse cx="45" cy="55" rx="28" ry="35" fill="white" opacity="0.06"/>
      </g>
    </g>
  );
});

export default Torso;