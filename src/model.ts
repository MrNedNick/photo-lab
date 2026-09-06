export interface Crop {
  x: number
  y: number
  width: number
  height: number
}
export interface Edit {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  vignette: number
  rotation: number
  flipX: boolean
  flipY: boolean
  crop: Crop
}
export const freshEdit = (): Edit => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  vignette: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  crop: { x: 0, y: 0, width: 1, height: 1 },
})
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
export class History {
  entries: Edit[]
  index: number
  constructor(entries: Edit[] = [freshEdit()], index = entries.length - 1) {
    this.entries = structuredClone(entries)
    this.index = index
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
