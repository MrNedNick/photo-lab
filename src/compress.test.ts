import { describe, expect, it } from 'vitest'
import { fitQuality, formatBytes, shrinkFor } from './compress'

// A pretend encoder: size grows with quality, like JPEG and WebP do.
const encoder = (bytesAt: (q: number) => number) => {
  const calls: number[] = []
  const encode = async (q: number) => {
    calls.push(q)
    return new Blob([new Uint8Array(Math.round(bytesAt(q)))])
  }
  return { encode, calls }
}

describe('fitting a file into a size', () => {
  it('finds the highest quality that still fits', async () => {
    const { encode, calls } = encoder((q) => 1000 + q * 9000)
    const fit = await fitQuality(encode, 5500)
    expect(fit!.blob.size).toBeLessThanOrEqual(5500)
    expect(fit!.quality).toBeGreaterThan(0.45)
    expect(fit!.quality).toBeLessThanOrEqual(0.5)
    expect(calls.length).toBeLessThanOrEqual(9)
  })

  it('keeps the top quality when the file already fits', async () => {
    const { encode, calls } = encoder(() => 100)
    expect((await fitQuality(encode, 500))!.quality).toBe(0.95)
    expect(calls).toEqual([0.95])
  })

  it('gives up when even the lowest quality is too big', async () => {
    const { encode } = encoder((q) => 10_000 + q)
    expect(await fitQuality(encode, 5000)).toBeNull()
  })

  it('shrinks the picture by the square root of the overshoot', () => {
    expect(shrinkFor(400, 100)).toBeCloseTo(0.45)
    expect(shrinkFor(100_000_000, 1)).toBe(0.1)
  })

  it('writes sizes the way people read them', () => {
    expect(formatBytes(512_000)).toBe('500 KB')
    expect(formatBytes(4.8 * 1024 * 1024)).toBe('4.8 MB')
  })
})
