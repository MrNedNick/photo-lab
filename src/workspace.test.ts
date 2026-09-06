import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/dom'
vi.mock('./storage', () => ({ readProject: async () => undefined, saveProject: async () => {} }))
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal('BroadcastChannel', undefined)
  localStorage.clear(); document.body.innerHTML = '<div id="app"></div>'
  await import('./main')
})
it('offers an accessible starting point and prevents editing before a photo is open', () => {
  expect(screen.getByRole('button', { name: 'Choose a photo ↗' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Export ↗' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('group', { name: 'Photo adjustments' }) as HTMLFieldSetElement).disabled).toBe(true)
})
it('rejects unsupported files with a useful message and keeps the workspace usable', () => {
  const input = document.querySelector('#file')!
  fireEvent.change(input, { target: { files: [new File(['test'], 'notes.txt', { type: 'text/plain' })] } })
  expect(screen.getByText('Choose a JPEG, PNG, WebP or AVIF photo.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Choose a photo ↗' })).toBeTruthy()
})
it('persists an accessible theme toggle', () => {
  fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('photo-lab-theme')).toBe('light')
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy()
})
