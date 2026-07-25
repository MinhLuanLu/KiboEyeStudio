export interface DisplayMaskOptions {
  size: number
  showBezel: boolean
}

/** Clears the canvas to black and clips all subsequent drawing to the round GC9A01
 * viewport. Caller must ctx.restore() (or rely on a fresh frame) to lift the clip. */
export function applyDisplayMask(ctx: CanvasRenderingContext2D, { size }: DisplayMaskOptions): void {
  ctx.save()
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.clip()
}

export function drawBezel(ctx: CanvasRenderingContext2D, { size, showBezel }: DisplayMaskOptions): void {
  if (!showBezel) return
  const r = size / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(r, r, r - 3, 0, Math.PI * 2)
  ctx.lineWidth = 6
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, '#4a4a52')
  grad.addColorStop(0.5, '#232327')
  grad.addColorStop(1, '#1a1a1d')
  ctx.strokeStyle = grad
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(r, r, r - 0.5, 0, Math.PI * 2)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.stroke()
  ctx.restore()
}
