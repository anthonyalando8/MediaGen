import { forwardRef } from "react";
import { PALETTE as C } from "./palette.js";

const Brow = forwardRef(function Brow(
  { width = 48, mirror = false, style = {}, className = '', ...rest },
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
        {/* main brow — tapered shape, drawn UPPER in the 16-tall viewBox so it
            doesn't kiss the eyelashes when placed above the eye */}
        <path d="M4 7
                 Q14 2 26 3
                 Q36 3 44 5
                 L43 7
                 Q35 5 26 5
                 Q15 5 5 8 Z"
              fill={C.hairBase}/>
        {/* hair-grain highlight */}
        <path d="M8 6 Q20 3 32 4 Q40 4 42 5"
              stroke={C.hairHi} strokeWidth="0.7" fill="none" opacity="0.6" strokeLinecap="round"/>
      </g>
    </g>
  );
});

export default Brow;
