import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Eye — small friendly "dot" eye. viewBox 36×24, pivot center (blink = scaleY).
 * A soft dark rounded oval with a single shine. Mirror flips for the other side.
 */
const Eye = forwardRef(function Eye(
  { width = 20, mirror = false, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 36;
  const mirrorT = mirror ? `scale(-1,1) translate(${-width}, 0)` : '';
  return (
    <g
      ref={ref}
      data-rig-part="eye"
      style={{ transformOrigin: '50% 50%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {/* eye body — soft tall rounded oval */}
        <ellipse cx="18" cy="12" rx="6" ry="8" fill={C.eyeDark}/>
        {/* lower soft lid (lifts the eye into a friendly squint) */}
        <path d="M11 13 Q18 19 25 13" stroke={C.eyeDark} strokeWidth="0"
              fill="none"/>
        {/* main shine upper-right */}
        <ellipse cx="20.5" cy="9" rx="2.1" ry="2.4" fill={C.eyeShine}/>
        {/* tiny secondary shine lower-left */}
        <circle cx="15.5" cy="14.5" r="1.1" fill={C.eyeShine} opacity="0.8"/>
      </g>
    </g>
  );
});

export default Eye;
