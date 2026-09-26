import { describe, expect, it } from 'vitest'
import {
  cropToAspect,
  dimensions,
  freshEdit,
  History,
  histogram,
  normalizeEdit,
  sourcePoint,
  sourceRect,
  straightenScale,
} from './model'

describe('photo editing history', () => {
  it('restores exactly the previous crop and filter, then redoes it', () => {
    const history = new History(),
      edit = freshEdit()
    edit.crop = cropToAspect(4000, 3000, 1)
    history.push(edit)
    edit.exposure = 0.65
    history.push(edit)
    expect(history.undo()).toEqual({ ...edit, exposure: 0 })
    expect(history.redo()).toEqual(edit)
    expect(dimensions(4000, 3000, edit)).toEqual({ width: 3000, height: 3000 })
  })
  it('drops the future when a new edit follows undo, without sharing references', () => {
    const history = new History(),
      edit = freshEdit()
    edit.exposure = 1
    history.push(edit)
    edit.exposure = 2
    history.push(edit)
    history.undo()
    edit.exposure = -0.5
    history.push(edit)
    edit.crop.x = 0.4
    expect(history.redo().exposure).toBe(-0.5)
    expect(history.current.crop.x).toBe(0)
    expect(history.entries).toHaveLength(3)
  })
  it('caps history and ignores unchanged slider commits', () => {
    const history = new History()
    history.push(freshEdit())
    expect(history.entries).toHaveLength(1)
    for (let i = 1; i < 110; i++)
      history.push({ ...freshEdit(), exposure: i / 100 })
    expect(history.entries).toHaveLength(100)
    expect(history.index).toBe(99)
  })
})
describe('output geometry and analysis', () => {
  it.each([0, 90, 180, 270])(
    'exports the correct crop dimensions at %i degrees without upscaling',
    (rotation) => {
      const edit = {
        ...freshEdit(),
        rotation,
        crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
      }
      const size = dimensions(4000, 3000, edit, 1200)
      expect(size).toEqual(
        rotation % 180
          ? { width: 1200, height: 1000 }
          : { width: 1000, height: 1200 },
      )
      expect(dimensions(100, 50, freshEdit(), 2048)).toEqual({
        width: 100,
        height: 50,
      })
    },
  )
  it('fits wide and portrait ratios within the original', () => {
    for (const ratio of [1, 4 / 3, 3 / 2, 16 / 9, 4 / 5]) {
      const crop = cropToAspect(4000, 3000, ratio)
      expect((crop.width * 4000) / (crop.height * 3000)).toBeCloseTo(ratio)
      expect(crop.x).toBeGreaterThanOrEqual(0)
      expect(crop.y).toBeGreaterThanOrEqual(0)
    }
  })
  it('counts RGB independently and ignores fully transparent pixels', () => {
    const bins = histogram(
      new Uint8Array([255, 0, 10, 255, 255, 50, 10, 255, 2, 2, 2, 0]),
    )
    expect(bins[0]![255]).toBe(2)
    expect(bins[1]![50]).toBe(1)
    expect(bins[2]![10]).toBe(2)
    expect(bins[0]![2]).toBe(0)
  })
})
describe('horizon, redactions and older saves', () => {
  it('opens a workspace saved before horizon, background and redactions existed', () => {
    const old = {
      exposure: 0.4,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      vignette: 0,
      rotation: 90,
      flipX: false,
      flipY: true,
      crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
    }
    const history = new History([old], 0)
    expect(history.current).toEqual({ ...freshEdit(), ...old })
    expect(normalizeEdit({}).redactions).toEqual([])
  })
  it('zooms a straightened frame just enough to hide the corners', () => {
    expect(straightenScale(0, 1.5)).toBe(1)
    const k = straightenScale(10, 1.5),
      a = (10 * Math.PI) / 180
    // Every corner of the output, rotated back, stays inside the source.
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const p = sourcePoint(u!, v!, { ...freshEdit(), straighten: 10 }, 1.5)
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x).toBeLessThanOrEqual(1 + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1e-9)
      expect(p.y).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(k).toBeCloseTo(Math.cos(a) + Math.sin(a) * 1.5)
  })
  it('maps a point on the preview back through crop, flip and rotation', () => {
    const edit = {
      ...freshEdit(),
      crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    }
    expect(sourcePoint(0, 0, edit, 1)).toEqual({ x: 0.5, y: 0.5 })
    expect(sourcePoint(0, 0, { ...edit, flipX: true }, 1)).toEqual({
      x: 1,
      y: 0.5,
    })
    const turned = sourcePoint(0, 0, { ...freshEdit(), rotation: 90 }, 1)
    expect(turned).toEqual({ x: 0, y: 1 })
  })
  it('stores an area drawn on a cropped preview in original-photo coordinates', () => {
    const edit = {
      ...freshEdit(),
      crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
    }
    const rect = sourceRect({ x: 0.5, y: 0.5 }, { x: 0, y: 0 }, edit, 1)
    expect(rect.x).toBeCloseTo(0.2)
    expect(rect.y).toBeCloseTo(0.2)
    expect(rect.width).toBeCloseTo(0.25)
    expect(rect.height).toBeCloseTo(0.25)
  })
})
