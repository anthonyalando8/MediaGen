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
