import PyodideWorker from './pyodide.worker.ts?worker'

type WorkerOutMessage =
  | { type: 'progress'; message: string }
  | { type: 'ready' }
  | { type: 'parsed'; id: string; ast: unknown; trace: unknown }
  | { type: 'error'; id?: string; message: string }

export interface ParseResult {
  ast: unknown
  trace: unknown
}

type Pending = {
  resolve: (result: ParseResult) => void
  reject: (err: Error) => void
}

class PyodideClient {
  private worker: Worker | null = null
  private readyPromise: Promise<void> | null = null
  private pending = new Map<string, Pending>()
  private progressListeners = new Set<(message: string) => void>()
  private nextId = 0

  ensureWorker(): Worker {
    if (this.worker) return this.worker
    const w = new PyodideWorker()
    w.onmessage = (e: MessageEvent<WorkerOutMessage>) => this.handleMessage(e.data)
    w.onerror = (e) => {
      const msg = e.message || 'Pyodide worker error'
      for (const p of this.pending.values()) p.reject(new Error(msg))
      this.pending.clear()
    }
    this.worker = w
    return w
  }

  private handleMessage(msg: WorkerOutMessage) {
    if (msg.type === 'progress') {
      for (const l of this.progressListeners) l(msg.message)
      return
    }
    if (msg.type === 'ready') {
      // Resolved via readyPromise wrapper below.
      return
    }
    if (msg.type === 'parsed') {
      const pending = this.pending.get(msg.id)
      if (pending) {
        pending.resolve({ ast: msg.ast, trace: msg.trace })
        this.pending.delete(msg.id)
      }
      return
    }
    if (msg.type === 'error') {
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id)
        if (pending) {
          pending.reject(new Error(msg.message))
          this.pending.delete(msg.id)
          return
        }
      }
      // Fallback: surface as init error
      this.readyPromise = Promise.reject(new Error(msg.message))
    }
  }

  init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise
    const w = this.ensureWorker()
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const handler = (e: MessageEvent<WorkerOutMessage>) => {
        if (e.data.type === 'ready') {
          w.removeEventListener('message', handler)
          resolve()
        } else if (e.data.type === 'error' && e.data.id === undefined) {
          w.removeEventListener('message', handler)
          reject(new Error(e.data.message))
        }
      }
      w.addEventListener('message', handler)
      w.postMessage({ type: 'init' })
    })
    return this.readyPromise
  }

  parse(code: string): Promise<ParseResult> {
    const w = this.ensureWorker()
    // Trigger init lazily; parse will still queue on worker side.
    void this.init()
    const id = String(this.nextId++)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ type: 'parse', id, code })
    })
  }

  onProgress(listener: (message: string) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }
}

let singleton: PyodideClient | null = null

export function getPyodideClient(): PyodideClient {
  if (!singleton) singleton = new PyodideClient()
  return singleton
}
