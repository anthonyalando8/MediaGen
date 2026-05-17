import { forwardRef } from "react";

// upper_arm viewBox: 0 0 32 70   lower_arm viewBox: 0 0 28 65
const UPPER_VB_W = 32;
const LOWER_VB_W = 28;

const Arm = forwardRef(function Arm(
  { segment = "upper", width, mirror = false, style = {}, className = "", ...rest },
  ref
) {
  const isUpper = segment === "upper";
  const VB_W    = isUpper ? UPPER_VB_W : LOWER_VB_W;
  const w       = width ?? VB_W;
  const s       = w / VB_W;
  const mirrorT = mirror ? `scale(-1,1) translate(${-w}, 0)` : "";

  return (
    <g
      ref={ref}
      data-rig-part={`${segment}_arm`}
      style={{ transformOrigin: "50% 0%", transformBox: "fill-box", ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        {isUpper ? (
          <>
            {/* upper_arm — viewBox 32×70 */}
            <path d="M6 2 Q2 2 2 8 L2 60 Q2 66 8 68 L24 68 Q30 66 30 60 L30 8 Q30 2 26 2 Z"
                  fill="#3A6BBF" stroke="#2A4E99" strokeWidth="1.5"/>
            <ellipse cx="16" cy="34" rx="10" ry="22" fill="white" opacity="0.06"/>
          </>
        ) : (
          <>
            {/* lower_arm — viewBox 28×65 */}
            <path d="M5 2 Q2 2 2 7 L2 55 Q2 62 7 64 L21 64 Q26 62 26 55 L26 7 Q26 2 23 2 Z"
                  fill="#FADADB" stroke="#E8A0A4" strokeWidth="1.5"/>
            <path d="M10 10 L10 58" stroke="#E8A0A4" strokeWidth="1" opacity="0.3"/>
          </>
        )}
      </g>
    </g>
  );
});

export default Arm;