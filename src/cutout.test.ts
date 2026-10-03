import { describe, expect, it } from 'vitest'
import {
  boxMean,
  cutout,
  fillHoles,
  guidedFilter,
  mainSubject,
  resize,
} from './cutout'

/** A w × h map from a function of (x, y). */
const map = (w: number, h: number, f: (x: number, y: number) => number) =>
  Float32Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w)))
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? 1 : 0

describe('cleaning up the cut-out', () => {
  it('keeps the subject and drops a small stray piece', () => {
    const prob = map(40, 40, (x, y) =>
      Math.max(disc(15, 20, 10)(x, y), disc(35, 5, 2)(x, y)),
    )
    const keep = mainSubject(prob, 40, 40)
    expect(keep[20 * 40 + 15]).toBe(1)
    expect(keep[5 * 40 + 35]).toBe(0)
  })

  it('keeps two subjects of a similar size', () => {
    const prob = map(40, 20, (x, y) =>
      Math.max(disc(10, 10, 6)(x, y), disc(30, 10, 5)(x, y)),
    )
    const keep = mainSubject(prob, 40, 20)
    expect(keep[10 * 40 + 10]).toBe(1)
    expect(keep[10 * 40 + 30]).toBe(1)
  })

  it('fills holes inside an object but not the background around it', () => {
    const ring = map(20, 20, (x, y) =>
      disc(10, 10, 8)(x, y) && !disc(10, 10, 3)(x, y) ? 1 : 0,
    )
    const filled = fillHoles(Uint8Array.from(ring), 20, 20)
    expect(filled[10 * 20 + 10]).toBe(1)
    expect(filled[0]).toBe(0)
  })

  it('averages over a window and clamps at the borders', () => {
    const ones = new Float32Array(25).fill(1)
    expect(
      [...boxMean(ones, 5, 5, 2)].every((v) => Math.abs(v - 1) < 1e-6),
    ).toBe(true)
    const spike = new Float32Array(9)
    spike[4] = 9
    expect(boxMean(spike, 3, 3, 1)[4]).toBeCloseTo(1)
  })

  it('snaps a blurry edge to the sharp edge of the photo', () => {
    // Photo: dark left half, light right half. Mask: a soft ramp across the middle.
    const w = 64,
      h = 8
    const guide = map(w, h, (x) => (x < 32 ? 0.1 : 0.9))
    // As wide as the 320 px model output is after scaling up to the photo.
    const blurry = map(w, h, (x) => Math.min(1, Math.max(0, (x - 28) / 8)))
    const sharp = guidedFilter(guide, blurry, w, h, 4, 1e-4)
    const steepest = (m: Float32Array) => {
      let at = 0,
        jump = 0
      for (let x = 1; x < w; x++)
        if (m[x]! - m[x - 1]! > jump) [at, jump] = [x, m[x]! - m[x - 1]!]
      return { at, jump }
    }
    // The biggest step lands on the photo's own edge and is far taller.
    expect(steepest(sharp).at).toBe(32)
    expect(steepest(sharp).jump).toBeGreaterThan(steepest(blurry).jump * 3)
  })

  it('resizes without shifting the picture', () => {
    const src = map(4, 4, (x) => x / 3)
    const big = resize(src, 4, 4, 8, 8)
    expect(big[0]).toBeCloseTo(0)
    expect(big[7]).toBeCloseTo(1)
  })

  it('makes an object firm and a soft edge wider', () => {
    const prob = map(32, 32, disc(16, 16, 10)),
      guide = map(64, 64, (x, y) => disc(32, 32, 20)(x, y) * 0.8 + 0.1)
    const firm = cutout(prob, 32, 32, guide, 64, 64, {
      mode: 'object',
      soft: 0,
    })
    const soft = cutout(prob, 32, 32, guide, 64, 64, {
      mode: 'object',
      soft: 1,
    })
    const partial = (a: Float32Array) =>
      [...a].filter((v) => v > 0.05 && v < 0.95).length
    expect(firm[32 * 64 + 32]).toBeCloseTo(1)
    expect(firm[0]).toBeCloseTo(0)
    expect(partial(soft)).toBeGreaterThan(partial(firm))
  })
})
