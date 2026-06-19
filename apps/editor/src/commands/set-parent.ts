import type { Composition, Id, Op } from "core";
import { setNodeProp } from "./set-node-prop";
import { findNodeIndex } from "./find-node-index";



export function setParentOp(comp: Composition, nodeId: Id, parentId: Id): Op{
    findNodeIndex(comp, nodeId);
    findNodeIndex(comp, parentId);
    return setNodeProp(comp, nodeId, "parentId", parentId)
}

export function clearParentOp(comp: Composition, nodeId: Id): Op {
    return setNodeProp(comp, nodeId, "parentId", null)
}