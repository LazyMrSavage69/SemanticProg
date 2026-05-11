import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard, Html, RoundedBox, Sparkles, Text } from '@react-three/drei'
import type { SemanticNode } from '../../parser/types'
import { useSSPEStore } from '../../store/useSSPEStore'
import { NODE_COLORS } from './constants'

interface NodeMeshProps {
  node: SemanticNode
}

export function NodeMesh({ node }: NodeMeshProps) {
  const groupRef = useRef<THREE.Group>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const innerRef = useRef<THREE.Mesh>(null)
  const opacityRef = useRef(1)

  const setSelectedNode = useSSPEStore((s) => s.setSelectedNode)
  const setHoveredNode = useSSPEStore((s) => s.setHoveredNode)
  const selectedNodeId = useSSPEStore((s) => s.selectedNodeId)
  const hoveredNodeId = useSSPEStore((s) => s.hoveredNodeId)
  const activeNodeIds = useSSPEStore((s) => s.activeNodeIds)
  const focusedNodeId = useSSPEStore((s) => s.focusedNodeId)
  const focusedRelatedIds = useSSPEStore((s) => s.focusedRelatedIds)
  const variableValues = useSSPEStore((s) => s.variableValues)
  const variableValueIndex = useSSPEStore((s) => s.variableValueIndex)

  const color = NODE_COLORS[node.type]
  const isActive = activeNodeIds.includes(node.id)
  const isSelected = selectedNodeId === node.id
  const isHovered = hoveredNodeId === node.id

  // Focus mode: when something is focused, fade unrelated nodes.
  const focusActive = focusedNodeId !== null
  const isRelated = !focusActive || focusedRelatedIds[node.id] === true
  const targetOpacity = isRelated ? 1 : 0.18

  const colorObj = useMemo(() => new THREE.Color(color), [color])

  // Compute the live value to display under variables.
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

  // Iteration count for loops.
  const iterationCount = node.type === 'loop' && typeof node.metadata.iterations === 'number'
    ? node.metadata.iterations
    : null

  // Condition test text (e.g., "n <= 1") for the diamond label.
  const conditionTest = node.type === 'condition' && typeof node.metadata.test === 'string'
    ? node.metadata.test
    : null

  useFrame((_, delta) => {
    // Animated emissive — pulse when active.
    if (materialRef.current) {
      const targetEmissive = isActive ? 1.6 : isSelected ? 1.1 : isHovered ? 0.85 : 0.4
      materialRef.current.emissiveIntensity = THREE.MathUtils.damp(
        materialRef.current.emissiveIntensity,
        targetEmissive,
        8,
        delta,
      )
      materialRef.current.opacity = THREE.MathUtils.damp(
        materialRef.current.opacity,
        targetOpacity,
        6,
        delta,
      )
      materialRef.current.transparent = targetOpacity < 0.999
    }
    if (lightRef.current) {
      const targetIntensity = isActive ? 2 : 0
      lightRef.current.intensity = THREE.MathUtils.damp(lightRef.current.intensity, targetIntensity, 6, delta)
    }
    if (groupRef.current) {
      // Loops slowly rotate; recursion gently bobs.
      if (node.type === 'loop') groupRef.current.rotation.z += delta * 0.5
      if (node.type === 'recursion') {
        groupRef.current.rotation.y += delta * 0.4
        if (innerRef.current) innerRef.current.rotation.x -= delta * 0.9
      }
    }
    opacityRef.current = THREE.MathUtils.damp(opacityRef.current, targetOpacity, 6, delta)
  })

  const handlePointerOver = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    setHoveredNode(node.id)
    document.body.style.cursor = 'pointer'
  }
  const handlePointerOut = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (hoveredNodeId === node.id) setHoveredNode(null)
    document.body.style.cursor = 'default'
  }
  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    setSelectedNode(node.id)
  }
  const handleContextMenu = (e: { stopPropagation: () => void; nativeEvent?: Event }) => {
    e.stopPropagation()
    e.nativeEvent?.preventDefault?.()
    setSelectedNode(node.id)
  }

  const interactionProps = {
    onPointerOver: handlePointerOver,
    onPointerOut: handlePointerOut,
    onClick: handleClick,
    onContextMenu: handleContextMenu,
  }

  return (
    <group ref={groupRef} position={node.position}>
      <pointLight ref={lightRef} color={color} intensity={0} distance={8} decay={2} />

      {renderShape(node.type, materialRef, color, innerRef, interactionProps)}

      {isRelated && (
        <Sparkles
          count={node.type === 'function' || node.type === 'recursion' ? 18 : 8}
          scale={2.2}
          size={2}
          speed={0.4}
          color={colorObj}
          opacity={0.55 * targetOpacity}
        />
      )}

      {/* Loop iteration badge — clearly communicates "this runs N times" */}
      {iterationCount !== null && (
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

      {/* Condition test text under the diamond */}
      {conditionTest && (
        <Billboard position={[0, -1.05, 0]}>
          <Text
            fontSize={0.18}
            color="#c9d8f0"
            anchorX="center"
            anchorY="top"
            outlineColor="#050810"
            outlineWidth={0.012}
            font={undefined}
          >
            {conditionTest}
          </Text>
        </Billboard>
      )}

      {/* Variable label + live value */}
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

      {(isSelected || isHovered) && node.type !== 'variable' && (
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

      {/* Plain-language hover tooltip */}
      {isHovered && (
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

type InteractionProps = {
  onPointerOver: (e: { stopPropagation: () => void }) => void
  onPointerOut: (e: { stopPropagation: () => void }) => void
  onClick: (e: { stopPropagation: () => void }) => void
  onContextMenu: (e: { stopPropagation: () => void; nativeEvent?: Event }) => void
}

function renderShape(
  type: SemanticNode['type'],
  matRef: React.RefObject<THREE.MeshStandardMaterial | null>,
  color: string,
  innerRef: React.RefObject<THREE.Mesh | null>,
  interaction: InteractionProps,
) {
  const sharedMaterial = (
    <meshStandardMaterial
      ref={matRef}
      color={color}
      emissive={color}
      emissiveIntensity={0.4}
      metalness={0.4}
      roughness={0.3}
      toneMapped={false}
      transparent
      opacity={1}
    />
  )

  switch (type) {
    case 'variable':
    case 'assignment':
      return (
        <group {...interaction}>
          <RoundedBox args={[0.8, 0.8, 0.8]} radius={0.12} smoothness={3}>
            {sharedMaterial}
          </RoundedBox>
          <mesh>
            <boxGeometry args={[0.82, 0.82, 0.82]} />
            <meshBasicMaterial color={color} wireframe transparent opacity={0.35} toneMapped={false} />
          </mesh>
        </group>
      )
    case 'loop':
      return (
        <mesh {...interaction} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.2, 0.15, 16, 64]} />
          {sharedMaterial}
        </mesh>
      )
    case 'condition':
      // Flat flowchart-style diamond plate (rotated square on its corner).
      return (
        <group {...interaction}>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[1.25, 1.25, 0.28]} />
            {sharedMaterial}
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[1.3, 1.3, 0.3]} />
            <meshBasicMaterial color={color} wireframe transparent opacity={0.4} toneMapped={false} />
          </mesh>
        </group>
      )
    case 'function':
      return (
        <mesh {...interaction}>
          <cylinderGeometry args={[0.6, 0.8, 1.0, 6]} />
          {sharedMaterial}
        </mesh>
      )
    case 'recursion':
      return (
        <group {...interaction}>
          <mesh>
            <icosahedronGeometry args={[0.8, 0]} />
            {sharedMaterial}
          </mesh>
          <mesh ref={innerRef} scale={0.5}>
            <icosahedronGeometry args={[0.8, 0]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.9}
              wireframe
              toneMapped={false}
            />
          </mesh>
        </group>
      )
    case 'expression':
    default:
      return (
        <mesh {...interaction}>
          <sphereGeometry args={[0.4, 24, 24]} />
          {sharedMaterial}
        </mesh>
      )
  }
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
      return `A decision diamond. It checks ${test || 'a condition'} and goes YES if true${hasElse ? ', or NO otherwise' : ''}${lineNote}.`
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
