import type { Edit } from './model'
export interface Project {
  file: Blob
  name: string
  entries: Edit[]
  index: number
  updated: number
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('photo-lab', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readProject(): Promise<Project | undefined> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly'),
        request = tx.objectStore('projects').get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
export async function saveProject(project: Project | null) {
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite')
      if (project) tx.objectStore('projects').put(project, 'current')
      else tx.objectStore('projects').delete('current')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
