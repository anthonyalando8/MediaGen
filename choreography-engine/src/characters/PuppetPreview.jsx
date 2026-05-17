import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import SVGPuppet from "./SVGPuppet.jsx";

/**
 * PuppetPreview.jsx
 * -----------------
 * Development sandbox. Verifies rig renders correctly and all
 * rigRef keys are populated. Runs smoke-test animations on mount.
 *
 * Character height = 310px (feet at y=0, head top at y=-310).
 * viewBox "-160 -340 320 360" gives 30px padding above head,
 * 20px below feet, and 160px either side of center for arms.
 */
export default function PuppetPreview() {
  const rigRef = useRef(null);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;

    // Audit refs — check browser console
    console.group("SVGPuppet rigRef audit");
    Object.entries(rig).forEach(([key, val]) => {
      const ok = Array.isArray(val) ? val.every(Boolean) : Boolean(val);
      console.log(`  ${key.padEnd(16)} ${ok ? "✓" : "✗ NULL"}`);
    });
    console.groupEnd();

    const ctx = gsap.context(() => {

      // Idle breathe
      gsap.to(rig.torso, {
        scaleY: 1.025, duration: 1.4,
        ease: "sine.inOut", yoyo: true, repeat: -1,
      });

      // Blink loop
      gsap.timeline({ repeat: -1, repeatDelay: 3 })
        .to([rig.eye_l, rig.eye_r], { scaleY: 0.05, duration: 0.07, ease: "power2.in" })
        .to([rig.eye_l, rig.eye_r], { scaleY: 1,    duration: 0.12, ease: "power2.out" });

      // Brow raise at t=1
      gsap.timeline({ delay: 1 })
        .to(rig.brow_l, { rotation: -8, y: -3, duration: 0.25 })
        .to(rig.brow_r, { rotation:  8, y: -3, duration: 0.25 }, "<")
        .to(rig.brow_l, { rotation:  0, y:  0, duration: 0.3, delay: 0.8 })
        .to(rig.brow_r, { rotation:  0, y:  0, duration: 0.3 }, "<");

      // Walk cycle at t=2
      gsap.timeline({ delay: 2 })
        .to(rig.leg_l,       { rotation:  22, duration: 0.25, ease: "power1.inOut" })
        .to(rig.leg_r,       { rotation: -22, duration: 0.25 }, "<")
        .to(rig.upper_arm_r, { rotation:  25, duration: 0.25 }, "<")
        .to(rig.upper_arm_l, { rotation: -25, duration: 0.25 }, "<")
        .to(rig.leg_l,       { rotation: -22, duration: 0.25, ease: "power1.inOut" })
        .to(rig.leg_r,       { rotation:  22, duration: 0.25 }, "<")
        .to(rig.upper_arm_r, { rotation: -25, duration: 0.25 }, "<")
        .to(rig.upper_arm_l, { rotation:  25, duration: 0.25 }, "<")
        .to([rig.leg_l, rig.leg_r, rig.upper_arm_l, rig.upper_arm_r], {
          rotation: 0, duration: 0.3,
        });

    });

    return () => ctx.revert();
  }, []);

  return (
    <div style={{
      width: 320, height: 380,
      background: "#f5f0ea",
      borderRadius: 16,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    }}>
      <svg
        width="320" height="380"
        viewBox="-160 -340 320 360"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Character puppet preview"
      >
        <line x1="-140" y1="0" x2="140" y2="0"
              stroke="#00000015" strokeWidth="1" />
        <SVGPuppet
          ref={rigRef}
          characterId="preview-hero"
          scale={1} x={0} y={0}
          facingRight={true}
        />
      </svg>
    </div>
  );
}