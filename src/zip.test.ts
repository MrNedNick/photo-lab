import { describe, expect, it } from 'vitest'
import { crc32, uniqueNames, zip } from './zip'

/** Reads a stored ZIP back: name, size and bytes of every entry. */
function read(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer)
  const end = bytes.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const out: { name: string; data: Uint8Array; crc: number }[] = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const size = view.getUint32(at + 24, true),
      nameLength = view.getUint16(at + 28, true),
      local = view.getUint32(at + 42, true),
      crc = view.getUint32(at + 16, true)
    const name = new TextDecoder().decode(
      bytes.slice(at + 46, at + 46 + nameLength),
    )
    const start = local + 30 + view.getUint16(local + 26, true)
    out.push({ name, data: bytes.slice(start, start + size), crc })
    at += 46 + nameLength
  }
  return out
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('stores every file so it reads back byte for byte', async () => {
    const a = new Uint8Array([1, 2, 3, 250]),
      b = new TextEncoder().encode('Ünïcode name works')
    const blob = await zip([
      { name: 'one.jpg', blob: new Blob([a]) },
      { name: 'café.webp', blob: new Blob([b]) },
    ])
    const entries = read(new Uint8Array(await blob.arrayBuffer()))
    expect(entries.map((e) => e.name)).toEqual(['one.jpg', 'café.webp'])
    expect([...entries[0]!.data]).toEqual([...a])
    expect(entries[1]!.crc).toBe(crc32(b))
  })

  it('keeps names apart', () => {
    expect(uniqueNames(['a.jpg', 'b.jpg', 'A.jpg', 'a.jpg'])).toEqual([
      'a.jpg',
      'b.jpg',
      'A (2).jpg',
      'a (3).jpg',
    ])
  })
})
