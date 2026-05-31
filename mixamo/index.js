'use strict'

/**
 * index.js — entry point for the Mixamo character renderer
 * 
 * Called by Python (visuals.py) as:
 *   node mixamo/index.js \
 *     --scene  workspace/run_xxx/scene.json \
 *     --out    workspace/run_xxx/ \
 *     --fps    30 \
 *     --width  1080 \
 *     --height 1920 \
 *     --concurrency 4
 */

const path = require('path')
const { parse }                 = require('./lib/args')
const { renderCharacterFrames } = require('./renderer/three_renderer')

const MIXAMO_ROOT    = __dirname
const CHARACTER_DIR  = path.join(MIXAMO_ROOT, 'character')
const ANIMATIONS_DIR = path.join(MIXAMO_ROOT, 'animations')
const ANIM_MAP_PATH  = path.join(MIXAMO_ROOT, 'animation_map.json')

async function main() {
  const args = parse(process.argv)

  console.log('[mixamo] ─────────────────────────────────────────')
  console.log('[mixamo] Character Renderer')
  console.log(`[mixamo] Scene:       ${args.scene}`)
  console.log(`[mixamo] Out:         ${args.out}`)
  console.log(`[mixamo] FPS:         ${args.fps}`)
  console.log(`[mixamo] Size:        ${args.width}x${args.height}`)
  console.log(`[mixamo] Concurrency: ${args.concurrency}`)
  console.log('[mixamo] ─────────────────────────────────────────')

  await renderCharacterFrames({
    scenePath:     args.scene,
    outDir:        args.out,
    fps:           args.fps,
    width:         args.width,
    height:        args.height,
    concurrency:   args.concurrency,
    characterDir:  CHARACTER_DIR,
    animationsDir: ANIMATIONS_DIR,
    animMapPath:   ANIM_MAP_PATH,
  })

  console.log('[mixamo] ✓ Complete')
}

main().catch(err => {
  console.error('[mixamo] ✗ Fatal error:', err.message)
  console.error(err.stack)
  process.exit(1)
})