import { forwardRef, useId } from "react";
import { PALETTE as C } from "./palette.js";

const Eye = forwardRef(function Eye(
  { width = 36, mirror = false, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 36;
  const mirrorT = mirror ? `scale(-1,1) translate(${-width}, 0)` : '';
  // unique gradient id per render so multiple eyes share crisply
  const gid = useId();
  return (
    <g
      ref={ref}
      data-rig-part="eye"
      style={{ transformOrigin: '50% 50%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s}) ${mirrorT}`}>
        <defs>
          <radialGradient id={`iris-${gid}`} cx="50%" cy="40%" r="55%">
            <stop offset="0%"  stopColor={C.irisRim}/>
            <stop offset="35%" stopColor={C.irisOuter}/>
            <stop offset="100%" stopColor={C.irisInner}/>
          </radialGradient>
          <radialGradient id={`white-${gid}`} cx="50%" cy="40%" r="60%">
            <stop offset="0%"   stopColor={C.eyeWhite}/>
            <stop offset="100%" stopColor={C.eyeShade}/>
          </radialGradient>
        </defs>

        {/* upper lid shadow (sits behind everything, gives depth) */}
        <path d="M2 10 Q18 4 34 10 Q18 7 2 10 Z" fill={C.skinShade} opacity="0.4"/>

        {/* eye white — almond shape */}
        <path d="M3 12
                 Q4 5 18 4
                 Q32 5 33 12
                 Q32 19 18 20
                 Q4 19 3 12 Z"
              fill={`url(#white-${gid})`} stroke={C.skinLine} strokeWidth="0.5"/>

        {/* iris — taller-than-wide (anime convention) */}
        <ellipse cx="18" cy="12" rx="7.5" ry="8.5" fill={`url(#iris-${gid})`}/>
        {/* iris dark rim */}
        <ellipse cx="18" cy="12" rx="7.5" ry="8.5"
                 fill="none" stroke={C.irisInner} strokeWidth="0.6" opacity="0.85"/>
        {/* inner darker pool */}
        <ellipse cx="18" cy="13" rx="4.5" ry="5.5" fill={C.irisInner} opacity="0.7"/>
        {/* pupil */}
        <ellipse cx="18" cy="12" rx="2.2" ry="3.2" fill={C.pupil}/>

        {/* big highlight upper-right */}
        <ellipse cx="21" cy="9" rx="2.6" ry="2.2" fill="white"/>
        {/* small highlight lower-left */}
        <ellipse cx="14" cy="15.5" rx="1.3" ry="1.0" fill="white" opacity="0.85"/>
        {/* iris bright reflection across bottom */}
        <path d="M13 16 Q18 17.5 23 16" stroke={C.irisRim} strokeWidth="0.7"
              fill="none" opacity="0.8" strokeLinecap="round"/>

        {/* UPPER LASH — the defining anime feature */}
        <path d="M2 11 Q4 4 18 3.5 Q32 4 34 11"
              stroke={C.lashes} strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        {/* outer lash flick */}
        <path d="M3 10 Q1 8 0 6" stroke={C.lashes} strokeWidth="1.6"
              strokeLinecap="round" fill="none"/>
        <path d="M5 5 Q3 4 2 2" stroke={C.lashes} strokeWidth="1.1"
              strokeLinecap="round" fill="none" opacity="0.9"/>

        {/* lower lash hint */}
        <path d="M5 19 Q18 21 31 19" stroke={C.lashes} strokeWidth="0.8"
              strokeLinecap="round" fill="none" opacity="0.7"/>
      </g>
    </g>
  );
});

export default Eye;
