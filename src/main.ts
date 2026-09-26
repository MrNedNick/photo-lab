import './style.css'
import {
  cropToAspect,
  dimensions,
  freshEdit,
  History,
  MAX_REDACTIONS,
  sourceRect,
  type BackgroundMode,
  type Crop,
  type Edit,
} from './model'
import { readProject, saveProject, type Project } from './storage'
import { Renderer } from './renderer'
import { icon } from './icons'

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!
const $$ = <T extends HTMLElement = HTMLElement>(selector: string) => [
  ...document.querySelectorAll<T>(selector),
]
const adjustments = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01 },
  { key: 'temperature', label: 'Warmth', min: -1, max: 1, step: 0.01 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
] as const
type AdjustKey = (typeof adjustments)[number]['key']
const looks: {
  id: string
  label: string
  values: Partial<Record<AdjustKey, number>>
}[] = [
  { id: 'natural', label: 'Original', values: {} },
  {
    id: 'vivid',
    label: 'Vivid',
    values: { contrast: 0.15, saturation: 0.35, exposure: 0.05 },
  },
  {
    id: 'warm',
    label: 'Golden',
    values: { temperature: 0.55, exposure: 0.15, saturation: 0.12 },
  },
  { id: 'cool', label: 'Cool', values: { temperature: -0.45, contrast: 0.08 } },
  { id: 'mono', label: 'Mono', values: { saturation: -1, contrast: 0.18 } },
  {
    id: 'fade',
    label: 'Soft',
    values: { contrast: -0.2, exposure: 0.2, saturation: -0.15 },
  },
  {
    id: 'noir',
    label: 'Noir',
    values: { saturation: -1, contrast: 0.45, vignette: 0.55, exposure: -0.1 },
  },
]
const cropPresets = [
  { ratio: 0, label: 'Free', use: 'Any shape' },
  { ratio: -1, label: 'Original', use: 'Photo shape' },
  { ratio: 1, label: '1:1', use: 'Instagram post' },
  { ratio: 0.8, label: '4:5', use: 'Instagram portrait' },
  { ratio: 9 / 16, label: '9:16', use: 'Stories, Reels' },
  { ratio: 16 / 9, label: '16:9', use: 'YouTube, slides' },
  { ratio: 1.5, label: '3:2', use: 'Print photo' },
  { ratio: 1 / Math.SQRT2, label: 'A4', use: 'Document' },
]
const tools = [
  { id: 'adjust', label: 'Adjust' },
  { id: 'crop', label: 'Crop' },
  { id: 'background', label: 'Background' },
  { id: 'retouch', label: 'Blur area' },
] as const
type Tool = (typeof tools)[number]['id']
const swatches = [
  '#ffffff',
  '#111111',
  '#e9e4da',
  '#c5ec82',
  '#8fb8ff',
  '#f4a7b9',
]

$('#app').innerHTML = `
<div class="app">
<header class="topbar">
  <a class="brand" href="./" aria-label="Photo Lab home"><span class="brand-mark" aria-hidden="true"></span><span>Photo Lab</span></a>
  <span class="badge" title="Photo Lab is free, needs no account and never uploads your photos">Free · No sign-up<span class="badge-long"> · Stays on your device</span></span>
  <div class="file-info"><span id="filename">No photo yet</span><span id="file-size" class="muted"></span></div>
  <div class="top-actions">
    <button id="undo" class="icon-button" aria-label="Undo last edit" title="Undo (Ctrl/⌘ Z)" disabled>${icon('undo')}</button>
    <button id="redo" class="icon-button" aria-label="Redo last edit" title="Redo (Ctrl/⌘ Shift Z)" disabled>${icon('redo')}</button>
    <button id="compare" class="icon-button" aria-pressed="false" aria-label="Compare with original" title="Compare with original (hold Space for a quick look)" disabled>${icon('compare')}</button>
    <button id="theme" class="icon-button" aria-label="Switch to light theme">${icon('sun')}</button>
    <button id="open" class="button">${icon('open')}<span>Open</span></button>
    <button id="export" class="button primary" disabled>${icon('download')}<span>Export</span></button>
  </div>
</header>
<nav class="rail" aria-label="Tools" role="tablist">
  ${tools.map((t, i) => `<button role="tab" id="tab-${t.id}" data-tool="${t.id}" aria-controls="panel-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${icon(t.id)}<span>${t.label}</span></button>`).join('')}
</nav>
<main class="stage-area">
  <input id="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden>
  <div id="stage" class="stage">
    <div id="empty" class="empty">
      <div class="empty-icon">${icon('image')}</div>
      <h1>Free photo editor</h1>
      <p>Drop a photo here, paste it with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>V</kbd>, or pick one from your device.</p>
      <div class="empty-actions"><button id="choose" class="button primary large">${icon('open')}<span>Open a photo</span></button><button id="sample" class="button large">Try a sample image</button></div>
      <p class="formats">Crop, adjust, remove the background, blur faces and plates. JPEG, PNG, WebP, AVIF up to 50 MP. Your photo never leaves this device.</p>
    </div>
    <div id="canvas-wrap" class="canvas-wrap" hidden>
      <canvas id="canvas" aria-label="Edited photo preview"></canvas>
      <div id="crop-overlay" class="crop-overlay" hidden><div id="crop-box" tabindex="0" role="group" aria-label="Crop frame. Arrow keys move it, Shift makes larger steps."><span data-corner="nw"></span><span data-corner="ne"></span><span data-corner="sw"></span><span data-corner="se"></span></div></div>
      <div id="draw-overlay" class="draw-overlay" hidden><div id="draw-rect" hidden></div></div>
      <div id="split" class="split" role="slider" tabindex="0" aria-label="Before and after divider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" hidden><span>Before</span><span>After</span></div>
    </div>
    <div id="loading" class="loading" hidden><span class="spinner"></span><p id="loading-text">Opening your photo…</p></div>
  </div>
  <div class="status-bar"><span id="dimensions"></span><span id="save-status">Nothing leaves this device</span></div>
</main>
<aside class="panel" aria-label="Tool settings">
<fieldset id="edit-tools" disabled><legend class="sr-only">Photo adjustments</legend>
  <section id="panel-adjust" role="tabpanel" aria-labelledby="tab-adjust" data-panel="adjust">
    <div class="panel-heading"><h2>Adjust</h2><button id="reset" class="text-button">Reset all</button></div>
    <h3>Looks</h3>
    <div class="looks">${looks.map((l) => `<button class="look" data-look="${l.id}" aria-label="${l.label}"><canvas width="96" height="72" aria-hidden="true"></canvas><span>${l.label}</span></button>`).join('')}</div>
    <h3>Light &amp; color</h3>
    ${adjustments.map((a) => `<div class="adjustment"><label for="${a.key}">${a.label}</label><output for="${a.key}" id="${a.key}-value">0</output><input id="${a.key}" type="range" min="${a.min}" max="${a.max}" step="${a.step}" value="0"></div>`).join('')}
    <h3>Histogram</h3>
    <canvas id="histogram" width="256" height="64" role="img" aria-label="Red, green and blue tonal distribution"></canvas>
  </section>
  <section id="panel-crop" role="tabpanel" aria-labelledby="tab-crop" data-panel="crop" hidden>
    <div class="panel-heading"><h2>Crop &amp; rotate</h2></div>
    <h3>Frame</h3>
    <div class="presets">${cropPresets.map((p, i) => `<button class="preset" data-ratio="${p.ratio}" aria-pressed="${i === 0}"><strong>${p.label}</strong><span>${p.use}</span></button>`).join('')}</div>
    <div id="crop-actions" class="row" hidden><button id="crop-apply" class="button primary">Apply crop</button><button id="crop-cancel" class="button">Cancel</button></div>
    <p class="hint">Drag the frame or its corners. Arrow keys move it.</p>
    <h3>Straighten</h3>
    <div class="adjustment"><label for="straighten">Horizon</label><output id="straighten-value" for="straighten">0°</output><input id="straighten" type="range" min="-45" max="45" step="0.1" value="0"></div>
    <div class="composition"><button id="rotate" class="button" aria-label="Rotate clockwise">${icon('rotate')}<span>Rotate</span></button><button id="flip-x" class="button" aria-label="Flip horizontally">${icon('flipX')}<span>Flip</span></button><button id="flip-y" class="button" aria-label="Flip vertically">${icon('flipY')}<span>Flip</span></button></div>
  </section>
  <section id="panel-background" role="tabpanel" aria-labelledby="tab-background" data-panel="background" hidden>
    <div class="panel-heading"><h2>Background</h2></div>
    <p class="hint">Cut out the main subject. It runs on this device — the model (4.6 MB) downloads once, your photo stays here.</p>
    <button id="remove-bg" class="button primary wide">${icon('background')}<span>Remove background</span></button>
    <p id="bg-status" class="hint" role="status"></p>
    <div id="bg-options" hidden>
      <h3>Behind the subject</h3>
      <div class="chips">${(['keep', 'transparent', 'color', 'blur'] as const).map((m) => `<button class="chip" data-bg="${m}" aria-pressed="false">${{ keep: 'Original', transparent: 'Transparent', color: 'Color', blur: 'Blur' }[m]}</button>`).join('')}</div>
      <div id="bg-colors" class="swatches" hidden>${swatches.map((c) => `<button class="swatch" data-color="${c}" style="--swatch:${c}" aria-label="Background ${c}"></button>`).join('')}<label class="swatch custom" aria-label="Pick any color"><input id="bg-color" type="color" value="#ffffff"></label></div>
    </div>
  </section>
  <section id="panel-retouch" role="tabpanel" aria-labelledby="tab-retouch" data-panel="retouch" hidden>
    <div class="panel-heading"><h2>Blur an area</h2></div>
    <p class="hint">Hide a face, a number plate or an address before you share. Drag over the area on the photo.</p>
    <div class="chips"><button class="chip" data-mode="blur" aria-pressed="true">Blur</button><button class="chip" data-mode="pixelate" aria-pressed="false">Pixelate</button></div>
    <button id="draw-area" class="button primary wide" aria-pressed="false">${icon('retouch')}<span>Draw an area</span></button>
    <ol id="areas" class="areas"></ol>
    <button id="clear-areas" class="text-button" hidden>Remove all areas</button>
  </section>
  <button id="forget" class="text-button forget">Clear saved photo</button>
</fieldset>
</aside>
</div>
<div id="notice" role="status" aria-live="polite" hidden><span id="notice-text"></span><button id="retry" class="text-button" hidden>Try again</button><button id="dismiss" class="icon-button" aria-label="Dismiss message">${icon('close')}</button></div>
<dialog id="export-dialog"><form method="dialog">
  <div class="panel-heading"><h2>Export</h2><button class="icon-button" aria-label="Close export dialog">${icon('close')}</button></div>
  <p class="hint">A new file with every edit. Your original stays untouched.</p>
  <label for="format">Format</label><select id="format"><option value="image/jpeg">JPEG · smallest for photos</option><option value="image/png">PNG · lossless, keeps transparency</option></select>
  <label for="quality">Quality <output id="quality-value">92%</output></label><input id="quality" type="range" min="10" max="100" value="92">
  <label for="export-size">Size</label><select id="export-size"><option value="full">Full resolution</option><option value="2048">2048 px long edge</option><option value="1080">1080 px long edge · social</option><option value="0.5">50%</option><option value="0.25">25%</option><option value="custom">Custom width…</option></select>
  <div id="custom-size" hidden><label for="custom-width">Width in pixels</label><input id="custom-width" type="number" min="16" step="1" inputmode="numeric"></div>
  <p id="export-dimensions" class="hint"></p>
  <p id="export-estimate" class="hint" aria-live="polite"></p>
  <p id="export-status" role="status"></p>
  <div class="dialog-actions">
    <button id="download" type="button" class="button primary">${icon('download')}<span>Download</span></button>
    <button id="copy" type="button" class="button" hidden>${icon('copy')}<span>Copy image</span></button>
    <button id="share" type="button" class="button" hidden>${icon('share')}<span>Share</span></button>
    <button id="cancel-export" type="button" class="button" hidden>Cancel export</button>
    <a id="download-again" class="text-button" hidden>Download again</a>
  </div>
</form></dialog>`

let history = new History(),
  edit = history.current
let photo: Blob | undefined,
  mask: Blob | undefined,
  name = '',
  width = 0,
  height = 0
let renderer: Renderer | undefined,
  worker: Worker | undefined,
  exportWorker: Worker | undefined,
  segmentWorker: Worker | undefined,
  exportReject: ((reason: Error) => void) | undefined
let loadId = 0,
  histogramId = 0,
  frame = 0,
  histTimer = 0,
  thumbTimer = 0,
  thumbId = 0
let tool: Tool = 'adjust'
let cropActive = false,
  cropRatio = 0,
  draftCrop: Crop = freshEdit().crop
let comparing = false,
  holdOriginal = false,
  splitAt = 0.5
let drawing = false,
  redactMode: 'blur' | 'pixelate' = 'blur'
let retry: (() => void) | undefined
let exportUrl: string | undefined
let persistChain = Promise.resolve()
const channel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('photo-lab')
    : undefined
const canvas = $<HTMLCanvasElement>('#canvas')

function announce(message: string, action?: () => void) {
  $('#notice').hidden = false
  $('#notice-text').textContent = message
  retry = action
  $('#retry').hidden = !action
}
$('#dismiss').onclick = () => {
  $('#notice').hidden = true
}
$('#retry').onclick = () => retry?.()

function setTheme(theme: string) {
  document.documentElement.dataset.theme = theme
  $('#theme').setAttribute(
    'aria-label',
    `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
  )
  $('#theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon')
  try {
    localStorage.setItem('photo-lab-theme', theme)
  } catch {
    /* Theme remains available without storage. */
  }
}
let theme = 'dark'
try {
  theme = localStorage.getItem('photo-lab-theme') || theme
} catch {
  /* Use the default theme. */
}
setTheme(theme)
$('#theme').onclick = () =>
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')

/* ---------- tools ---------- */
function selectTool(next: Tool, focus = false) {
  if (tool === 'crop' && next !== 'crop' && cropActive) endCrop()
  if (next !== 'retouch') setDrawing(false)
  tool = next
  for (const tab of $$('[data-tool]')) {
    const on = tab.dataset.tool === next
    tab.setAttribute('aria-selected', String(on))
    tab.tabIndex = on ? 0 : -1
    if (on && focus) tab.focus()
  }
  for (const panel of $$('[data-panel]'))
    panel.hidden = panel.dataset.panel !== next
  if (next === 'crop' && photo) beginCrop()
}
for (const tab of $$('[data-tool]')) {
  tab.onclick = () => selectTool(tab.dataset.tool as Tool)
  tab.onkeydown = (e) => {
    const index = tools.findIndex((t) => t.id === tab.dataset.tool)
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
      e.key
    ]
    if (!step) return
    e.preventDefault()
    selectTool(tools[(index + step + tools.length) % tools.length]!.id, true)
  }
}

/* ---------- view ---------- */
function outputAspect() {
  const size = dimensions(width, height, edit)
  return size.width / size.height
}
function syncControls() {
  for (const a of adjustments) {
    $<HTMLInputElement>(`#${a.key}`).value = String(edit[a.key])
    $(`#${a.key}-value`).textContent =
      a.key === 'exposure'
        ? `${edit[a.key].toFixed(2)} EV`
        : String(Math.round(edit[a.key] * 100))
  }
  $<HTMLInputElement>('#straighten').value = String(edit.straighten)
  $('#straighten-value').textContent = `${edit.straighten.toFixed(1)}°`
  $<HTMLButtonElement>('#undo').disabled = !photo || history.index === 0
  $<HTMLButtonElement>('#redo').disabled =
    !photo || history.index === history.entries.length - 1
  const size = dimensions(width, height, edit)
  $('#dimensions').textContent = photo
    ? `${size.width.toLocaleString('en-US')} × ${size.height.toLocaleString('en-US')} px`
    : ''
  $('#compare').setAttribute('aria-pressed', String(comparing))
  $('#split').hidden = !comparing || cropActive
  $('#split').style.left = `${splitAt * 100}%`
  $('#split').setAttribute('aria-valuenow', String(Math.round(splitAt * 100)))
  $('#remove-bg').hidden = !!mask && edit.background !== 'keep'
  $('#bg-options').hidden = !mask
  for (const chip of $$('[data-bg]'))
    chip.setAttribute(
      'aria-pressed',
      String(chip.dataset.bg === edit.background),
    )
  $('#bg-colors').hidden = edit.background !== 'color'
  $<HTMLInputElement>('#bg-color').value = edit.backgroundColor
  renderAreas()
}
function fitCanvas() {
  const stage = $('#stage'),
    pad = innerWidth < 760 ? 16 : 40
  const room = {
    width: Math.max(1, stage.clientWidth - pad),
    height: Math.max(1, stage.clientHeight - pad),
  }
  const ratio = canvas.width / canvas.height
  const w = Math.min(room.width, room.height * ratio)
  $('#canvas-wrap').style.width = `${Math.floor(w)}px`
  $('#canvas-wrap').style.height = `${Math.floor(w / ratio)}px`
}
/** While cropping the whole photo is shown, colors included, so the frame
 * can be drawn over it in original-photo coordinates. */
const cropView = (): Edit => ({
  ...edit,
  crop: freshEdit().crop,
  rotation: 0,
  straighten: 0,
  flipX: false,
  flipY: false,
})
function previewEdge() {
  const stage = $('#stage')
  return Math.min(
    1600,
    Math.max(
      640,
      Math.round(
        Math.max(stage.clientWidth, stage.clientHeight) *
          Math.min(devicePixelRatio || 1, 2),
      ),
    ),
  )
}
function paint() {
  if (!renderer || !photo) return
  const shown = cropActive ? cropView() : edit
  const split = cropActive ? -1 : holdOriginal ? 2 : comparing ? splitAt : -1
  renderer.render(shown, previewEdge(), split)
  fitCanvas()
  syncControls()
  if (!histTimer)
    histTimer = window.setTimeout(() => {
      histTimer = 0
      worker?.postMessage({ kind: 'histogram', id: ++histogramId, edit: shown })
    }, 100)
}
function render() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(paint)
}
/** Look previews are rendered by the photo worker, off the main thread. */
function drawThumbs() {
  clearTimeout(thumbTimer)
  thumbTimer = window.setTimeout(() => {
    if (!photo) return
    const base = freshEdit()
    const edits = looks.map((look) => {
      const preview: Edit = structuredClone(edit)
      for (const a of adjustments)
        preview[a.key] = look.values[a.key] ?? base[a.key]
      return preview
    })
    worker?.postMessage({ kind: 'thumbs', id: ++thumbId, edits, max: 160 })
  }, 180)
}
function showThumbs(images: ImageData[]) {
  looks.forEach((look, i) => {
    const target = $<HTMLCanvasElement>(`[data-look="${look.id}"] canvas`),
      image = images[i]!
    target.width = image.width
    target.height = image.height
    target.getContext('2d')!.putImageData(image, 0, 0)
  })
}
function persist() {
  if (!photo) return
  const project: Project = {
    file: photo,
    name,
    entries: structuredClone(history.entries),
    index: history.index,
    updated: Date.now(),
    mask,
  }
  $('#save-status').textContent = 'Saving on this device…'
  persistChain = persistChain
    .catch(() => {})
    .then(() => saveProject(project))
    .then(() => {
      $('#save-status').textContent = 'Saved on this device'
      channel?.postMessage('updated')
    })
    .catch(() => {
      $('#save-status').textContent = 'Not saved'
      announce(
        'Your browser could not save this photo locally. You can still edit and export it.',
        persist,
      )
    })
}
function commit() {
  history.push(edit)
  syncControls()
  render()
  drawThumbs()
  persist()
}
function setBusy(busy: boolean, text = 'Opening your photo…') {
  $('#loading').hidden = !busy
  $('#loading-text').textContent = text
  $<HTMLFieldSetElement>('#edit-tools').disabled = busy || !photo
  $<HTMLButtonElement>('#export').disabled = busy || !photo
  $<HTMLButtonElement>('#compare').disabled = busy || !photo
}
function drawHistogram(bins: number[][]) {
  const target = $<HTMLCanvasElement>('#histogram'),
    ctx = target.getContext('2d')!
  ctx.clearRect(0, 0, 256, 64)
  const peak = Math.max(1, ...bins.flat())
  const colors = ['#ef7a80', '#a9d98c', '#80b5f1']
  bins.forEach((values, index) => {
    ctx.fillStyle = colors[index]!
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.moveTo(0, 64)
    values.forEach((count, x) =>
      ctx.lineTo(x, 64 - Math.sqrt(count / peak) * 60),
    )
    ctx.lineTo(256, 64)
    ctx.closePath()
    ctx.fill()
  })
}

/* ---------- opening ---------- */
async function openPhoto(file: Blob, filename: string, saved?: Project) {
  if (file.size > 50 * 1024 * 1024) {
    announce('Choose a photo smaller than 50 MB.')
    return
  }
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)
  ) {
    announce('Choose a JPEG, PNG, WebP or AVIF photo.')
    return
  }
  if (!('OffscreenCanvas' in window) || !('createImageBitmap' in window)) {
    announce(
      'This browser does not support the photo workspace. Try a current Chrome, Firefox or Safari browser.',
    )
    return
  }
  // The worker lives for the whole session; stale replies are dropped by id.
  worker ||= new Worker(new URL('./photo.worker.ts', import.meta.url), {
    type: 'module',
  })
  const id = ++loadId
  endCrop()
  setDrawing(false)
  setBusy(true)
  const started = performance.now()
  worker.onmessage = async ({ data }) => {
    if (id !== loadId) return
    // A reply to an earlier photo can still arrive from the shared worker.
    if ((data.kind === 'load' || data.kind === 'error') && data.id !== id)
      return
    if (data.kind === 'load') {
      try {
        renderer ||= new Renderer(canvas)
        renderer.load(data.bitmap)
        data.bitmap.close()
        const savedMask = saved?.mask
          ? await createImageBitmap(saved.mask)
          : null
        renderer.loadMask(savedMask)
        savedMask?.close()
        worker!.postMessage({ kind: 'mask', id, mask: saved?.mask ?? null })
        photo = file
        mask = saved?.mask
        name = filename
        width = data.width
        height = data.height
        history = saved
          ? new History(saved.entries, saved.index)
          : new History()
        edit = history.current
        comparing = false
        $('#filename').textContent = name
        $('#file-size').textContent =
          `${(file.size / 1024 / 1024).toFixed(1)} MB`
        $('#empty').hidden = true
        $('#canvas-wrap').hidden = false
        $('#notice').hidden = true
        $('#bg-status').textContent = ''
        setBusy(false)
        // Controls are synced here as well as on paint: a background tab
        // gets no animation frames, but its sliders must still follow.
        syncControls()
        render()
        drawThumbs()
        if (!saved) persist()
        else $('#save-status').textContent = 'Saved on this device'
        if (tool === 'crop') beginCrop()
        performance.measure('photo-open', {
          start: started,
          end: performance.now(),
        })
      } catch (error) {
        setBusy(false)
        announce(String(error), () => void openPhoto(file, filename, saved))
      }
    } else if (data.kind === 'histogram' && data.id === histogramId)
      drawHistogram(data.bins)
    else if (data.kind === 'thumbs' && data.id === thumbId)
      showThumbs(data.images)
    else if (data.kind === 'error') {
      setBusy(false)
      announce(
        `Unable to open photo: ${data.message}`,
        () => void openPhoto(file, filename, saved),
      )
    }
  }
  worker.onerror = () => {
    worker?.terminate()
    worker = undefined
    setBusy(false)
    announce(
      'The photo worker stopped. Please reopen your photo.',
      () => void openPhoto(file, filename, saved),
    )
  }
  worker.postMessage({ id, kind: 'load', file })
}
const choose = () => $<HTMLInputElement>('#file').click()
$('#open').onclick = choose
$('#choose').onclick = choose
$<HTMLInputElement>('#file').onchange = (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void openPhoto(file, file.name)
  input.value = ''
}
$('#stage').ondragover = (e) => {
  e.preventDefault()
  $('#stage').classList.add('dragging')
}
$('#stage').ondragleave = () => $('#stage').classList.remove('dragging')
$('#stage').ondrop = (e) => {
  e.preventDefault()
  $('#stage').classList.remove('dragging')
  const file = e.dataTransfer?.files[0]
  if (file) void openPhoto(file, file.name)
}
document.addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files ?? [])].find((f) =>
    f.type.startsWith('image/'),
  )
  if (!file) return
  e.preventDefault()
  void openPhoto(
    file,
    file.name && file.name !== 'image.png' ? file.name : 'Pasted image.png',
  )
})
$('#sample').onclick = () => {
  const demo = document.createElement('canvas')
  demo.width = 2400
  demo.height = 1600
  const ctx = demo.getContext('2d')!,
    sky = ctx.createLinearGradient(0, 0, 0, 1600)
  sky.addColorStop(0, '#85b8b9')
  sky.addColorStop(0.55, '#f5d7b2')
  sky.addColorStop(1, '#e79670')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 2400, 1600)
  ctx.fillStyle = '#ffedc4'
  ctx.beginPath()
  ctx.arc(1740, 430, 180, 0, Math.PI * 2)
  ctx.fill()
  for (const [color, y, amplitude] of [
    ['#849d94', 780, 200],
    ['#426f6a', 1010, 220],
    ['#214d4b', 1280, 180],
  ] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, 1600)
    for (let x = 0; x <= 2400; x += 10)
      ctx.lineTo(x, y + Math.sin(x / 410) * amplitude + Math.cos(x / 190) * 70)
    ctx.lineTo(2400, 1600)
    ctx.fill()
  }
  demo.toBlob((blob) => {
    if (blob) void openPhoto(blob, 'Quiet hills.png')
  }, 'image/png')
}

/* ---------- adjust ---------- */
for (const a of adjustments) {
  $<HTMLInputElement>(`#${a.key}`).oninput = (event) => {
    edit[a.key] = +(event.target as HTMLInputElement).value
    syncControls()
    render()
  }
  $<HTMLInputElement>(`#${a.key}`).onchange = commit
}
for (const button of $$<HTMLButtonElement>('[data-look]'))
  button.onclick = () => {
    const look = looks.find((l) => l.id === button.dataset.look)!,
      base = freshEdit()
    for (const a of adjustments) edit[a.key] = look.values[a.key] ?? base[a.key]
    commit()
  }
$('#reset').onclick = () => {
  edit = {
    ...freshEdit(),
    background: edit.background,
    backgroundColor: edit.backgroundColor,
  }
  endCrop()
  commit()
}

/* ---------- crop & geometry ---------- */
$<HTMLInputElement>('#straighten').oninput = (e) => {
  edit.straighten = +(e.target as HTMLInputElement).value
  if (cropActive) endCrop()
  $('#canvas-wrap').classList.add('show-grid')
  syncControls()
  render()
}
$<HTMLInputElement>('#straighten').onchange = () => {
  $('#canvas-wrap').classList.remove('show-grid')
  commit()
}
$('#rotate').onclick = () => {
  edit.rotation = (edit.rotation + 90) % 360
  endCrop()
  commit()
}
$('#flip-x').onclick = () => {
  edit.flipX = !edit.flipX
  endCrop()
  commit()
}
$('#flip-y').onclick = () => {
  edit.flipY = !edit.flipY
  endCrop()
  commit()
}
function drawCrop() {
  const box = $('#crop-box')
  box.style.left = `${draftCrop.x * 100}%`
  box.style.top = `${draftCrop.y * 100}%`
  box.style.width = `${draftCrop.width * 100}%`
  box.style.height = `${draftCrop.height * 100}%`
}
/** Preset ratios describe the finished photo; with a quarter turn applied the
 * frame on the unrotated original has the inverse shape. */
function sourceRatio(ratio: number) {
  if (ratio === -1) return width / height
  if (!ratio) return 0
  return edit.rotation % 180 ? 1 / ratio : ratio
}
function beginCrop() {
  if (!photo || cropActive) return
  cropActive = true
  comparing = false
  draftCrop = structuredClone(edit.crop)
  $('#crop-overlay').hidden = false
  $('#crop-actions').hidden = false
  drawCrop()
  render()
}
function endCrop() {
  if (!cropActive) return
  cropActive = false
  $('#crop-overlay').hidden = true
  $('#crop-actions').hidden = true
  render()
}
for (const button of $$<HTMLButtonElement>('[data-ratio]'))
  button.onclick = () => {
    cropRatio = +button.dataset.ratio!
    for (const b of $$('[data-ratio]'))
      b.setAttribute('aria-pressed', String(b === button))
    beginCrop()
    const ratio = sourceRatio(cropRatio)
    if (ratio) draftCrop = cropToAspect(width, height, ratio)
    drawCrop()
    $('#crop-box').focus()
  }
$('#crop-apply').onclick = () => {
  edit.crop = structuredClone(draftCrop)
  endCrop()
  commit()
  selectTool('adjust')
}
$('#crop-cancel').onclick = () => {
  endCrop()
  selectTool('adjust')
}
type Drag = { x: number; y: number; start: Crop; corner?: string }
let drag: Drag | undefined
$('#crop-box').onpointerdown = (e) => {
  const corner = (e.target as HTMLElement).dataset.corner
  drag = {
    x: e.clientX,
    y: e.clientY,
    start: structuredClone(draftCrop),
    corner,
  }
  $('#crop-box').setPointerCapture(e.pointerId)
}
function moveCrop(x: number, y: number) {
  draftCrop.x = Math.max(0, Math.min(1 - draftCrop.width, x))
  draftCrop.y = Math.max(0, Math.min(1 - draftCrop.height, y))
  drawCrop()
}
function resizeCrop(d: Drag, dx: number, dy: number) {
  const s = d.start,
    west = d.corner!.includes('w'),
    north = d.corner!.includes('n')
  const anchorX = west ? s.x + s.width : s.x,
    anchorY = north ? s.y + s.height : s.y
  let w = Math.max(0.05, west ? s.width - dx : s.width + dx)
  let h = Math.max(0.05, north ? s.height - dy : s.height + dy)
  w = Math.min(w, west ? anchorX : 1 - anchorX)
  h = Math.min(h, north ? anchorY : 1 - anchorY)
  const ratio = sourceRatio(cropRatio)
  if (ratio) {
    const toH = width / height / ratio
    if (w * toH <= h) h = w * toH
    else w = h / toH
  }
  draftCrop = {
    x: west ? anchorX - w : anchorX,
    y: north ? anchorY - h : anchorY,
    width: w,
    height: h,
  }
  drawCrop()
}
$('#crop-box').onpointermove = (e) => {
  if (!drag) return
  const bounds = $('#crop-overlay').getBoundingClientRect()
  const dx = (e.clientX - drag.x) / bounds.width,
    dy = (e.clientY - drag.y) / bounds.height
  if (drag.corner) resizeCrop(drag, dx, dy)
  else moveCrop(drag.start.x + dx, drag.start.y + dy)
}
$('#crop-box').onpointerup = () => {
  drag = undefined
}
$('#crop-box').onpointercancel = () => {
  drag = undefined
}
$('#crop-box').onkeydown = (e) => {
  const delta = e.shiftKey ? 0.05 : 0.01
  const movement: Record<string, number[]> = {
    ArrowLeft: [-delta, 0],
    ArrowRight: [delta, 0],
    ArrowUp: [0, -delta],
    ArrowDown: [0, delta],
  }
  if (movement[e.key]) {
    e.preventDefault()
    moveCrop(
      draftCrop.x + movement[e.key]![0]!,
      draftCrop.y + movement[e.key]![1]!,
    )
  }
  if (e.key === 'Enter') $('#crop-apply').click()
  if (e.key === 'Escape') $('#crop-cancel').click()
}

/* ---------- background ---------- */
function removeBackground() {
  if (!photo) return
  if (mask) {
    edit.background = 'transparent'
    commit()
    return
  }
  const id = loadId,
    source = photo
  segmentWorker ||= new Worker(
    new URL('./segment.worker.ts', import.meta.url),
    { type: 'module' },
  )
  $<HTMLButtonElement>('#remove-bg').disabled = true
  $('#bg-status').textContent = 'Preparing…'
  const fail = (message: string) => {
    $<HTMLButtonElement>('#remove-bg').disabled = false
    $('#bg-status').textContent = ''
    setBusy(false)
    announce(message, removeBackground)
  }
  segmentWorker.onmessage = async ({ data }) => {
    if (id !== loadId || source !== photo) return
    if (data.kind === 'progress') {
      const text =
        data.value === 'model'
          ? 'Loading the cut-out model — only the first time…'
          : 'Finding the subject…'
      $('#bg-status').textContent = text
      setBusy(true, text)
    } else if (data.kind === 'error') fail(data.message)
    else if (data.kind === 'mask') {
      try {
        const bitmap = await createImageBitmap(data.blob)
        renderer!.loadMask(bitmap)
        bitmap.close()
        mask = data.blob
        worker?.postMessage({ kind: 'mask', id, mask })
        setBusy(false)
        $<HTMLButtonElement>('#remove-bg').disabled = false
        $('#bg-status').textContent =
          'Background removed. Pick what goes behind the subject.'
        edit.background = 'transparent'
        commit()
      } catch {
        fail('The cut-out could not be applied to this photo.')
      }
    }
  }
  segmentWorker.onerror = () => {
    segmentWorker?.terminate()
    segmentWorker = undefined
    fail(
      'The background could not be removed. Check your connection and try again.',
    )
  }
  segmentWorker.postMessage({ id, file: photo, max: 2048 })
}
$('#remove-bg').onclick = removeBackground
for (const chip of $$<HTMLButtonElement>('[data-bg]'))
  chip.onclick = () => {
    edit.background = chip.dataset.bg as BackgroundMode
    commit()
  }
for (const swatch of $$<HTMLButtonElement>('[data-color]'))
  swatch.onclick = () => {
    edit.backgroundColor = swatch.dataset.color!
    commit()
  }
$<HTMLInputElement>('#bg-color').oninput = (e) => {
  edit.backgroundColor = (e.target as HTMLInputElement).value
  render()
}
$<HTMLInputElement>('#bg-color').onchange = commit

/* ---------- blur an area ---------- */
function setDrawing(on: boolean) {
  drawing = on && !!photo
  if (drawing) {
    comparing = false
    endCrop()
  }
  $('#draw-overlay').hidden = !drawing
  $('#draw-area').setAttribute('aria-pressed', String(drawing))
  $('#draw-area').querySelector('span')!.textContent = drawing
    ? 'Drag over the photo…'
    : 'Draw an area'
  render()
}
function renderAreas() {
  const list = $('#areas')
  list.innerHTML = edit.redactions
    .map(
      (r, i) =>
        `<li><span>Area ${i + 1} · ${r.mode === 'pixelate' ? 'Pixelate' : 'Blur'}</span><button class="icon-button" data-remove="${i}" aria-label="Remove area ${i + 1}">${icon('close')}</button></li>`,
    )
    .join('')
  for (const b of list.querySelectorAll<HTMLButtonElement>('[data-remove]'))
    b.onclick = () => {
      edit.redactions.splice(+b.dataset.remove!, 1)
      commit()
    }
  $('#clear-areas').hidden = !edit.redactions.length
  $<HTMLButtonElement>('#draw-area').disabled =
    edit.redactions.length >= MAX_REDACTIONS
}
for (const chip of $$<HTMLButtonElement>('[data-mode]'))
  chip.onclick = () => {
    redactMode = chip.dataset.mode as 'blur' | 'pixelate'
    for (const c of $$('[data-mode]'))
      c.setAttribute('aria-pressed', String(c === chip))
  }
$('#draw-area').onclick = () => setDrawing(!drawing)
$('#clear-areas').onclick = () => {
  edit.redactions = []
  commit()
}
let sketch: { x: number; y: number } | undefined
const overlayPoint = (e: PointerEvent) => {
  const r = $('#draw-overlay').getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  }
}
$('#draw-overlay').onpointerdown = (e) => {
  sketch = overlayPoint(e)
  $('#draw-overlay').setPointerCapture(e.pointerId)
}
$('#draw-overlay').onpointermove = (e) => {
  if (!sketch) return
  const p = overlayPoint(e),
    rect = $('#draw-rect')
  rect.hidden = false
  rect.style.left = `${Math.min(p.x, sketch.x) * 100}%`
  rect.style.top = `${Math.min(p.y, sketch.y) * 100}%`
  rect.style.width = `${Math.abs(p.x - sketch.x) * 100}%`
  rect.style.height = `${Math.abs(p.y - sketch.y) * 100}%`
}
$('#draw-overlay').onpointerup = (e) => {
  if (!sketch) return
  const end = overlayPoint(e),
    start = sketch
  sketch = undefined
  $('#draw-rect').hidden = true
  if (Math.abs(end.x - start.x) < 0.01 || Math.abs(end.y - start.y) < 0.01)
    return
  edit.redactions.push({
    ...sourceRect(start, end, edit, outputAspect()),
    mode: redactMode,
  })
  setDrawing(false)
  commit()
}

/* ---------- history & compare ---------- */
function undo() {
  if (!photo || cropActive) return
  edit = history.undo()
  syncControls()
  render()
  drawThumbs()
  persist()
}
function redo() {
  if (!photo || cropActive) return
  edit = history.redo()
  syncControls()
  render()
  drawThumbs()
  persist()
}
$('#undo').onclick = undo
$('#redo').onclick = redo
$('#compare').onclick = () => {
  comparing = !comparing
  if (comparing) {
    endCrop()
    setDrawing(false)
  }
  render()
}
$('#split').onpointerdown = (e) => {
  $('#split').setPointerCapture(e.pointerId)
  $('#split').onpointermove = (m) => {
    const r = $('#canvas-wrap').getBoundingClientRect()
    splitAt = Math.max(0, Math.min(1, (m.clientX - r.left) / r.width))
    render()
  }
}
$('#split').onpointerup = () => {
  $('#split').onpointermove = null
}
$('#split').onkeydown = (e) => {
  const step = { ArrowLeft: -0.05, ArrowRight: 0.05 }[e.key]
  if (!step) return
  e.preventDefault()
  splitAt = Math.max(0, Math.min(1, splitAt + step))
  render()
}
const typing = (target: EventTarget | null) =>
  (target as HTMLElement | null)?.matches?.(
    'input,select,textarea,button,[role="slider"],[tabindex]',
  ) ?? false
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && photo && !e.repeat && !typing(e.target)) {
    e.preventDefault()
    holdOriginal = true
    render()
    return
  }
  if (
    !(e.metaKey || e.ctrlKey) ||
    e.key.toLowerCase() !== 'z' ||
    (e.target as HTMLElement).matches('input,select')
  )
    return
  e.preventDefault()
  if (e.shiftKey) redo()
  else undo()
})
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && holdOriginal) {
    holdOriginal = false
    render()
  }
})

/* ---------- export ---------- */
if ('OffscreenCanvas' in window)
  for (const [type, label] of [
    ['image/webp', 'WebP · small, keeps transparency'],
    ['image/avif', 'AVIF · smallest, newest browsers'],
  ] as const) {
    const probe = new OffscreenCanvas(1, 1)
    probe.getContext('2d')
    // Browsers that cannot encode a format quietly return PNG instead.
    void probe.convertToBlob({ type }).then(
      (blob) => {
        if (blob.type === type)
          $('#format').insertAdjacentHTML(
            'beforeend',
            `<option value="${type}">${label}</option>`,
          )
      },
      () => {},
    )
  }
function exportMax() {
  const choice = $<HTMLSelectElement>('#export-size').value,
    full = dimensions(width, height, edit),
    longest = Math.max(full.width, full.height)
  if (choice === 'full') return Infinity
  if (choice === 'custom') {
    const wanted = Math.max(
      16,
      +$<HTMLInputElement>('#custom-width').value || full.width,
    )
    return Math.round((longest * Math.min(wanted, full.width)) / full.width)
  }
  const n = +choice
  return n < 1 ? Math.round(longest * n) : n
}
function exportDimensions() {
  const size = dimensions(width, height, edit, exportMax())
  const format = $<HTMLSelectElement>('#format').value
  const note =
    mask && edit.background === 'transparent' && format === 'image/jpeg'
      ? ' · JPEG has no transparency, the background turns black'
      : ''
  $('#export-dimensions').textContent =
    `${size.width} × ${size.height} px · every edit included${note}`
  $<HTMLInputElement>('#quality').disabled = format === 'image/png'
  estimateSize(size, format)
}
let estimateTimer = 0
/** Encode the on-screen preview and scale by pixel count — rough, hence
 * "about", but enough to choose between formats before waiting for export. */
function estimateSize(size: { width: number; height: number }, format: string) {
  clearTimeout(estimateTimer)
  $('#export-estimate').textContent = ''
  estimateTimer = window.setTimeout(() => {
    paint() // a hidden tab may not have drawn a frame yet
    canvas.toBlob?.(
      (blob) => {
        if (!blob || blob.type !== format) return
        const scale =
            (size.width * size.height) / (canvas.width * canvas.height),
          mb = (blob.size * scale) / 1024 / 1024
        $('#export-estimate').textContent =
          `File size about ${mb < 0.1 ? 'under 0.1' : mb.toFixed(1)} MB`
      },
      format,
      +$<HTMLInputElement>('#quality').value / 100,
    )
  }, 250)
}
$('#export').onclick = () => {
  if (
    mask &&
    edit.background === 'transparent' &&
    $<HTMLSelectElement>('#format').value === 'image/jpeg'
  )
    $<HTMLSelectElement>('#format').value = 'image/png'
  $<HTMLInputElement>('#custom-width').value = String(
    dimensions(width, height, edit).width,
  )
  $('#copy').hidden = !('ClipboardItem' in window && navigator.clipboard?.write)
  $('#share').hidden = !navigator.canShare?.({
    files: [new File([''], 'x.png', { type: 'image/png' })],
  })
  $('#export-status').textContent = ''
  exportDimensions()
  $<HTMLDialogElement>('#export-dialog').showModal()
}
$('#export-size').onchange = () => {
  $('#custom-size').hidden =
    $<HTMLSelectElement>('#export-size').value !== 'custom'
  exportDimensions()
}
$('#custom-width').oninput = exportDimensions
$('#format').onchange = exportDimensions
$('#quality').oninput = () => {
  $('#quality-value').textContent = `${$<HTMLInputElement>('#quality').value}%`
  exportDimensions()
}
function exportBusy(busy: boolean) {
  $('#cancel-export').hidden = !busy
  for (const id of ['#download', '#copy', '#share'])
    $<HTMLButtonElement>(id).disabled = busy
}
function cancelExport() {
  exportWorker?.terminate()
  exportWorker = undefined
  exportReject?.(new Error('cancelled'))
  exportReject = undefined
  exportBusy(false)
}
$('#cancel-export').onclick = () => {
  cancelExport()
  $('#export-status').textContent = 'Export cancelled. Your edits are safe.'
}
$<HTMLDialogElement>('#export-dialog').onclose = cancelExport
function renderFile(format: string) {
  cancelExport()
  exportBusy(true)
  $('#export-status').textContent = 'Preparing export…'
  const started = performance.now()
  return new Promise<{ blob: Blob; width: number; height: number }>(
    (resolve, reject) => {
      exportReject = reject
      exportWorker = new Worker(new URL('./photo.worker.ts', import.meta.url), {
        type: 'module',
      })
      exportWorker.onmessage = ({ data }) => {
        if (data.kind === 'progress')
          $('#export-status').textContent = data.value
        else if (data.kind === 'error') {
          exportReject = undefined
          cancelExport()
          reject(new Error(data.message))
        } else if (data.kind === 'export') {
          performance.measure('photo-export', {
            start: started,
            end: performance.now(),
          })
          exportReject = undefined
          cancelExport()
          resolve(data)
        }
      }
      exportWorker.onerror = () => {
        exportReject = undefined
        cancelExport()
        reject(new Error('Export failed. Try a smaller output size.'))
      }
      exportWorker.postMessage({
        id: 1,
        kind: 'export',
        file: photo,
        mask: edit.background !== 'keep' ? mask : undefined,
        edit: structuredClone(edit),
        format,
        quality: +$<HTMLInputElement>('#quality').value / 100,
        max: exportMax(),
      })
    },
  )
}
const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
}
const fileName = (format: string) =>
  `${name.replace(/\.[^.]+$/, '')}-edited.${extensions[format] ?? 'png'}`
const ready = (r: { blob: Blob; width: number; height: number }) =>
  `Ready · ${r.width} × ${r.height} px · ${(r.blob.size / 1024 / 1024).toFixed(1)} MB`
const failed = (error: Error) => {
  if (error.message !== 'cancelled')
    $('#export-status').textContent = error.message
}
$('#download').onclick = () => {
  if (!photo) return
  const format = $<HTMLSelectElement>('#format').value
  $('#download-again').hidden = true
  renderFile(format).then((result) => {
    if (exportUrl) URL.revokeObjectURL(exportUrl)
    exportUrl = URL.createObjectURL(result.blob)
    const link = $<HTMLAnchorElement>('#download-again')
    link.href = exportUrl
    link.download = fileName(format)
    link.hidden = false
    link.click()
    $('#export-status').textContent = ready(result)
  }, failed)
}
$('#copy').onclick = () => {
  if (!photo) return
  // The clipboard item is created inside the click so Safari keeps the
  // permission while the image is still being rendered.
  const result = renderFile('image/png')
  let settled = false,
    timer = 0
  result.then(
    () => {
      $('#export-status').textContent = 'Copying to the clipboard…'
      // Some browsers leave the request pending instead of refusing it.
      timer = window.setTimeout(() => {
        if (!settled)
          failed(
            new Error(
              'The browser did not allow copying. Use Download instead.',
            ),
          )
      }, 6000)
    },
    () => {},
  )
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': result.then((r) => r.blob) })])
    .then(
      () =>
        result.then((r) => {
          settled = true
          clearTimeout(timer)
          $('#export-status').textContent =
            `Copied · ${r.width} × ${r.height} px. Paste it anywhere.`
        }),
      (error: Error) => {
        settled = true
        clearTimeout(timer)
        failed(
          error.message === 'cancelled'
            ? error
            : new Error(
                'Copying images is blocked in this browser. Use Download instead.',
              ),
        )
      },
    )
}
$('#share').onclick = () => {
  if (!photo) return
  const format = $<HTMLSelectElement>('#format').value
  renderFile(format).then(async (result) => {
    const file = new File([result.blob], fileName(format), { type: format })
    try {
      await navigator.share({ files: [file], title: name })
      $('#export-status').textContent = ready(result)
    } catch (error) {
      if ((error as Error).name !== 'AbortError')
        $('#export-status').textContent =
          'Sharing did not start. Use Download instead.'
    }
  }, failed)
}

/* ---------- workspace ---------- */
async function clearPhoto(broadcast = true) {
  loadId++
  photo = undefined
  mask = undefined
  history = new History()
  edit = history.current
  endCrop()
  setDrawing(false)
  comparing = false
  setBusy(false)
  $('#canvas-wrap').hidden = true
  $('#empty').hidden = false
  $('#filename').textContent = 'No photo yet'
  $('#file-size').textContent = ''
  $('#save-status').textContent = 'Nothing leaves this device'
  $('#bg-status').textContent = ''
  drawHistogram([[], [], []])
  syncControls()
  if (broadcast) {
    await persistChain
    await saveProject(null)
    channel?.postMessage('updated')
    announce('Saved photo and edit history cleared from this browser.')
  }
}
$('#forget').onclick = () => {
  void clearPhoto().catch(() =>
    announce(
      'Could not clear browser storage. Try again.',
      () => void clearPhoto(),
    ),
  )
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  announce('Graphics connection lost. Reopen your photo to continue.', () => {
    renderer = undefined
    if (photo)
      void openPhoto(photo, name, {
        file: photo,
        name,
        entries: history.entries,
        index: history.index,
        updated: Date.now(),
        mask,
      })
  })
})
async function restore() {
  try {
    const saved = await readProject()
    if (saved) await openPhoto(saved.file, saved.name, saved)
  } catch {
    announce(
      'Saved workspace could not be restored. You can open a photo to start again.',
    )
  }
}
if (channel)
  channel.onmessage = async () => {
    await persistChain
    try {
      const saved = await readProject()
      if (saved) {
        await openPhoto(saved.file, saved.name, saved)
        announce('Workspace updated from another tab.')
      } else await clearPhoto(false)
    } catch {
      announce('Could not sync the workspace from another tab.')
    }
  }
new ResizeObserver(() => render()).observe($('#stage'))
syncControls()
void restore()
