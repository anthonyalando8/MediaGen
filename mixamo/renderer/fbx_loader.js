'use strict'

/**
 * fbx_loader.js
 * -------------
 * Wraps Three.js FBXLoader for Node.js use.
 * 
 * The browser FBXLoader expects a DOM environment. In Node.js we need to:
 * 1. Provide the THREE global (FBXLoader.js reads from it)
 * 2. Patch the loader to accept ArrayBuffer directly (no fetch/XHR)
 * 3. Handle the fflate dependency FBXLoader needs for compressed FBX
 */

const fs   = require('fs')
const path = require('path')
const THREE = require('three')

// ── Patch global THREE so FBXLoader.js (browser-style) can find it ────────
global.THREE = THREE

// ── Load fflate first (FBXLoader dependency for compressed files) ──────────
const fflateCode = fs.readFileSync(
  path.join(__dirname, '../libs/fflate.min.js'), 'utf8'
)
// fflate exposes itself as a global or module export
// Eval in a context that makes it available on global
;(function() {
  const module = { exports: {} }
  eval(fflateCode)
  if (module.exports && Object.keys(module.exports).length) {
    global.fflate = module.exports
  }
})()

// ── Load FBXLoader.js (browser-style script) ──────────────────────────────
const fbxLoaderCode = fs.readFileSync(
  path.join(__dirname, '../libs/FBXLoader.js'), 'utf8'
)
;(function() {
  eval(fbxLoaderCode)
})()

// After eval, THREE.FBXLoader should be registered on the THREE namespace
if (!THREE.FBXLoader) {
  throw new Error('[fbx_loader] FBXLoader did not register on THREE — check libs/FBXLoader.js')
}

/**
 * Parse an FBX file from a Buffer/ArrayBuffer synchronously.
 * 
 * @param {Buffer|ArrayBuffer} buffer
 * @returns {THREE.Group} parsed scene graph
 */
function parseFBX(buffer) {
  const loader = new THREE.FBXLoader()
  // FBXLoader.parse() is synchronous — takes ArrayBuffer + resource path
  const arrayBuffer = buffer instanceof Buffer
    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    : buffer
  return loader.parse(arrayBuffer, '')
}

/**
 * Load and parse an FBX file from disk.
 * 
 * @param {string} filePath  - absolute or relative path to .fbx file
 * @returns {THREE.Group}
 */
function loadFBX(filePath) {
  const absPath = path.resolve(filePath)
  if (!fs.existsSync(absPath)) {
    throw new Error(`[fbx_loader] File not found: ${absPath}`)
  }
  const buffer = fs.readFileSync(absPath)
  console.log(`[fbx_loader] Loaded ${path.basename(filePath)} (${(buffer.length / 1024).toFixed(0)} KB)`)
  return parseFBX(buffer)
}

module.exports = { loadFBX, parseFBX, FBXLoader: THREE.FBXLoader }