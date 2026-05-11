import * as THREE from 'three'
import type { NodeType } from '../../parser/types'

/**
 * Non-reactive transient state shared between scene controllers.
 *
 * The Zustand store (`useSSPEStore`) holds *user-facing* state that React
 * components must re-render on. This runtime holds *per-frame / per-camera*
 * data that scene controllers mutate inside `useFrame` and read from each
 * other without ever triggering React reconciliation.
 *
 * Rule: nothing in here should be wrapped in `useSyncExternalStore` or
 * passed as a prop. Read it directly from refs/`useFrame` callbacks.
 */

export interface SceneRuntime {
  /** Last-known camera distance to graph centroid (world units). */
  cameraDistance: number
  /** Last-known camera world position. */
  cameraPos: THREE.Vector3

  /** Bounding-sphere center of the current graph (world coords). */
  graphCenter: THREE.Vector3
  /** Bounding-sphere radius of the current graph (world units). */
  graphRadius: number

  /**
   * Discrete semantic-zoom level derived from camera distance.
   *
   *  0 = OVERVIEW  — only "module" nodes (functions, recursion roots).
   *  1 = FLOW      — + loops, conditions (control-flow skeleton).
   *  2 = DETAIL    — + variables, assignments, expressions.
   *  3 = EXECUTION — everything, with rich labels and execution trace.
   */
  zoomLevel: 0 | 1 | 2 | 3
  /** Smoothed (damped) zoomLevel for continuous fade transitions. */
  zoomLevelSmooth: number

  /** Per-frame visibility multiplier per node type (0..1, smoothly damped). */
  typeVisibility: Record<NodeType, number>

  /**
   * Node ids that should receive *rich overlays* this frame
   * (labels, sparkles, tooltips, point lights).
   *
   * Built once per frame by the controller from:
   *   selected ∪ hovered ∪ focused ∪ active ∪ near-camera.
   * Capped at MAX_DETAIL_NODES to bound the overlay cost.
   */
  detailNodeIds: Set<string>
}

export const MAX_DETAIL_NODES = 24

export const sceneRuntime: SceneRuntime = {
  cameraDistance: 50,
  cameraPos: new THREE.Vector3(),
  graphCenter: new THREE.Vector3(),
  graphRadius: 10,
  zoomLevel: 3,
  zoomLevelSmooth: 3,
  typeVisibility: {
    variable: 1,
    assignment: 1,
    loop: 1,
    condition: 1,
    function: 1,
    recursion: 1,
    expression: 1,
  },
  detailNodeIds: new Set(),
}

/**
 * Which node types remain visible at each discrete zoom level.
 * Higher = closer = more detail visible.
 */
export const TYPE_VISIBLE_AT_LEVEL: Record<NodeType, 0 | 1 | 2 | 3> = {
  function: 0,
  recursion: 0,
  loop: 1,
  condition: 1,
  variable: 2,
  assignment: 2,
  expression: 2,
}

/** Pick the discrete zoom level for a given camera distance / graph radius. */
export function zoomLevelForDistance(distance: number, radius: number): 0 | 1 | 2 | 3 {
  const r = Math.max(radius, 1)
  if (distance > r * 4.0) return 0
  if (distance > r * 2.5) return 1
  if (distance > r * 1.4) return 2
  return 3
}

/** Target visibility (0..1) for a node type given a (possibly fractional) zoom level. */
export function targetVisibilityForType(type: NodeType, zoomSmooth: number): number {
  const threshold = TYPE_VISIBLE_AT_LEVEL[type]
  // Fade in over a 0.6-level window centred on the threshold.
  return THREE.MathUtils.clamp((zoomSmooth - (threshold - 0.5)) / 0.6, 0, 1)
}
