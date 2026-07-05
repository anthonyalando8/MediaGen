// apps/editor/src/config/api.ts
//
/// <reference types="vite/client" />
//
// Single source of truth for `apps/api`'s base URL (Week 12, Deliverable
// 05). Consumed by every panel that wires through
// `fileToAssetRefViaServerOrLocal` (`MediaPalette`, `CompSetupPanel`,
// `AudioUploadPanel`) so the origin lives in one place, not copy-pasted
// into three components.
//
// Reads `VITE_API_BASE_URL` (set in `.env.local` for a non-default port/
// host) and falls back to `http://localhost:3001` — `apps/api`'s `start()`
// default port (see `apps/api/src/index.ts`). No trailing slash.

export const API_BASE_URL: string = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") || "http://localhost:3001";