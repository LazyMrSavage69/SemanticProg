import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useSSPEStore } from '../../store/useSSPEStore'
import {
  MAX_DETAIL_NODES,
  sceneRuntime,
  targetVisibilityForType,
  zoomLevelForDistance,
} from './sceneRuntime'
import type { NodeType, SemanticGraph } from '../../parser/types'

const NODE_TYPES: NodeType[] = [
  'variable',
  'assignment',
  'loop',
  'condition',
  'function',
  'recursion',
  'expression',
]

/** Compute the bounding sphere (center + radius) of a graph. */
function computeBoundingSphere(graph: SemanticGraph): { center: THREE.Vector3; radius: number } {
  const center = new THREE.Vector3()
  if (graph.nodes.length === 0) return { center, radius: 10 }
  for (const n of graph.nodes) center.add(n.position)
  center.divideScalar(graph.nodes.length)
  let radius = 0
  for (const n of graph.nodes) {
    const d = n.position.distanceTo(center)
    if (d > radius) radius = d
  }
  // Floor the radius so an empty/collapsed graph still gives sensible thresholds.
  return { center, radius: Math.max(radius, 4) }
}

/**
 * Drives the semantic-zoom pipeline:
 *   - per-frame computes camera distance to graph centroid
 *   - maps distance to discrete zoom level (0..3) and smooth float
 *   - damps per-type visibility multipliers
 *   - builds the "detail set" of node ids that get rich overlays
 *
 * This component renders nothing — it only mutates `sceneRuntime`.
 * Other scene components read those refs inside their own `useFrame`.
 */
export function SemanticZoomController() {
  const { camera } = useThree()
  const graph = useSSPEStore((s) => s.graph)

  // Recompute graph bounding sphere only when the graph identity changes.
  useEffect(() => {
    if (!graph) {
      sceneRuntime.graphCenter.set(0, 0, 0)
      sceneRuntime.graphRadius = 10
      return
    }
    const { center, radius } = computeBoundingSphere(graph)
    sceneRuntime.graphCenter.copy(center)
    sceneRuntime.graphRadius = radius
  }, [graph])

  // Stable position arrays for fast distance lookups inside useFrame.
  const nodeIndex = useMemo(() => {
    if (!graph) return { ids: [] as string[], positions: new Float32Array(0) }
    const ids = graph.nodes.map((n) => n.id)
    const positions = new Float32Array(graph.nodes.length * 3)
    for (let i = 0; i < graph.nodes.length; i++) {
      const p = graph.nodes[i]!.position
      positions[i * 3] = p.x
      positions[i * 3 + 1] = p.y
      positions[i * 3 + 2] = p.z
    }
    return { ids, positions }
  }, [graph])

  useFrame((_, delta) => {
    const state = useSSPEStore.getState()

    // 1. Camera distance + discrete zoom level.
    const dist = camera.position.distanceTo(sceneRuntime.graphCenter)
    sceneRuntime.cameraDistance = dist
    sceneRuntime.cameraPos.copy(camera.position)

    const lvl = zoomLevelForDistance(dist, sceneRuntime.graphRadius)
    sceneRuntime.zoomLevel = lvl
    sceneRuntime.zoomLevelSmooth = THREE.MathUtils.damp(
      sceneRuntime.zoomLevelSmooth,
      lvl,
      4,
      delta,
    )

    // 2. Per-type visibility (smoothly damped 0..1).
    for (const t of NODE_TYPES) {
      const target = targetVisibilityForType(t, sceneRuntime.zoomLevelSmooth)
      sceneRuntime.typeVisibility[t] = THREE.MathUtils.damp(
        sceneRuntime.typeVisibility[t],
        target,
        6,
        delta,
      )
    }

    // 3. Detail set — nodes that get rich overlays this frame.
    //    Always-included: selected, hovered, focused-pivot, active.
    //    Then top-up with the closest N nodes to the camera.
    const set = sceneRuntime.detailNodeIds
    set.clear()
    if (state.selectedNodeId) set.add(state.selectedNodeId)
    if (state.hoveredNodeId) set.add(state.hoveredNodeId)
    if (state.focusedNodeId) set.add(state.focusedNodeId)
    for (const id of state.activeNodeIds) set.add(id)

    // Closest-N pass: only at zoom levels where node detail makes sense.
    if (lvl >= 2 && set.size < MAX_DETAIL_NODES) {
      const slotsLeft = MAX_DETAIL_NODES - set.size
      const candidates = pickClosestNodes(camera.position, nodeIndex, slotsLeft, set)
      for (const id of candidates) set.add(id)
    }
  })

  return null
}

/**
 * Return up to `count` node ids closest to `camPos`, excluding any already in `skip`.
 *
 * Implementation note: this is O(N) with a simple insertion sort into a small
 * bounded buffer. For 10k+ nodes a kd-tree/octree would be preferable, but the
 * complexity of maintaining one isn't worth it until N >> 1000.
 */
function pickClosestNodes(
  camPos: THREE.Vector3,
  index: { ids: string[]; positions: Float32Array },
  count: number,
  skip: Set<string>,
): string[] {
  const { ids, positions } = index
  if (count <= 0 || ids.length === 0) return []

  const topIds: string[] = new Array(count).fill('')
  const topDists: number[] = new Array(count).fill(Infinity)

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    if (skip.has(id)) continue
    const dx = positions[i * 3]! - camPos.x
    const dy = positions[i * 3 + 1]! - camPos.y
    const dz = positions[i * 3 + 2]! - camPos.z
    const d = dx * dx + dy * dy + dz * dz

    if (d >= topDists[count - 1]!) continue

    // Insertion into a small sorted buffer (ascending by distance).
    let j = count - 1
    while (j > 0 && topDists[j - 1]! > d) {
      topDists[j] = topDists[j - 1]!
      topIds[j] = topIds[j - 1]!
      j--
    }
    topDists[j] = d
    topIds[j] = id
  }

  // Trim sentinel slots.
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    if (topIds[i]) out.push(topIds[i]!)
  }
  return out
}
