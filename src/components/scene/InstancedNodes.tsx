import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useSSPEStore } from '../../store/useSSPEStore'
import type { NodeType, SemanticNode } from '../../parser/types'
import { NODE_COLORS } from './constants'
import { sceneRuntime } from './sceneRuntime'

/**
 * GPU-instanced rendering of every node in the graph.
 *
 * One `InstancedMesh` per node *shape*, sharing geometry + material:
 *   - O(shapes) draw calls instead of O(nodes)
 *   - O(1) React components instead of O(nodes)
 *   - Animation runs entirely inside a single `useFrame`, mutating
 *     per-instance matrices + colors. Zustand state is read via
 *     `getState()` so nothing in React reconciliation depends on it.
 *
 * Per-instance state tracked outside React:
 *   - matrix (position + scale + rotation)
 *   - color (base × brightness multiplier, baked together so Bloom picks it up)
 */

/** Per-shape configuration. */
interface ShapeSpec {
  /** Build the shared geometry for this shape. */
  geometry: () => THREE.BufferGeometry
  /** Which NodeTypes use this shape. */
  nodeTypes: readonly NodeType[]
  /** Resting rotation in radians (XYZ). */
  baseRotation?: [number, number, number]
  /** Resting scale multiplier. */
  baseScale?: number
  /** Optional per-frame rotation rate (XYZ) for the entire group, gives loops "spin". */
  spin?: [number, number, number]
}

const SHAPE_SPECS: Record<string, ShapeSpec> = {
  variable: {
    geometry: () => new THREE.BoxGeometry(0.8, 0.8, 0.8),
    nodeTypes: ['variable', 'assignment'],
    baseScale: 1,
  },
  loop: {
    geometry: () => new THREE.TorusGeometry(1.2, 0.15, 12, 48),
    nodeTypes: ['loop'],
    baseRotation: [Math.PI / 2, 0, 0],
    spin: [0, 0, 0.5],
  },
  condition: {
    geometry: () => new THREE.BoxGeometry(1.25, 1.25, 0.28),
    nodeTypes: ['condition'],
    baseRotation: [0, 0, Math.PI / 4],
  },
  func: {
    geometry: () => new THREE.CylinderGeometry(0.6, 0.8, 1.0, 6),
    nodeTypes: ['function'],
  },
  recursion: {
    geometry: () => new THREE.IcosahedronGeometry(0.8, 0),
    nodeTypes: ['recursion'],
    spin: [0, 0.4, 0],
  },
  expression: {
    geometry: () => new THREE.SphereGeometry(0.4, 16, 16),
    nodeTypes: ['expression'],
  },
} as const

type ShapeKey = keyof typeof SHAPE_SPECS

function shapeKeyForType(type: NodeType): ShapeKey {
  if (type === 'function') return 'func'
  if (type === 'assignment') return 'variable'
  return type as ShapeKey
}

/** Pre-allocated scratch objects re-used inside useFrame. */
const tmpMatrix = new THREE.Matrix4()
const tmpQuat = new THREE.Quaternion()
const tmpEuler = new THREE.Euler()
const tmpScale = new THREE.Vector3()
const tmpPos = new THREE.Vector3()
const tmpColor = new THREE.Color()
const baseColor = new THREE.Color()

/**
 * Holds the bookkeeping for a single instanced mesh.
 *
 * `nodes` lists the SemanticNodes whose instance index in the mesh matches
 * their position in this array. We never re-order — additions append, the
 * mesh `count` shrinks/grows.
 */
interface ShapeBucket {
  key: ShapeKey
  spec: ShapeSpec
  nodes: SemanticNode[]
  /** Per-instance current emissive brightness (smoothly damped). */
  brightness: Float32Array
  /** Per-instance "spin angle" so individual loops/recursions don't all rotate in lock-step. */
  spinPhase: Float32Array
  ref: { current: THREE.InstancedMesh | null }
}

interface InstancedNodesProps {
  graph: { nodes: SemanticNode[] } | null
}

export function InstancedNodes({ graph }: InstancedNodesProps) {
  const setSelectedNode = useSSPEStore((s) => s.setSelectedNode)
  const setHoveredNode = useSSPEStore((s) => s.setHoveredNode)

  // Build buckets whenever graph identity changes.
  const buckets = useMemo(() => {
    // Group nodes by shape.
    const grouped: Record<ShapeKey, SemanticNode[]> = {
      variable: [],
      loop: [],
      condition: [],
      func: [],
      recursion: [],
      expression: [],
    }
    if (graph) {
      for (const n of graph.nodes) grouped[shapeKeyForType(n.type)].push(n)
    }

    const out = {} as Record<ShapeKey, ShapeBucket>
    for (const key of Object.keys(SHAPE_SPECS) as ShapeKey[]) {
      const nodes = grouped[key]
      const bucket: ShapeBucket = {
        key,
        spec: SHAPE_SPECS[key]!,
        nodes,
        brightness: new Float32Array(Math.max(nodes.length, 1)),
        spinPhase: new Float32Array(Math.max(nodes.length, 1)),
        ref: { current: null },
      }
      // Deterministic spin phase per instance — avoids `Math.random` during render
      // (impurity rule) while still keeping individual nodes out of lock-step.
      for (let i = 0; i < nodes.length; i++) {
        bucket.spinPhase[i] = (hashStringToFloat(nodes[i]!.id) * Math.PI * 2) % (Math.PI * 2)
      }
      out[key] = bucket
    }

    return out
  }, [graph])

  // Geometry is recreated whenever buckets change (count changed) — but the
  // shape geometries themselves are constant per key, so memoise once.
  const sharedGeometries = useMemo(() => {
    const map = {} as Record<ShapeKey, THREE.BufferGeometry>
    for (const key of Object.keys(SHAPE_SPECS) as ShapeKey[]) {
      map[key] = SHAPE_SPECS[key]!.geometry()
    }
    return map
  }, [])

  // Cleanup geometries on unmount.
  useEffect(() => {
    return () => {
      for (const g of Object.values(sharedGeometries)) g.dispose()
    }
  }, [sharedGeometries])

  // Initialise matrices + colors whenever the bucket layout changes.
  useEffect(() => {
    for (const bucket of Object.values(buckets)) {
      const mesh = bucket.ref.current
      if (!mesh) continue
      const { spec, nodes } = bucket
      const baseRot = spec.baseRotation ?? [0, 0, 0]
      const baseS = spec.baseScale ?? 1

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!
        tmpPos.copy(node.position)
        tmpEuler.set(baseRot[0], baseRot[1], baseRot[2])
        tmpQuat.setFromEuler(tmpEuler)
        tmpScale.setScalar(baseS)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        mesh.setMatrixAt(i, tmpMatrix)

        baseColor.set(NODE_COLORS[node.type])
        mesh.setColorAt(i, baseColor)
        bucket.brightness[i] = 0.5
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.count = nodes.length
    }
  }, [buckets])

  // The single per-scene useFrame: animates every node by mutating per-instance
  // matrices + colors. Zero React renders.
  useFrame((_, delta) => {
    const state = useSSPEStore.getState()
    const selectedId = state.selectedNodeId
    const hoveredId = state.hoveredNodeId
    const activeIds = state.activeNodeIds
    const focusedId = state.focusedNodeId
    const focusedSet = state.focusedRelatedIds

    const activeSet = activeSetCache.populate(activeIds)

    for (const bucket of Object.values(buckets)) {
      const mesh = bucket.ref.current
      if (!mesh) continue
      const { spec, nodes } = bucket
      const typeVisibility = sceneRuntime.typeVisibility[nodes[0]?.type ?? 'expression']
      mesh.visible = typeVisibility > 0.02

      if (!mesh.visible) continue

      const baseRot = spec.baseRotation ?? [0, 0, 0]
      const baseS = spec.baseScale ?? 1
      const spin = spec.spin
      const focusActive = focusedId !== null

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!
        const isActive = activeSet.has(node.id)
        const isSelected = node.id === selectedId
        const isHovered = node.id === hoveredId
        const isRelated = !focusActive || focusedSet[node.id] === true

        // Target brightness — bloom turns brightness > 1 into visible glow.
        const targetBright = isActive
          ? 2.6
          : isSelected
          ? 1.8
          : isHovered
          ? 1.4
          : isRelated
          ? 0.75
          : 0.18

        // Multiply by typeVisibility so nodes fade out as semantic zoom hides them.
        const effectiveBright = targetBright * typeVisibility

        bucket.brightness[i] = THREE.MathUtils.damp(
          bucket.brightness[i]!,
          effectiveBright,
          7,
          delta,
        )
        const b = bucket.brightness[i]!

        baseColor.set(NODE_COLORS[node.type])
        tmpColor.copy(baseColor).multiplyScalar(b)
        mesh.setColorAt(i, tmpColor)

        // Matrix: position + base rotation + optional spin + scale pulse on active.
        tmpEuler.set(baseRot[0], baseRot[1], baseRot[2])
        if (spin) {
          bucket.spinPhase[i] = (bucket.spinPhase[i]! + delta) % (Math.PI * 200)
          const phase = bucket.spinPhase[i]!
          tmpEuler.x += spin[0] * phase
          tmpEuler.y += spin[1] * phase
          tmpEuler.z += spin[2] * phase
        }
        tmpQuat.setFromEuler(tmpEuler)

        const pulse = isActive ? 1.08 + Math.sin(performance.now() * 0.008 + i) * 0.05 : 1
        tmpScale.setScalar(baseS * pulse * (0.2 + 0.8 * typeVisibility))

        tmpPos.copy(node.position)
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
        mesh.setMatrixAt(i, tmpMatrix)
      }

      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  const handlePointerOver = (key: ShapeKey) => (e: ThreeEvent<PointerEvent>) => {
    if (typeof e.instanceId !== 'number') return
    e.stopPropagation()
    const node = buckets[key].nodes[e.instanceId]
    if (!node) return
    setHoveredNode(node.id)
    document.body.style.cursor = 'pointer'
  }
  const handlePointerOut = () => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHoveredNode(null)
    document.body.style.cursor = 'default'
  }
  const handleClick = (key: ShapeKey) => (e: ThreeEvent<MouseEvent>) => {
    if (typeof e.instanceId !== 'number') return
    e.stopPropagation()
    const node = buckets[key].nodes[e.instanceId]
    if (!node) return
    setSelectedNode(node.id)
  }

  return (
    <group>
      {(Object.keys(SHAPE_SPECS) as ShapeKey[]).map((key) => {
        const bucket = buckets[key]
        const count = Math.max(bucket.nodes.length, 1)
        return (
          <instancedMesh
            key={key}
            ref={(m) => {
              bucket.ref.current = m
            }}
            args={[sharedGeometries[key], undefined, count]}
            castShadow={false}
            receiveShadow={false}
            onPointerOver={handlePointerOver(key)}
            onPointerOut={handlePointerOut()}
            onClick={handleClick(key)}
            frustumCulled={false}
          >
            <meshBasicMaterial
              vertexColors={false}
              toneMapped={false}
              transparent
              opacity={1}
            />
          </instancedMesh>
        )
      })}
    </group>
  )
}

/**
 * Tiny reusable "Set" backed by a single Set instance that we clear+repopulate
 * each frame, avoiding allocation churn.
 */
const activeSetCache = {
  _set: new Set<string>(),
  populate(ids: string[]): Set<string> {
    this._set.clear()
    for (const id of ids) this._set.add(id)
    return this._set
  },
}

/** Deterministic 0..1 hash of a string — used for stable per-instance phases. */
function hashStringToFloat(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}
