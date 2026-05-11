import * as THREE from 'three'
import type { SemanticEdge, SemanticGraph, SemanticNode } from '../parser/types'

interface Particle {
  id: string
  pos: THREE.Vector3
  vel: THREE.Vector3
}

interface LayoutOptions {
  iterations?: number
  repulsion?: number
  springLength?: number
  springStrength?: number
  damping?: number
  centerStrength?: number
  seed?: number
}

/**
 * 3D force-directed layout using Coulomb repulsion + Hooke springs and a
 * mild centering force. Mutates each node's `position` in place after
 * running the simulation. Deterministic given a seed.
 */
export function forceLayout3D(graph: SemanticGraph, options: LayoutOptions = {}): SemanticGraph {
  const {
    iterations = 220,
    repulsion = 28,
    springLength = 3,
    springStrength = 0.18,
    damping = 0.82,
    centerStrength = 0.012,
    seed = 1,
  } = options

  const rand = mulberry32(seed)
  const particles: Particle[] = graph.nodes.map((n) => ({
    id: n.id,
    pos: new THREE.Vector3(
      (rand() - 0.5) * 6,
      (rand() - 0.5) * 6,
      (rand() - 0.5) * 6,
    ),
    vel: new THREE.Vector3(0, 0, 0),
  }))
  const indexById = new Map(particles.map((p, i) => [p.id, i]))

  // Per-edge tunables: structural edges keep parents close; data-flow is looser.
  function edgeParams(e: SemanticEdge): { length: number; strength: number } {
    switch (e.type) {
      case 'executes':
        return { length: springLength * 0.9, strength: springStrength * 1.4 }
      case 'controlsFlow':
        return { length: springLength * 1.0, strength: springStrength * 1.2 }
      case 'calls':
        return { length: springLength * 1.6, strength: springStrength * 0.7 }
      case 'returns':
        return { length: springLength * 1.4, strength: springStrength * 0.7 }
      case 'dependsOn':
        return { length: springLength * 2.0, strength: springStrength * 0.35 }
      case 'dataFlow':
        return { length: springLength * 1.5, strength: springStrength * 0.4 }
      default:
        return { length: springLength, strength: springStrength }
    }
  }

  const tmp = new THREE.Vector3()
  const force = new THREE.Vector3()

  for (let step = 0; step < iterations; step++) {
    // Cool the system as iterations progress.
    const cooling = 1 - step / iterations
    const stepDamping = damping * (0.92 + 0.08 * cooling)

    // Reset forces
    const forces: THREE.Vector3[] = particles.map(() => new THREE.Vector3(0, 0, 0))

    // Coulomb-style repulsion (all-pairs, O(N²))
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        tmp.subVectors(particles[i]!.pos, particles[j]!.pos)
        let distSq = tmp.lengthSq()
        if (distSq < 1e-4) {
          tmp.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.1)
          distSq = tmp.lengthSq()
        }
        const dist = Math.sqrt(distSq)
        const strength = repulsion / distSq
        force.copy(tmp).divideScalar(dist).multiplyScalar(strength)
        forces[i]!.add(force)
        forces[j]!.sub(force)
      }
    }

    // Hooke springs along edges
    for (const e of graph.edges) {
      const a = indexById.get(e.source)
      const b = indexById.get(e.target)
      if (a === undefined || b === undefined) continue
      const { length, strength } = edgeParams(e)
      tmp.subVectors(particles[b]!.pos, particles[a]!.pos)
      const dist = tmp.length() || 1e-4
      const displacement = dist - length
      force.copy(tmp).divideScalar(dist).multiplyScalar(displacement * strength)
      forces[a]!.add(force)
      forces[b]!.sub(force)
    }

    // Mild attraction toward origin so the cluster doesn't drift away.
    for (let i = 0; i < particles.length; i++) {
      force.copy(particles[i]!.pos).multiplyScalar(-centerStrength)
      forces[i]!.add(force)
    }

    // Integrate (semi-implicit Euler)
    for (let i = 0; i < particles.length; i++) {
      particles[i]!.vel.add(forces[i]!).multiplyScalar(stepDamping)
      // Clamp velocity to avoid blow-ups
      const speed = particles[i]!.vel.length()
      if (speed > 4) particles[i]!.vel.multiplyScalar(4 / speed)
      particles[i]!.pos.add(particles[i]!.vel)
    }
  }

  // Write positions back into the graph nodes.
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i] as SemanticNode
    const p = particles[i]!.pos
    node.position.set(p.x, p.y, p.z)
  }

  // Center the entire layout so the average position is at the origin.
  const centroid = new THREE.Vector3()
  for (const n of graph.nodes) centroid.add(n.position)
  if (graph.nodes.length > 0) centroid.divideScalar(graph.nodes.length)
  for (const n of graph.nodes) n.position.sub(centroid)

  return graph
}

/** Tiny seeded PRNG for deterministic layouts. */
function mulberry32(a: number): () => number {
  let s = a | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
