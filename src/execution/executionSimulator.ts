import type { ExecutionStep, SemanticEdge, SemanticGraph, SemanticNode } from '../parser/types'

interface Adjacency {
  executesChildren: Map<string, SemanticEdge[]>
  controlsChildren: Map<string, SemanticEdge[]>
  callsTarget: Map<string, SemanticEdge>
  returnsTarget: Map<string, SemanticEdge>
  dependsOn: SemanticEdge[]
  incomingExecutes: Map<string, number>
}

function buildAdjacency(graph: SemanticGraph): Adjacency {
  const executesChildren = new Map<string, SemanticEdge[]>()
  const controlsChildren = new Map<string, SemanticEdge[]>()
  const callsTarget = new Map<string, SemanticEdge>()
  const returnsTarget = new Map<string, SemanticEdge>()
  const dependsOn: SemanticEdge[] = []
  const incomingExecutes = new Map<string, number>()

  for (const e of graph.edges) {
    if (e.type === 'executes') {
      const arr = executesChildren.get(e.source) ?? []
      arr.push(e)
      executesChildren.set(e.source, arr)
      incomingExecutes.set(e.target, (incomingExecutes.get(e.target) ?? 0) + 1)
    } else if (e.type === 'controlsFlow') {
      const arr = controlsChildren.get(e.source) ?? []
      arr.push(e)
      controlsChildren.set(e.source, arr)
    } else if (e.type === 'calls') {
      callsTarget.set(e.source, e)
    } else if (e.type === 'returns') {
      returnsTarget.set(e.source, e)
    } else if (e.type === 'dependsOn') {
      dependsOn.push(e)
    }
  }

  return { executesChildren, controlsChildren, callsTarget, returnsTarget, dependsOn, incomingExecutes }
}

const MAX_RECURSION_DEPTH = 3

/**
 * Produce an ordered timeline of ExecutionStep events for a SemanticGraph.
 *
 * Walks roots in source order, skipping FunctionDef declarations (they execute
 * only when called). Loops repeat their body N times, conditions follow the
 * TRUE branch only, and `calls` edges dive into the target function up to
 * MAX_RECURSION_DEPTH levels deep so recursion is finite but visible.
 */
export function buildExecutionSteps(graph: SemanticGraph): ExecutionStep[] {
  const steps: ExecutionStep[] = []
  const nodeById = new Map<string, SemanticNode>()
  for (const n of graph.nodes) nodeById.set(n.id, n)

  const adj = buildAdjacency(graph)

  const walking = new Set<string>() // currently on the call stack — avoid same-frame re-entry

  const lineOf = (node: SemanticNode): number | undefined => {
    const v = node.metadata.lineno
    return typeof v === 'number' ? v : undefined
  }

  const walk = (nodeId: string, parentEdgeId: string | null, recursionDepth: number): void => {
    if (walking.has(nodeId)) {
      // Cycle through executes/calls — emit a tiny visual and bail.
      if (parentEdgeId) steps.push({ type: 'particle', edgeId: parentEdgeId })
      return
    }
    const node = nodeById.get(nodeId)
    if (!node) return

    walking.add(nodeId)

    const line = lineOf(node)
    if (parentEdgeId) steps.push({ type: 'particle', edgeId: parentEdgeId, line })
    steps.push({ type: 'activate', nodeId, line })

    if (node.type === 'loop') {
      const iterations = numberMeta(node.metadata.iterations, 3)
      const children = adj.executesChildren.get(nodeId) ?? []
      for (let i = 0; i < iterations; i++) {
        steps.push({ type: 'loop_iteration', nodeId, iteration: i, line })
        for (const e of children) walk(e.target, e.id, recursionDepth)
      }
    } else if (node.type === 'condition') {
      const controls = adj.controlsChildren.get(nodeId) ?? []
      const executes = adj.executesChildren.get(nodeId) ?? []
      if (controls.length > 0) {
        // TRUE branch only.
        const e = controls[0]!
        walk(e.target, e.id, recursionDepth)
      } else {
        for (const e of executes) walk(e.target, e.id, recursionDepth)
      }
    } else {
      const children = adj.executesChildren.get(nodeId) ?? []
      for (const e of children) walk(e.target, e.id, recursionDepth)

      const callsEdge = adj.callsTarget.get(nodeId)
      if (callsEdge && recursionDepth + 1 <= MAX_RECURSION_DEPTH) {
        walk(callsEdge.target, callsEdge.id, recursionDepth + 1)
      }

      const returnsEdge = adj.returnsTarget.get(nodeId)
      if (returnsEdge && node.type === 'function') {
        // Visualise the function returning by sending a particle along its 'returns' edge.
        steps.push({ type: 'particle', edgeId: returnsEdge.id })
      }
    }

    steps.push({ type: 'deactivate', nodeId, line })
    walking.delete(nodeId)
  }

  const rootNodes = graph.nodes.filter((n) => !adj.incomingExecutes.has(n.id))

  for (const root of rootNodes) {
    if (root.type === 'function') {
      // Declarations only — emit a brief activation so the user sees the function register.
      steps.push({ type: 'activate', nodeId: root.id })
      steps.push({ type: 'deactivate', nodeId: root.id })
      continue
    }
    walk(root.id, null, 0)
  }

  return steps
}

function numberMeta(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}
