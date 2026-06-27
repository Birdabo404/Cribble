'use client'

import { useEffect, useRef } from 'react'

interface RadarDisplayProps {
  status: 'connected' | 'inactive' | 'missing' | 'unknown'
}

const COLORS = {
  connected: { primary: '#02fe01', r: 2,   g: 254, b: 1   },
  inactive:  { primary: '#fbbf24', r: 251, g: 191, b: 36  },
  missing:   { primary: '#ef4444', r: 239, g: 68,  b: 68  },
  unknown:   { primary: '#6b7280', r: 107, g: 114, b: 128 },
}

export default function RadarDisplay({ status }: RadarDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)
  const angleRef  = useRef<number>(0)

  const col = COLORS[status] ?? COLORS.unknown
  const isLive = status === 'connected'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const SIZE = 200
    canvas.width  = SIZE
    canvas.height = SIZE
    const cx = SIZE / 2
    const cy = SIZE / 2
    const R  = SIZE / 2 - 4   // outer radius of radar

    // Blip positions (static, seeded by status so they look intentional)
    const blips: { a: number; d: number; alpha: number }[] =
      status === 'connected'
        ? [
            { a: 0.9,  d: 0.42, alpha: 1.0 },
            { a: 2.4,  d: 0.71, alpha: 0.7 },
            { a: 4.1,  d: 0.55, alpha: 0.85 },
          ]
        : []

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE)

      // ── Background circle ──
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},0.03)`
      ctx.fill()

      // ── Concentric rings ──
      ;[0.25, 0.5, 0.75, 1].forEach(f => {
        ctx.beginPath()
        ctx.arc(cx, cy, R * f, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},0.12)`
        ctx.lineWidth = 0.8
        ctx.stroke()
      })

      // ── Crosshairs ──
      ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},0.10)`
      ctx.lineWidth = 0.8
      ;[[cx, cy - R, cx, cy + R], [cx - R, cy, cx + R, cy]].forEach(([x1,y1,x2,y2]) => {
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      })

      // ── Diagonal tick marks at 45° ──
      ;[45, 135, 225, 315].forEach(deg => {
        const rad = (deg * Math.PI) / 180
        const x1 = cx + Math.cos(rad) * R * 0.92
        const y1 = cy + Math.sin(rad) * R * 0.92
        const x2 = cx + Math.cos(rad) * R
        const y2 = cy + Math.sin(rad) * R
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},0.20)`
        ctx.lineWidth = 1
        ctx.stroke()
      })

      if (isLive) {
        // ── Sweep gradient (pie slice) ──
        const sweepAngle = Math.PI * 0.65

        // Clip to circle
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx, cy, R - 1, 0, Math.PI * 2)
        ctx.clip()

        // Draw sweep as filled arc with gradient opacity
        const steps = 40
        for (let i = 0; i < steps; i++) {
          const t    = i / steps
          const a0   = angleRef.current - sweepAngle * (1 - t)
          const a1   = angleRef.current - sweepAngle * (1 - (i + 1) / steps)
          const alpha = t * 0.18
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, R - 1, a0, a1)
          ctx.closePath()
          ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${alpha.toFixed(3)})`
          ctx.fill()
        }

        // Leading edge line
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(
          cx + Math.cos(angleRef.current) * (R - 1),
          cy + Math.sin(angleRef.current) * (R - 1)
        )
        ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},0.85)`
        ctx.lineWidth = 1.5
        ctx.stroke()

        ctx.restore()

        // ── Blips — light up as sweep passes ──
        blips.forEach(b => {
          const bx = cx + Math.cos(b.a) * R * b.d
          const by = cy + Math.sin(b.a) * R * b.d

          // How far behind the sweep angle is this blip?
          let diff = ((angleRef.current - b.a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
          const fade = diff < sweepAngle ? 1 - diff / sweepAngle : 0
          if (fade <= 0) return

          const alpha = b.alpha * fade
          ctx.beginPath()
          ctx.arc(bx, by, 3.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},${alpha})`
          ctx.fill()

          // Blip glow
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, 12)
          g.addColorStop(0, `rgba(${col.r},${col.g},${col.b},${(alpha * 0.5).toFixed(3)})`)
          g.addColorStop(1, `rgba(${col.r},${col.g},${col.b},0)`)
          ctx.beginPath()
          ctx.arc(bx, by, 12, 0, Math.PI * 2)
          ctx.fillStyle = g
          ctx.fill()
        })

        // Advance angle
        angleRef.current += 0.022
      }

      // ── Outer ring border ──
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},0.25)`
      ctx.lineWidth = 1
      ctx.stroke()

      // ── Center dot ──
      ctx.beginPath()
      ctx.arc(cx, cy, 3, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},0.7)`
      ctx.fill()

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [status])

  return (
    <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
      {/* CSS pulse rings — layered behind canvas */}
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 200,
            height: 200,
            border: `1px solid rgba(${col.r},${col.g},${col.b},${isLive ? 0.18 : 0.07})`,
            borderRadius: '50%',
            animation: isLive
              ? `radar-ring-expand 3s ease-out ${i * 1}s infinite`
              : 'none',
            opacity: 0,
          }}
        />
      ))}
      <canvas
        ref={canvasRef}
        style={{ width: 200, height: 200, display: 'block' }}
      />
    </div>
  )
}
