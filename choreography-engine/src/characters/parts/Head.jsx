import { forwardRef } from "react";

// Native viewBox: 0 0 80 80
const VB_W = 80;

/**
 * Head — GSAP-safe two-group pattern.
 * Outer <g ref> has NO SVG transform — GSAP owns it via CSS.
 * Inner <g> carries the static scale — never touched by GSAP.
 * SVGPuppet positions this via a translate wrapper.
 */
const Head = forwardRef(function Head(
  { width = VB_W, style = {}, className = "", ...rest },
  ref
) {
  const s = width / VB_W;
  return (
    <g
      ref={ref}
      data-rig-part="head"
      style={{ transformOrigin: "50% 100%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* Head shape — viewBox 80×80 */}
        <rect x="4" y="8" width="72" height="68" rx="28" ry="28"
              fill="#FADADB" stroke="#E8A0A4" strokeWidth="2"/>
        <ellipse cx="4"  cy="44" rx="5" ry="9" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.5"/>
        <ellipse cx="76" cy="44" rx="5" ry="9" fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.5"/>
        <path d="M14 28 Q14 4 40 4 Q66 4 66 28" fill="#5C3D2E"/>
      </g>
    </g>
  );
});

export default Head;