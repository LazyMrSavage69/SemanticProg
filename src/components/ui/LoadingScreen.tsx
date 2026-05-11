import { useEffect, useState } from 'react'

interface LoadingScreenProps {
  visible: boolean
  workerMessage: string
  variant: 'pyodide' | 'parsing'
}

const PYODIDE_PHASES = [
  { label: 'Waking up Python…', match: ['Fetching', 'Booting'], min: 0 },
  { label: 'Loading cave systems…', match: ['Initialising', 'Loading'], min: 25 },
  { label: 'Summoning execution engine…', match: ['Preparing'], min: 65 },
  { label: 'Preparing semantic world…', match: ['Ready'], min: 90 },
]

function pickPhase(workerMessage: string) {
  const lower = workerMessage.toLowerCase()
  for (let i = PYODIDE_PHASES.length - 1; i >= 0; i--) {
    const phase = PYODIDE_PHASES[i]!
    if (phase.match.some((m) => lower.includes(m.toLowerCase()))) return phase
  }
  return PYODIDE_PHASES[0]!
}

export function LoadingScreen({ visible, workerMessage, variant }: LoadingScreenProps) {
  const [progress, setProgress] = useState(8)
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [tick, setTick] = useState(0)

  // Cycle through phases when no informative worker message yet.
  useEffect(() => {
    if (!visible) return
    const id = window.setInterval(() => setTick((t) => (t + 1) % 4), 1100)
    return () => window.clearInterval(id)
  }, [visible])

  // React to worker messages and update phase + progress.
  useEffect(() => {
    if (!visible) {
      setProgress(100)
      return
    }
    if (variant === 'pyodide') {
      const phase = pickPhase(workerMessage)
      const idx = PYODIDE_PHASES.indexOf(phase)
      setPhaseIndex(idx)
      // Estimate progress: phase.min + a slow drift up to next phase.min
      const next = PYODIDE_PHASES[idx + 1]?.min ?? 100
      setProgress((p) => {
        const target = phase.min + (next - phase.min) * 0.5
        return Math.max(p, Math.min(target, 95))
      })
    } else {
      // Parsing — just a quick indeterminate progress.
      setProgress((p) => Math.min(p + 6, 80))
    }
  }, [workerMessage, visible, variant])

  if (!visible) return null

  const phase = PYODIDE_PHASES[phaseIndex] ?? PYODIDE_PHASES[0]!
  const tickDots = '·'.repeat(tick + 1).padEnd(4, ' ')

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none px-3">
      <div className="bg-surface/90 backdrop-blur-md border border-border rounded-lg p-4 sm:p-6 w-full max-w-[420px]
        shadow-[0_0_48px_0_rgba(16,185,129,0.18)] pointer-events-auto">
        {/* Animated orb */}
        <div className="flex items-center gap-4 mb-4">
          <div className="relative w-12 h-12 flex-shrink-0">
            <div className="absolute inset-0 rounded-full bg-function/30 sspe-loading-orb" />
            <div className="absolute inset-2 rounded-full bg-function/60 sspe-loading-orb" style={{ animationDelay: '-0.4s' }} />
            <div className="absolute inset-4 rounded-full bg-function shadow-[0_0_16px_#10b981]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
              {variant === 'pyodide' ? 'sspe runtime' : 'parsing'}
            </div>
            <div className="font-mono text-sm text-text truncate">
              {variant === 'pyodide' ? phase.label : 'Mapping source into 3d space…'}
            </div>
          </div>
          <div className="font-mono text-[11px] text-muted tabular-nums w-10 text-right">
            {Math.round(progress)}%
          </div>
        </div>

        {/* Progress bar */}
        <div className="relative h-2 bg-border rounded overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-function via-variable to-loop transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
          {progress < 100 && <div className="sspe-shimmer" />}
        </div>

        {/* Phase log */}
        <ol className="mt-4 space-y-1 font-mono text-[11px]">
          {variant === 'pyodide' &&
            PYODIDE_PHASES.map((p, idx) => {
              const status = idx < phaseIndex ? 'done' : idx === phaseIndex ? 'now' : 'pending'
              return (
                <li
                  key={p.label}
                  className={
                    status === 'done'
                      ? 'text-function'
                      : status === 'now'
                      ? 'text-text'
                      : 'text-muted'
                  }
                >
                  <span className="inline-block w-4">
                    {status === 'done' ? '✓' : status === 'now' ? '▸' : '·'}
                  </span>
                  {p.label}
                  {status === 'now' && (
                    <span className="text-muted ml-1">{tickDots}</span>
                  )}
                </li>
              )
            })}
          {variant === 'parsing' && (
            <li className="text-text">
              <span className="inline-block w-4">▸</span>
              Re-mapping the cave
              <span className="text-muted ml-1">{tickDots}</span>
            </li>
          )}
        </ol>

        <div className="mt-3 font-mono text-[10px] text-muted truncate">
          {variant === 'pyodide' ? `runtime: ${workerMessage}` : 'one moment…'}
        </div>
      </div>
    </div>
  )
}
