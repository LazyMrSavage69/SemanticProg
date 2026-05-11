/// <reference lib="webworker" />

/**
 * Pyodide AST worker.
 *
 * Loads Pyodide from the official CDN inside a module web-worker, exposes a
 * simple message protocol for parsing Python source into a JSON-serializable
 * AST dict and reporting load progress.
 *
 * Protocol:
 *   IN  { type: 'init' }                       -> outputs 'ready' or 'error'
 *   IN  { type: 'parse', id, code }            -> outputs 'parsed' or 'error'
 *   OUT { type: 'progress', message }
 *   OUT { type: 'ready' }
 *   OUT { type: 'parsed', id, ast }
 *   OUT { type: 'error', id?, message }
 */

const PYODIDE_VERSION = '0.29.4'
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

// Pyodide instance — typed loosely because we load it dynamically from CDN.
type PyodideAPI = {
  runPython: (code: string) => unknown
  runPythonAsync: (code: string) => Promise<unknown>
  globals: { set: (name: string, value: unknown) => void; get: (name: string) => unknown }
}

let pyodidePromise: Promise<PyodideAPI> | null = null

const PARSE_HELPER = `
import ast
import json
import sys
import io
import builtins

def _ast_to_dict(node):
    if isinstance(node, ast.AST):
        d = {'_type': type(node).__name__}
        for field, value in ast.iter_fields(node):
            d[field] = _ast_to_dict(value)
        for attr in ('lineno', 'col_offset', 'end_lineno', 'end_col_offset'):
            if hasattr(node, attr):
                v = getattr(node, attr)
                if v is not None:
                    d[attr] = v
        return d
    if isinstance(node, list):
        return [_ast_to_dict(x) for x in node]
    if isinstance(node, (str, int, float, bool)) or node is None:
        return node
    # Bytes, complex, etc. -> stringify
    return repr(node)

def _sspe_short_repr(value, max_len=60):
    try:
        rep = repr(value)
    except Exception:
        rep = '<unrepr>'
    if len(rep) > max_len:
        rep = rep[:max_len - 3] + '...'
    return rep

def _sspe_run_with_trace(source, max_events=2000, time_budget_ms=400):
    """Execute source under sys.settrace and capture variable mutations.

    Returns a list of dicts: {line, name, value}. Bails early if either
    max_events or the time budget is exceeded so a runaway loop never
    blocks the UI.
    """
    import time
    events = []
    seen = {}
    start = time.monotonic()
    deadline = start + (time_budget_ms / 1000.0)

    def tracer(frame, event, arg):
        if time.monotonic() > deadline:
            sys.settrace(None)
            return None
        if event != 'line' and event != 'return':
            return tracer
        try:
            line = frame.f_lineno
            scope = frame.f_locals
            for name, val in list(scope.items()):
                if name.startswith('_sspe') or name.startswith('__'):
                    continue
                if callable(val) and not isinstance(val, (int, float, str, bool, list, tuple, dict, set, type(None))):
                    continue
                rep = _sspe_short_repr(val)
                key = (id(scope), name)
                if seen.get(key) != rep:
                    seen[key] = rep
                    events.append({'line': line, 'name': name, 'value': rep})
                    if len(events) >= max_events:
                        sys.settrace(None)
                        return None
        except Exception:
            pass
        return tracer

    # Suppress stdout so print() doesn't pollute the worker console.
    old_stdout = sys.stdout
    sys.stdout = io.StringIO()
    try:
        compiled = compile(source, '<sspe>', 'exec')
        sys.settrace(tracer)
        try:
            exec(compiled, {'__name__': '__main__', '__builtins__': builtins})
        except Exception:
            pass
    except Exception:
        pass
    finally:
        sys.settrace(None)
        sys.stdout = old_stdout
    return events

def _sspe_parse(source):
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return json.dumps({'_error': True, 'message': str(e), 'lineno': e.lineno, 'offset': e.offset})
    trace = []
    try:
        trace = _sspe_run_with_trace(source)
    except Exception:
        trace = []
    return json.dumps({'_error': False, 'tree': _ast_to_dict(tree), 'trace': trace})
`

async function loadPyodideRuntime(): Promise<PyodideAPI> {
  if (pyodidePromise) return pyodidePromise
  pyodidePromise = (async () => {
    post({ type: 'progress', message: 'Fetching Pyodide runtime…' })
    // Dynamic import from CDN — `@vite-ignore` keeps Vite from trying to bundle it.
    const moduleUrl = `${PYODIDE_INDEX_URL}pyodide.mjs`
    const mod: { loadPyodide: (opts: { indexURL: string }) => Promise<PyodideAPI> } =
      await import(/* @vite-ignore */ moduleUrl)
    post({ type: 'progress', message: 'Initialising Python interpreter…' })
    const py = await mod.loadPyodide({ indexURL: PYODIDE_INDEX_URL })
    post({ type: 'progress', message: 'Preparing AST helper…' })
    await py.runPythonAsync(PARSE_HELPER)
    return py
  })()
  return pyodidePromise
}

interface InMessage {
  type: 'init' | 'parse'
  id?: string
  code?: string
}

type OutMessage =
  | { type: 'progress'; message: string }
  | { type: 'ready' }
  | { type: 'parsed'; id: string; ast: unknown; trace: unknown }
  | { type: 'error'; id?: string; message: string }

function post(msg: OutMessage) {
  ;(self as DedicatedWorkerGlobalScope).postMessage(msg)
}

;(self as DedicatedWorkerGlobalScope).onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      await loadPyodideRuntime()
      post({ type: 'ready' })
      return
    }
    if (msg.type === 'parse') {
      const id = msg.id ?? ''
      const code = msg.code ?? ''
      const py = await loadPyodideRuntime()
      py.globals.set('sspe_source', code)
      const resultJson = (await py.runPythonAsync('_sspe_parse(sspe_source)')) as string
      const parsed = JSON.parse(resultJson)
      if (parsed._error) {
        post({ type: 'error', id, message: parsed.message ?? 'Python syntax error' })
        return
      }
      post({ type: 'parsed', id, ast: parsed.tree, trace: parsed.trace ?? [] })
      return
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    post({ type: 'error', id: msg.id, message })
  }
}
