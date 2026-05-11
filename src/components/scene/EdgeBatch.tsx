import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSSPEStore } from '../../store/useSSPEStore'
import type { EdgeType, SemanticEdge, SemanticGraph, SemanticNode } from '../../parser/types'
import { EDGE_COLORS, EDGE_OPACITY } from './constants'

/**
 * Batched edge rendering.
 *
 * Replaces the per-edge `<EdgeLine>` component (which created one drei `<Line>`
 * draw call + one bezier sample buffer + multiple billboards per edge) with:
 *
 *   1. A single static `LineSegments` per edge type, sampled along the
 *      original quadratic bezier curve. Built once per graph change.
 *
 *   2. A single dynamic `LineSegments` rebuilt only when the "active" /
 *      "selected-adjacent" set changes — drawing brighter overlays on top.
 *
 * Result: O(edgeTypes) draw calls for the base layer + 1 highlight pass,
 * down from O(edges) drei <Line> components.
 */

const SAMPLES_PER_EDGE = 16

interface EdgeBatchProps {
  graph: SemanticGraph | null
}

/** Sample a "bowed" quadratic bezier between two points. */
function sampleCurve(
  a: THREE.Vector3,
  b: THREE.Vector3,
  samples: number,
  out: Float32Array,
  offset: number,
): void {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length() || 1
  const offsetAxis =
    Math.abs(dir.y) < 0.99
      ? new THREE.Vector3(0, 1, 0).cross(dir).normalize()
      : new THREE.Vector3(1, 0, 0).cross(dir).normalize()
  mid.addScaledVector(offsetAxis, len * 0.15)
  const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone())

  const p = new THREE.Vector3()
  // Emit `samples` line-segments → `samples * 2` vertices (each segment shares its endpoints).
  for (let i = 0; i < samples; i++) {
    const t0 = i / samples
    const t1 = (i + 1) / samples
    curve.getPoint(t0, p)
    out[offset + i * 6] = p.x
    out[offset + i * 6 + 1] = p.y
    out[offset + i * 6 + 2] = p.z
    curve.getPoint(t1, p)
    out[offset + i * 6 + 3] = p.x
    out[offset + i * 6 + 4] = p.y
    out[offset + i * 6 + 5] = p.z
  }
}

interface TypeBucket {
  type: EdgeType
  edges: SemanticEdge[]
  /** Per-edge offset (in vertex *positions*, i.e. floats/3) into the flat buffer. */
  edgeStartIndex: number[]
  positions: Float32Array
  geometry: THREE.BufferGeometry
}

function makeTypeBucket(
  type: EdgeType,
  edges: SemanticEdge[],
  nodesById: Map<string, SemanticNode>,
): TypeBucket | null {
  if (edges.length === 0) return null

  const verticesPerEdge = SAMPLES_PER_EDGE * 2 // line segments = 2 verts each
  const positions = new Float32Array(edges.length * verticesPerEdge * 3)
  const starts: number[] = []

  let cursor = 0
  for (const edge of edges) {
    const s = nodesById.get(edge.source)
    const t = nodesById.get(edge.target)
    starts.push(cursor)
    if (!s || !t) {
      cursor += verticesPerEdge * 3
      continue
    }
    sampleCurve(s.position, t.position, SAMPLES_PER_EDGE, positions, cursor)
    cursor += verticesPerEdge * 3
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  return { type, edges, edgeStartIndex: starts, positions, geometry }
}

export function EdgeBatch({ graph }: EdgeBatchProps) {
  const nodesById = useMemo(() => {
    const m = new Map<string, SemanticNode>()
    if (graph) for (const n of graph.nodes) m.set(n.id, n)
    return m
  }, [graph])

  // Group edges by type, then build one buffer per type.
  const buckets = useMemo(() => {
    if (!graph) return [] as TypeBucket[]
    const grouped: Record<EdgeType, SemanticEdge[]> = {
      executes: [],
      dependsOn: [],
      controlsFlow: [],
      calls: [],
      returns: [],
      dataFlow: [],
    }
    for (const e of graph.edges) grouped[e.type].push(e)

    const out: TypeBucket[] = []
    for (const t of Object.keys(grouped) as EdgeType[]) {
      const b = makeTypeBucket(t, grouped[t], nodesById)
      if (b) out.push(b)
    }
    return out
  }, [graph, nodesById])

  // Dispose geometries when graph changes.
  useEffect(() => {
    return () => {
      for (const b of buckets) b.geometry.dispose()
    }
  }, [buckets])

  // Highlight overlay geometry — rebuilt only when the *interesting* edge set
  // changes (active / hovered-adjacent / selected-adjacent / focus-related).
  const highlightGeomRef = useRef<THREE.BufferGeometry>(null)
  const highlightColorRef = useRef<Float32Array>(new Float32Array(0))
  const highlightPositionRef = useRef<Float32Array>(new Float32Array(0))
  const highlightSegRef = useRef<THREE.LineSegments>(null)

  // Per-edge index into the highlight buffer (when present), so we can locate
  // and tint specific edges during rebuilds.
  const edgePosByIdRef = useRef<Map<string, { positions: Float32Array; offset: number }>>(
    new Map(),
  )

  useEffect(() => {
    // Build a fast lookup from edge id → buffer location so the highlight pass
    // can copy positions without re-sampling.
    const lookup = new Map<string, { positions: Float32Array; offset: number }>()
    for (const bucket of buckets) {
      for (let i = 0; i < bucket.edges.length; i++) {
        lookup.set(bucket.edges[i]!.id, {
          positions: bucket.positions,
          offset: bucket.edgeStartIndex[i]!,
        })
      }
    }
    edgePosByIdRef.current = lookup
  }, [buckets])

  // Recompute the highlight overlay whenever the relevant subset of state
  // changes. Done in a useFrame for simplicity (cheap when subset is small)
  // but only mutates buffers when the subset actually differs from last frame.
  const lastHighlightSig = useRef<string>('')

  useFrame(() => {
    if (!graph) return
    const state = useSSPEStore.getState()
    const activeIds = state.activeEdgeIds
    const selectedNodeId = state.selectedNodeId
    const hoveredNodeId = state.hoveredNodeId
    const focusedNodeId = state.focusedNodeId
    const focusedSet = state.focusedRelatedIds

    // Collect interesting edges.
    const interesting: SemanticEdge[] = []
    const seen = new Set<string>()
    for (const id of activeIds) {
      const edge = graph.edges.find((e) => e.id === id)
      if (edge && !seen.has(edge.id)) {
        interesting.push(edge)
        seen.add(edge.id)
      }
    }
    if (selectedNodeId || hoveredNodeId) {
      for (const e of graph.edges) {
        if (seen.has(e.id)) continue
        if (
          e.source === selectedNodeId ||
          e.target === selectedNodeId ||
          e.source === hoveredNodeId ||
          e.target === hoveredNodeId
        ) {
          interesting.push(e)
          seen.add(e.id)
        }
      }
    }
    if (focusedNodeId) {
      for (const e of graph.edges) {
        if (seen.has(e.id)) continue
        if (focusedSet[e.source] && focusedSet[e.target] && (e.source === focusedNodeId || e.target === focusedNodeId)) {
          interesting.push(e)
          seen.add(e.id)
        }
      }
    }

    // Build a stable signature so we don't rebuild every frame.
    const sig =
      interesting.length === 0
        ? ''
        : interesting
            .map((e) => e.id)
            .sort()
            .join('|')

    if (sig === lastHighlightSig.current) return
    lastHighlightSig.current = sig

    const segCount = interesting.length * SAMPLES_PER_EDGE
    const vertCount = segCount * 2
    const positions = new Float32Array(vertCount * 3)
    const colors = new Float32Array(vertCount * 3)

    const lookup = edgePosByIdRef.current
    let cursor = 0
    for (const e of interesting) {
      const loc = lookup.get(e.id)
      const color = new THREE.Color(EDGE_COLORS[e.type])
      // Brighten so bloom picks it up.
      color.multiplyScalar(1.8)
      const segVerts = SAMPLES_PER_EDGE * 2
      if (loc) {
        // Copy the bezier samples we already have.
        for (let i = 0; i < segVerts * 3; i++) {
          positions[cursor + i] = loc.positions[loc.offset + i]!
        }
      }
      for (let i = 0; i < segVerts; i++) {
        colors[cursor + i * 3] = color.r
        colors[cursor + i * 3 + 1] = color.g
        colors[cursor + i * 3 + 2] = color.b
      }
      cursor += segVerts * 3
    }

    highlightPositionRef.current = positions
    highlightColorRef.current = colors

    const geom = highlightGeomRef.current
    if (geom) {
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geom.attributes.position!.needsUpdate = true
      geom.attributes.color!.needsUpdate = true
      const seg = highlightSegRef.current
      if (seg) {
        seg.visible = interesting.length > 0
      }
    }
  })

  return (
    <group>
      {/* Base layer — one draw call per edge type. */}
      {buckets.map((bucket) => (
        <lineSegments key={bucket.type} frustumCulled={false}>
          <primitive object={bucket.geometry} attach="geometry" />
          <lineBasicMaterial
            color={EDGE_COLORS[bucket.type]}
            transparent
            opacity={EDGE_OPACITY[bucket.type]}
            toneMapped={false}
            depthWrite={false}
          />
        </lineSegments>
      ))}

      {/* Highlight overlay — one extra draw call total, only when something is active. */}
      <lineSegments ref={highlightSegRef} frustumCulled={false}>
        <bufferGeometry ref={highlightGeomRef} />
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.95}
          toneMapped={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  )
}
