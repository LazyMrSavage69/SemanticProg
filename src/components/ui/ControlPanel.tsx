import { useSSPEStore } from '../../store/useSSPEStore'

export function ControlPanel() {
  const isPlaying = useSSPEStore((s) => s.isPlaying)
  const currentStep = useSSPEStore((s) => s.currentStep)
  const executionSteps = useSSPEStore((s) => s.executionSteps)
  const playSpeed = useSSPEStore((s) => s.playSpeed)
  const play = useSSPEStore((s) => s.play)
  const pause = useSSPEStore((s) => s.pause)
  const reset = useSSPEStore((s) => s.reset)
  const step = useSSPEStore((s) => s.step)
  const setPlaySpeed = useSSPEStore((s) => s.setPlaySpeed)
  const setCurrentStep = useSSPEStore((s) => s.setCurrentStep)
  const setActive = useSSPEStore((s) => s.setActive)

  const total = executionSteps.length
  const progress = total > 0 ? Math.min(currentStep / total, 1) : 0
  const hasSteps = total > 0

  const handleSkipBack = () => {
    pause()
    setCurrentStep(Math.max(0, currentStep - 5))
    setActive([], [])
  }
  const handleSkipForward = () => {
    pause()
    setCurrentStep(Math.min(total, currentStep + 5))
  }

  return (
    <div
      className="
        border-t border-border bg-surface/95 backdrop-blur-md
        flex flex-wrap items-center gap-2 sm:gap-3 lg:gap-4
        px-2 py-2 sm:px-3 lg:px-4 lg:h-14 lg:py-0 lg:flex-nowrap
      "
    >
      {/* Buttons row */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <ControlButton onClick={handleSkipBack} disabled={!hasSteps} label="◀◀" title="Step back 5" />
        <ControlButton
          onClick={() => (isPlaying ? pause() : play())}
          disabled={!hasSteps}
          label={isPlaying ? '❚❚' : '▶'}
          title={isPlaying ? 'Pause' : 'Play'}
          accent
        />
        <ControlButton
          onClick={() => {
            pause()
            step()
          }}
          disabled={!hasSteps}
          label="▶▶"
          title="Step forward 1"
        />
        <ControlButton onClick={handleSkipForward} disabled={!hasSteps} label="⏭" title="Skip 5" />
        <ControlButton
          onClick={() => reset()}
          disabled={!hasSteps}
          label="↺"
          title="Reset"
        />
      </div>

      {/* Progress + step counter — claims full width on mobile, shares row on lg+ */}
      <div className="flex-1 flex items-center gap-3 min-w-[140px] order-3 sm:order-2">
        <div className="flex-1 h-1.5 bg-border rounded relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-function via-variable to-loop transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="font-mono text-[10px] sm:text-[11px] text-muted whitespace-nowrap tabular-nums">
          {currentStep.toString().padStart(3, '0')}/{total.toString().padStart(3, '0')}
        </div>
      </div>

      {/* Speed slider */}
      <div className="flex items-center gap-2 min-w-[140px] sm:min-w-[160px] lg:min-w-[180px] order-2 sm:order-3">
        <span className="font-mono text-[10px] sm:text-[11px] text-muted">speed</span>
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.25}
          value={playSpeed}
          onChange={(e) => setPlaySpeed(parseFloat(e.target.value))}
          className="flex-1 accent-function min-w-0"
        />
        <span className="font-mono text-[10px] sm:text-[11px] text-text w-10 text-right tabular-nums">
          {playSpeed.toFixed(2)}x
        </span>
      </div>
    </div>
  )
}

interface ControlButtonProps {
  onClick: () => void
  disabled?: boolean
  label: string
  title: string
  accent?: boolean
}

function ControlButton({ onClick, disabled, label, title, accent }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        w-8 h-8 sm:w-9 sm:h-9 rounded flex items-center justify-center
        font-mono text-xs sm:text-sm border transition-all
        ${
          accent
            ? 'bg-function/15 border-function/40 text-function hover:bg-function/25 hover:border-function/70'
            : 'bg-transparent border-border text-text hover:border-text/40 hover:text-text'
        }
        disabled:opacity-30 disabled:cursor-not-allowed
      `}
    >
      {label}
    </button>
  )
}
