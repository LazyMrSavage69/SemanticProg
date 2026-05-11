import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard, Html, Sparkles, Text } from '@react-three/drei'
import type { SemanticGraph, SemanticNode } from '../../parser/types'
import { useSSPEStore } from '../../store/useSSPEStore'
import { NODE_COLORS } from './constants'
import { sceneRuntime } from './sceneRuntime'

/**
 * Renders the "expensive" per-node overlays (labels, sparkles, point lights,
 * iteration badges, condition test text, hover tooltips) — but only for the
 * small set of nodes that genuinely need them right now.
 *
 * That set ("detail set") lives in `sceneRuntime.detailNodeIds` and is
 * maintained by `SemanticZoomController`. It is bounded by
 * `MAX_DETAIL_NODES`, so this component never renders more than a handful
 * of overlay nodes regardless of total graph size.
 *
 * We diff the detail set inside a `useFrame` and only call `setState` when
 * it changes — so navigation jitter doesn't cascade into React renders.
 */

interface NodeOverlaysProps {
  graph: SemanticGraph | null
}

export function NodeOverlays({ graph }: NodeOverlaysProps) {
  const nodesById = useMemo(() => {
    const m = new Map<string, SemanticNode>()
    if (graph) for (const n of graph.nodes) m.set(n.id, n)
    return m
  }, [graph])

  const [overlayIds, setOverlayIds] = useState<string[]>([])
  const lastSigRef = useRef('')

  useFrame(() => {
    // Build a stable signature of the detail set and only React-sync on change.
    let sig = ''
    let first = true
    for (const id of sceneRuntime.detailNodeIds) {
      sig += first ? id : `,${id}`
      first = false
    }
    if (sig === lastSigRef.current) return
    lastSigRef.current = sig

    if (sig === '') {
      if (overlayIds.length > 0) setOverlayIds([])
      return
    }
    // Convert to sorted array so render order is stable.
    const ids = sig.split(',').sort()
    setOverlayIds(ids)
  })

  return (
    <group>
      {overlayIds.map((id) => {
        const node = nodesById.get(id)
        if (!node) return null
        return <NodeOverlay key={node.id} node={node} />
      })}
    </group>
  )
}

interface NodeOverlayProps {
  node: SemanticNode
}

function NodeOverlay({ node }: NodeOverlayProps) {
  const lightRef = useRef<THREE.PointLight>(null)
  const opacityRef = useRef(1)

  const selectedNodeId = useSSPEStore((s) => s.selectedNodeId)
  const hoveredNodeId = useSSPEStore((s) => s.hoveredNodeId)
  const focusedNodeId = useSSPEStore((s) => s.focusedNodeId)
  const focusedRelatedIds = useSSPEStore((s) => s.focusedRelatedIds)
  const activeNodeIds = useSSPEStore((s) => s.activeNodeIds)
  const variableValues = useSSPEStore((s) => s.variableValues)
  const variableValueIndex = useSSPEStore((s) => s.variableValueIndex)

  const color = NODE_COLORS[node.type]
  const colorObj = useMemo(() => new THREE.Color(color), [color])

  const isActive = activeNodeIds.includes(node.id)
  const isSelected = selectedNodeId === node.id
  const isHovered = hoveredNodeId === node.id
  const focusActive = focusedNodeId !== null
  const isRelated = !focusActive || focusedRelatedIds[node.id] === true
  const targetOpacity = isRelated ? 1 : 0.18

  // Live variable value display (carry-over from the original NodeMesh).
  const variableValue: string | null = useMemo(() => {
    if (node.type !== 'variable') return null
    const list = variableValues[node.label]
    if (list && list.length > 0) {
      const idx = Math.min(variableValueIndex[node.label] ?? 0, list.length - 1)
      return list[idx] ?? null
    }
    const initial = node.metadata.initialValue
    if (typeof initial === 'string') return initial
    const expr = node.metadata.valueExpr
    if (typeof expr === 'string') return expr
    return null
  }, [node, variableValues, variableValueIndex])

  const iterationCount =
    node.type === 'loop' && typeof node.metadata.iterations === 'number'
      ? node.metadata.iterations
      : null

  const conditionTest =
    node.type === 'condition' && typeof node.metadata.test === 'string'
      ? node.metadata.test
      : null

  useFrame((_, delta) => {
    if (lightRef.current) {
      const target = isActive ? 2 : 0
      lightRef.current.intensity = THREE.MathUtils.damp(
        lightRef.current.intensity,
        target,
        6,
        delta,
      )
    }
    opacityRef.current = THREE.MathUtils.damp(opacityRef.current, targetOpacity, 6, delta)
  })

  // Skip rendering text-heavy overlays at very-low zoom (LOD).
  // Detail set still contains the node (for selected/hovered/active), but at
  // zoom 0 we collapse to a single bold label per overlay.
  const [zoomTier, setZoomTier] = useState(2)
  useEffect(() => {
    const id = window.setInterval(() => {
      setZoomTier(sceneRuntime.zoomLevel)
    }, 200) // 5Hz sample — overlays don't need sub-frame precision
    return () => window.clearInterval(id)
  }, [])

  const showRichLabels = zoomTier >= 2
  const showSparkles = isRelated && (isActive || isSelected || isHovered) && zoomTier >= 2
  const showTooltip = isHovered && zoomTier >= 2

  return (
    <group position={node.position}>
      <pointLight ref={lightRef} color={color} intensity={0} distance={8} decay={2} />

      {showSparkles && (
        <Sparkles
          count={node.type === 'function' || node.type === 'recursion' ? 14 : 6}
          scale={2.2}
          size={2}
          speed={0.4}
          color={colorObj}
          opacity={0.55 * targetOpacity}
        />
      )}

      {iterationCount !== null && showRichLabels && (
        <Billboard position={[0.95, 0.95, 0]}>
          <mesh>
            <circleGeometry args={[0.32, 24]} />
            <meshBasicMaterial color="#050810" toneMapped={false} />
          </mesh>
          <mesh>
            <ringGeometry args={[0.3, 0.34, 24]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
          <Text
            fontSize={0.24}
            color={color}
            anchorX="center"
            anchorY="middle"
            outlineColor="#050810"
            outlineWidth={0.01}
          >
            {`${iterationCount}×`}
          </Text>
        </Billboard>
      )}

      {conditionTest && showRichLabels && (
        <Billboard position={[0, -1.05, 0]}>
          <Text
            fontSize={0.18}
            color="#c9d8f0"
            anchorX="center"
            anchorY="top"
            outlineColor="#050810"
            outlineWidth={0.012}
          >
            {conditionTest}
          </Text>
        </Billboard>
      )}

      <Billboard position={[0, 1.1, 0]}>
        <Text
          fontSize={node.type === 'variable' ? 0.26 : 0.28}
          color={isActive ? '#ffffff' : '#c9d8f0'}
          anchorX="center"
          anchorY="bottom"
          outlineColor="#050810"
          outlineWidth={0.015}
          outlineOpacity={0.9}
        >
          {node.label}
        </Text>
        {node.type === 'variable' && variableValue !== null && (
          <Text
            position={[0, 0.34, 0]}
            fontSize={0.2}
            color={color}
            anchorX="center"
            anchorY="bottom"
            outlineColor="#050810"
            outlineWidth={0.012}
          >
            {`= ${variableValue}`}
          </Text>
        )}
      </Billboard>

      {(isSelected || isHovered) && node.type !== 'variable' && showRichLabels && (
        <Billboard position={[0, -1.1, 0]}>
          <Text
            fontSize={0.18}
            color={color}
            anchorX="center"
            anchorY="top"
            outlineColor="#050810"
            outlineWidth={0.012}
          >
            {node.type}
          </Text>
        </Billboard>
      )}

      {showTooltip && (
        <Html
          position={[0, -1.6, 0]}
          center
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          distanceFactor={8}
          wrapperClass="sspe-tooltip-wrapper"
        >
          <div
            className="bg-surface/95 backdrop-blur-md border border-border rounded
              px-3 py-2 font-sans text-[12px] text-text
              shadow-[0_0_24px_0_rgba(0,0,0,0.6)]
              w-[min(280px,80vw)]"
          >
            <div className="font-mono text-[10px] uppercase tracking-widest mb-1" style={{ color }}>
              {plainTitle(node)}
            </div>
            <div className="text-text/90 leading-snug">{plainExplanation(node)}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

function plainTitle(node: SemanticNode): string {
  switch (node.type) {
    case 'function':
      return `Function · ${node.label}`
    case 'loop':
      return `Loop · ${node.label}`
    case 'condition':
      return `Condition · ${node.label}`
    case 'variable':
    case 'assignment':
      return `Variable · ${node.label}`
    case 'recursion':
      return `Recursion · ${node.label}`
    case 'expression':
      return `Action · ${node.label}`
    default:
      return node.label
  }
}

function plainExplanation(node: SemanticNode): string {
  const meta = node.metadata
  const lineNote = typeof meta.lineno === 'number' ? ` (line ${meta.lineno})` : ''
  switch (node.type) {
    case 'function': {
      const args = Array.isArray(meta.args) ? (meta.args as string[]).join(', ') : ''
      const argText = args ? `It takes ${args}.` : 'It takes no inputs.'
      return `A reusable block of code named "${node.label}". ${argText} Other code calls it to run its body${lineNote}.`
    }
    case 'loop': {
      const n = typeof meta.iterations === 'number' ? meta.iterations : 3
      return `A ${node.label}-loop. It runs the code inside it ${n} time${n === 1 ? '' : 's'} in a row${lineNote}.`
    }
    case 'condition': {
      const test = typeof meta.test === 'string' ? `(${meta.test})` : ''
      const hasElse = meta.hasElse === true
      return `A decision diamond. It checks ${test || 'a condition'} and goes YES if true${
        hasElse ? ', or NO otherwise' : ''
      }${lineNote}.`
    }
    case 'variable':
    case 'assignment': {
      const init = typeof meta.initialValue === 'string' ? meta.initialValue : null
      const expr = typeof meta.valueExpr === 'string' ? meta.valueExpr : null
      const value = init ?? (expr && expr !== node.label ? expr : null)
      const valueText = value ? ` It starts as ${value}.` : ''
      return `A box that holds a value named "${node.label}".${valueText} Watch it flash when the program changes it${lineNote}.`
    }
    case 'recursion':
      return `A function calling itself. The crimson icosahedron means the program goes back into the same chamber with smaller inputs${lineNote}.`
    case 'expression': {
      const callee = typeof meta.callee === 'string' ? meta.callee : node.label
      return `A small piece of work that runs ${callee}${lineNote}.`
    }
    default:
      return `A semantic node${lineNote}.`
  }
}
