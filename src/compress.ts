/**
 * Finds the best quality whose file still fits the target size. Encoders are
 * monotonic enough in practice — lower quality, smaller file — so a binary
 * search needs about seven encodes instead of trying every step.
 */
export interface Fit {
  blob: Blob
  quality: number
}

export async function fitQuality(
  encode: (quality: number) => Promise<Blob>,
  target: number,
  { min = 0.05, max = 0.95, steps = 7 } = {},
): Promise<Fit | null> {
  const top = await encode(max)
  if (top.size <= target) return { blob: top, quality: max }
  const bottom = await encode(min)
  if (bottom.size > target) return null
  let best: Fit = { blob: bottom, quality: min }
  let lo = min,
    hi = max
  for (let i = 0; i < steps; i++) {
    const quality = (lo + hi) / 2
    const blob = await encode(quality)
    if (blob.size <= target) {
      best = { blob, quality }
      lo = quality
    } else hi = quality
  }
  return best
}

/**
 * When even the lowest quality is too big, the picture gets smaller: file
 * size falls roughly with the pixel count, so scale by the square root.
 */
export function shrinkFor(size: number, target: number): number {
  return Math.max(0.1, Math.min(0.9, Math.sqrt(target / size) * 0.9))
}

export const TARGETS = [
  { bytes: 100 * 1024, label: '100 KB' },
  { bytes: 500 * 1024, label: '500 KB' },
  { bytes: 1024 * 1024, label: '1 MB' },
  { bytes: 2 * 1024 * 1024, label: '2 MB' },
]

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
