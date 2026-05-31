'use strict'

/**
 * scene_builder.js
 * ----------------
 * Creates the Three.js scene: lighting, floor, character mesh.
 * Returns { scene, camera, characterRoot } for the render loop to use.
 * 
 * Character is loaded from an ArrayBuffer (pre-read by caller)
 * so this module has no direct fs dependency.
 */

const THREE = require('three')
const { FBXLoader } = require('./fbx_loader')

/**
 * Build scene from a pre-parsed character FBX object.
 * 
 * @param {object} opts
 * @param {number} opts.width   - frame width
 * @param {number} opts.height  - frame height
 * @param {object} opts.charFbx - parsed THREE.Group from FBXLoader
 * @returns {{ scene, camera, characterRoot }}
 */
function buildScene({ width, height, charFbx }) {
  const scene = new THREE.Scene()
  // NO scene.background — keeps it transparent for compositing

  // ── Camera ────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100)
  camera.position.set(0, 1.4, 3.2)
  camera.lookAt(0, 1.1, 0)

  // ── Lighting (documentary gritty — matches your video theme) ──────────
  const ambient = new THREE.AmbientLight(0xffffff, 0.3)
  scene.add(ambient)

  const key = new THREE.DirectionalLight(0xfff0e0, 1.8)
  key.position.set(1.5, 4, 2)
  key.castShadow = true
  scene.add(key)

  const fill = new THREE.DirectionalLight(0x1a1a3a, 0.5)
  fill.position.set(-3, 1, 1)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xff4400, 0.4)
  rim.position.set(0, 3, -3)
  scene.add(rim)

  // ── Character ─────────────────────────────────────────────────────────
  const characterRoot = charFbx

  // Scale to consistent height (2.2 world units)
  const box = new THREE.Box3().setFromObject(characterRoot)
  const size = box.getSize(new THREE.Vector3())
  const scale = 2.2 / size.y
  characterRoot.scale.setScalar(scale)

  // Sit on floor (y=0)
  characterRoot.position.y = -box.min.y * scale

  // Enable shadows on all meshes
  characterRoot.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })

  scene.add(characterRoot)

  console.log(`[scene_builder] Character loaded — scale: ${scale.toFixed(3)}, height: ${size.y.toFixed(2)}`)

  return { scene, camera, characterRoot }
}

module.exports = { buildScene }