// packages/motion/src/index.ts — Phase 2 §9.1 Motion package
export type { Motion, MotionCtx, MotionPreset, MotionControl, MotionControlNumber, MotionControlSelect } from "./types";
export { bake } from "./bake";
export { kenBurns, kenBurnsPreset } from "./presets/ken-burns";
export { pop, popPreset } from "./presets/pop";
export { slamPunch, slamPunchPreset } from "./presets/slam-punch";
export { parallax, parallaxPreset } from "./presets/parallax";
export { spring, stepSpring } from "./generators/spring";
export { noise, sampleNoise, valueNoise } from "./generators/noise";