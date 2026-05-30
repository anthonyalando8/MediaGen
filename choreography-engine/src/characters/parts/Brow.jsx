import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Brow — short soft rounded brow. viewBox 48×16, pivot center.
 * Animate via translateY (raise/lower) or rotate (anger/worry).
 */
const Brow = forwardRef(function Brow(
  { width = 20, mirror = false, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 48;
  const mirrorT = mirror ? `scale(-1,1) translate(${-width}, 0)` : '';
  return (
    <g
      ref={ref}
      data-rig-part="brow"
      style={{ transformOrigin: '50% 50%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {/* soft tapered brow, thicker at the inner end */}
        <path d="M6 9
                 Q16 4 30 5
                 Q40 6 44 9
                 Q40 8 30 8
                 Q17 8 7 11 Z"
              fill={C.brow}/>
      </g>
    </g>
  );
});

export default Brow;
