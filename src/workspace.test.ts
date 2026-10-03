import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/dom'
vi.mock('./storage', () => ({
  readProject: async () => undefined,
  saveProject: async () => {},
}))
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  localStorage.clear()
  document.body.innerHTML = '<div id="app"></div>'
  await import('./main')
})
it('offers an accessible starting point and prevents editing before a photo is open', () => {
  expect(screen.getByRole('button', { name: 'Open a photo' })).toBeTruthy()
  expect(
    (screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  expect(
    (
      screen.getByRole('group', {
        name: 'Photo adjustments',
      }) as HTMLFieldSetElement
    ).disabled,
  ).toBe(true)
})
it('rejects unsupported files with a useful message and keeps the workspace usable', async () => {
  const input = document.querySelector('#file')!
  fireEvent.change(input, {
    target: {
      files: [new File(['test'], 'notes.txt', { type: 'text/plain' })],
    },
  })
  expect(
    await screen.findByText('Choose a JPEG, PNG, WebP, AVIF or HEIC photo.'),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open a photo' })).toBeTruthy()
})
it('opens straight into the editor with its tools, and switches tools like tabs', () => {
  expect(
    screen.getByRole('heading', { name: 'Free photo editor' }),
  ).toBeTruthy()
  const tabs = screen.getAllByRole('tab')
  expect(tabs.map((t) => t.textContent)).toEqual([
    'Adjust',
    'Crop',
    'Background',
    'Blur area',
    'Compress',
  ])
  fireEvent.click(screen.getByRole('tab', { name: 'Background' }))
  expect(
    screen
      .getByRole('tab', { name: 'Background' })
      .getAttribute('aria-selected'),
  ).toBe('true')
  expect(screen.getByRole('tabpanel', { name: 'Background' })).toBeTruthy()
  expect(document.querySelector<HTMLElement>('#panel-adjust')!.hidden).toBe(
    true,
  )
})
it('persists an accessible theme toggle', () => {
  fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('photo-lab-theme')).toBe('light')
  expect(
    screen.getByRole('button', { name: 'Switch to dark theme' }),
  ).toBeTruthy()
})
