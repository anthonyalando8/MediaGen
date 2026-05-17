/**
 * EventBus.js
 * -----------
 * Lightweight pub/sub for runtime-wide events.
 * Decouples timeline orchestration from React state and renderer.
 *
 * Events fired by the runtime:
 *   scene:start        { sceneId }
 *   scene:complete     { sceneId }
 *   scene:tick         { time, progress }
 *   character:action   { characterId, action, at }
 *   character:expression { characterId, expression, at }
 *   timeline:seek      { time }
 *   timeline:pause     {}
 *   timeline:resume    {}
 *
 * Usage:
 *   EventBus.on("scene:complete", ({ sceneId }) => { ... });
 *   EventBus.emit("scene:start", { sceneId: "intro" });
 *   EventBus.off("scene:complete", handler);
 */

class EventBusClass {
  constructor() {
    this._listeners = {};
  }

  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapper = (data) => { handler(data); this.off(event, wrapper); };
    return this.on(event, wrapper);
  }

  off(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(h => h !== handler);
  }

  emit(event, data = {}) {
    (this._listeners[event] ?? []).forEach(h => {
      try { h(data); } catch (e) {
        console.error(`[EventBus] Error in handler for "${event}":`, e);
      }
    });
  }

  clear(event) {
    if (event) delete this._listeners[event];
    else this._listeners = {};
  }
}

export const EventBus = new EventBusClass();
export default EventBus;