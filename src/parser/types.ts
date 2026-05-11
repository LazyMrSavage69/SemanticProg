import type * as THREE from 'three'

export type NodeType =
  | 'variable'
  | 'loop'
  | 'condition'
  | 'function'
  | 'recursion'
  | 'expression'
  | 'assignment'

export type EdgeType =
  | 'executes'
  | 'dependsOn'
  | 'controlsFlow'
  | 'calls'
  | 'returns'
  | 'dataFlow'

export interface SemanticNode {
  id: string
  type: NodeType
  label: string
  metadata: Record<string, unknown>
  position: THREE.Vector3
}

export interface SemanticEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  metadata?: Record<string, unknown>
}

export interface SemanticGraph {
  nodes: SemanticNode[]
  edges: SemanticEdge[]
}

/** A single recorded variable mutation captured by the Python tracer. */
export interface TraceEvent {
  line: number
  name: string
  value: string
}

/** Plain (non-Vector3) variant used inside the worker / serialization boundary. */
export interface SerializableNode {
  id: string
  type: NodeType
  label: string
  metadata: Record<string, unknown>
  position: { x: number; y: number; z: number }
}

export interface SerializableGraph {
  nodes: SerializableNode[]
  edges: SemanticEdge[]
}

/** A single step in the execution simulator timeline. */
export interface ExecutionStep {
  type: 'activate' | 'deactivate' | 'particle' | 'loop_iteration'
  nodeId?: string
  edgeId?: string
  iteration?: number
  /** 1-based source line associated with this step, when known. */
  line?: number
}
