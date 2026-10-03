/**
 * Turns an iPhone HEIC/HEIF photo into a JPEG the editor can work with.
 * Browsers that decode HEIC themselves (Safari) do it natively; elsewhere the
 * libheif decoder (LGPL-3.0, unmodified) is loaded as its own module — only
 * when such a file actually arrives.
 */
type Decoded = {
  width: number
  height: number
  draw: (c: OffscreenCanvasRenderingContext2D) => void
}

async function native(file: Blob): Promise<Decoded | null> {
  try {
    const bitmap = await createImageBitmap(file)
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (c) => c.drawImage(bitmap, 0, 0),
    }
  } catch {
    return null
  }
}

interface HeifImage {
  get_width(): number
  get_height(): number
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: { data: Uint8ClampedArray } | null) => void,
  ): void
  free?(): void
}

async function withLibheif(file: Blob): Promise<Decoded> {
  const { default: load } =
    await import('libheif-js/libheif-wasm/libheif-bundle.mjs')
  const libheif = load()
  const images: HeifImage[] = new libheif.HeifDecoder().decode(
    new Uint8Array(await file.arrayBuffer()),
  )
  const image = images[0]
  if (!image) throw new Error('This HEIC file has no picture in it.')
  const width = image.get_width(),
    height = image.get_height()
  const pixels = await new Promise<Uint8ClampedArray>((resolve, reject) =>
    image.display(
      { data: new Uint8ClampedArray(width * height * 4), width, height },
      (result) =>
        result
          ? resolve(result.data)
          : reject(new Error('Unable to decode this HEIC photo.')),
    ),
  )
  for (const other of images) other.free?.()
  return {
    width,
    height,
    draw: (c) =>
      c.putImageData(
        new ImageData(new Uint8ClampedArray(pixels), width, height),
        0,
        0,
      ),
  }
}

self.onmessage = async ({ data }: MessageEvent<{ file: Blob }>) => {
  try {
    const decoded = (await native(data.file)) ?? (await withLibheif(data.file))
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    decoded.draw(canvas.getContext('2d')!)
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: 0.95,
    })
    self.postMessage({ blob })
  } catch (error) {
    self.postMessage({ error: (error as Error).message || String(error) })
  }
}
