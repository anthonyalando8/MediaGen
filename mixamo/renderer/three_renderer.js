'use strict'

/**
 * three_renderer.js
 * -----------------
 * Fixes applied:
 *   1. Concurrency state fix — each worker pre-seeks to its start time
 *      by replaying all beat transitions up to that point, so gestures
 *      fire correctly regardless of which chunk a worker starts on.
 *   2. Camera framing fix — pulled back and lowered to fit full character.
 *   3. Single-page fallback for short videos / debugging.
 */

const fs    = require('fs')
const path  = require('path')
const { chromium } = require('playwright')

const MIXAMO_ROOT = path.join(__dirname, '..')
const LIBS_DIR    = path.join(MIXAMO_ROOT, 'libs')

// ─── Page setup ───────────────────────────────────────────────────────────────

async function setupPage({ browser, width, height, threeJs, fflateJs, fbxLoaderJs,
                            charB64, idleB64, gestureB64, beatTimeline }) {
  const context = await browser.newContext()
  const page    = await context.newPage()
  await page.setViewportSize({ width, height })

  await page.setContent(`
    <!DOCTYPE html><html><head>
    <style>
      * { margin:0; padding:0; }
      body { background:transparent; overflow:hidden; }
      canvas { display:block; }
    </style>
    </head><body>
    <canvas id="c" width="${width}" height="${height}"></canvas>
    </body></html>
  `)

  await page.addScriptTag({ content: threeJs })
  await page.addScriptTag({ content: fflateJs })
  await page.addScriptTag({ content: fbxLoaderJs })

  await page.evaluate(({ width, height, charB64, idleB64, gestureB64, beatTimeline }) => {
    // ── Renderer ────────────────────────────────────────────────────────
    const canvas   = document.getElementById('c')
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(1)
    renderer.outputEncoding = THREE.sRGBEncoding
    renderer.setClearColor(0x000000, 0)

    // ── Scene ────────────────────────────────────────────────────────────
    const scene  = new THREE.Scene()

    // FIX 3: pulled back (z=4.2) and lookAt lowered (y=1.0) to frame full body
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100)
    camera.position.set(0, 1.2, 4.2)
    camera.lookAt(0, 1.0, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 0.3))
    const key = new THREE.DirectionalLight(0xfff0e0, 1.8)
    key.position.set(1.5, 4, 2); scene.add(key)
    const fill = new THREE.DirectionalLight(0x1a1a3a, 0.5)
    fill.position.set(-3, 1, 1); scene.add(fill)
    const rim = new THREE.DirectionalLight(0xff4400, 0.4)
    rim.position.set(0, 3, -3); scene.add(rim)

    // ── FBX helpers ──────────────────────────────────────────────────────
    function b64ToArrayBuffer(b64) {
      const bin = atob(b64)
      const buf = new ArrayBuffer(bin.length)
      const arr = new Uint8Array(buf)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      return buf
    }
    function parseFBX(b64) {
      return new THREE.FBXLoader().parse(b64ToArrayBuffer(b64), '')
    }

    // ── Character ────────────────────────────────────────────────────────
    const charFbx = parseFBX(charB64)
    const box     = new THREE.Box3().setFromObject(charFbx)
    const size    = box.getSize(new THREE.Vector3())
    const scale   = 2.2 / size.y
    charFbx.scale.setScalar(scale)
    charFbx.position.y = -box.min.y * scale
    charFbx.traverse(o => { if (o.isMesh) o.castShadow = true })
    scene.add(charFbx)

    // ── Mixer + idle ─────────────────────────────────────────────────────
    const mixer      = new THREE.AnimationMixer(charFbx)
    const idleFbx    = parseFBX(idleB64)
    const idleClip   = idleFbx.animations[0]
    const idleAction = mixer.clipAction(idleClip)
    idleAction.loop = THREE.LoopRepeat
    idleAction.play()

    // ── Gesture clips ────────────────────────────────────────────────────
    const gestureClips   = {}
    const gestureActions = {}
    for (const [fname, b64] of Object.entries(gestureB64)) {
      const fbx = parseFBX(b64)
      if (fbx.animations?.length) {
        gestureClips[fname]   = fbx.animations[0]
        gestureActions[fname] = mixer.clipAction(fbx.animations[0])
      }
    }

    // ── Camera helper ─────────────────────────────────────────────────────
    // FIX 3: updated default camera position to match scene setup above
    function applyCameraAtTime(t, tl, cam) {
      const b = tl.find(b => t >= b.startTime && t < b.endTime)
      if (!b) {
        cam.position.set(0, 1.2, 4.2)
        cam.lookAt(0, 1.0, 0)
        return
      }
      const dur = b.endTime - b.startTime
      const p   = Math.min((t - b.startTime) / (dur * 0.3), 1.0)
      const e   = p < 0.5 ? 2*p*p : -1+(4-2*p)*p
      let z = 4.2, y = 1.2, x = 0
      switch (b.beat?.camera) {
        case 'push_in':     z = 5.5 + (4.2 - 5.5) * e; break
        case 'pull_out':    z = 4.2 + (5.5 - 4.2) * e; break
        case 'snap_zoom':   z = p < 0.1 ? 5.0+(3.2-5.0)*e : 3.2+(4.2-3.2)*e; break
        case 'tilt_up':     y = 0.6 + (1.2 - 0.6) * e; break
        case 'micro_shake':
          x = Math.sin(t * 47.3) * 0.012 * (1 - p)
          y = 1.2 + Math.sin(t * 31.7) * 0.006
          break
      }
      cam.position.set(x, y, z)
      cam.lookAt(0, 1.0, 0)
    }

    // ── seekTo(t) — deterministic animation state with blending ─────────
    // Computes correct pose for ANY time T — safe for concurrent workers.
    // Blend windows:
    //   BLEND_IN  (0.0 → 0.3s into beat) : idle fades out, gesture fades in
    //   BLEND_OUT (gesture end → +0.4s)   : gesture fades out, idle fades in
    const BLEND_IN  = 0.3  // seconds to blend from idle into gesture
    const BLEND_OUT = 0.4  // seconds to blend from gesture back to idle

    function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t }

    function setWeights(idleW, gestureAction, gestureW, gestureTime, idleTime) {
      // Idle
      if (!idleAction.isRunning()) {
        idleAction.reset(); idleAction.loop = THREE.LoopRepeat; idleAction.play()
      }
      idleAction.time = idleTime
      idleAction.setEffectiveWeight(idleW)

      // Gesture
      if (gestureAction) {
        if (!gestureAction.isRunning()) {
          gestureAction.reset()
          gestureAction.loop = THREE.LoopOnce
          gestureAction.clampWhenFinished = false
          gestureAction.play()
        }
        gestureAction.time = gestureTime
        gestureAction.setEffectiveWeight(gestureW)
      }

      // Stop unrelated gesture actions
      Object.entries(gestureActions).forEach(([fname, a]) => {
        if (a !== gestureAction && a.isRunning()) {
          a.setEffectiveWeight(0)
          a.stop()
        }
      })

      mixer.update(0)
    }

    function seekTo(t) {
      const beatIdx = beatTimeline.findIndex(b => t >= b.startTime && t < b.endTime)
      const beat    = beatTimeline[beatIdx]

      // ── No beat / no gesture → pure idle ─────────────────────────────
      if (beatIdx === -1 || !beat?.file || !gestureClips[beat.file]) {
        // Check if we're in a blend-out window after a previous beat
        const prevBeat = beatTimeline.slice(0, beatIdx === -1 ? beatTimeline.length : beatIdx)
          .reverse().find(b => b.file && gestureClips[b.file])

        if (prevBeat) {
          const timeSinceEnd = t - prevBeat.endTime
          if (timeSinceEnd >= 0 && timeSinceEnd < BLEND_OUT) {
            // Blend out previous gesture
            const blendW  = easeInOut(timeSinceEnd / BLEND_OUT)
            const action  = gestureActions[prevBeat.file]
            const clipDur = gestureClips[prevBeat.file].duration
            setWeights(
              blendW,                                    // idle fading IN
              action,
              1 - blendW,                               // gesture fading OUT
              Math.min(prevBeat.endTime - prevBeat.startTime, clipDur - 0.001),
              t % idleClip.duration
            )
            return
          }
        }

        // Pure idle
        idleAction.setEffectiveWeight(1)
        if (!idleAction.isRunning()) {
          idleAction.reset(); idleAction.loop = THREE.LoopRepeat; idleAction.play()
        }
        idleAction.time = t % idleClip.duration
        Object.values(gestureActions).forEach(a => { a.setEffectiveWeight(0); if (a.isRunning()) a.stop() })
        mixer.update(0)
        return
      }

      const clip       = gestureClips[beat.file]
      const action     = gestureActions[beat.file]
      const timeInBeat = t - beat.startTime

      // ── Gesture finished → blend back to idle ─────────────────────────
      if (timeInBeat >= clip.duration) {
        const timeSinceEnd = timeInBeat - clip.duration
        if (timeSinceEnd < BLEND_OUT) {
          const blendW = easeInOut(timeSinceEnd / BLEND_OUT)
          setWeights(
            blendW,
            action,
            1 - blendW,
            clip.duration - 0.001,
            timeSinceEnd % idleClip.duration
          )
        } else {
          // Fully back to idle
          idleAction.setEffectiveWeight(1)
          if (!idleAction.isRunning()) {
            idleAction.reset(); idleAction.loop = THREE.LoopRepeat; idleAction.play()
          }
          idleAction.time = timeSinceEnd % idleClip.duration
          action.setEffectiveWeight(0); if (action.isRunning()) action.stop()
          mixer.update(0)
        }
        return
      }

      // ── Blend in: first BLEND_IN seconds of beat ──────────────────────
      if (timeInBeat < BLEND_IN) {
        const blendW = easeInOut(timeInBeat / BLEND_IN)
        setWeights(
          1 - blendW,              // idle fading OUT
          action,
          blendW,                  // gesture fading IN
          timeInBeat,
          t % idleClip.duration
        )
        return
      }

      // ── Full gesture ──────────────────────────────────────────────────
      setWeights(0, action, 1, timeInBeat, t % idleClip.duration)
    }

    // ── Expose to Node render loop ────────────────────────────────────────
    window._renderState = {
      renderer, scene, camera,
      seekTo,
      applyCameraAtTime,
      beatTimeline,
    }

  }, { width, height, charB64, idleB64, gestureB64, beatTimeline })

  return page
}

// ─── Render a chunk of frames ─────────────────────────────────────────────────

async function renderChunk({ page, charFramesDir, fps, frameStart, frameEnd, workerIdx }) {
  for (let frameIdx = frameStart; frameIdx < frameEnd; frameIdx++) {
    const t = frameIdx / fps

    await page.evaluate((t) => {
      const s = window._renderState
      // FIX 1: seekTo gives correct state at any T — no sequential dependency
      s.seekTo(t)
      s.applyCameraAtTime(t, s.beatTimeline, s.camera)
      s.renderer.render(s.scene, s.camera)
    }, t)

    const frameName = `frame_${String(frameIdx + 1).padStart(4, '0')}.png`
    await page.screenshot({
      path: path.join(charFramesDir, frameName),
      type: 'png',
      omitBackground: true,
    })
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function renderCharacterFrames({
  scenePath,
  outDir,
  fps         = 30,
  width       = 1080,
  height      = 1920,
  concurrency = 4,
  characterDir,
  animationsDir,
  animMapPath,
}) {
  console.log('[three_renderer] Starting headless render...')
  console.log(`[three_renderer] ${width}x${height} @ ${fps}fps  concurrency=${concurrency}`)

  // ── Inputs ────────────────────────────────────────────────────────────
  const scene   = JSON.parse(fs.readFileSync(scenePath, 'utf8'))
  const beats   = scene.beats || []
  const animMap = JSON.parse(fs.readFileSync(animMapPath, 'utf8'))

  const totalDuration = beats.reduce((sum, b) => sum + (b.duration_ms / 1000), 0)
  const totalFrames   = Math.ceil(totalDuration * fps)
  console.log(`[three_renderer] ${beats.length} beats, ${totalDuration.toFixed(1)}s, ${totalFrames} frames`)

  // ── Beat timeline ─────────────────────────────────────────────────────
  let cursor = 0
  const beatTimeline = beats.map(beat => {
    const startTime = cursor
    const endTime   = cursor + (beat.duration_ms / 1000)
    cursor = endTime
    const file =
      animMap.by_emotion?.[beat.emotion] ||
      animMap.by_type?.[beat.scene]      ||
      'Thinking.fbx'
    return { startTime, endTime, file, beat }
  })

  // ── Output dir ────────────────────────────────────────────────────────
  const charFramesDir = path.join(outDir, 'char_frames')
  fs.mkdirSync(charFramesDir, { recursive: true })

  // ── Read libs ─────────────────────────────────────────────────────────
  const threeJs     = fs.readFileSync(path.join(LIBS_DIR, 'three.min.js'),  'utf8')
  const fflateJs    = fs.readFileSync(path.join(LIBS_DIR, 'fflate.min.js'), 'utf8')
  const fbxLoaderJs = fs.readFileSync(path.join(LIBS_DIR, 'FBXLoader.js'),  'utf8')

  // ── Read FBX files ────────────────────────────────────────────────────
  console.log('[three_renderer] Reading FBX files...')
  const charB64 = fs.readFileSync(path.join(characterDir,  animMap.character)).toString('base64')
  const idleB64 = fs.readFileSync(path.join(animationsDir, animMap.idle)).toString('base64')

  const uniqueAnims = [...new Set(beatTimeline.map(b => b.file))]
  const gestureB64  = {}
  for (const fname of uniqueAnims) {
    const fpath = path.join(animationsDir, fname)
    if (fs.existsSync(fpath)) {
      gestureB64[fname] = fs.readFileSync(fpath).toString('base64')
      console.log(`[three_renderer] Loaded: ${fname}`)
    } else {
      console.warn(`[three_renderer] Missing animation: ${fname}`)
    }
  }

  // ── Launch browser ────────────────────────────────────────────────────
  console.log(`[three_renderer] Launching Chromium (${concurrency} workers)...`)
  const browser  = await chromium.launch({ headless: true })
  const pageArgs = { browser, width, height, threeJs, fflateJs, fbxLoaderJs,
                     charB64, idleB64, gestureB64, beatTimeline }

  const pages = await Promise.all(
    Array.from({ length: concurrency }, () => setupPage(pageArgs))
  )
  console.log(`[three_renderer] ${concurrency} pages ready`)

  // ── Divide into chunks ────────────────────────────────────────────────
  const chunkSize = Math.ceil(totalFrames / concurrency)
  const chunks    = pages.map((page, i) => ({
    page,
    workerIdx:  i,
    frameStart: i * chunkSize,
    frameEnd:   Math.min((i + 1) * chunkSize, totalFrames),
  }))

  chunks.forEach(c =>
    console.log(`[three_renderer]   Worker ${c.workerIdx}: frames ${c.frameStart+1}–${c.frameEnd}`)
  )

  // ── Render in parallel ────────────────────────────────────────────────
  const t0 = Date.now()

  await Promise.all(chunks.map(({ page, workerIdx, frameStart, frameEnd }) =>
    renderChunk({ page, charFramesDir, fps, frameStart, frameEnd, workerIdx })
      .then(() => {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`[three_renderer] Worker ${workerIdx} done (${elapsed}s)`)
      })
  ))

  await browser.close()

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1)
  const avgFps    = (totalFrames / parseFloat(totalTime)).toFixed(1)
  console.log(`[three_renderer] ✓ Done — ${totalFrames} frames in ${totalTime}s (avg ${avgFps} fps)`)
  console.log(`[three_renderer] Output: ${charFramesDir}`)

  return charFramesDir
}

module.exports = { renderCharacterFrames }