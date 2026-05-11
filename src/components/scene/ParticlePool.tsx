import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SemanticNode } from '../../parser/types'

/**
 * Fixed-size pool of execution-flow particles, rendered as a single
 * `InstancedMesh`. The old design created/destroyed a React component +
 * mesh + material per particle on every `executes` event — at high tick
 * rates this caused GC pressure and frame stalls.
 *
 * Now: one mesh, one material, one allocation. The parent calls
 * `spawn(source, target, color)` via the imperative ref and the pool
 * grabs the next free slot.
 */

export interface ParticlePoolHandle {
  spawn: (source: SemanticNode, target: SemanticNode, color: string) => void
  /** How many particles are currently alive. */
  alive: () => number
}

interface PooledParticle {
  /** Whether this slot is currently animating. */
  alive: boolean
  /** Bezier curve cached vectors. */
  start: THREE.Vector3
  end: THREE.Vector3
  ctrl: THREE.Vector3
  /** Animation duration (s). */
  duration: number
  /** Elapsed (s). */
  elapsed: number
  /** Base color (with bloom-friendly brightness applied). */
  color: THREE.Color
}

interface ParticlePoolProps {
  capacity?: number
  /** Per-particle animation length. */
  duration?: number
}

const tmpPos = new THREE.Vector3()
const tmpMat = new THREE.Matrix4()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()
const tmpColor = new THREE.Color()

export const ParticlePool = forwardRef<ParticlePoolHandle, ParticlePoolProps>(function ParticlePool(
  { capacity = 256, duration = 1.0 },
  ref,
) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  // Per-slot animation state. Allocated once for the lifetime of the pool.
  const slots = useMemo(() => {
    const arr: PooledParticle[] = new Array(capacity)
    for (let i = 0; i < capacity; i++) {
      arr[i] = {
        alive: false,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        ctrl: new THREE.Vector3(),
        duration,
        elapsed: 0,
        color: new THREE.Color(),
      }
    }
    return arr
  }, [capacity, duration])

  // Geometry + material are constant across the pool.
  const geometry = useMemo(() => new THREE.SphereGeometry(0.18, 10, 10), [])

  // Index of next slot to try when spawning. Rotates through the pool.
  const nextSlotRef = useRef(0)

  useImperativeHandle(
    ref,
    () => ({
      spawn(source, target, color) {
        // Find a free slot, starting from the rotating pointer.
        const start = nextSlotRef.current
        for (let i = 0; i < capacity; i++) {
          const idx = (start + i) % capacity
          if (!slots[idx]!.alive) {
            const s = slots[idx]!
            s.alive = true
            s.elapsed = 0
            s.duration = duration
            s.start.copy(source.position)
            s.end.copy(target.position)

            // Bowed control point — mirrors the curve used by EdgeBatch.
            tmpPos.subVectors(s.end, s.start)
            const len = tmpPos.length() || 1
            const offsetAxis =
              Math.abs(tmpPos.y) < 0.99
                ? new THREE.Vector3(0, 1, 0).cross(tmpPos).normalize()
                : new THREE.Vector3(1, 0, 0).cross(tmpPos).normalize()
            s.ctrl.copy(s.start).add(s.end).multiplyScalar(0.5).addScaledVector(offsetAxis, len * 0.15)

            s.color.set(color).multiplyScalar(2.4) // bloom-friendly intensity
            nextSlotRef.current = (idx + 1) % capacity
            return
          }
        }
        // Pool exhausted — silently drop. At capacity 256 with sub-second
        // particles this only happens during pathological execution storms.
      },
      alive() {
        let n = 0
        for (let i = 0; i < capacity; i++) if (slots[i]!.alive) n++
        return n
      },
    }),
    [capacity, duration, slots],
  )

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    let anyAlive = false
    for (let i = 0; i < capacity; i++) {
      const s = slots[i]!
      if (!s.alive) {
        // Park the instance off-screen at zero scale.
        tmpScale.setScalar(0)
        tmpPos.set(0, 1000, 0)
        tmpQuat.identity()
        tmpMat.compose(tmpPos, tmpQuat, tmpScale)
        mesh.setMatrixAt(i, tmpMat)
        continue
      }
      anyAlive = true
      s.elapsed += delta
      const t = Math.min(s.elapsed / s.duration, 1)

      // Quadratic bezier point.
      const oneMinusT = 1 - t
      tmpPos
        .set(0, 0, 0)
        .addScaledVector(s.start, oneMinusT * oneMinusT)
        .addScaledVector(s.ctrl, 2 * oneMinusT * t)
        .addScaledVector(s.end, t * t)

      // Subtle "comet" scale envelope — fat in the middle, taper at endpoints.
      const env = 1 - 4 * (t - 0.5) * (t - 0.5) * 0.3
      tmpScale.setScalar(env)
      tmpQuat.identity()
      tmpMat.compose(tmpPos, tmpQuat, tmpScale)
      mesh.setMatrixAt(i, tmpMat)

      // Fade out in the final 20% of life.
      const fade = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2
      tmpColor.copy(s.color).multiplyScalar(fade)
      mesh.setColorAt(i, tmpColor)

      if (t >= 1) s.alive = false
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.visible = anyAlive
  })

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, capacity]} frustumCulled={false}>
      <meshBasicMaterial toneMapped={false} transparent opacity={1} />
    </instancedMesh>
  )
})
