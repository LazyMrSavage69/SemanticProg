import type { EdgeType, NodeType } from '../../parser/types'

export const NODE_COLORS: Record<NodeType, string> = {
  variable: '#00d4ff',
  loop: '#7c3aed',
  condition: '#f59e0b',
  function: '#10b981',
  recursion: '#ef4444',
  expression: '#64748b',
  assignment: '#00d4ff',
}

export const EDGE_COLORS: Record<EdgeType, string> = {
  executes: '#ffffff',
  dependsOn: '#00d4ff',
  controlsFlow: '#f59e0b',
  calls: '#10b981',
  returns: '#ef4444',
  dataFlow: '#ffffff',
}

export const EDGE_DASHED: Record<EdgeType, boolean> = {
  executes: false,
  dependsOn: true,
  controlsFlow: false,
  calls: false,
  returns: false,
  dataFlow: true,
}

export const EDGE_OPACITY: Record<EdgeType, number> = {
  executes: 0.32,
  dependsOn: 0.45,
  controlsFlow: 0.55,
  calls: 0.55,
  returns: 0.6,
  dataFlow: 0.45,
}
