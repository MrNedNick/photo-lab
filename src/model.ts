export interface Crop {
  x: number
  y: number
  width: number
  height: number
}
export type BackgroundMode = 'keep' | 'transparent' | 'color' | 'blur'
/** An area hidden in the export — a face, a plate, an address. Coordinates
 * are normalized to the original photo, so later crops keep it in place. */
export interface Redaction extends Crop {
  mode: 'blur' | 'pixelate'
}
export interface Edit {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  vignette: number
  rotation: number
  /** Horizon correction in degrees, −45…45, applied after crop. */
  straighten: number
  flipX: boolean
  flipY: boolean
  crop: Crop
  background: BackgroundMode
  backgroundColor: string
  redactions: Redaction[]
}
export const MAX_REDACTIONS = 8
export const freshEdit = (): Edit => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  vignette: 0,
  rotation: 0,
  straighten: 0,
  flipX: false,
  flipY: false,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  background: 'keep',
  backgroundColor: '#ffffff',
  redactions: [],
})
/** Saved edits from before horizon, background and redaction support lack
 * those fields; fill them in so old workspaces open unchanged. */
export function normalizeEdit(edit: Partial<Edit>): Edit {
  const base = freshEdit()
  return {
    ...base,
    ...edit,
    crop: { ...base.crop, ...edit.crop },
    redactions: (edit.redactions ?? []).map((r) => ({ ...r })),
  }
}
export function dimensions(
  width: number,
  height: number,
  edit: Edit,
  max = Infinity,
) {
  let w = Math.max(1, Math.round(width * edit.crop.width))
  let h = Math.max(1, Math.round(height * edit.crop.height))
  if (edit.rotation % 180 !== 0) [w, h] = [h, w]
  const scale = Math.min(1, max / Math.max(w, h))
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}
export function cropToAspect(
  width: number,
  height: number,
  ratio: number,
): Crop {
  if (!ratio) return { x: 0, y: 0, width: 1, height: 1 }
  const aspect = width / height
  const w = Math.min(1, ratio / aspect),
    h = Math.min(1, aspect / ratio)
  return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h }
}
/** How much a straightened frame is enlarged so that no empty corner shows:
 * the smallest zoom at which the rotated frame still covers the output. */
export function straightenScale(degrees: number, aspect: number) {
  const angle = (Math.abs(degrees) * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle)
  return Math.max(cos + sin / aspect, cos + sin * aspect)
}
/** Map a point of the edited output (0…1, top-left origin) back to the
 * original photo. Mirrors the fragment shader, so tools that draw on the
 * preview land on the same pixels in the export. */
export function sourcePoint(u: number, v: number, edit: Edit, aspect: number) {
  const angle = (edit.straighten * Math.PI) / 180,
    k = straightenScale(edit.straighten, aspect),
    qx = (u - 0.5) * aspect,
    qy = v - 0.5
  let x = (Math.cos(angle) * qx - Math.sin(angle) * qy) / k / aspect + 0.5
  let y = (Math.sin(angle) * qx + Math.cos(angle) * qy) / k + 0.5
  if (edit.flipX) x = 1 - x
  if (edit.flipY) y = 1 - y
  const turn = (((edit.rotation / 90) % 4) + 4) % 4
  if (turn === 1) [x, y] = [y, 1 - x]
  else if (turn === 2) [x, y] = [1 - x, 1 - y]
  else if (turn === 3) [x, y] = [1 - y, x]
  return {
    x: edit.crop.x + x * edit.crop.width,
    y: edit.crop.y + y * edit.crop.height,
  }
}
/** A rectangle drawn on the preview, as the area it covers in the original. */
export function sourceRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  edit: Edit,
  aspect: number,
): Crop {
  const corners = [
    [a.x, a.y],
    [b.x, a.y],
    [a.x, b.y],
    [b.x, b.y],
  ].map(([u, v]) => sourcePoint(u!, v!, edit, aspect))
  const clamp = (n: number) => Math.max(0, Math.min(1, n))
  const xs = corners.map((p) => clamp(p.x)),
    ys = corners.map((p) => clamp(p.y))
  const x = Math.min(...xs),
    y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
export class History {
  entries: Edit[]
  index: number
  constructor(entries: Partial<Edit>[] = [freshEdit()], index?: number) {
    this.entries = entries.map(normalizeEdit)
    this.index = index ?? this.entries.length - 1
  }
  get current() {
    return structuredClone(this.entries[this.index]!)
  }
  push(edit: Edit) {
    if (JSON.stringify(edit) === JSON.stringify(this.current)) return
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push(structuredClone(edit))
    if (this.entries.length > 100) this.entries.shift()
    this.index = this.entries.length - 1
  }
  undo() {
    this.index = Math.max(0, this.index - 1)
    return this.current
  }
  redo() {
    this.index = Math.min(this.entries.length - 1, this.index + 1)
    return this.current
  }
}
export function histogram(pixels: Uint8Array) {
  const bins = Array.from({ length: 3 }, () => new Array<number>(256).fill(0))
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue
    for (let channel = 0; channel < 3; channel++)
      bins[channel]![pixels[i + channel]!]!++
  }
  return bins
}
