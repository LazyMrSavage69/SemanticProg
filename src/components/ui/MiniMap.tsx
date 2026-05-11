import { useEffect, useRef } from 'react'
import { useSSPEStore } from '../../store/useSSPEStore'
import { NODE_COLORS } from '../scene/constants'
import { sceneRuntime } from '../scene/sceneRuntime'

/**
 * 2D top-down minimap, drawn into a regular DOM `<canvas>` overlay.
 *
 * Intentionally NOT inside the main R3F Canvas:
 *   - decouples it from main-scene framerate
 *   - it doesn't need PBR, bloom, instancing, or any of the heavy scene cost
 *   - draws at ~30Hz via requestAnimationFrame, well under main-scene budget
 *
 * Shows:
 *   - nodes as coloured dots, sized by type
 *   - camera frustum / position as a small triangle
 *   - selection / hover / focused subgraph highlighted
 *
 * Acts as both a navigation overlay (visual context for where the camera is)
 * and an at-a-glance map of the entire graph regardless of semantic zoom.
 */

const MAP_SIZE = 180
const PADDING = 12

export function MiniMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const graph = useSSPEStore((s) => s.graph)
  const selectedNodeId = useSSPEStore((s) => s.selectedNodeId)
  const hoveredNodeId = useSSPEStore((s) => s.hoveredNodeId)
  const focusedRelatedIds = useSSPEStore((s) => s.focusedRelatedIds)
  const focusedNodeId = useSSPEStore((s) => s.focusedNodeId)

  // Animation loop — recomputes the projection each frame using `sceneRuntime`
  // (camera pos + graph bounds). Cheap; just a small 2D canvas draw.
  useEffect(() => {
    let raf = 0
    let lastDraw = 0
    const FRAME_INTERVAL = 33 // ~30Hz

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - lastDraw < FRAME_INTERVAL) return
      lastDraw = t

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Background.
      ctx.fillStyle = 'rgba(5, 8, 16, 0.78)'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.45)'
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

      if (!graph || graph.nodes.length === 0) {
        ctx.fillStyle = 'rgba(201, 216, 240, 0.5)'
        ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
        ctx.textAlign = 'center'
        ctx.fillText('no graph yet', w / 2, h / 2)
        return
      }

      // Compute projection from world-space (X,Z plane) to canvas space.
      // Y in world ≈ vertical "altitude" — projecting onto XZ gives an
      // intuitive "looking down on the cave" view.
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const n of graph.nodes) {
        const { x, z } = n.position
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      const worldW = Math.max(maxX - minX, 1)
      const worldH = Math.max(maxZ - minZ, 1)
      const scaleW = (w - PADDING * 2) / worldW
      const scaleH = (h - PADDING * 2) / worldH
      const scale = Math.min(scaleW, scaleH)

      const project = (wx: number, wz: number): [number, number] => {
        const px = PADDING + (wx - minX) * scale
        const pz = PADDING + (wz - minZ) * scale
        return [px, pz]
      }

      const focusActive = focusedNodeId !== null

      // Edges first (faint).
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(124, 142, 178, 0.18)'
      ctx.beginPath()
      for (const e of graph.edges) {
        const s = graph.nodes.find((n) => n.id === e.source)
        const t = graph.nodes.find((n) => n.id === e.target)
        if (!s || !t) continue
        if (focusActive && !(focusedRelatedIds[e.source] && focusedRelatedIds[e.target])) continue
        const [sx, sz] = project(s.position.x, s.position.z)
        const [tx, tz] = project(t.position.x, t.position.z)
        ctx.moveTo(sx, sz)
        ctx.lineTo(tx, tz)
      }
      ctx.stroke()

      // Nodes on top.
      for (const n of graph.nodes) {
        const [px, pz] = project(n.position.x, n.position.z)
        const isSelected = n.id === selectedNodeId
        const isHovered = n.id === hoveredNodeId
        const isFocused = focusActive && focusedRelatedIds[n.id] === true
        const dimmed = focusActive && !isFocused

        // Size by importance: functions/recursion biggest, expressions smallest.
        const baseSize =
          n.type === 'function'
            ? 4
            : n.type === 'recursion'
            ? 3.5
            : n.type === 'loop' || n.type === 'condition'
            ? 3
            : 2

        const color = NODE_COLORS[n.type]
        ctx.fillStyle = dimmed ? hexWithAlpha(color, 0.25) : color
        ctx.beginPath()
        ctx.arc(px, pz, baseSize, 0, Math.PI * 2)
        ctx.fill()

        if (isSelected || isHovered) {
          ctx.strokeStyle = isSelected ? '#ffffff' : color
          ctx.lineWidth = isSelected ? 1.5 : 1
          ctx.beginPath()
          ctx.arc(px, pz, baseSize + 2, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // Camera marker.
      const camWX = sceneRuntime.cameraPos.x
      const camWZ = sceneRuntime.cameraPos.z
      const [cx, cz] = project(camWX, camWZ)
      ctx.fillStyle = '#7c3aed'
      ctx.beginPath()
      ctx.arc(cx, cz, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.4)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cz, 9, 0, Math.PI * 2)
      ctx.stroke()

      // Zoom-level chip in the corner.
      ctx.fillStyle = 'rgba(124, 58, 237, 0.8)'
      ctx.font = '9px ui-monospace, SFMono-Regular, monospace'
      ctx.textAlign = 'left'
      const labels = ['L0 · overview', 'L1 · flow', 'L2 · detail', 'L3 · trace']
      ctx.fillText(labels[sceneRuntime.zoomLevel] ?? '', 6, h - 6)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [graph, selectedNodeId, hoveredNodeId, focusedRelatedIds, focusedNodeId])

  return (
    <div
      className="
        absolute z-20 pointer-events-none
        bottom-2 right-2 lg:bottom-4 lg:right-4
        bg-surface/40 backdrop-blur-md rounded
        border border-border
      "
    >
      <canvas
        ref={canvasRef}
        width={MAP_SIZE}
        height={MAP_SIZE}
        style={{ display: 'block', width: MAP_SIZE, height: MAP_SIZE }}
        aria-label="Top-down minimap of the semantic graph"
      />
      <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-muted text-center border-t border-border">
        minimap
      </div>
    </div>
  )
}

/** Apply an alpha (0..1) to a `#rrggbb` hex colour, returning an `rgba(...)` string. */
function hexWithAlpha(hex: string, a: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
