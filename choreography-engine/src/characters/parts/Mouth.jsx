import { forwardRef, useRef, useImperativeHandle } from "react";
import { PALETTE as C } from "./palette.js";

const Mouth = forwardRef(function Mouth(
  { width = 56, style = {}, className = '', ...rest },
  ref
) {
  const s        = width / 56;
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
      style={{ transformOrigin: '50% 50%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        {/* mouth interior (shows when lips part) — LIFTED to y=4..8 in viewBox
            so when SVGPuppet places mouth at HEAD_Y+56 the lip-line lands at
            ~75% down the face (anime convention) instead of chin level. */}
        <path d="M18 6 Q28 12 38 6 Q28 8 18 6 Z" fill={C.mouthIn}/>
        {/* tongue hint */}
        <path d="M22 7 Q28 10 34 7 Q28 9 22 7 Z" fill={C.tongue} opacity="0.85"/>
        {/* upper teeth strip (only peeks when mouth opens) */}
        <path d="M20 5.5 Q28 6.5 36 5.5 L36 6.8 Q28 7.8 20 6.8 Z" fill={C.teeth}/>

        {/* upper lip (animatable) */}
        <g ref={upperRef} data-rig-part="mouth_upper"
           style={{ transformOrigin: '50% 100%', transformBox: 'fill-box' }}>
          <path d="M16 5
                   Q22 1 28 3
                   Q34 1 40 5
                   Q34 3 28 4
                   Q22 3 16 5 Z"
                fill={C.lip} stroke={C.lipDeep} strokeWidth="0.5"/>
          <path d="M22 3 Q28 2 34 3" stroke={C.lip} strokeWidth="0.6"
                fill="none" opacity="0.6"/>
        </g>

        {/* lower lip (animatable) */}
        <g ref={lowerRef} data-rig-part="mouth_lower"
           style={{ transformOrigin: '50% 0%', transformBox: 'fill-box' }}>
          <path d="M16 6
                   Q22 11 28 11
                   Q34 11 40 6
                   Q34 8 28 8
                   Q22 8 16 6 Z"
                fill={C.lip} stroke={C.lipDeep} strokeWidth="0.5"/>
          <ellipse cx="28" cy="9" rx="6" ry="0.7" fill="white" opacity="0.35"/>
        </g>

        {/* philtrum hint above the upper lip */}
        <path d="M28 0 L28 2.5" stroke={C.skinShade} strokeWidth="0.4" opacity="0.5"/>
      </g>
    </g>
  );
});

export default Mouth;
