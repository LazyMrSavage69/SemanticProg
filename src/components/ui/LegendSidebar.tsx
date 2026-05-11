import { useEffect, useState } from 'react'
import { NODE_COLORS, EDGE_COLORS, EDGE_DASHED } from '../scene/constants'
import type { EdgeType, NodeType } from '../../parser/types'

/** Match Tailwind's `lg` breakpoint. */
const LG_QUERY = '(min-width: 1024px)'

interface NodeLegendEntry {
  type: NodeType
  shape: 'box' | 'ring' | 'diamond' | 'hex' | 'icos' | 'sphere'
  python: string
  meaning: string
}

const NODE_LEGEND: NodeLegendEntry[] = [
  {
    type: 'function',
    shape: 'hex',
    python: 'def name(...)',
    meaning: 'Reusable code chamber. Calls flow in, results flow out.',
  },
  {
    type: 'loop',
    shape: 'ring',
    python: 'for / while',
    meaning: 'Repeats its body N times. Badge shows the count.',
  },
  {
    type: 'condition',
    shape: 'diamond',
    python: 'if / else',
    meaning: 'Picks YES (true) or NO (false). Diamond = decision.',
  },
  {
    type: 'variable',
    shape: 'box',
    python: 'x = value',
    meaning: 'Holds a value. Flashes when the value changes.',
  },
  {
    type: 'recursion',
    shape: 'icos',
    python: 'self call',
    meaning: 'A function calling itself. Spinning crimson core.',
  },
  {
    type: 'expression',
    shape: 'sphere',
    python: 'fn() / op',
    meaning: 'A small piece of work — usually a function call.',
  },
]

interface EdgeLegendEntry {
  type: EdgeType
  python: string
  meaning: string
}

const EDGE_LEGEND: EdgeLegendEntry[] = [
  { type: 'executes', python: 'parent → child', meaning: 'Order of execution.' },
  { type: 'controlsFlow', python: 'if branches', meaning: 'YES / NO branch from a condition.' },
  { type: 'calls', python: 'fn(args)', meaning: 'A call site invokes a function.' },
  { type: 'returns', python: 'return …', meaning: 'A function returns a value.' },
  { type: 'dependsOn', python: 'uses x', meaning: 'A statement reads a variable defined earlier.' },
]

function ShapePreview({ shape, color }: { shape: NodeLegendEntry['shape']; color: string }) {
  const glow = `0 0 8px ${color}, 0 0 14px ${color}66`
  switch (shape) {
    case 'box':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <rect
            x="4" y="4" width="16" height="16" rx="3"
            fill={color} fillOpacity="0.18"
            stroke={color} strokeWidth="1.6"
            style={{ filter: `drop-shadow(${glow})` }}
          />
          <rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke={color} strokeOpacity="0.5" strokeDasharray="2 2" />
        </svg>
      )
    case 'ring':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8" fill="none" stroke={color} strokeWidth="2"
            style={{ filter: `drop-shadow(${glow})` }} />
          <circle cx="12" cy="12" r="2" fill={color} />
        </svg>
      )
    case 'diamond':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <polygon points="12,3 21,12 12,21 3,12"
            fill={color} fillOpacity="0.18"
            stroke={color} strokeWidth="1.8"
            style={{ filter: `drop-shadow(${glow})` }} />
        </svg>
      )
    case 'hex':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <polygon points="12,3 20,7 20,17 12,21 4,17 4,7"
            fill={color} fillOpacity="0.2"
            stroke={color} strokeWidth="1.6"
            style={{ filter: `drop-shadow(${glow})` }} />
        </svg>
      )
    case 'icos':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <polygon points="12,3 22,9 18,21 6,21 2,9"
            fill={color} fillOpacity="0.18"
            stroke={color} strokeWidth="1.6"
            style={{ filter: `drop-shadow(${glow})` }} />
          <polygon points="12,8 17,11 15,17 9,17 7,11"
            fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="1.2" />
        </svg>
      )
    case 'sphere':
    default:
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="6"
            fill={color} fillOpacity="0.2"
            stroke={color} strokeWidth="1.6"
            style={{ filter: `drop-shadow(${glow})` }} />
        </svg>
      )
  }
}

function EdgePreview({ type }: { type: EdgeType }) {
  const color = EDGE_COLORS[type]
  const dashed = EDGE_DASHED[type]
  return (
    <svg width="32" height="12" viewBox="0 0 32 12" aria-hidden>
      <line
        x1="2" y1="6" x2="30" y2="6"
        stroke={color} strokeWidth="2"
        strokeDasharray={dashed ? '3 2' : undefined}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      />
    </svg>
  )
}

export function LegendSidebar() {
  // Default-open on desktop, default-closed on mobile/tablet to free up the scene.
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia(LG_QUERY).matches
  })

  // If the viewport crosses the lg breakpoint, mirror that into the open state.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(LG_QUERY)
    const handler = (e: MediaQueryListEvent) => setOpen(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-2 right-2 lg:top-4 lg:right-4 z-20 bg-surface/85 backdrop-blur-md border border-border rounded
          px-3 py-2 font-mono text-[11px] tracking-widest text-muted hover:text-text hover:border-text/40 transition-all"
        title="Show legend"
      >
        ◧ legend
      </button>
    )
  }

  return (
    <>
      {/* Mobile backdrop — tapping outside the drawer closes it */}
      <button
        type="button"
        aria-label="Close legend"
        onClick={() => setOpen(false)}
        className="lg:hidden absolute inset-0 z-10 bg-bg/40 backdrop-blur-sm cursor-default"
      />
      <aside
        className="
          absolute z-20
          inset-2 lg:inset-auto
          lg:top-4 lg:right-4 lg:bottom-4 lg:w-72
          bg-surface/95 lg:bg-surface/85 backdrop-blur-md border border-border rounded
          shadow-[0_0_24px_0_rgba(0,0,0,0.6)] flex flex-col overflow-hidden pointer-events-auto
        "
      >
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">legend</div>
          <div className="font-mono text-sm text-text">semantic shapes</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted hover:text-text font-mono text-xs px-2 py-1 -my-1 rounded hover:bg-bg/40"
          title="Hide legend"
        >
          ◨
        </button>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-4 text-[11px]">
        <section>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">nodes</div>
          <ul className="space-y-2">
            {NODE_LEGEND.map((entry) => {
              const color = NODE_COLORS[entry.type]
              return (
                <li
                  key={entry.type}
                  className="flex items-start gap-2 p-2 rounded border border-transparent hover:border-border hover:bg-bg/40 transition-all"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <ShapePreview shape={entry.shape} color={color} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-text" style={{ color }}>
                        {entry.type}
                      </span>
                      <code className="font-mono text-[10px] text-muted truncate">{entry.python}</code>
                    </div>
                    <div className="text-text/80 leading-snug mt-0.5">{entry.meaning}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">edges</div>
          <ul className="space-y-1.5">
            {EDGE_LEGEND.map((e) => {
              const color = EDGE_COLORS[e.type]
              return (
                <li key={e.type} className="flex items-start gap-2 px-1">
                  <div className="pt-1 flex-shrink-0">
                    <EdgePreview type={e.type} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono" style={{ color }}>
                        {e.type}
                      </span>
                      <code className="font-mono text-[10px] text-muted truncate">{e.python}</code>
                    </div>
                    <div className="text-text/75 leading-snug">{e.meaning}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="text-text/70 leading-snug border-t border-border pt-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">
            interaction
          </div>
          <ul className="space-y-1">
            <li>· <span className="text-text">drag</span> orbits the camera</li>
            <li>· <span className="text-text">click</span> a node to select + jump editor</li>
            <li>· <span className="text-text">hover</span> a node for plain-language help</li>
            <li>· <span className="text-text">focus</span> button isolates a sub-graph</li>
          </ul>
        </section>
      </div>
      </aside>
    </>
  )
}
