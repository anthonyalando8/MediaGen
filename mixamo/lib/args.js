'use strict'

/**
 * args.js — CLI argument parser
 * 
 * Supports:
 *   --scene        path to scene.json
 *   --out          output directory
 *   --fps          frames per second (default: 30)
 *   --width        frame width (default: 1080)
 *   --height       frame height (default: 1920)
 *   --concurrency  parallel Chromium pages (default: 4)
 */

function parse(argv) {
  const args = argv.slice(2)
  const result = {
    scene:       null,
    out:         null,
    fps:         30,
    width:       1080,
    height:      1920,
    concurrency: 4,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--scene':       result.scene       = args[++i]; break
      case '--out':         result.out         = args[++i]; break
      case '--fps':         result.fps         = parseInt(args[++i], 10); break
      case '--width':       result.width       = parseInt(args[++i], 10); break
      case '--height':      result.height      = parseInt(args[++i], 10); break
      case '--concurrency': result.concurrency = parseInt(args[++i], 10); break
      default: console.warn(`[args] Unknown argument: ${args[i]}`)
    }
  }

  const missing = []
  if (!result.scene) missing.push('--scene')
  if (!result.out)   missing.push('--out')
  if (missing.length) {
    console.error(`[args] Missing required arguments: ${missing.join(', ')}`)
    console.error('Usage: node index.js --scene scene.json --out output/ [--fps 30] [--width 1080] [--height 1920] [--concurrency 4]')
    process.exit(1)
  }

  return result
}

module.exports = { parse }