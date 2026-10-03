// Background removal runs here, off the main thread and only on request: the
// runtime and the model are fetched the first time someone asks for a cut-out.
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { cutout, type CutoutMode } from './cutout'

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
  mode?: CutoutMode
  /** 0…1 */
  soft?: number
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

/** The network runs once per photo; changing the mode or softness reuses it. */
let last: {
  id: number
  prob: Float32Array
  guide: Float32Array
  width: number
  height: number
} | null = null

async function analyse(data: Request) {
  worker.postMessage({ id: data.id, kind: 'progress', value: 'model' })
  const model = await load()
  worker.postMessage({ id: data.id, kind: 'progress', value: 'subject' })
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
  const prob = new Float32Array(SIZE * SIZE)
  for (let i = 0; i < SIZE * SIZE; i++)
    prob[i] = (out[i]! - lo) / (hi - lo || 1)
  // A grey copy of the photo at the mask's size guides the edge.
  const scale = Math.min(1, data.max / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale)),
    height = Math.max(1, Math.round(bitmap.height * scale))
  const photo = new OffscreenCanvas(width, height),
    pctx = photo.getContext('2d', { willReadFrequently: true })!
  pctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const pixels = pctx.getImageData(0, 0, width, height).data,
    guide = new Float32Array(width * height)
  for (let i = 0; i < guide.length; i++)
    guide[i] =
      (0.299 * pixels[i * 4]! +
        0.587 * pixels[i * 4 + 1]! +
        0.114 * pixels[i * 4 + 2]!) /
      255
  last = { id: data.id, prob, guide, width, height }
  return last
}

worker.onmessage = async ({ data }) => {
  const { id } = data
  try {
    const source = last?.id === id ? last : await analyse(data)
    const alpha = cutout(
      source.prob,
      SIZE,
      SIZE,
      source.guide,
      source.width,
      source.height,
      {
        mode: data.mode ?? 'person',
        soft: data.soft ?? 0,
      },
    )
    const image = new ImageData(source.width, source.height)
    for (let i = 0; i < alpha.length; i++) {
      const v = Math.round(alpha[i]! * 255)
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v
      image.data[i * 4 + 3] = 255
    }
    const mask = new OffscreenCanvas(source.width, source.height)
    mask.getContext('2d')!.putImageData(image, 0, 0)
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
