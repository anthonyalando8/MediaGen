import { forwardRef, useRef, useImperativeHandle } from "react";

// Native viewBox: 0 0 56 32
const VB_W = 56;

const Mouth = forwardRef(function Mouth(
  { width = VB_W, style = {}, className = "", ...rest },
  ref
) {
  const s        = width / VB_W;
  const rootRef  = useRef(null);
  const upperRef = useRef(null);
  const lowerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    el:       rootRef.current,
    upperLip: upperRef.current,
    lowerLip: lowerRef.current,
  }));

  return (
    <g
      ref={rootRef}
      data-rig-part="mouth"
      style={{ transformOrigin: "50% 50%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* Mouth — viewBox 56×32 */}
        <ellipse cx="28" cy="18" rx="20" ry="12" fill="#8B2E3A"/>
        <rect x="12" y="14" width="32" height="8" rx="3" fill="white"/>
        <rect x="14" y="20" width="28" height="7" rx="3" fill="#F0ECEA"/>
        <g ref={upperRef} data-rig-part="mouth_upper"
           style={{ transformOrigin: "50% 100%", transformBox: "fill-box" }}>
          <path d="M6 16 Q14 10 28 12 Q42 10 50 16 Q42 14 28 16 Q14 14 6 16 Z"
                fill="#E8848A"/>
        </g>
        <g ref={lowerRef} data-rig-part="mouth_lower"
           style={{ transformOrigin: "50% 0%", transformBox: "fill-box" }}>
          <path d="M6 16 Q18 26 28 27 Q38 26 50 16 Q40 20 28 20 Q16 20 6 16 Z"
                fill="#D97079"/>
        </g>
        <path d="M6 16 Q18 14 28 15 Q38 14 50 16"
              stroke="#C05060" strokeWidth="1" strokeLinecap="round" fill="none"/>
      </g>
    </g>
  );
});

export default Mouth;