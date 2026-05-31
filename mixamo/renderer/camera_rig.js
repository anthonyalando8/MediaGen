'use strict'

/**
 * camera_rig.js
 * -------------
 * Computes camera position and lookAt for a given time T,
 * based on beat contracts (camera field: push_in, pull_out, etc.)
 * 
 * Unlike the browser version (which uses tweens over real time),
 * the headless renderer needs DETERMINISTIC camera state at any T —
 * so we compute position mathematically from where we are in the beat.
 */

const THREE = require('three')

// Default camera resting position
const REST = { z: 3.2, y: 1.4, x: 0 }
const LOOK_AT = new THREE.Vector3(0, 1.1, 0)

/**
 * Easing function (ease-in-out quad)
 */
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

/**
 * Get camera state at time T given the beat timeline.
 * 
 * @param {number} t              - absolute time in seconds
 * @param {Array}  beatTimeline   - array of { startTime, endTime, beat }
 * @param {object} camera         - THREE.PerspectiveCamera to mutate
 */
function applyCameraAtTime(t, beatTimeline, camera) {
  // Find current beat
  const beat = beatTimeline.find(b => t >= b.startTime && t < b.endTime)

  if (!beat) {
    // Between beats — rest position
    camera.position.set(REST.x, REST.y, REST.z)
    camera.lookAt(LOOK_AT)
    return
  }

  const duration    = beat.endTime - beat.startTime
  const progress    = Math.min((t - beat.startTime) / duration, 1.0)
  const eased       = easeInOut(progress)
  const camType     = beat.beat?.camera || 'static'
  const intensity   = beat.beat?.intensity || 0.7

  // Motion duration as fraction of beat (first 30% of beat = motion, rest = hold)
  const motionProgress = Math.min(progress / 0.3, 1.0)
  const motionEased    = easeInOut(motionProgress)

  let x = REST.x
  let y = REST.y
  let z = REST.z

  switch (camType) {
    case 'push_in':
      // Camera moves from far to close
      z = 4.5 + (REST.z - 4.5) * motionEased
      break

    case 'pull_out':
      // Camera moves from close to far
      z = REST.z + (4.5 - REST.z) * motionEased
      break

    case 'snap_zoom': {
      // Fast snap to close, then settle
      const snapProgress = Math.min(progress / 0.1, 1.0)  // snap in first 10%
      const settleProgress = Math.max((progress - 0.1) / 0.2, 0)
      if (progress < 0.1) {
        z = 4.0 + (2.8 - 4.0) * easeInOut(snapProgress)
      } else {
        z = 2.8 + (REST.z - 2.8) * easeInOut(Math.min(settleProgress, 1.0))
      }
      break
    }

    case 'tilt_up':
      // Camera rises from low to normal
      y = 0.8 + (REST.y - 0.8) * motionEased
      break

    case 'micro_shake': {
      // Deterministic shake using sine waves (no randomness — same every frame)
      const shakeDecay = Math.max(0, 1.0 - progress * 3)  // decays over first 33% of beat
      const shakeAmp   = intensity * 0.012 * shakeDecay
      x = Math.sin(t * 47.3) * shakeAmp
      y = REST.y + Math.sin(t * 31.7) * shakeAmp * 0.5
      break
    }

    case 'handheld': {
      // Gentle continuous drift
      const driftAmp = 0.008
      x = Math.sin(t * 1.3) * driftAmp
      y = REST.y + Math.sin(t * 0.9) * driftAmp * 0.5
      break
    }

    case 'static':
    default:
      // No motion
      break
  }

  camera.position.set(x, y, z)
  camera.lookAt(LOOK_AT)
}

module.exports = { applyCameraAtTime }