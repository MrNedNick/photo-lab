import type { Edit } from './model'
export interface Project {
  file: Blob
  name: string
  entries: Edit[]
  index: number
  updated: number
  /** Background cut-out mask, present once the background was removed. */
  mask?: Blob
  /** How the cut-out was cleaned up: subject kind and edge softness (0…1). */
  cutout?: { mode: 'person' | 'object'; soft: number }
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('photo-lab', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
/**
 * Safari's private windows refuse Blobs in IndexedDB. The first refusal
 * switches to storing plain bytes, which every browser accepts; reading
 * understands both forms.
 */
interface Bytes {
  bytes: ArrayBuffer
  type: string
}
type Stored = Omit<Project, 'file' | 'mask'> & {
  file: Blob | Bytes
  mask?: Blob | Bytes
}
let blobsRefused = false
const bytesCache = new WeakMap<Blob, Bytes>()
async function toBytes(blob: Blob): Promise<Bytes> {
  let cached = bytesCache.get(blob)
  if (!cached) {
    cached = { bytes: await blob.arrayBuffer(), type: blob.type }
    bytesCache.set(blob, cached)
  }
  return cached
}
const toBlob = (value: Blob | Bytes) =>
  value instanceof Blob ? value : new Blob([value.bytes], { type: value.type })

export async function readProject(): Promise<Project | undefined> {
  const db = await open()
  try {
    const stored = await new Promise<Stored | undefined>((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly'),
        request = tx.objectStore('projects').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!stored) return undefined
    return {
      ...stored,
      file: toBlob(stored.file),
      mask: stored.mask && toBlob(stored.mask),
    }
  } finally {
    db.close()
  }
}
async function write(value: Stored | null) {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite')
      if (value) tx.objectStore('projects').put(value, 'current')
      else tx.objectStore('projects').delete('current')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
const asBytes = async (project: Project): Promise<Stored> => ({
  ...project,
  file: await toBytes(project.file),
  mask: project.mask && (await toBytes(project.mask)),
})
export async function saveProject(project: Project | null) {
  if (!project) return write(null)
  if (!blobsRefused) {
    try {
      return await write(project)
    } catch {
      blobsRefused = true
    }
  }
  return write(await asBytes(project))
}
