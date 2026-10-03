import { normalizeEdit, type Edit } from './model'
import { Renderer } from './renderer'
import { MaskLayer } from './mask'
interface Request {
  id: number
  kind: 'load' | 'export' | 'mask' | 'thumbs'
  edits?: Edit[]
  file?: Blob
  mask?: Blob
  edit?: Edit
  max?: number
  format?: string
  quality?: number
}
const worker = self as unknown as {
  onmessage: (event: MessageEvent<Request>) => void
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}
let renderer: Renderer | undefined
let canvas: OffscreenCanvas | undefined
const layer = new MaskLayer()
worker.onmessage = async ({ data }) => {
  const { id, kind } = data
  try {
    if (kind === 'load') {
      const bitmap = await createImageBitmap(data.file!)
      const width = bitmap.width,
        height = bitmap.height
      if (width * height > 50_000_000) {
        bitmap.close()
        throw new Error('Choose a photo up to 50 megapixels.')
      }
      const scale = Math.min(1, 2048 / Math.max(width, height))
      const preview = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(width * scale)),
        resizeHeight: Math.max(1, Math.round(height * scale)),
        resizeQuality: 'high',
      })
      bitmap.close()
      // One context for the whole session: a new photo is just a new texture.
      // Recreating contexts per photo stalls software GPUs.
      canvas ||= new OffscreenCanvas(1, 1)
      renderer ||= new Renderer(canvas)
      renderer.load(preview)
      layer.setBase(null)
      worker.postMessage({ id, kind, bitmap: preview, width, height }, [
        preview,
      ])
    } else if (kind === 'mask') {
      if (!renderer) return
      layer.setBase(data.mask ? await createImageBitmap(data.mask) : null)
    } else if (kind === 'thumbs') {
      if (!renderer || !canvas) return
      // Plain pixels rather than GPU bitmaps: the previews are tiny, and
      // sharing GPU images across threads stalls software renderers.
      const images = data.edits!.map((raw) => {
        const edit = normalizeEdit(raw)
        layer.apply(renderer!, edit.maskStrokes)
        const { width, height } = renderer!.render(edit, data.max)
        const pixels = renderer!.pixels(),
          rows = new Uint8ClampedArray(pixels.length),
          stride = width * 4
        for (let y = 0; y < height; y++)
          rows.set(
            pixels.subarray((height - 1 - y) * stride, (height - y) * stride),
            y * stride,
          )
        return new ImageData(rows, width, height)
      })
      worker.postMessage(
        { id, kind, images },
        images.map((image) => image.data.buffer),
      )
    } else {
      worker.postMessage({
        id,
        kind: 'progress',
        value: 'Decoding original photo…',
      })
      const bitmap = await createImageBitmap(data.file!)
      canvas = new OffscreenCanvas(1, 1)
      renderer = new Renderer(canvas)
      renderer.load(bitmap)
      bitmap.close()
      const edit = normalizeEdit(data.edit || {})
      if (data.mask) {
        const exportLayer = new MaskLayer()
        exportLayer.setBase(await createImageBitmap(data.mask))
        exportLayer.apply(renderer, edit.maskStrokes)
      }
      worker.postMessage({
        id,
        kind: 'progress',
        value: 'Rendering your edits…',
      })
      const size = renderer.render(edit, data.max || Infinity)
      worker.postMessage({
        id,
        kind: 'progress',
        value: 'Encoding your photo…',
      })
      const blob = await canvas.convertToBlob({
        type: data.format || 'image/jpeg',
        quality: data.quality ?? 0.92,
      })
      worker.postMessage({ id, kind, blob, ...size })
      renderer.dispose()
    }
  } catch (error) {
    worker.postMessage({
      id,
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Could not process this photo. Try a JPEG, PNG or WebP file.',
    })
  }
}
