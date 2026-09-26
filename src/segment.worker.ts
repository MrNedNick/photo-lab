// Background removal runs here, off the main thread and only on request: the
// runtime and the model are fetched the first time someone asks for a cut-out.
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

const SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const MODEL = `${import.meta.env.BASE_URL}models/u2netp.onnx`

ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href }

interface Request {
  id: number
  file: Blob
  /** Longest edge of the mask; matches the preview texture. */
  max: number
}
const worker = self as unknown as {
  onmessage: (event: MessageEvent<Request>) => void
  postMessage: (message: unknown) => void
}
let session: Promise<ort.InferenceSession> | undefined

async function modelBytes() {
  const cache = 'caches' in self ? await caches.open('photo-lab-models') : null
  const hit = await cache?.match(MODEL)
  if (hit) return hit.arrayBuffer()
  const response = await fetch(MODEL)
  if (!response.ok) throw new Error('The cut-out model could not be loaded.')
  await cache?.put(MODEL, response.clone())
  return response.arrayBuffer()
}

function load() {
  session ||= modelBytes().then((bytes) =>
    ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }),
  )
  session.catch(() => (session = undefined))
  return session
}

worker.onmessage = async ({ data }) => {
  const { id } = data
  try {
    worker.postMessage({ id, kind: 'progress', value: 'model' })
    const model = await load()
    worker.postMessage({ id, kind: 'progress', value: 'subject' })
    const bitmap = await createImageBitmap(data.file)
    const input = new OffscreenCanvas(SIZE, SIZE),
      ctx = input.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, SIZE, SIZE)
    const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data,
      tensor = new Float32Array(3 * SIZE * SIZE)
    for (let i = 0; i < SIZE * SIZE; i++)
      for (let c = 0; c < 3; c++)
        tensor[c * SIZE * SIZE + i] =
          (rgba[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!
    const result = await model.run({
      [model.inputNames[0]!]: new ort.Tensor('float32', tensor, [
        1,
        3,
        SIZE,
        SIZE,
      ]),
    })
    const out = result[model.outputNames[0]!]!.data as Float32Array
    let lo = Infinity,
      hi = -Infinity
    for (const v of out) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    const small = new ImageData(SIZE, SIZE)
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = Math.round(((out[i]! - lo) / (hi - lo || 1)) * 255)
      small.data.set([v, v, v, 255], i * 4)
    }
    const scale = Math.min(1, data.max / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale)),
      height = Math.max(1, Math.round(bitmap.height * scale))
    bitmap.close()
    const staging = new OffscreenCanvas(SIZE, SIZE)
    staging.getContext('2d')!.putImageData(small, 0, 0)
    const mask = new OffscreenCanvas(width, height),
      mctx = mask.getContext('2d')!
    mctx.imageSmoothingQuality = 'high'
    mctx.drawImage(staging, 0, 0, width, height)
    worker.postMessage({
      id,
      kind: 'mask',
      blob: await mask.convertToBlob({ type: 'image/png' }),
    })
  } catch (error) {
    worker.postMessage({
      id,
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'The background could not be removed.',
    })
  }
}
