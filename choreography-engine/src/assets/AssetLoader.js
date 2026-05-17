/**
 * AssetLoader.js
 * --------------
 * LRU-cached asset loader for scene assets.
 * Currently handles: scene JSON files, character variant configs.
 *
 * For SVG body parts: those are bundled as inline JSX components
 * (Layer 1) and need no runtime loading. This loader handles
 * SCENE-level assets: backgrounds, audio metadata, variant configs.
 *
 * ── Usage ────────────────────────────────────────────────────────
 *   // Preload a scene before playing:
 *   await AssetLoader.preloadScene(sceneJSON);
 *
 *   // Load a character variant config:
 *   const variant = await AssetLoader.loadVariant("villain_dark");
 *
 *   // Cache stats:
 *   AssetLoader.getCacheStats();
 */

const MAX_CACHE_SIZE = 50;

class AssetLoaderClass {
  constructor() {
    // LRU cache: Map preserves insertion order
    this._cache    = new Map();
    this._loading  = new Map();  // in-flight requests
    this._maxSize  = MAX_CACHE_SIZE;
  }

  // ── Core load ─────────────────────────────────────────────────

  /**
   * Load a JSON asset by URL. Returns cached result if available.
   * @param {string} url
   * @returns {Promise<object>}
   */
  async loadJSON(url) {
    if (this._cache.has(url)) {
      // LRU: move to end (most recently used)
      const val = this._cache.get(url);
      this._cache.delete(url);
      this._cache.set(url, val);
      return val;
    }

    // Deduplicate in-flight requests
    if (this._loading.has(url)) {
      return this._loading.get(url);
    }

    const promise = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`[AssetLoader] Failed to load: ${url} (${r.status})`);
        return r.json();
      })
      .then(data => {
        this._set(url, data);
        this._loading.delete(url);
        return data;
      })
      .catch(err => {
        this._loading.delete(url);
        throw err;
      });

    this._loading.set(url, promise);
    return promise;
  }

  // ── Scene preloading ──────────────────────────────────────────

  /**
   * Preload all assets referenced by a scene JSON.
   * Call before SceneRenderer mounts to eliminate loading flicker.
   * @param {object} sceneJSON — parsed scene object
   * @returns {Promise<void>}
   */
  async preloadScene(sceneJSON) {
    const tasks = [];

    // Audio metadata (future: waveform analysis for lip sync)
    if (sceneJSON.audio?.src) {
      tasks.push(this._preloadAudio(sceneJSON.audio.src));
    }

    await Promise.allSettled(tasks);
  }

  // ── Character variant system ──────────────────────────────────

  /**
   * Load a character variant configuration.
   * Variants override default color palette, proportions, or part paths.
   *
   * Variant config shape:
   * {
   *   id: "villain_dark",
   *   displayName: "Dark Villain",
   *   palette: {
   *     skin:    "#2A1A0A",
   *     hair:    "#000000",
   *     shirt:   "#1A1A1A",
   *     pants:   "#0A0A0A",
   *     shoes:   "#111111",
   *   },
   *   proportions: { headScale: 1.0, torsoScale: 1.1 },  // optional
   * }
   *
   * @param {string} variantId
   * @returns {Promise<object>}
   */
  async loadVariant(variantId) {
    // Built-in variants (no fetch needed)
    const builtin = BUILTIN_VARIANTS[variantId];
    if (builtin) return builtin;

    // External variant: fetch from /characters/variants/{id}.json
    return this.loadJSON(`/characters/variants/${variantId}.json`);
  }

  // ── Cache management ──────────────────────────────────────────

  _set(key, value) {
    if (this._cache.size >= this._maxSize) {
      // Evict least recently used (first item in Map)
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(key, value);
  }

  has(url)    { return this._cache.has(url); }
  clear()     { this._cache.clear(); }

  getCacheStats() {
    return {
      size:     this._cache.size,
      maxSize:  this._maxSize,
      keys:     [...this._cache.keys()],
      inflight: this._loading.size,
    };
  }

  // ── Audio preload (for lip sync prep) ────────────────────────

  _preloadAudio(src) {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve({ src, duration: audio.duration });
      audio.onerror = () => resolve({ src, error: true }); // non-fatal
      audio.src = src;
    });
  }
}

// ── Singleton ────────────────────────────────────────────────────
export const AssetLoader = new AssetLoaderClass();
export default AssetLoader;

// ── Built-in character palette variants ──────────────────────────
// Define common character skins without requiring a network fetch.
export const BUILTIN_VARIANTS = {
  hero_default: {
    id:          "hero_default",
    displayName: "Hero",
    palette: {
      skin:   "#FADADB",
      hair:   "#5C3D2E",
      shirt:  "#3A6BBF",
      pants:  "#2A4480",
      shoes:  "#2A1A0A",
    },
  },
  villain_default: {
    id:          "villain_default",
    displayName: "Villain",
    palette: {
      skin:   "#D4B896",
      hair:   "#1A1A1A",
      shirt:  "#1A1A2E",
      pants:  "#0A0A1A",
      shoes:  "#0A0A0A",
    },
  },
  hero_alt: {
    id:          "hero_alt",
    displayName: "Hero (Alt)",
    palette: {
      skin:   "#8B5E3C",
      hair:   "#1A0A00",
      shirt:  "#BF3A3A",
      pants:  "#3A1A1A",
      shoes:  "#1A0A00",
    },
  },
  neutral: {
    id:          "neutral",
    displayName: "Neutral",
    palette: {
      skin:   "#FADADB",
      hair:   "#5C3D2E",
      shirt:  "#666666",
      pants:  "#444444",
      shoes:  "#222222",
    },
  },
};