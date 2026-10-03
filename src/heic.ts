/** HEIC/HEIF — the iPhone camera format. Recognised by type, name or the file's own header. */
export async function isHeic(file: Blob, name: string): Promise<boolean> {
  if (/^image\/hei[cf](-sequence)?$/.test(file.type)) return true
  if (/\.hei[cf]$/i.test(name)) return true
  if (file.type && file.type !== 'application/octet-stream') return false
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const box = String.fromCharCode(...head.slice(4, 12))
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(box)
}

/** Decodes in a separate worker and resolves with a high-quality JPEG. */
export function heicToJpeg(file: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./heic.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }) => {
      worker.terminate()
      if (data.blob) resolve(data.blob)
      else reject(new Error(data.error))
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('Unable to read this HEIC photo.'))
    }
    worker.postMessage({ file })
  })
}
