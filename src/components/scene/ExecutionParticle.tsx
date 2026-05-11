import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SemanticNode } from '../../parser/types'

interface ExecutionParticleProps {
  id: number
  source: SemanticNode
  target: SemanticNode
  color?: string
  duration?: number
  onDone: (id: number) => void
}

export function ExecutionParticle({
  id,
  source,
  target,
  color = '#ffffff',
  duration = 1.1,
  onDone,
}: ExecutionParticleProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const elapsed = useRef(0)
  const finishedRef = useRef(false)

  const curve = useMemo(() => {
    const a = source.position.clone()
    const b = target.position.clone()
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const dir = b.clone().sub(a)
    const len = dir.length() || 1
    const offsetAxis = Math.abs(dir.y) < 0.99
      ? new THREE.Vector3(0, 1, 0).cross(dir).normalize()
      : new THREE.Vector3(1, 0, 0).cross(dir).normalize()
    mid.addScaledVector(offsetAxis, len * 0.15)
    return new THREE.QuadraticBezierCurve3(a, mid, b)
  }, [source.position, target.position])

  useFrame((_, delta) => {
    if (finishedRef.current) return
    elapsed.current += delta
    const tRaw = elapsed.current / duration
    const t = Math.min(tRaw, 1)
    if (meshRef.current) {
      const p = curve.getPoint(t)
      meshRef.current.position.copy(p)
      const scale = 1 - Math.pow(2 * (t - 0.5), 2) * 0.3
      meshRef.current.scale.setScalar(0.18 * scale)
    }
    if (matRef.current) {
      matRef.current.emissiveIntensity = t < 0.85 ? 2.5 : 2.5 * (1 - (t - 0.85) / 0.15)
      matRef.current.opacity = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15
    }
    if (t >= 1) {
      finishedRef.current = true
      onDone(id)
    }
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshStandardMaterial
        ref={matRef}
        color={color}
        emissive={color}
        emissiveIntensity={2.5}
        transparent
        opacity={1}
        toneMapped={false}
      />
    </mesh>
  )
}
