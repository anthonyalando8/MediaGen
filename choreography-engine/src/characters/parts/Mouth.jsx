import { forwardRef, useRef, useImperativeHandle } from "react";
import { PALETTE as C } from "./palette.js";

/**
 * Mouth — friendly smile. viewBox 56×20.
 * Keeps the upperLip / lowerLip sub-refs so existing lip-sync animation works:
 *   ref.upperLip → translateY up, ref.lowerLip → translateY down to "open".
 * Default state is a gentle open smile (interior crescent + teeth strip).
 */
const Mouth = forwardRef(function Mouth(
  { width = 30, style = {}, className = '', ...rest },
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
        {/* interior (shows as the smile opening) */}
        <path d="M16 7 Q28 18 40 7 Q28 11 16 7 Z" fill={C.mouthIn}/>
        {/* teeth strip along the top of the opening */}
        <path d="M18 7 Q28 9.5 38 7 Q28 11 18 7 Z" fill={C.teeth}/>

        {/* upper lip (animatable) */}
        <g ref={upperRef} data-rig-part="mouth_upper"
           style={{ transformOrigin: '50% 100%', transformBox: 'fill-box' }}>
          <path d="M15 6 Q28 2 41 6 Q28 8 15 6 Z" fill={C.mouth}/>
        </g>

        {/* lower lip (animatable) */}
        <g ref={lowerRef} data-rig-part="mouth_lower"
           style={{ transformOrigin: '50% 0%', transformBox: 'fill-box' }}>
          <path d="M16 7 Q28 19 40 7 Q34 14 28 14 Q22 14 16 7 Z" fill={C.mouth}/>
          <path d="M19 9 Q28 15 37 9" stroke={C.mouthDeep} strokeWidth="0.6"
                fill="none" opacity="0.5" strokeLinecap="round"/>
        </g>
      </g>
    </g>
  );
});

export default Mouth;
