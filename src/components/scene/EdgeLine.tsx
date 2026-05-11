import { useMemo } from 'react'
import * as THREE from 'three'
import { Billboard, Line, Text } from '@react-three/drei'
import type { SemanticEdge, SemanticNode } from '../../parser/types'
import { useSSPEStore } from '../../store/useSSPEStore'
import { EDGE_COLORS, EDGE_DASHED, EDGE_OPACITY } from './constants'

interface EdgeLineProps {
  edge: SemanticEdge
  source: SemanticNode
  target: SemanticNode
}

/** Sample a quadratic-bezier between two points so the edge bows naturally. */
function curveFor(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length() || 1
  const offsetAxis = Math.abs(dir.y) < 0.99
    ? new THREE.Vector3(0, 1, 0).cross(dir).normalize()
    : new THREE.Vector3(1, 0, 0).cross(dir).normalize()
  mid.addScaledVector(offsetAxis, len * 0.15)
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone())
}

function curveSamples(curve: THREE.QuadraticBezierCurve3, samples = 24): [number, number, number][] {
  return curve.getPoints(samples).map((p) => [p.x, p.y, p.z] as [number, number, number])
}

function edgeLabelText(edge: SemanticEdge): string | null {
  // Branch labels (YES / NO) are the most teaching-critical — always visible.
  const meta = edge.metadata
  if (meta && typeof meta.label === 'string') return meta.label
  switch (edge.type) {
    case 'calls':
      return 'calls'
    case 'returns':
      return 'returns'
    case 'dependsOn': {
      const v = meta && typeof meta.variable === 'string' ? meta.variable : null
      return v ? `uses ${v}` : 'uses'
    }
    case 'controlsFlow':
      return null // already labelled YES/NO via metadata when present
    case 'executes':
    case 'dataFlow':
    default:
      return null
  }
}

export function EdgeLine({ edge, source, target }: EdgeLineProps) {
  const activeEdgeIds = useSSPEStore((s) => s.activeEdgeIds)
  const selectedNodeId = useSSPEStore((s) => s.selectedNodeId)
  const hoveredNodeId = useSSPEStore((s) => s.hoveredNodeId)
  const focusedNodeId = useSSPEStore((s) => s.focusedNodeId)
  const focusedRelatedIds = useSSPEStore((s) => s.focusedRelatedIds)

  const isActive = activeEdgeIds.includes(edge.id)
  const isAdjacentToSelected =
    selectedNodeId !== null && (selectedNodeId === edge.source || selectedNodeId === edge.target)
  const isAdjacentToHovered =
    hoveredNodeId !== null && (hoveredNodeId === edge.source || hoveredNodeId === edge.target)

  const focusActive = focusedNodeId !== null
  const isRelated =
    !focusActive ||
    (focusedRelatedIds[edge.source] === true && focusedRelatedIds[edge.target] === true)
  const focusFade = isRelated ? 1 : 0.18

  const curve = useMemo(
    () => curveFor(source.position, target.position),
    [
      source.position,
      target.position,
      source.position.x,
      source.position.y,
      source.position.z,
      target.position.x,
      target.position.y,
      target.position.z,
    ],
  )
  const points = useMemo(() => curveSamples(curve), [curve])
  const midPoint = useMemo(() => curve.getPoint(0.5), [curve])

  const color = EDGE_COLORS[edge.type]
  const baseOpacity = EDGE_OPACITY[edge.type]
  const interactionOpacity = isActive
    ? 1
    : isAdjacentToSelected
    ? 0.85
    : isAdjacentToHovered
    ? 0.7
    : baseOpacity
  const opacity = interactionOpacity * focusFade
  const lineWidth = isActive ? 2.4 : isAdjacentToSelected ? 1.7 : 1
  const dashed = EDGE_DASHED[edge.type]

  // Branch label (YES/NO) — always visible when present (controlsFlow edges).
  const branchLabel =
    edge.metadata && typeof edge.metadata.label === 'string' ? edge.metadata.label : null
  const branchKind =
    edge.metadata && typeof edge.metadata.branch === 'string' ? edge.metadata.branch : null

  // Generic edge label (calls / returns / uses x).
  const genericLabel = edgeLabelText(edge)
  const showGenericLabel =
    genericLabel !== null &&
    isRelated &&
    edge.type !== 'controlsFlow' &&
    (isAdjacentToSelected || isAdjacentToHovered || isActive || edge.type === 'returns' || edge.type === 'calls')

  return (
    <group>
      <Line
        points={points}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={opacity}
        dashed={dashed}
        dashSize={dashed ? 0.3 : undefined}
        gapSize={dashed ? 0.18 : undefined}
        toneMapped={false}
      />

      {branchLabel && isRelated && (
        <Billboard position={[midPoint.x, midPoint.y, midPoint.z]}>
          <mesh>
            <planeGeometry args={[0.7, 0.32]} />
            <meshBasicMaterial
              color="#050810"
              transparent
              opacity={0.9 * focusFade}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0, 0.001]}>
            <planeGeometry args={[0.74, 0.36]} />
            <meshBasicMaterial
              color={branchKind === 'true' ? '#10b981' : '#ef4444'}
              wireframe
              transparent
              opacity={0.6 * focusFade}
              toneMapped={false}
            />
          </mesh>
          <Text
            position={[0, 0, 0.01]}
            fontSize={0.2}
            color={branchKind === 'true' ? '#10b981' : '#ef4444'}
            anchorX="center"
            anchorY="middle"
            outlineColor="#050810"
            outlineWidth={0.012}
          >
            {branchLabel}
          </Text>
        </Billboard>
      )}

      {showGenericLabel && genericLabel !== null && (
        <Billboard position={[midPoint.x, midPoint.y + 0.18, midPoint.z]}>
          <Text
            fontSize={0.16}
            color={color}
            anchorX="center"
            anchorY="middle"
            outlineColor="#050810"
            outlineWidth={0.012}
          >
            {genericLabel}
          </Text>
        </Billboard>
      )}
    </group>
  )
}
