// packages/core/src/types/project.ts
import type { Json } from "./primitives";
import type { Id } from "./ids";
import type { Composition } from "./composition";
import type { Op } from "../oplog/op";

/** Content-addressed asset reference (v1.0 §12). */
export interface AssetRef {
  id: Id;
  hash: string;
  kind: "video" | "image" | "audio" | "font" | "lottie" | "rig" | "glb" | "svg";
  master: string;
  proxy?: string;
  poster?: string;
  waveform?: string;
  /**
   * Native decoded pixel dimensions, for "image"/"video" assets — known at
   * UPLOAD time (asset-upload.ts's `fileToAssetRef`), since the evaluator
   * (core/evaluator) runs synchronously and can't await a browser decode.
   * Used by image.ts/video.ts's `imageBox` to size an image/video node's
   * `RenderNode.box` to the asset's actual aspect ratio — without this,
   * `box` falls back to the composition's frame size, which letterboxes
   * (for "contain") or otherwise looks wrong whenever the asset's aspect
   * ratio doesn't match the composition's.
   */
  width?: number;
  height?: number;
  provenance?: "upload" | "stock" | "generated";
  meta?: Record<string, Json>;
}

export interface Project {
  id: Id;
  /** Semver, for migrations (see packages/schema/src/migrate.ts). */
  schema: string;
  name: string;
  /** The library — masters, precomps, and templates. */
  comps: Record<Id, Composition>;
  rootCompId: Id;
  assets: AssetRef[];
  opLog: Op[];
  sceneRef?: string;
}