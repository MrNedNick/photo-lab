/**
 * Turns the network's rough 320 × 320 guess into a clean cut-out:
 * - only the main subject stays (stray pieces of the background go),
 * - objects get their holes filled, people keep soft hair edges,
 * - the edge snaps to the real edge of the photo (guided filter),
 * - and can be softened on request.
 * Plain arrays in, plain arrays out — no canvas, so it is testable.
 */
export type CutoutMode = 'person' | 'object'

/** 4-connected regions above the threshold; returns a 0/1 map of the ones to keep. */
export function mainSubject(
  prob: Float32Array,
  w: number,
  h: number,
  { threshold = 0.5, share = 0.35 } = {},
): Uint8Array {
  const label = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || prob[start]! < threshold) continue
    const id = sizes.length
    let size = 0
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      size++
      const x = i % w,
        y = (i - x) / w
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ])
        if (n >= 0 && label[n] === -1 && prob[n]! >= threshold) {
          label[n] = id
          stack.push(n)
        }
    }
    sizes.push(size)
  }
  const keep = new Uint8Array(w * h)
  if (!sizes.length) return keep
  const largest = Math.max(...sizes)
  // Two burgers side by side are both the subject; a lamp in the corner is not.
  const kept = sizes.map((s) => s >= largest * share)
  for (let i = 0; i < w * h; i++)
    if (label[i]! >= 0 && kept[label[i]!]) keep[i] = 1
  return keep
}

/** Background regions that do not touch the border are holes in the subject. */
export function fillHoles(keep: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h)
  const stack: number[] = []
  const seed = (i: number) => {
    if (!keep[i] && !outside[i]) {
      outside[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w,
      y = (i - x) / w
    if (x > 0) seed(i - 1)
    if (x < w - 1) seed(i + 1)
    if (y > 0) seed(i - w)
    if (y < h - 1) seed(i + w)
  }
  const filled = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) filled[i] = outside[i] ? 0 : 1
  return filled
}

/** Mean over a (2r+1)² window, clamped at the borders, via a summed-area table. */
export function boxMean(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  const sat = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]!
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1]! + row
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r),
      y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r),
        x1 = Math.min(w, x + r + 1)
      const sum =
        sat[y1 * (w + 1) + x1]! -
        sat[y0 * (w + 1) + x1]! -
        sat[y1 * (w + 1) + x0]! +
        sat[y0 * (w + 1) + x0]!
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/** He et al. guided filter: the mask follows the edges of the grey guide image. */
export function guidedFilter(
  guide: Float32Array,
  mask: Float32Array,
  w: number,
  h: number,
  r: number,
  eps: number,
): Float32Array {
  const n = w * h
  const ip = new Float32Array(n),
    ii = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    ip[i] = guide[i]! * mask[i]!
    ii[i] = guide[i]! * guide[i]!
  }
  const mI = boxMean(guide, w, h, r),
    mP = boxMean(mask, w, h, r),
    mIP = boxMean(ip, w, h, r),
    mII = boxMean(ii, w, h, r)
  const a = new Float32Array(n),
    b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const cov = mIP[i]! - mI[i]! * mP[i]!,
      variance = mII[i]! - mI[i]! * mI[i]!
    a[i] = cov / (variance + eps)
    b[i] = mP[i]! - a[i]! * mI[i]!
  }
  const mA = boxMean(a, w, h, r),
    mB = boxMean(b, w, h, r)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++)
    out[i] = Math.min(1, Math.max(0, mA[i]! * guide[i]! + mB[i]!))
  return out
}

const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/** Bilinear resize of a single-channel map. */
export function resize(
  src: Float32Array,
  sw: number,
  sh: number,
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / h - 0.5))
    const y0 = Math.floor(fy),
      y1 = Math.min(sh - 1, y0 + 1),
      ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / w - 0.5))
      const x0 = Math.floor(fx),
        x1 = Math.min(sw - 1, x0 + 1),
        tx = fx - x0
      const top = src[y0 * sw + x0]! * (1 - tx) + src[y0 * sw + x1]! * tx
      const bottom = src[y1 * sw + x0]! * (1 - tx) + src[y1 * sw + x1]! * tx
      out[y * w + x] = top * (1 - ty) + bottom * ty
    }
  }
  return out
}

export interface CutoutOptions {
  mode: CutoutMode
  /** 0 = crisp, 1 = very soft edge. */
  soft: number
}

/**
 * From the model's probabilities (sw × sh) and a grey copy of the photo
 * (w × h) to the final alpha at w × h, 0…1.
 */
export function cutout(
  prob: Float32Array,
  sw: number,
  sh: number,
  guide: Float32Array,
  w: number,
  h: number,
  { mode, soft }: CutoutOptions,
): Float32Array {
  // 1. Only the subject: zero everything outside the kept regions, a little
  //    margin around them so soft edges survive.
  let keep = mainSubject(prob, sw, sh)
  if (mode === 'object') keep = fillHoles(keep, sw, sh)
  const near = boxMean(Float32Array.from(keep), sw, sh, 2)
  const cleaned = new Float32Array(sw * sh)
  for (let i = 0; i < sw * sh; i++)
    cleaned[i] = keep[i] && mode === 'object' ? 1 : near[i]! > 0 ? prob[i]! : 0
  // 2. Up to the photo's size, then snap the edge to the photo itself.
  const rough = resize(cleaned, sw, sh, w, h)
  const r = Math.max(
    2,
    Math.round(Math.max(w, h) / (mode === 'person' ? 220 : 400)),
  )
  const refined = guidedFilter(
    guide,
    rough,
    w,
    h,
    r,
    mode === 'person' ? 1e-3 : 1e-4,
  )
  // 3. Objects get a firm edge; hair and fur keep their gradient.
  const [lo, hi] = mode === 'object' ? [0.4, 0.6] : [0.15, 0.85]
  let alpha: Float32Array = refined.map((v) => smoothstep(lo, hi, v))
  // 4. Optional softening, in proportion to the picture.
  const blur = soft > 0 ? Math.ceil(soft * Math.max(w, h) * 0.006) : 0
  if (blur > 0) alpha = boxMean(boxMean(alpha, w, h, blur), w, h, blur)
  return alpha
}
