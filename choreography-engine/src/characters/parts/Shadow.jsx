import { forwardRef } from "react";

// Native viewBox: 0 0 120 24
const VB_W = 120;

const Shadow = forwardRef(function Shadow(
  { width = VB_W, style = {}, className = "", ...rest },
  ref
) {
  const s = width / VB_W;
  return (
    <g
      ref={ref}
      data-rig-part="shadow"
      style={{ transformOrigin: "50% 50%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* Shadow — viewBox 120×24 */}
        <ellipse cx="60" cy="12" rx="56" ry="10" fill="black" opacity="0.18"/>
      </g>
    </g>
  );
});

export default Shadow;