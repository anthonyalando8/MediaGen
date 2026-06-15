// packages/core/src/domain/composition.ts
import { createId, toFrame } from "../types/ids";
import type { Id, Frame } from "../types/ids";
import type { Composition } from "../types/composition";
import type { ColorOKLCH } from "../types/primitives";
import type { Project } from "../types/project";

export interface CreateCompositionOptions {
  id?: Id;
  name?: string;
  size?: { width: number; height: number };
  fps?: number;
  duration?: Frame;
  background?: ColorOKLCH;
}

/** Creates a new, empty Composition with sensible defaults. */
export function createComposition(options: CreateCompositionOptions = {}): Composition {
  return {
    id: options.id ?? createId(),
    name: options.name ?? "Untitled Composition",
    size: options.size ?? { width: 1080, height: 1920 },
    fps: options.fps ?? 30,
    duration: options.duration ?? toFrame(150),
    background: options.background,
    root: [],
  };
}

/** Looks up a composition by id within `project.comps`. */
export function findComposition(project: Project, id: Id): Composition | undefined {
  return project.comps[id];
}
