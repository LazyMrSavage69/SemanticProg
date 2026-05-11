import { astToGraph } from './astToGraph'
import { forceLayout3D } from '../layout/forceLayout3D'
import { buildExecutionSteps } from '../execution/executionSimulator'
import { getPyodideClient } from './pyodideLoader'
import { useSSPEStore } from '../store/useSSPEStore'
import type { ExecutionStep, SemanticGraph, TraceEvent } from './types'

interface CacheEntry {
  source: string
  graph: SemanticGraph
  steps: ExecutionStep[]
  trace: TraceEvent[]
}

const cache = new Map<string, CacheEntry>()
const CACHE_LIMIT = 16

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function hashSource(code: string): string {
  // Cheap hash + length, robust enough for an in-memory cache.
  return `${code.length}:${fnv1a(code)}`
}

function applyCacheEntry(entry: CacheEntry): void {
  const store = useSSPEStore.getState()
  store.setGraph(entry.graph)
  store.setExecutionSteps(entry.steps)
  store.setTrace(entry.trace)
  store.setCurrentLine(null)
}

function pruneCache(): void {
  while (cache.size > CACHE_LIMIT) {
    const firstKey = cache.keys().next().value
    if (firstKey === undefined) break
    cache.delete(firstKey)
  }
}

/** Coerce the raw worker trace payload into a typed TraceEvent[]. */
function normaliseTrace(raw: unknown): TraceEvent[] {
  if (!Array.isArray(raw)) return []
  const out: TraceEvent[] = []
  for (const ev of raw) {
    if (!ev || typeof ev !== 'object') continue
    const r = ev as { line?: unknown; name?: unknown; value?: unknown }
    if (typeof r.line === 'number' && typeof r.name === 'string' && typeof r.value === 'string') {
      out.push({ line: r.line, name: r.name, value: r.value })
    }
  }
  return out
}

export async function parseAndRender(code: string): Promise<void> {
  const store = useSSPEStore.getState()
  const key = hashSource(code)

  // Cache hit → re-apply graph instantly without touching Pyodide.
  const hit = cache.get(key)
  if (hit && hit.source === code) {
    store.setIsParsing(false)
    store.setParseError(null)
    applyCacheEntry(hit)
    return
  }

  store.setIsParsing(true)
  store.setParseError(null)
  try {
    const { ast, trace } = await getPyodideClient().parse(code)
    const graph = astToGraph(ast)
    forceLayout3D(graph)
    const steps = buildExecutionSteps(graph)
    const traceEvents = normaliseTrace(trace)

    const entry: CacheEntry = { source: code, graph, steps, trace: traceEvents }
    cache.set(key, entry)
    pruneCache()

    applyCacheEntry(entry)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.setParseError(message)
  } finally {
    store.setIsParsing(false)
  }
}
