'use strict'

/**
 * animation_mixer.js
 * ------------------
 * Manages the character's animation state machine:
 * 
 *   - Idle loops continuously as the base layer
 *   - Beat gestures play ONCE then crossfade back to idle
 *   - Provides getStateAtTime(t) for the render loop — seeks the mixer
 *     to the correct time for a given frame timestamp
 * 
 * Timeline model:
 *   Each beat has { startTime, endTime, animationFile }
 *   At any time T:
 *     - Find which beat contains T (if any)
 *     - If in a beat: play gesture from (T - beat.startTime)
 *     - If between beats: play idle
 */

const THREE = require('three')
const path  = require('path')
const { loadFBX } = require('./fbx_loader')

class AnimationMixer {
  constructor({ characterRoot, animationsDir }) {
    this.characterRoot  = characterRoot
    this.animationsDir  = animationsDir
    this.mixer          = new THREE.AnimationMixer(characterRoot)
    this.idleClip       = null
    this.idleAction     = null
    this.gestureClips   = {}   // filename → THREE.AnimationClip
    this.beatTimeline   = []   // [{ startTime, endTime, file, clip, action }]
    this._lastBeatIdx   = -1
    this._currentAction = null
  }

  /**
   * Load the idle animation (must be "with skin" FBX).
   */
  loadIdle(idleFile) {
    const fbx = loadFBX(path.join(this.animationsDir, idleFile))
    if (!fbx.animations?.length) {
      throw new Error(`[animation_mixer] Idle FBX has no animations: ${idleFile}`)
    }
    this.idleClip   = fbx.animations[0]
    this.idleAction = this.mixer.clipAction(this.idleClip)
    this.idleAction.loop             = THREE.LoopRepeat
    this.idleAction.clampWhenFinished = false
    this.idleAction.timeScale        = 1.0
    this.idleAction.play()
    this._currentAction = this.idleAction
    console.log(`[animation_mixer] Idle loaded: ${idleFile} (${this.idleClip.duration.toFixed(2)}s)`)
  }

  /**
   * Pre-load a gesture animation by filename.
   * Called during setup so render loop has no IO.
   */
  preloadGesture(filename) {
    if (this.gestureClips[filename]) return  // already loaded
    const fbx = loadFBX(path.join(this.animationsDir, filename))
    if (!fbx.animations?.length) {
      console.warn(`[animation_mixer] No animations in: ${filename}`)
      return
    }
    this.gestureClips[filename] = fbx.animations[0]
    console.log(`[animation_mixer] Gesture loaded: ${filename} (${fbx.animations[0].duration.toFixed(2)}s)`)
  }

  /**
   * Build the beat timeline from beat contracts.
   * Each beat gets a startTime, endTime, and resolved animation filename.
   * 
   * @param {Array} beats       - beat contracts from scene.json
   * @param {Array} animMap     - animation_map.json contents
   */
  buildTimeline(beats, animMap) {
    this.beatTimeline = beats.map(beat => {
      const startTime = beat.start_time_s  || 0
      const endTime   = beat.end_time_s    || startTime + (beat.duration_ms / 1000)

      // Resolve animation: emotion first, type as fallback
      const file =
        animMap.by_emotion?.[beat.emotion] ||
        animMap.by_type?.[beat.scene]      ||
        animMap.by_type?.['insight']       // ultimate fallback

      return { startTime, endTime, file, beat }
    })

    // Pre-load all needed gestures
    const unique = [...new Set(this.beatTimeline.map(b => b.file).filter(Boolean))]
    console.log(`[animation_mixer] Pre-loading ${unique.length} gesture animations...`)
    unique.forEach(f => this.preloadGesture(f))
    console.log('[animation_mixer] Timeline ready')
  }

  /**
   * Seek the mixer to time T and update bone transforms.
   * Call this once per frame before rendering.
   * 
   * @param {number} t - absolute time in seconds from video start
   */
  seekTo(t) {
    // Find which beat we're in (if any)
    const beatIdx = this.beatTimeline.findIndex(
      b => t >= b.startTime && t < b.endTime
    )

    if (beatIdx === -1) {
      // Between beats — ensure idle is playing
      this._ensureIdle()
    } else {
      const beat = this.beatTimeline[beatIdx]
      const timeInBeat = t - beat.startTime
      const clip = this.gestureClips[beat.file]

      if (!clip) {
        // Gesture not loaded — fall back to idle
        this._ensureIdle()
      } else {
        const gestureDuration = clip.duration
        const clipTime = timeInBeat % gestureDuration  // allow loop within beat if gesture is short

        // If we just entered this beat, set up the gesture action
        if (beatIdx !== this._lastBeatIdx) {
          this._playGesture(beat.file, clipTime)
          this._lastBeatIdx = beatIdx
        }

        // Seek gesture to exact frame time
        const action = this.mixer.clipAction(clip)
        action.time = Math.min(clipTime, gestureDuration - 0.001)
        this.mixer.update(0)  // update with 0 delta to apply the seek
        return
      }
    }

    // Seek idle to time T (looped)
    if (this.idleAction && this.idleClip) {
      const idleTime = t % this.idleClip.duration
      this.idleAction.time = idleTime
    }
    this.mixer.update(0)
    this._lastBeatIdx = beatIdx
  }

  /**
   * Ensure idle action is the active one.
   */
  _ensureIdle() {
    if (!this.idleAction) return
    if (!this.idleAction.isRunning()) {
      this.idleAction.reset()
      this.idleAction.play()
      this._currentAction = this.idleAction
    }
  }

  /**
   * Activate a gesture action (stops idle, plays gesture).
   */
  _playGesture(filename, startTime = 0) {
    const clip = this.gestureClips[filename]
    if (!clip) return

    const action = this.mixer.clipAction(clip)
    action.reset()
    action.time  = startTime
    action.loop  = THREE.LoopOnce
    action.clampWhenFinished = false

    if (this._currentAction && this._currentAction !== action) {
      action.crossFadeFrom(this._currentAction, 0.3, true)
    }
    action.play()
    this._currentAction = action
  }
}

module.exports = { AnimationMixer }