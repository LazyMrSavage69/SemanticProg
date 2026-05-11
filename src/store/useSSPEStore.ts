import { create } from 'zustand'
import type { ExecutionStep, SemanticGraph, TraceEvent } from '../parser/types'
import { EXAMPLES, FACTORIAL_EXAMPLE } from '../data/examples'

export const SAMPLE_PYTHON = FACTORIAL_EXAMPLE

export interface SSPEState {
  // Graph
  graph: SemanticGraph | null
  setGraph: (g: SemanticGraph | null) => void

  // Active node ids during execution (set, but stored as array for shallow checks)
  activeNodeIds: string[]
  activeEdgeIds: string[]
  setActive: (nodeIds: string[], edgeIds: string[]) => void

  // Execution simulation
  executionSteps: ExecutionStep[]
  setExecutionSteps: (s: ExecutionStep[]) => void
  currentStep: number
  setCurrentStep: (i: number) => void
  isPlaying: boolean
  playSpeed: number
  play: () => void
  pause: () => void
  step: () => void
  reset: () => void
  setPlaySpeed: (s: number) => void

  // UI
  selectedNodeId: string | null
  setSelectedNode: (id: string | null) => void
  hoveredNodeId: string | null
  setHoveredNode: (id: string | null) => void

  sourceCode: string
  setSourceCode: (code: string) => void

  // Parsing lifecycle
  isParsing: boolean
  setIsParsing: (b: boolean) => void
  parseError: string | null
  setParseError: (s: string | null) => void

  pyodideReady: boolean
  setPyodideReady: (b: boolean) => void

  // Last progress message from the Pyodide worker (e.g. "Loading runtime…").
  pyodideMessage: string
  setPyodideMessage: (m: string) => void

  // True while the user is typing in Monaco — used to disable OrbitControls.
  editorFocused: boolean
  setEditorFocused: (b: boolean) => void

  // Live runtime trace from Pyodide (variable mutations).
  traceEvents: TraceEvent[]
  setTrace: (events: TraceEvent[]) => void
  // Per-variable list of values, in order of mutation (built from traceEvents).
  variableValues: Record<string, string[]>
  // Current display index for each variable (advances on activation).
  variableValueIndex: Record<string, number>
  bumpVariableValue: (name: string) => void
  resetVariableValues: () => void

  // Source line currently being executed in the playback (for editor highlight).
  currentLine: number | null
  setCurrentLine: (line: number | null) => void

  // Focused subgraph — when set, unrelated nodes/edges fade out.
  focusedNodeId: string | null
  focusedRelatedIds: Record<string, true>
  setFocusedNode: (id: string | null) => void

  // Selected example id (so the picker UI knows what's loaded).
  currentExampleId: string | null
  setCurrentExampleId: (id: string | null) => void

  examples: typeof EXAMPLES
}

export const useSSPEStore = create<SSPEState>((set, get) => ({
  graph: null,
  setGraph: (g) => set({ graph: g, selectedNodeId: null }),

  activeNodeIds: [],
  activeEdgeIds: [],
  setActive: (nodeIds, edgeIds) => set({ activeNodeIds: nodeIds, activeEdgeIds: edgeIds }),

  executionSteps: [],
  setExecutionSteps: (s) =>
    set({ executionSteps: s, currentStep: 0, activeNodeIds: [], activeEdgeIds: [] }),
  currentStep: 0,
  setCurrentStep: (i) => set({ currentStep: i }),
  isPlaying: false,
  playSpeed: 1,
  play: () => {
    const { executionSteps, currentStep } = get()
    if (!executionSteps.length) return
    // If at end, reset before playing
    if (currentStep >= executionSteps.length) {
      set({ currentStep: 0, isPlaying: true, activeNodeIds: [], activeEdgeIds: [] })
    } else {
      set({ isPlaying: true })
    }
  },
  pause: () => set({ isPlaying: false }),
  step: () => {
    const { currentStep, executionSteps } = get()
    if (currentStep < executionSteps.length) {
      set({ currentStep: currentStep + 1 })
    }
  },
  reset: () =>
    set((s) => {
      const idx: Record<string, number> = {}
      for (const name of Object.keys(s.variableValues)) idx[name] = 0
      return {
        currentStep: 0,
        isPlaying: false,
        activeNodeIds: [],
        activeEdgeIds: [],
        variableValueIndex: idx,
        currentLine: null,
      }
    }),
  setPlaySpeed: (s) => set({ playSpeed: s }),

  selectedNodeId: null,
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  hoveredNodeId: null,
  setHoveredNode: (id) => set({ hoveredNodeId: id }),

  sourceCode: SAMPLE_PYTHON,
  setSourceCode: (code) => set({ sourceCode: code }),

  isParsing: false,
  setIsParsing: (b) => set({ isParsing: b }),
  parseError: null,
  setParseError: (s) => set({ parseError: s }),

  pyodideReady: false,
  setPyodideReady: (b) => set({ pyodideReady: b }),

  pyodideMessage: 'Booting Python runtime…',
  setPyodideMessage: (m) => set({ pyodideMessage: m }),

  editorFocused: false,
  setEditorFocused: (b) => set({ editorFocused: b }),

  traceEvents: [],
  variableValues: {},
  variableValueIndex: {},
  setTrace: (events) => {
    const values: Record<string, string[]> = {}
    for (const ev of events) {
      if (!values[ev.name]) values[ev.name] = []
      values[ev.name]!.push(ev.value)
    }
    const indexes: Record<string, number> = {}
    for (const name of Object.keys(values)) indexes[name] = 0
    set({ traceEvents: events, variableValues: values, variableValueIndex: indexes })
  },
  bumpVariableValue: (name) =>
    set((s) => {
      const list = s.variableValues[name]
      if (!list || list.length === 0) return s
      const cur = s.variableValueIndex[name] ?? 0
      if (cur >= list.length - 1) return s
      return { variableValueIndex: { ...s.variableValueIndex, [name]: cur + 1 } }
    }),
  resetVariableValues: () =>
    set((s) => {
      const reset: Record<string, number> = {}
      for (const name of Object.keys(s.variableValues)) reset[name] = 0
      return { variableValueIndex: reset }
    }),

  currentLine: null,
  setCurrentLine: (line) => set({ currentLine: line }),

  focusedNodeId: null,
  focusedRelatedIds: {},
  setFocusedNode: (id) =>
    set((s) => {
      if (!id) return { focusedNodeId: null, focusedRelatedIds: {} }
      const graph = s.graph
      if (!graph) return { focusedNodeId: id, focusedRelatedIds: { [id]: true } }
      const adj = new Map<string, Set<string>>()
      for (const e of graph.edges) {
        if (!adj.has(e.source)) adj.set(e.source, new Set())
        if (!adj.has(e.target)) adj.set(e.target, new Set())
        adj.get(e.source)!.add(e.target)
        adj.get(e.target)!.add(e.source)
      }
      const visited: Record<string, true> = { [id]: true }
      const queue: string[] = [id]
      while (queue.length) {
        const cur = queue.shift()!
        for (const nb of adj.get(cur) ?? []) {
          if (!visited[nb]) {
            visited[nb] = true
            queue.push(nb)
          }
        }
      }
      return { focusedNodeId: id, focusedRelatedIds: visited }
    }),

  currentExampleId: null,
  setCurrentExampleId: (id) => set({ currentExampleId: id }),

  examples: EXAMPLES,
}))
