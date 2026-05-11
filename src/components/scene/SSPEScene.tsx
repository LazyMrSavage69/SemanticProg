import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useSSPEStore } from '../../store/useSSPEStore'
import type { ExecutionStep, SemanticNode } from '../../parser/types'
import { InstancedNodes } from './InstancedNodes'
import { EdgeBatch } from './EdgeBatch'
import { NodeOverlays } from './NodeOverlays'
import { ParticlePool, type ParticlePoolHandle } from './ParticlePool'
import { SemanticZoomController } from './SemanticZoomController'
import { Starfield } from './Starfield'
import { PostProcessing } from './PostProcessing'

/**
 * Top-level 3D scene.
 *
 * New rendering pipeline (vs. the original one-component-per-node design):
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │  SemanticZoomController   → mutates sceneRuntime each frame       │
 *   │       │                                                            │
 *   │       ▼                                                            │
 *   │  InstancedNodes           → 7 draw calls, one per node shape       │
 *   │  EdgeBatch                → O(edgeTypes) draw calls + 1 highlight  │
 *   │  ParticlePool             → 1 instanced draw call for all flow     │
 *   │  NodeOverlays             → React overlays for ≤24 detail nodes    │
 *   │  ExecutionPlayer          → drives the simulator timeline          │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * The number of React components in the scene tree is now constant
 * (independent of graph size). Animation lives in a handful of `useFrame`
 * callbacks that mutate buffers directly.
 */

const STEP_DURATION = 0.32

export function SSPEScene() {
  const graph = useSSPEStore((s) => s.graph)
  const setSelectedNode = useSSPEStore((s) => s.setSelectedNode)
  const poolRef = useRef<ParticlePoolHandle>(null)

  const nodeById = useMemo(() => {
    const map = new Map<string, SemanticNode>()
    if (graph) for (const n of graph.nodes) map.set(n.id, n)
    return map
  }, [graph])

  // Spawn a particle along an edge id — used by the execution player.
  const spawnParticle = useCallback(
    (edgeId: string) => {
      if (!graph) return
      const edge = graph.edges.find((e) => e.id === edgeId)
      if (!edge) return
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) return
      const color =
        edge.type === 'returns'
          ? '#ef4444'
          : edge.type === 'calls'
          ? '#10b981'
          : edge.type === 'controlsFlow'
          ? '#f59e0b'
          : edge.type === 'dependsOn'
          ? '#00d4ff'
          : '#ffffff'
      poolRef.current?.spawn(source, target, color)
    },
    [graph, nodeById],
  )

  return (
    <Canvas
      camera={{ position: [10, 8, 14], fov: 55, near: 0.1, far: 2000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(new THREE.Color('#050810'))
        scene.fog = new THREE.FogExp2(0x050810, 0.012)
      }}
      onPointerMissed={() => setSelectedNode(null)}
    >
      <ambientLight intensity={0.3} />
      <directionalLight position={[10, 10, 10]} intensity={0.4} />
      <directionalLight position={[-12, -6, -8]} intensity={0.18} color="#7c3aed" />

      <Starfield />

      {/* Mutates sceneRuntime — must be rendered before consumers each frame.
          R3F useFrame priority defaults are insertion order. */}
      <SemanticZoomController />

      <EdgeBatch graph={graph} />
      <InstancedNodes graph={graph} />
      <ParticlePool ref={poolRef} />
      <NodeOverlays graph={graph} />

      <ExecutionPlayer onParticle={spawnParticle} />
      <DynamicOrbitControls hasGraph={!!graph} />

      <PostProcessing />
    </Canvas>
  )
}

interface ExecutionPlayerProps {
  onParticle: (edgeId: string) => void
}

/**
 * Drives the execution-trace timeline. Unchanged in behaviour from the
 * original implementation — only the visual side-effects (particle spawn,
 * node activation) now feed into the new instanced renderers.
 */
function ExecutionPlayer({ onParticle }: ExecutionPlayerProps) {
  const elapsedRef = useRef(0)
  const autoDeactivateRef = useRef<{ nodeId: string; deadline: number }[]>([])
  const clockRef = useRef(0)

  useFrame((_, delta) => {
    clockRef.current += delta
    const state = useSSPEStore.getState()

    const dueDeactivations = autoDeactivateRef.current.filter((d) => d.deadline <= clockRef.current)
    if (dueDeactivations.length > 0) {
      autoDeactivateRef.current = autoDeactivateRef.current.filter(
        (d) => d.deadline > clockRef.current,
      )
      const toRemove = new Set(dueDeactivations.map((d) => d.nodeId))
      const next = state.activeNodeIds.filter((id) => !toRemove.has(id))
      if (next.length !== state.activeNodeIds.length) {
        state.setActive(next, state.activeEdgeIds)
      }
    }

    if (!state.isPlaying) return
    if (state.currentStep >= state.executionSteps.length) {
      state.pause()
      return
    }

    elapsedRef.current += delta * state.playSpeed

    while (elapsedRef.current >= STEP_DURATION) {
      const current = useSSPEStore.getState()
      const idx = current.currentStep
      if (idx >= current.executionSteps.length) {
        current.pause()
        elapsedRef.current = 0
        return
      }
      const step = current.executionSteps[idx]
      if (step) applyStep(step, onParticle, autoDeactivateRef.current, clockRef.current)
      current.setCurrentStep(idx + 1)
      elapsedRef.current -= STEP_DURATION
    }
  })

  return null
}

function applyStep(
  step: ExecutionStep,
  onParticle: (edgeId: string) => void,
  deactivations: { nodeId: string; deadline: number }[],
  now: number,
) {
  const state = useSSPEStore.getState()
  if (typeof step.line === 'number') state.setCurrentLine(step.line)

  if (step.type === 'activate' && step.nodeId) {
    const ids = state.activeNodeIds.includes(step.nodeId)
      ? state.activeNodeIds
      : [...state.activeNodeIds, step.nodeId]
    state.setActive(ids, state.activeEdgeIds)

    const node = state.graph?.nodes.find((n) => n.id === step.nodeId)
    if (node && (node.type === 'variable' || node.type === 'assignment')) {
      state.bumpVariableValue(node.label)
    }

    deactivations.push({ nodeId: step.nodeId, deadline: now + STEP_DURATION * 4 })
  } else if (step.type === 'deactivate' && step.nodeId) {
    const ids = state.activeNodeIds.filter((id) => id !== step.nodeId)
    state.setActive(ids, state.activeEdgeIds)
  } else if (step.type === 'particle' && step.edgeId) {
    onParticle(step.edgeId)
    const next = state.activeEdgeIds.includes(step.edgeId)
      ? state.activeEdgeIds
      : [...state.activeEdgeIds, step.edgeId]
    state.setActive(state.activeNodeIds, next)
    setTimeout(() => {
      const s = useSSPEStore.getState()
      s.setActive(
        s.activeNodeIds,
        s.activeEdgeIds.filter((id) => id !== step.edgeId),
      )
    }, STEP_DURATION * 1000 * 1.2)
  }
}

function DynamicOrbitControls({ hasGraph }: { hasGraph: boolean }) {
  const { camera } = useThree()
  const initialFitRef = useRef(false)
  const graph = useSSPEStore((s) => s.graph)
  const editorFocused = useSSPEStore((s) => s.editorFocused)

  useEffect(() => {
    if (!graph || initialFitRef.current) return
    if (graph.nodes.length === 0) return
    const box = new THREE.Box3()
    for (const n of graph.nodes) box.expandByPoint(n.position)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)
    const maxDim = Math.max(size.x, size.y, size.z, 4)
    const dist = Math.max(maxDim * 1.8, 10)
    camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.9)
    camera.lookAt(center)
    initialFitRef.current = true
  }, [graph, camera])

  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.08}
      enabled={hasGraph && !editorFocused}
      makeDefault
    />
  )
}
