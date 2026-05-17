import { forwardRef, useId } from "react";
import { PALETTE as C } from "./palette.js";

const Shadow = forwardRef(function Shadow(
  { width = 120, style = {}, className = '', ...rest },
  ref
) {
  const s = width / 120;
  const gid = useId();
  return (
    <g
      ref={ref}
      data-rig-part="shadow"
      style={{ transformOrigin: '50% 50%', transformBox: 'fill-box', ...style }}
      className={className}
      {...rest}
    >
      <g transform={`scale(${s})`}>
        <defs>
          <radialGradient id={`sh-${gid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="black" stopOpacity="0.5"/>
            <stop offset="60%"  stopColor="black" stopOpacity="0.2"/>
            <stop offset="100%" stopColor="black" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="60" cy="12" rx="56" ry="11" fill={`url(#sh-${gid})`}/>
      </g>
    </g>
  );
});

export default Shadow;
