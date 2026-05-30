import { forwardRef, useRef, useImperativeHandle } from "react";
import { Head, Eye, Brow, Mouth, Torso, Arm, Hand, Hip, Leg, Shadow } from "./parts/index.js";

/**
 * SVGPuppet.jsx — GSAP-safe two-group architecture (contract UNCHANGED).
 * -------------------------------------------------------------------------
 * Every part's outer <g ref> has NO SVG transform; SVGPuppet positions parts
 * with wrapper <g transform="translate(x,y)">; GSAP writes CSS transforms only.
 *
 * ── MATCHED TO THE CURRENT (large) PARTS ─────────────────────────────────
 *   Torso     120×150   (broad chest, V-taper)
 *   Upper arm  52×92     deltoid cap on the INNER side (local x≈2–16),
 *                        arm-body centerline ≈ local x36, bottom(elbow) ≈ x36
 *   Lower arm  32×86     body centerline ≈ local x16
 *   Hand       40×46     centerline ≈ local x20
 *   Hip        88×56     Leg 46×170     Head 76×92
 *
 * Why the old build looked "disconnected": the previous SVGPuppet used the
 * chibi dims (TORSO_W=90, UA_W=32), did NOT pass full widths, applied NO joint
 * overlaps, and did NOT mirror the back/left arm — so the deltoid landed on the
 * wrong side and every joint had a gap. All fixed below.
 *
 * KEY RULES that keep the upper body connected:
 *   1. Back/left arm AND right/front arm both get the correct mirror so each
 *      deltoid points toward the torso centre (inner side).
 *   2. Each segment is offset so the deltoid overlaps the torso shoulder and the
 *      forearm + hand fall straight under the elbow (shared visible centre).
 *   3. Joints overlap (ELBOW/WRIST/SHOULDER) so the later-drawn part hides the seam.
 *
 * Stage space: y=0 ≈ ground at feet, building UPWARD (negative y).
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

  // ── Part dimensions (native viewBox = rendered px at scale 1) ─────
  const TORSO_W = 120, TORSO_H = 150;
  const HIP_W   = 88,  HIP_H   = 56;
  const LEG_W   = 46,  LEG_H   = 170;
  const UA_W    = 36,  UA_H    = 92;    // upper arm (slim tapered tube)
  const LA_W    = 30,  LA_H    = 86;
  const HAND_W  = 34;
  const HEAD_W  = 76,  HEAD_H  = 92;
  const EYE_W   = 20;
  const BROW_W  = 20;
  const MOUTH_W = 30;
  const SHADOW_W = 130;

  // ── Local centrelines inside each part (viewBox units) ────────────
  const UA_BODY_C = 18;   // upper-arm centreline (= width/2, centred shape)
  const LA_BODY_C = 15;   // lower-arm centreline
  const HAND_C    = 17;   // hand centreline

  // ── Joint overlaps (px the upper part dips behind the lower one) ──
  const HIP_OVERLAP   = 16;
  const TORSO_OVERLAP = 16;
  const NECK_OVERLAP  = 26;   // head drops onto the shoulders; neck ends in the collar
  const ELBOW_OVERLAP = 12;
  const WRIST_OVERLAP = 15;

  // ── Y positions — each part's TOP-LEFT corner, stacked bottom→top ─
  const LEG_Y      = -LEG_H;                               // -170
  const HIP_Y      = LEG_Y - HIP_H + HIP_OVERLAP;          // -210
  const TORSO_Y    = HIP_Y - TORSO_H + TORSO_OVERLAP;      // -344
  const HEAD_Y     = TORSO_Y - HEAD_H + NECK_OVERLAP;      // -420
  const SHOULDER_Y = TORSO_Y + 20;                         // slim arm tucks under the torso shoulder shelf
  const ELBOW_Y    = SHOULDER_Y + (UA_H - 4) - ELBOW_OVERLAP; // lower-arm top
  const WRIST_Y    = ELBOW_Y + (LA_H - 2) - WRIST_OVERLAP;    // hand top

  // ── X positions — centred on x=0 ─────────────────────────────────
  const TORSO_X = -(TORSO_W / 2);   // -60
  const HIP_X   = -(HIP_W / 2);     // -44

  // Legs: visible centres at ±LEG_CX (leg-art centre ≈ w/2)
  const LEG_CX  = 20;
  const LEG_L_X = -LEG_CX - LEG_W / 2;   // -43
  const LEG_R_X =  LEG_CX - LEG_W / 2;   // -3

  // Arms: pick the elbow's visible centre, then back-solve each segment so the
  // deltoid overlaps the torso shoulder and forearm/hand fall straight down.
  const ELBOW_CX = 44;   // |stage x| of the shoulder–elbow–wrist line (inside the torso shoulder)

  // right side (NOT mirrored): stage = X + localCentre
  const UA_R_X = ELBOW_CX - UA_BODY_C;   // 20
  const LA_R_X = ELBOW_CX - LA_BODY_C;   // 40
  const HA_R_X = ELBOW_CX - HAND_C;      // 36
  // left side (mirrored): stage = X + (w - localCentre) ⇒ X = -ELBOW_CX - (w - c)
  const UA_L_X = -ELBOW_CX - (UA_W - UA_BODY_C);  // -72
  const LA_L_X = -ELBOW_CX - (LA_W - LA_BODY_C);  // -72
  const HA_L_X = -ELBOW_CX - (HAND_W - HAND_C);   // -76

  // Head: centred
  const HEAD_X = -(HEAD_W / 2);   // -38

  // ── Face features (stage coords; head face-centre is stage x=0) ───
  const EYE_CX  = 11;
  const EYE_Y   = HEAD_Y + 31;
  const EYE_R_X =  EYE_CX - 10;   // +1
  const EYE_L_X = -EYE_CX - 10;   // -21 (mirror)

  const BROW_Y   = EYE_Y - 7;
  const BROW_R_X =  EYE_CX - 10;
  const BROW_L_X = -EYE_CX - 11;

  const MOUTH_Y = EYE_Y + 25;
  const MOUTH_X = -(MOUTH_W / 2);

  const SHADOW_X = -(SHADOW_W / 2);
  const SHADOW_Y = 8;

  const flip = facingRight ? 1 : -1;

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

      {/* ── Back arm (left — BEHIND torso, mirrored so deltoid is inner) ── */}
      <P x={UA_L_X} y={SHOULDER_Y}><Arm ref={upperArmLRef} segment="upper" width={UA_W} mirror /></P>
      <P x={LA_L_X} y={ELBOW_Y}>   <Arm ref={lowerArmLRef} segment="lower" width={LA_W} mirror /></P>
      <P x={HA_L_X} y={WRIST_Y}>   <Hand ref={handLRef}                    width={HAND_W} mirror /></P>

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
      <P x={BROW_L_X} y={BROW_Y}><Brow ref={browLRef} width={BROW_W} mirror /></P>
      <P x={BROW_R_X} y={BROW_Y}><Brow ref={browRRef} width={BROW_W} /></P>

      {/* ── Eyes ────────────────────────────────────────────── */}
      <P x={EYE_L_X} y={EYE_Y}><Eye ref={eyeLRef} width={EYE_W} mirror /></P>
      <P x={EYE_R_X} y={EYE_Y}><Eye ref={eyeRRef} width={EYE_W} /></P>

      {/* ── Mouth ───────────────────────────────────────────── */}
      <P x={MOUTH_X} y={MOUTH_Y}><Mouth ref={mouthRef} width={MOUTH_W} /></P>
    </g>
  );
});

export default SVGPuppet;
