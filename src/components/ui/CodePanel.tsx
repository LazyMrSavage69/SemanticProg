import { useEffect, useMemo, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useSSPEStore } from '../../store/useSSPEStore'
import { getPyodideClient } from '../../parser/pyodideLoader'
import { parseAndRender } from '../../parser/parsePipeline'
import {
  highlightExecutionLine,
  highlightSelectionLine,
  registerEditor,
  unregisterEditor,
} from '../../utils/editorBridge'

const AUTO_PARSE_DEBOUNCE_MS = 800

export function CodePanel() {
  const sourceCode = useSSPEStore((s) => s.sourceCode)
  const setSourceCode = useSSPEStore((s) => s.setSourceCode)
  const isParsing = useSSPEStore((s) => s.isParsing)
  const parseError = useSSPEStore((s) => s.parseError)
  const pyodideReady = useSSPEStore((s) => s.pyodideReady)
  const setPyodideReady = useSSPEStore((s) => s.setPyodideReady)
  const setPyodideMessage = useSSPEStore((s) => s.setPyodideMessage)
  const pyodideMessage = useSSPEStore((s) => s.pyodideMessage)
  const examples = useSSPEStore((s) => s.examples)
  const currentExampleId = useSSPEStore((s) => s.currentExampleId)
  const setCurrentExampleId = useSSPEStore((s) => s.setCurrentExampleId)
  const currentLine = useSSPEStore((s) => s.currentLine)
  const selectedNodeId = useSSPEStore((s) => s.selectedNodeId)
  const graph = useSSPEStore((s) => s.graph)

  const debounceRef = useRef<number | null>(null)
  const lastParsedRef = useRef<string>(sourceCode)

  // ─── Pyodide bring-up ────────────────────────────────────────────────────
  useEffect(() => {
    const client = getPyodideClient()
    const off = client.onProgress((m) => setPyodideMessage(m))
    client.init().then(
      () => {
        setPyodideReady(true)
        setPyodideMessage('Ready')
        const { graph: existingGraph, sourceCode: latest } = useSSPEStore.getState()
        if (!existingGraph) void parseAndRender(latest)
      },
      (err: Error) => setPyodideMessage(`Failed: ${err.message}`),
    )
    return () => {
      off()
    }
  }, [setPyodideReady, setPyodideMessage])

  // ─── Auto-parse with debounce ───────────────────────────────────────────
  useEffect(() => {
    if (!pyodideReady) return
    if (sourceCode === lastParsedRef.current) return
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      lastParsedRef.current = sourceCode
      void parseAndRender(sourceCode)
    }, AUTO_PARSE_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [sourceCode, pyodideReady])

  // ─── Execution line highlight ───────────────────────────────────────────
  useEffect(() => {
    highlightExecutionLine(currentLine)
  }, [currentLine])

  // ─── Selected node → highlight + reveal ─────────────────────────────────
  useEffect(() => {
    if (!graph || !selectedNodeId) {
      highlightSelectionLine(null)
      return
    }
    const node = graph.nodes.find((n) => n.id === selectedNodeId)
    const lineno = node && typeof node.metadata.lineno === 'number' ? node.metadata.lineno : null
    highlightSelectionLine(lineno)
  }, [selectedNodeId, graph])

  // ─── Editor mount ───────────────────────────────────────────────────────
  const handleMount: OnMount = (editor, monaco) => {
    registerEditor(editor, monaco)
    const { setEditorFocused } = useSSPEStore.getState()
    editor.onDidFocusEditorText(() => setEditorFocused(true))
    editor.onDidBlurEditorText(() => setEditorFocused(false))
  }

  useEffect(() => () => unregisterEditor(), [])

  // ─── Examples picker ────────────────────────────────────────────────────
  const groupedExamples = useMemo(() => {
    return examples.map((ex) => ({ id: ex.id, title: ex.title, description: ex.description, code: ex.code }))
  }, [examples])

  const handlePickExample = (exampleId: string) => {
    const ex = examples.find((e) => e.id === exampleId)
    if (!ex) return
    setCurrentExampleId(ex.id)
    setSourceCode(ex.code)
    lastParsedRef.current = '' // force re-parse
  }

  const handleManualParse = () => {
    lastParsedRef.current = sourceCode
    void parseAndRender(sourceCode)
  }

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-function shadow-[0_0_8px_#10b981]" />
          <h2 className="font-mono text-sm tracking-wider text-text">SSPE / source</h2>
        </div>
        <div className="text-[11px] text-muted font-mono">python · live</div>
      </div>

      {/* Examples picker */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">example</span>
        <select
          value={currentExampleId ?? ''}
          onChange={(e) => handlePickExample(e.target.value)}
          className="flex-1 bg-bg border border-border rounded px-2 py-1.5 text-text font-mono text-[11px]
            focus:outline-none focus:border-function/60 hover:border-text/40 transition-colors"
        >
          <option value="" disabled>
            choose a learning step…
          </option>
          {groupedExamples.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0">
        <Editor
          value={sourceCode}
          onChange={(v) => setSourceCode(v ?? '')}
          language="python"
          theme="vs-dark"
          onMount={handleMount}
          options={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13,
            lineNumbers: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'gutter',
            roundedSelection: false,
            padding: { top: 12, bottom: 12 },
            tabSize: 4,
            insertSpaces: true,
            glyphMargin: true,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
      </div>

      {parseError && (
        <div className="px-3 py-2 bg-recursion/15 border-t border-recursion/40 text-recursion font-mono text-xs whitespace-pre-wrap max-h-32 overflow-auto">
          <div className="font-semibold mb-1">parse error</div>
          {parseError}
        </div>
      )}

      <div className="px-3 py-3 border-t border-border flex items-center gap-3">
        <button
          type="button"
          onClick={handleManualParse}
          disabled={isParsing || !pyodideReady}
          className="flex-1 font-mono text-sm tracking-wider px-4 py-2 rounded
            bg-function/15 hover:bg-function/25 disabled:opacity-40 disabled:cursor-not-allowed
            text-function border border-function/40 hover:border-function/70 transition-all
            shadow-[0_0_0_0_rgba(16,185,129,0)] hover:shadow-[0_0_16px_0_rgba(16,185,129,0.35)]"
        >
          {isParsing ? 'parsing…' : pyodideReady ? '▶ re-render' : 'loading runtime…'}
        </button>
      </div>

      <div className="px-3 py-2 text-[10px] font-mono text-muted border-t border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              pyodideReady ? 'bg-function' : 'bg-condition animate-pulse'
            }`}
          />
          <span>{pyodideReady ? 'auto-parse on' : 'pyodide'}</span>
          {isParsing && <span className="text-condition animate-pulse">· re-mapping…</span>}
        </div>
        <div className="truncate max-w-[60%] text-right">{pyodideMessage}</div>
      </div>
    </div>
  )
}
