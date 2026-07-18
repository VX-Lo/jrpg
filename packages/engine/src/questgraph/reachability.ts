/**
 * Shared staged-reachability helper for forward generation (Deliverable
 * 2). `gateNodeIds` is the region's ordered gate sequence; a node is
 * "reachable at step S" iff it isn't reserved by gate S or any later
 * gate. This is what makes placement deadlock-free by construction: a
 * fact generated to satisfy gate i is always drawn from
 * `reachableAtStep(i)`, which by definition excludes gate i's own node
 * and every gate after it — so nothing gate i needs can ever be locked
 * behind gate i or a later gate.
 *
 * Locks gate a node's USABILITY (item pickup / trainer / capture / boss
 * encounter), never physical traversal — Phase 2's region graphs are
 * already guaranteed fully connected (see worldgen/edges.ts), so there
 * is nothing to gate geometrically without graph-cut analysis this
 * phase doesn't need. `reachableAtStep` reflects that: it is a set of
 * *usable* node ids, not a BFS over edges.
 */
export function reachableAtStep(
  allNodeIds: readonly string[],
  gateNodeIds: readonly string[],
  step: number,
): string[] {
  const reserved = new Set(gateNodeIds.slice(step));
  return allNodeIds.filter((id) => !reserved.has(id));
}

/** The step at which a node stops being reserved by a later gate and becomes free to use. Entry/never-gated nodes are free from step 0. Used by hint emission to rank "how close to needed" a hint's source node is. */
export function unlockedAtStep(nodeId: string, gateNodeIds: readonly string[]): number {
  const idx = gateNodeIds.indexOf(nodeId);
  return idx === -1 ? 0 : idx + 1;
}
