import { useEffect } from 'react'
import { CodePanel } from './components/ui/CodePanel'
import { ControlPanel } from './components/ui/ControlPanel'
import { InfoPanel } from './components/ui/InfoPanel'
import { LegendSidebar } from './components/ui/LegendSidebar'
import { LoadingScreen } from './components/ui/LoadingScreen'
import { SSPEScene } from './components/scene/SSPEScene'
import { useSSPEStore } from './store/useSSPEStore'

function App() {
  const isParsing = useSSPEStore((s) => s.isParsing)
  const graph = useSSPEStore((s) => s.graph)
  const pyodideReady = useSSPEStore((s) => s.pyodideReady)
  const pyodideMessage = useSSPEStore((s) => s.pyodideMessage)
  const focusedNodeId = useSSPEStore((s) => s.focusedNodeId)
  const setFocusedNode = useSSPEStore((s) => s.setFocusedNode)
  const currentExampleId = useSSPEStore((s) => s.currentExampleId)
  const examples = useSSPEStore((s) => s.examples)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target && target.closest('canvas')) e.preventDefault()
    }
    window.addEventListener('contextmenu', handler)
    return () => window.removeEventListener('contextmenu', handler)
  }, [])

  const activeExample = examples.find((ex) => ex.id === currentExampleId) ?? null

  return (
    <div className="w-screen h-[100dvh] flex flex-col bg-bg text-text font-sans select-none">
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <aside
          className="
            w-full h-[44vh] min-h-[260px] max-h-[60vh] flex-shrink-0
            border-b border-border
            lg:h-full lg:max-h-none lg:w-[28%] lg:min-w-[320px] lg:max-w-[600px] lg:border-b-0 lg:border-r
          "
        >
          <CodePanel />
        </aside>
        <main className="flex-1 min-h-0 relative bg-bg overflow-hidden">
          <SSPEScene />

          <SceneHud
            isParsing={isParsing}
            hasGraph={!!graph}
            nodeCount={graph?.nodes.length ?? 0}
            edgeCount={graph?.edges.length ?? 0}
            example={activeExample?.title ?? null}
            description={activeExample?.description ?? null}
          />

          {focusedNodeId && (
            <div className="absolute top-2 left-2 lg:top-4 lg:left-4 z-20 mt-14 lg:mt-16 pointer-events-auto">
              <button
                type="button"
                onClick={() => setFocusedNode(null)}
                className="bg-surface/85 backdrop-blur-md border border-function/50 text-function rounded
                  px-3 py-1.5 font-mono text-[11px] hover:border-function transition-all"
              >
                ✕ exit focus
              </button>
            </div>
          )}

          <InfoPanel />
          <LegendSidebar />

          <LoadingScreen
            visible={!pyodideReady}
            workerMessage={pyodideMessage}
            variant="pyodide"
          />
        </main>
      </div>
      <ControlPanel />
    </div>
  )
}

interface SceneHudProps {
  isParsing: boolean
  hasGraph: boolean
  nodeCount: number
  edgeCount: number
  example: string | null
  description: string | null
}

function SceneHud({ isParsing, hasGraph, nodeCount, edgeCount, example, description }: SceneHudProps) {
  return (
    <>
      {/* Top-left title chip — compact on mobile, fuller on desktop */}
      <div className="absolute top-2 left-2 lg:top-4 lg:left-4 pointer-events-none max-w-[60vw] lg:max-w-[420px]">
        <div className="bg-surface/70 backdrop-blur-md border border-border rounded px-2 py-1.5 lg:px-3 lg:py-2">
          <div className="hidden sm:block font-mono text-[10px] uppercase tracking-widest text-muted">
            semantic spatial programming engine
          </div>
          <div className="sm:hidden font-mono text-[10px] uppercase tracking-widest text-muted">
            sspe
          </div>
          <div className="font-mono text-[12px] lg:text-sm text-text">
            <span className="text-function">{nodeCount}</span>
            <span className="text-muted"> nodes · </span>
            <span className="text-variable">{edgeCount}</span>
            <span className="text-muted"> edges</span>
            {isParsing && (
              <span className="text-condition ml-2 animate-pulse">· re-mapping</span>
            )}
          </div>
          {example && (
            <div className="mt-1.5 pt-1.5 lg:mt-2 lg:pt-2 border-t border-border">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                step
              </div>
              <div className="font-mono text-[11px] lg:text-[12px] text-text truncate">{example}</div>
              {description && (
                <div className="hidden md:block font-sans text-[11px] text-text/70 leading-snug mt-1">
                  {description}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!hasGraph && !isParsing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4">
          <div className="bg-surface/80 backdrop-blur-md border border-border rounded px-4 py-3 lg:px-6 lg:py-4 font-mono text-xs lg:text-sm text-center">
            type or pick an example to build the world
          </div>
        </div>
      )}
    </>
  )
}

export default App
