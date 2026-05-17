import { forwardRef, useRef, useImperativeHandle } from "react";
import { Head, Eye, Brow, Mouth, Torso, Arm, Hand, Hip, Leg, Shadow } from "./parts/index.js";

/**
 * SVGPuppet.jsx — GSAP-safe two-group architecture
 * -------------------------------------------------
 * CRITICAL RULE: Every part component's outer <g ref> has NO SVG transform
 * attribute. SVGPuppet positions parts via wrapper <g transform="translate(x,y)">.
 * GSAP only ever writes CSS transforms to the ref — no conflict with SVG attributes.
 *
 * Tree structure per part:
 *   <g transform="translate(x,y)">          ← SVGPuppet positions (SVG attr, static)
 *     <Part ref={partRef}>                  ← GSAP target (CSS transform only)
 *       <g transform="scale(s)">            ← static scale (SVG attr, inside part)
 *         {raw paths}
 *       </g>
 *     </Part>
 *   </g>
 *
 * Layout math — stacking bottom→top from y=0 (feet):
 *   Parts are placed at their TOP-LEFT corner in stage space.
 *   Heights at native scale (parts render at scale=1, so pixel = viewBox unit):
 *
 *   legs    38×80  → legY  = -80    (top at -80, bottom at 0)
 *   hip     90×40  → hipY  = -120   (top at -120, bottom at -80)
 *   torso   90×110 → torY  = -230   (top at -230, bottom at -120)
 *   upper_arm 32×70           shoulder = -230
 *   lower_arm 28×65           elbow    = -160
 *   hand    36×40             wrist    = -95
 *   head    80×80  → headY = -310   (top at -310, bottom at -230)
 */
const SVGPuppet = forwardRef(function SVGPuppet(
  { characterId = "character", scale = 1, x = 0, y = 0, facingRight = true, style = {}, className = "" },
  ref
) {
  // ── Refs ─────────────────────────────────────────────────────────
  const rootRef      = useRef(null);
  const shadowRef    = useRef(null);
  const hipRef       = useRef(null);
  const legLRef      = useRef(null);
  const legRRef      = useRef(null);
  const footLRef     = useRef(null);
  const footRRef     = useRef(null);
  const torsoRef     = useRef(null);
  const upperArmLRef = useRef(null);
  const lowerArmLRef = useRef(null);
  const handLRef     = useRef(null);
  const upperArmRRef = useRef(null);
  const lowerArmRRef = useRef(null);
  const handRRef     = useRef(null);
  const headRef      = useRef(null);
  const eyeLRef      = useRef(null);
  const eyeRRef      = useRef(null);
  const browLRef     = useRef(null);
  const browRRef     = useRef(null);
  const mouthRef     = useRef(null);

  useImperativeHandle(ref, () => ({
    root:        rootRef.current,
    shadow:      shadowRef.current,
    hip:         hipRef.current,
    leg_l:       legLRef.current,
    leg_r:       legRRef.current,
    foot_l:      footLRef.current,
    foot_r:      footRRef.current,
    torso:       torsoRef.current,
    upper_arm_l: upperArmLRef.current,
    lower_arm_l: lowerArmLRef.current,
    hand_l:      handLRef.current,
    upper_arm_r: upperArmRRef.current,
    lower_arm_r: lowerArmRRef.current,
    hand_r:      handRRef.current,
    head:        headRef.current,
    eye_l:       eyeLRef.current,
    eye_r:       eyeRRef.current,
    brow_l:      browLRef.current,
    brow_r:      browRRef.current,
    mouth:       mouthRef.current,
    eyes:        [eyeLRef.current,      eyeRRef.current],
    brows:       [browLRef.current,     browRRef.current],
    arms_l:      [upperArmLRef.current, lowerArmLRef.current, handLRef.current],
    arms_r:      [upperArmRRef.current, lowerArmRRef.current, handRRef.current],
    legs:        [legLRef.current,      legRRef.current],
  }));

  // ── Part dimensions (native viewBox sizes = rendered pixel sizes at scale 1) ─
  const TORSO_W = 90,  TORSO_H = 110;
  const HIP_W   = 90,  HIP_H   = 40;
  const LEG_W   = 38,  LEG_H   = 80;
  const UA_W    = 32,  UA_H    = 70;
  const LA_W    = 28,  LA_H    = 65;
  const HAND_W  = 36;
  const HEAD_W  = 80,  HEAD_H  = 80;
  const EYE_W   = 24;   // rendered width (smaller than viewBox for proportion)
  const BROW_W  = 22;
  const MOUTH_W = 40;
  const SHADOW_W = 100;

  // ── Y positions — each part's TOP-LEFT corner ─────────────────────
  const LEG_Y      = -LEG_H;               // -80
  const HIP_Y      = -LEG_H - HIP_H;       // -120
  const TORSO_Y    = HIP_Y  - TORSO_H;     // -230
  const SHOULDER_Y = TORSO_Y;              // -230 — arm top = torso top
  const ELBOW_Y    = SHOULDER_Y + UA_H;    // -160
  const WRIST_Y    = ELBOW_Y   + LA_H;     // -95
  const HEAD_Y     = TORSO_Y   - HEAD_H;   // -310

  // ── X positions — centered on x=0 ────────────────────────────────
  const TORSO_X = -(TORSO_W / 2);          // -45  (center)
  const HIP_X   = -(HIP_W   / 2);          // -45
  // Legs: gap of 4px between them, centered under hip
  const LEG_L_X = -(LEG_W + 2);            // -40
  const LEG_R_X =  2;                      //  +2
  // Arms: sit flush against torso sides
  const UA_L_X  = TORSO_X - UA_W;          // -77
  const UA_R_X  = -TORSO_X;               // +45
  const LA_L_X  = UA_L_X  + 2;            // -75
  const LA_R_X  = UA_R_X  - 2;            // +43
  const HA_L_X  = LA_L_X  - 2;            // -77
  const HA_R_X  = LA_R_X  + (LA_W - HAND_W) / 2 + 2; // centers hand on forearm
  // Head: centered
  const HEAD_X  = -(HEAD_W / 2);           // -40

  // ── Face feature positions (in HEAD's local space after translate) ─
  // Head rect occupies x=4..76, y=8..76. Hair fills y=4..28.
  // Usable face area: x=10..70  y=28..72  →  60px wide, 44px tall
  // Eyes: place two eyes symmetrically, with natural spacing
  const EYE_Y   = HEAD_Y + 34;  // absolute stage Y: -310 + 34 = -276
  const EYE_L_X = HEAD_X + 10;  // left eye left edge:  -40 + 10 = -30
  const EYE_R_X = HEAD_X + HEAD_W - EYE_W - 10;  // right eye left edge: -40+80-24-10 = +6

  // Brows: just above eyes
  const BROW_Y   = HEAD_Y + 24;
  const BROW_L_X = HEAD_X + 11;
  const BROW_R_X = HEAD_X + HEAD_W - BROW_W - 11;

  // Mouth: lower face, centered
  const MOUTH_Y = HEAD_Y + 56;
  const MOUTH_X = HEAD_X + (HEAD_W - MOUTH_W) / 2;  // centered

  // Shadow: centered at feet
  const SHADOW_X = -(SHADOW_W / 2);
  const SHADOW_Y = -8;

  const flip = facingRight ? 1 : -1;

  // ── Positioner helper — keeps SVGPuppet JSX clean ────────────────
  const P = ({ x: px, y: py, children }) => (
    <g transform={`translate(${px}, ${py})`}>{children}</g>
  );

  return (
    <g
      ref={rootRef}
      data-character-id={characterId}
      transform={`translate(${x}, ${y}) scale(${scale * flip}, ${scale})`}
      style={{ transformOrigin: "50% 100%", transformBox: "fill-box", ...style }}
      className={className}
      aria-label={`Character: ${characterId}`}
    >
      {/* ── Shadow ──────────────────────────────────────────── */}
      <P x={SHADOW_X} y={SHADOW_Y}>
        <Shadow ref={shadowRef} width={SHADOW_W} />
      </P>

      {/* ── Back arm (left — BEHIND torso) ──────────────────── */}
      <P x={UA_L_X} y={SHOULDER_Y}><Arm ref={upperArmLRef} segment="upper" width={UA_W} /></P>
      <P x={LA_L_X} y={ELBOW_Y}>   <Arm ref={lowerArmLRef} segment="lower" width={LA_W} /></P>
      <P x={HA_L_X} y={WRIST_Y}>   <Hand ref={handLRef}                    width={HAND_W} /></P>

      {/* ── Legs ────────────────────────────────────────────── */}
      <P x={LEG_L_X} y={LEG_Y}><Leg ref={legLRef} footRef={footLRef} legWidth={LEG_W} /></P>
      <P x={LEG_R_X} y={LEG_Y}><Leg ref={legRRef} footRef={footRRef} legWidth={LEG_W} mirror /></P>

      {/* ── Hip ─────────────────────────────────────────────── */}
      <P x={HIP_X} y={HIP_Y}><Hip ref={hipRef} width={HIP_W} /></P>

      {/* ── Torso ───────────────────────────────────────────── */}
      <P x={TORSO_X} y={TORSO_Y}><Torso ref={torsoRef} width={TORSO_W} /></P>

      {/* ── Front arm (right — IN FRONT of torso) ───────────── */}
      <P x={UA_R_X} y={SHOULDER_Y}><Arm ref={upperArmRRef} segment="upper" width={UA_W} /></P>
      <P x={LA_R_X} y={ELBOW_Y}>   <Arm ref={lowerArmRRef} segment="lower" width={LA_W} /></P>
      <P x={HA_R_X} y={WRIST_Y}>   <Hand ref={handRRef}                    width={HAND_W} /></P>

      {/* ── Head ────────────────────────────────────────────── */}
      <P x={HEAD_X} y={HEAD_Y}><Head ref={headRef} width={HEAD_W} /></P>

      {/* ── Brows ───────────────────────────────────────────── */}
      <P x={BROW_L_X} y={BROW_Y}><Brow ref={browLRef} width={BROW_W} /></P>
      <P x={BROW_R_X} y={BROW_Y}><Brow ref={browRRef} width={BROW_W} mirror /></P>

      {/* ── Eyes ────────────────────────────────────────────── */}
      <P x={EYE_L_X} y={EYE_Y}><Eye ref={eyeLRef} width={EYE_W} /></P>
      <P x={EYE_R_X} y={EYE_Y}><Eye ref={eyeRRef} width={EYE_W} mirror /></P>

      {/* ── Mouth ───────────────────────────────────────────── */}
      <P x={MOUTH_X} y={MOUTH_Y}><Mouth ref={mouthRef} width={MOUTH_W} /></P>
    </g>
  );
});

export default SVGPuppet;