// apps/editor/src/commands/move-lane.ts
//
// Sets node.lane — moves a clip to a different horizontal track row.
// Creating a new lane or moving to an existing one both use the same op.

import { createId, createOp } from "core";
import type { Composition, Id, Json, Op } from "core";
import { findNodeIndex } from "./find-node-index";

/** Move a node to a specific lane string. Pass null to give it its own row. */
export function moveLaneOp(comp: Composition, nodeId: Id, lane: string | null): Op {
  const index = findNodeIndex(comp, nodeId);
  const node = comp.root[index];
  const before = (node.lane ?? null) as unknown as Json;
  const after = lane as unknown as Json;
  return createOp({
    type: "set",
    compId: comp.id,
    path: `/root/${index}/lane`,
    before,
    after,
    txn: createId(),
  });
}

/**
 * Returns a sorted list of unique lane ids present in the comp, plus a
 * synthetic lane id for every node that has no lane (one per such node).
 * Each entry maps to the nodes on that lane in z-order.
 */
export interface LaneEntry {
  laneId: string;        // unique lane identifier
  label: string;         // display name (e.g. "Track 1")
  nodes: { node: import("core").Node; index: number }[];
}

export function buildLanes(comp: Composition): LaneEntry[] {
  const laneMap = new Map<string, LaneEntry>();
  let autoTrackNum = 1;

  for (let i = 0; i < comp.root.length; i++) {
    const node = comp.root[i];
    const laneId = node.lane ?? `__solo__${node.id}`;

    if (!laneMap.has(laneId)) {
      laneMap.set(laneId, {
        laneId,
        label: node.lane ? `Track ${autoTrackNum++}` : node.name,
        nodes: [],
      });
    }
    laneMap.get(laneId)!.nodes.push({ node, index: i });
  }

  return Array.from(laneMap.values());
}

/**
 * Auto-assign a lane to a newly added node. If it overlaps in time with
 * nodes already on a lane, puts it on a new lane; otherwise reuses the
 * first lane that has room.
 */
export function autoAssignLane(comp: Composition, nodeId: Id): string {
  const node = comp.root.find((n) => n.id === nodeId)!;
  const nodeStart = node.time.start as number;
  const nodeEnd = nodeStart + (node.time.duration as number);
  const lanes = buildLanes(comp);

  for (const lane of lanes) {
    // Skip solo lanes
    if (lane.laneId.startsWith("__solo__")) continue;
    const hasOverlap = lane.nodes.some(({ node: n }) => {
      const s = n.time.start as number;
      const e = s + (n.time.duration as number);
      return nodeEnd > s && e > nodeStart && n.id !== nodeId;
    });
    if (!hasOverlap) return lane.laneId;
  }

  // Need a new lane
  const existing = lanes.filter((l) => !l.laneId.startsWith("__solo__"));
  return `track-${existing.length + 1}`;
}