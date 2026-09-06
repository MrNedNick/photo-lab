import { freshEdit, histogram, type Edit } from './model'
import { Renderer } from './renderer'
interface Request { id: number; kind: 'load' | 'histogram' | 'export'; file?: Blob; edit?: Edit; max?: number; format?: string; quality?: number }
const worker = self as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage: (message: unknown, transfer?: Transferable[]) => void }
let renderer: Renderer | undefined
let canvas: OffscreenCanvas | undefined
worker.onmessage = async ({ data }) => {
  const { id, kind } = data
  try {
    if (kind === 'load') {
      const bitmap = await createImageBitmap(data.file!)
      const width = bitmap.width, height = bitmap.height
      if (width * height > 50_000_000) { bitmap.close(); throw new Error('Choose a photo up to 50 megapixels.') }
      const scale = Math.min(1, 2048 / Math.max(width, height))
      const preview = await createImageBitmap(bitmap, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: 'high' })
      bitmap.close()
      canvas = new OffscreenCanvas(1, 1)
      renderer?.dispose(); renderer = new Renderer(canvas); renderer.load(preview)
      worker.postMessage({ id, kind, bitmap: preview, width, height }, [preview])
    } else if (kind === 'histogram') {
      if (!renderer) return
      renderer.render(data.edit!, 256)
      worker.postMessage({ id, kind, bins: histogram(renderer.pixels()) })
    } else {
      worker.postMessage({ id, kind: 'progress', value: 'Decoding original photo…' })
      const bitmap = await createImageBitmap(data.file!)
      canvas = new OffscreenCanvas(1, 1); renderer = new Renderer(canvas); renderer.load(bitmap); bitmap.close()
      worker.postMessage({ id, kind: 'progress', value: 'Rendering your edits…' })
      const size = renderer.render(data.edit || freshEdit(), data.max || Infinity)
      worker.postMessage({ id, kind: 'progress', value: 'Encoding your photo…' })
      const blob = await canvas.convertToBlob({ type: data.format || 'image/jpeg', quality: data.quality ?? 0.92 })
      worker.postMessage({ id, kind, blob, ...size })
      renderer.dispose()
    }
  } catch (error) { worker.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : 'Could not process this photo. Try a JPEG, PNG or WebP file.' }) }
}
