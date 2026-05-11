import { useMemo } from 'react'
import { useSSPEStore } from '../../store/useSSPEStore'
import { NODE_COLORS } from '../scene/constants'

export function InfoPanel() {
  const graph = useSSPEStore((s) => s.graph)
  const selectedNodeId = useSSPEStore((s) => s.selectedNodeId)
  const setSelectedNode = useSSPEStore((s) => s.setSelectedNode)
  const focusedNodeId = useSSPEStore((s) => s.focusedNodeId)
  const setFocusedNode = useSSPEStore((s) => s.setFocusedNode)

  const selectedNode = useMemo(() => {
    if (!graph || !selectedNodeId) return null
    return graph.nodes.find((n) => n.id === selectedNodeId) ?? null
  }, [graph, selectedNodeId])

  if (!selectedNode) return null

  const color = NODE_COLORS[selectedNode.type]
  const isFocused = focusedNodeId === selectedNode.id
  const lineno =
    typeof selectedNode.metadata.lineno === 'number' ? selectedNode.metadata.lineno : null

  // Position in top-right of the scene area. On lg+ we offset to avoid the
  // legend sidebar (which only shows there); on mobile the legend defaults
  // closed, so we can hug the right edge.
  return (
    <div
      className="absolute z-10 pointer-events-auto overflow-auto
        top-2 right-2 left-2 lg:left-auto lg:top-4 lg:right-[19rem]
        max-h-[55vh] lg:max-h-[60vh] lg:w-72
        bg-surface/95 backdrop-blur-md border border-border rounded
        shadow-[0_0_24px_0_rgba(0,0,0,0.6)]"
    >
      <div
        className="px-4 py-3 flex items-center justify-between border-b border-border"
        style={{ boxShadow: `inset 0 -1px 0 ${color}40` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: color, boxShadow: `0 0 10px ${color}` }}
          />
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
              {selectedNode.type}
            </div>
            <div className="font-mono text-sm text-text truncate" title={selectedNode.label}>
              {selectedNode.label}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSelectedNode(null)}
          className="text-muted hover:text-text font-mono text-xs px-1"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="p-3 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setFocusedNode(isFocused ? null : selectedNode.id)}
          className={`flex-1 font-mono text-[11px] px-3 py-2 rounded border transition-all
            ${
              isFocused
                ? 'bg-function/20 border-function/60 text-function'
                : 'bg-transparent border-border text-muted hover:text-text hover:border-text/40'
            }
          `}
        >
          {isFocused ? '✓ focused' : '◉ focus subgraph'}
        </button>
        {lineno && (
          <div className="font-mono text-[11px] px-3 py-2 rounded border border-border bg-bg/40 text-muted">
            line {lineno}
          </div>
        )}
      </div>

      <div className="p-4 font-mono text-[11px] text-text space-y-2">
        {Object.entries(selectedNode.metadata).length > 0 && (
          <>
            <div className="text-muted text-[10px] uppercase tracking-widest">metadata</div>
            <pre className="text-[11px] whitespace-pre-wrap break-words text-text/90">
              {JSON.stringify(selectedNode.metadata, null, 2)}
            </pre>
          </>
        )}

        <div className="text-muted text-[10px] uppercase tracking-widest pt-2">position</div>
        <div className="text-text/80">
          x:{selectedNode.position.x.toFixed(2)} y:{selectedNode.position.y.toFixed(2)} z:
          {selectedNode.position.z.toFixed(2)}
        </div>

        <div className="text-muted text-[10px] uppercase tracking-widest pt-2">id</div>
        <div className="break-all text-text/70">{selectedNode.id}</div>
      </div>
    </div>
  )
}
