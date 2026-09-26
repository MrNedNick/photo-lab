import type { MaskStroke } from './model'
import type { Renderer } from './renderer'

/** The cut-out as the model produced it, with the brush strokes painted on
 * top: white keeps, black erases. Strokes live in original-photo coordinates
 * and their width is a share of the photo's longest side. */
export function composeMask(base: ImageBitmap, strokes: MaskStroke[]) {
  const canvas = new OffscreenCanvas(base.width, base.height),
    ctx = canvas.getContext('2d')!,
    longest = Math.max(base.width, base.height)
  ctx.drawImage(base, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    const [x = 0, y = 0] = stroke.points
    ctx.strokeStyle = stroke.keep ? '#fff' : '#000'
    ctx.lineWidth = stroke.radius * 2 * longest
    ctx.beginPath()
    ctx.moveTo(x * base.width, y * base.height)
    // A single tap still leaves a round dot.
    if (stroke.points.length < 4) ctx.lineTo(x * base.width, y * base.height)
    for (let i = 2; i < stroke.points.length; i += 2)
      ctx.lineTo(
        stroke.points[i]! * base.width,
        stroke.points[i + 1]! * base.height,
      )
    ctx.stroke()
  }
  return canvas
}

/** Keeps a renderer's mask texture in step with the strokes of the edit it
 * is about to draw, recomposing only when they change. */
export class MaskLayer {
  private base: ImageBitmap | null = null
  private applied: string | undefined
  get present() {
    return !!this.base
  }
  setBase(base: ImageBitmap | null) {
    this.base?.close()
    this.base = base
    this.applied = undefined
  }
  apply(renderer: Renderer, strokes: MaskStroke[]) {
    const key = this.base ? JSON.stringify(strokes) : ''
    if (key === this.applied) return
    this.applied = key
    renderer.loadMask(
      this.base
        ? strokes.length
          ? composeMask(this.base, strokes)
          : this.base
        : null,
    )
  }
}
