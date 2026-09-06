import './style.css'
import { cropToAspect, dimensions, freshEdit, History } from './model'
import { readProject, saveProject, type Project } from './storage'
import { Renderer } from './renderer'

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const adjustments = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: .01, unit: ' EV' },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: .01, unit: '' },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: .01, unit: '' },
  { key: 'temperature', label: 'Warmth', min: -1, max: 1, step: .01, unit: '' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: .01, unit: '' },
] as const
$('#app').innerHTML = `
<header class="header"><a class="brand" href="./" aria-label="Photo Lab home"><span class="brand-mark">◉</span> photo<span>lab</span><span class="version">01</span></a><div class="header-right"><span class="privacy"><i></i> Local by design</span><button id="theme" class="icon-button" aria-label="Switch to light theme">☼</button><a class="source" href="https://github.com/MrNedNick/photo-lab">Source ↗</a></div></header>
<main>
<section class="intro"><div><p class="eyebrow">A LITTLE ROOM FOR YOUR BIG IDEAS</p><h1>Your light.<br class="mobile-break"> <em>Your edit.</em></h1><p class="subtitle">Make a photo feel like you. Everything stays on this device.</p></div><div class="intro-note"><span>NO UPLOADS. NO ACCOUNTS.</span><span>Just you and the image.</span></div></section>
<section class="studio" aria-label="Photo editor">
<div class="toolbar"><div class="file-info"><span class="file-dot"></span><span id="filename">Untitled workspace</span><span id="file-size" class="muted"></span></div><div class="toolbar-actions"><button id="open" class="button small">＋ Open photo</button><button id="export" class="button primary small" disabled>Export ↗</button></div></div>
<input id="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden>
<div class="workspace">
<div class="image-column"><div class="canvas-toolbar"><span class="eyebrow">CANVAS</span><div class="history-buttons"><button id="undo" aria-label="Undo last edit" title="Undo (Ctrl/⌘ Z)" disabled>↶</button><button id="redo" aria-label="Redo last edit" title="Redo (Ctrl/⌘ Shift Z)" disabled>↷</button><span class="divider"></span><button id="compare" disabled aria-pressed="false">Original</button></div></div>
<div id="stage" class="stage"><div id="empty" class="empty"><div class="empty-art" aria-hidden="true"><span class="photo-card back"></span><span class="photo-card front"><i class="sun"></i><i class="mountain"></i></span><span class="plus">+</span></div><h2>A fresh perspective<br>starts here.</h2><p>Drop a photo into your workspace<br>or choose one from your device.</p><button id="choose" class="button primary">Choose a photo <span>↗</span></button><button id="sample" class="text-button">Try a sample image</button><span class="formats">JPEG, PNG, WebP, AVIF · up to 50 MP / 50 MB</span></div><div id="canvas-wrap" hidden><canvas id="canvas" aria-label="Edited photo preview"></canvas><div id="crop-overlay" hidden><div id="crop-box" tabindex="0" role="group" aria-label="Crop selection. Arrow keys move the selection."><span></span><span></span><span></span><span></span></div></div></div><div id="loading" class="loading" hidden><span class="spinner"></span><p>Opening your photo…</p></div></div>
<div class="canvas-footer"><span id="dimensions">YOUR PRIVATE DARKROOM</span><span id="save-status">Nothing leaves this device</span></div></div>
<aside class="tools" aria-label="Editing tools"><fieldset id="edit-tools" disabled><legend class="sr-only">Photo adjustments</legend><div class="panel-heading"><h2>Make it yours</h2><button id="reset" class="text-button">Reset all</button></div><div class="presets" aria-label="Looks"><button data-preset="natural" class="preset"><span class="swatch natural"></span>Natural</button><button data-preset="warm" class="preset"><span class="swatch warm"></span>Golden</button><button data-preset="mono" class="preset"><span class="swatch mono"></span>Mono</button><button data-preset="fade" class="preset"><span class="swatch fade"></span>Soft</button></div>
<div class="section-label"><span>LIGHT & COLOR</span><span>01</span></div>
${adjustments.map(a => `<div class="adjustment"><label for="${a.key}">${a.label}</label><output for="${a.key}" id="${a.key}-value">0</output><input id="${a.key}" type="range" min="${a.min}" max="${a.max}" step="${a.step}" value="0"></div>`).join('')}
<div class="section-label"><span>COMPOSITION</span><span>02</span></div><div class="composition"><button id="crop-toggle" class="button small">⌗ Crop</button><button id="rotate" class="button small" aria-label="Rotate clockwise">↻ Rotate</button><button id="flip-x" class="button small" aria-label="Flip horizontally">↔ Flip H</button><button id="flip-y" class="button small" aria-label="Flip vertically">↕ Flip V</button></div>
<div id="crop-panel" hidden><label for="aspect">Aspect ratio</label><select id="aspect"><option value="0">Original</option><option value="1">Square · 1:1</option><option value="1.3333333333">Classic · 4:3</option><option value="1.5">Photo · 3:2</option><option value="1.7777777778">Wide · 16:9</option><option value="0.8">Portrait · 4:5</option></select><label for="crop-scale">Crop size</label><input id="crop-scale" type="range" min="10" max="100" value="100"><p class="hint">Drag the frame or use its arrow keys to move. Crop is applied before rotation.</p><div class="row"><button id="crop-apply" class="button primary small">Apply crop</button><button id="crop-cancel" class="button small">Cancel</button></div></div>
<div class="section-label"><span>RGB HISTOGRAM</span><span>03</span></div><canvas id="histogram" width="256" height="64" role="img" aria-label="Red, green and blue tonal distribution"></canvas><p class="hint">A little balance goes a long way.</p></fieldset></aside>
</div></section>
<div id="notice" role="status" aria-live="polite" hidden><span id="notice-text"></span><button id="retry" class="text-button" hidden>Try again</button><button id="dismiss" aria-label="Dismiss message">×</button></div>
<section class="principles" aria-label="How Photo Lab works"><article><span class="number">01 / OPEN</span><h2>Start with your perspective.</h2><p>A snapshot, a favorite memory, a happy accident. Bring a photo and take it somewhere new.</p></article><article><span class="number">02 / EXPLORE</span><h2>Find the feeling.</h2><p>Shape the light, warm things up, get closer. Every adjustment is yours to undo.</p></article><article><span class="number">03 / KEEP</span><h2>Take it with you.</h2><p>Export your edit in full resolution. Your original stays untouched, your photos stay private.</p></article></section>
</main><footer><span class="brand">photo<span>lab</span></span><p>A small tool. A different point of view.</p><div><a href="https://github.com/MrNedNick/photo-lab#readme">About this project ↗</a><button id="forget" class="text-button">Clear saved photo</button></div></footer>
<dialog id="export-dialog"><form method="dialog"><div class="panel-heading"><h2>Your photo, ready to go.</h2><button class="icon-button" aria-label="Close export dialog">×</button></div><p class="subtitle">A new file. Your original stays untouched.</p><label for="format">File format</label><select id="format"><option value="image/jpeg">JPEG · smaller file</option><option value="image/png">PNG · lossless, supports transparency</option></select><label for="quality">JPEG quality <output id="quality-value">92%</output></label><input id="quality" type="range" min="10" max="100" value="92"><label for="export-size">Longest edge</label><select id="export-size"><option value="0">Full resolution</option><option value="2048">2048 px</option><option value="1200">1200 px</option><option value="640">640 px</option></select><p id="export-dimensions" class="hint"></p><p id="export-status" role="status"></p><button id="download" type="button" class="button primary">Export photo ↗</button><button id="cancel-export" type="button" class="button" hidden>Cancel export</button><a id="download-again" class="button" hidden>Download again</a></form></dialog>`

let history = new History(), edit = history.current
let photo: Blob | undefined, name = '', width = 0, height = 0
let renderer: Renderer | undefined, worker: Worker | undefined, exportWorker: Worker | undefined
let loadId = 0, histogramId = 0, frame = 0, histTimer = 0
let cropActive = false, draftCrop = freshEdit().crop, comparing = false
let retry: (() => void) | undefined
let exportUrl: string | undefined
let persistChain = Promise.resolve()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('photo-lab') : undefined
const canvas = $<HTMLCanvasElement>('#canvas')
function announce(message: string, action?: () => void) { $('#notice').hidden = false; $('#notice-text').textContent = message; retry = action; $('#retry').hidden = !action }
$('#dismiss').onclick = () => { $('#notice').hidden = true }
$('#retry').onclick = () => retry?.()
function setTheme(theme: string) {
  document.documentElement.dataset.theme = theme
  $('#theme').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`)
  $('#theme').textContent = theme === 'dark' ? '☼' : '☾'
  try { localStorage.setItem('photo-lab-theme', theme) } catch { /* Theme remains available without storage. */ }
}
let theme = 'dark'
try { theme = localStorage.getItem('photo-lab-theme') || theme } catch { /* Use the default theme. */ }
setTheme(theme)
$('#theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
function syncControls() {
  for (const a of adjustments) {
    $<HTMLInputElement>(`#${a.key}`).value = String(edit[a.key])
    $(`#${a.key}-value`).textContent = (a.key === 'exposure' ? edit[a.key].toFixed(2) + a.unit : String(Math.round(edit[a.key] * 100)))
  }
  $<HTMLButtonElement>('#undo').disabled = !photo || history.index === 0
  $<HTMLButtonElement>('#redo').disabled = !photo || history.index === history.entries.length - 1
  const size = dimensions(width, height, edit)
  $('#dimensions').textContent = photo ? `${size.width.toLocaleString()} × ${size.height.toLocaleString()} px` : 'YOUR PRIVATE DARKROOM'
  $('#compare').setAttribute('aria-pressed', String(comparing))
  $('#compare').textContent = comparing ? 'Back to edit' : 'Original'
}
function render() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (!renderer || !photo) return
    const shown = comparing || cropActive ? freshEdit() : edit
    renderer.render(shown)
    syncControls()
    window.clearTimeout(histTimer)
    histTimer = window.setTimeout(() => worker?.postMessage({ kind: 'histogram', id: ++histogramId, edit: shown }), 100)
  })
}
function persist() {
  if (!photo) return
  const project: Project = { file: photo, name, entries: structuredClone(history.entries), index: history.index, updated: Date.now() }
  $('#save-status').textContent = 'Saving on this device…'
  persistChain = persistChain.catch(() => {}).then(() => saveProject(project)).then(() => {
    $('#save-status').textContent = 'Saved on this device'; channel?.postMessage('updated')
  }).catch(() => { $('#save-status').textContent = 'Not saved'; announce('Your browser could not save this photo locally. You can still edit and export it.', persist) })
}
function commit() { comparing = false; history.push(edit); syncControls(); render(); persist() }
function setBusy(busy: boolean) {
  $('#loading').hidden = !busy
  $<HTMLFieldSetElement>('#edit-tools').disabled = busy || !photo
  $<HTMLButtonElement>('#export').disabled = busy || !photo
  $<HTMLButtonElement>('#compare').disabled = busy || !photo
}
function drawHistogram(bins: number[][]) {
  const target = $<HTMLCanvasElement>('#histogram'), ctx = target.getContext('2d')!
  ctx.clearRect(0, 0, 256, 64)
  const peak = Math.max(1, ...bins.flat())
  const colors = ['#ef7a80', '#a9d98c', '#80b5f1']
  bins.forEach((values, index) => {
    ctx.fillStyle = colors[index]!; ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(0, 64)
    values.forEach((count, x) => ctx.lineTo(x, 64 - Math.sqrt(count / peak) * 60))
    ctx.lineTo(256, 64); ctx.closePath(); ctx.fill()
  })
}
async function openPhoto(file: Blob, filename: string, saved?: Project) {
  if (file.size > 50 * 1024 * 1024) { announce('Choose a photo smaller than 50 MB.'); return }
  if (!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)) { announce('Choose a JPEG, PNG, WebP or AVIF photo.'); return }
  if (!('OffscreenCanvas' in window) || !('createImageBitmap' in window)) { announce('This browser does not support the photo workspace. Try a current Chrome, Firefox or Safari browser.'); return }
  worker?.terminate(); worker = new Worker(new URL('./photo.worker.ts', import.meta.url), { type: 'module' })
  const id = ++loadId
  cropActive = false; $('#crop-panel').hidden = true; $('#crop-overlay').hidden = true
  setBusy(true)
  const started = performance.now()
  worker.onmessage = ({ data }) => {
    if (id !== loadId) return
    if (data.kind === 'load') {
      try {
        renderer ||= new Renderer(canvas)
        renderer.load(data.bitmap); data.bitmap.close()
        photo = file; name = filename; width = data.width; height = data.height
        history = saved ? new History(saved.entries, saved.index) : new History(); edit = history.current; comparing = false
        $('#filename').textContent = name; $('#file-size').textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`
        $('#empty').hidden = true; $('#canvas-wrap').hidden = false; $('#notice').hidden = true
        setBusy(false); render(); syncControls()
        if (!saved) persist()
        performance.measure('photo-open', { start: started, end: performance.now() })
      } catch (error) { setBusy(false); announce(String(error), () => void openPhoto(file, filename, saved)) }
    } else if (data.kind === 'histogram' && data.id === histogramId) drawHistogram(data.bins)
    else if (data.kind === 'error') { setBusy(false); announce(`Unable to open photo: ${data.message}`, () => void openPhoto(file, filename, saved)) }
  }
  worker.onerror = () => { setBusy(false); announce('The photo worker stopped. Please reopen your photo.', () => void openPhoto(file, filename, saved)) }
  worker.postMessage({ id, kind: 'load', file })
}
const choose = () => $<HTMLInputElement>('#file').click()
$('#open').onclick = choose; $('#choose').onclick = choose
$<HTMLInputElement>('#file').onchange = e => { const input = e.target as HTMLInputElement; const file = input.files?.[0]; if (file) void openPhoto(file, file.name); input.value = '' }
$('#stage').ondragover = e => { e.preventDefault(); $('#stage').classList.add('dragging') }
$('#stage').ondragleave = () => $('#stage').classList.remove('dragging')
$('#stage').ondrop = e => { e.preventDefault(); $('#stage').classList.remove('dragging'); const file = e.dataTransfer?.files[0]; if (file) void openPhoto(file, file.name) }
$('#sample').onclick = () => {
  const demo = document.createElement('canvas'); demo.width = 2400; demo.height = 1600
  const ctx = demo.getContext('2d')!, sky = ctx.createLinearGradient(0, 0, 0, 1600)
  sky.addColorStop(0, '#85b8b9'); sky.addColorStop(.55, '#f5d7b2'); sky.addColorStop(1, '#e79670'); ctx.fillStyle = sky; ctx.fillRect(0,0,2400,1600)
  ctx.fillStyle = '#ffedc4'; ctx.beginPath(); ctx.arc(1740,430,180,0,Math.PI*2); ctx.fill()
  for (const [color, y, amplitude] of [['#849d94', 780, 200], ['#426f6a', 1010, 220], ['#214d4b', 1280, 180]] as const) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0,1600)
    for (let x=0;x<=2400;x+=10) ctx.lineTo(x, y + Math.sin(x/410)*amplitude + Math.cos(x/190)*70)
    ctx.lineTo(2400,1600); ctx.fill()
  }
  demo.toBlob(blob => { if (blob) void openPhoto(blob, 'Quiet hills.png') }, 'image/png')
}
for (const a of adjustments) {
  $<HTMLInputElement>(`#${a.key}`).oninput = event => { edit[a.key] = +(event.target as HTMLInputElement).value; comparing = false; syncControls(); render() }
  $<HTMLInputElement>(`#${a.key}`).onchange = commit
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) button.onclick = () => {
  const base = freshEdit(); for (const a of adjustments) edit[a.key] = base[a.key]
  if (button.dataset.preset === 'warm') { edit.temperature = .55; edit.exposure = .15; edit.saturation = .12 }
  if (button.dataset.preset === 'mono') { edit.saturation = -1; edit.contrast = .18 }
  if (button.dataset.preset === 'fade') { edit.contrast = -.2; edit.exposure = .2; edit.saturation = -.15 }
  commit()
}
$('#reset').onclick = () => { edit = freshEdit(); endCrop(); commit() }
$('#rotate').onclick = () => { edit.rotation = (edit.rotation + 90) % 360; commit() }
$('#flip-x').onclick = () => { edit.flipX = !edit.flipX; commit() }
$('#flip-y').onclick = () => { edit.flipY = !edit.flipY; commit() }
function undo() { if (!photo || cropActive) return; edit = history.undo(); comparing = false; syncControls(); render(); persist() }
function redo() { if (!photo || cropActive) return; edit = history.redo(); comparing = false; syncControls(); render(); persist() }
$('#undo').onclick = undo; $('#redo').onclick = redo
$('#compare').onclick = () => { comparing = !comparing; render() }
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || (e.target as HTMLElement).matches('input,select')) return
  e.preventDefault(); if (e.shiftKey) redo(); else undo()
})
function drawCrop() {
  const box = $('#crop-box'); box.style.left = `${draftCrop.x * 100}%`; box.style.top = `${draftCrop.y * 100}%`; box.style.width = `${draftCrop.width * 100}%`; box.style.height = `${draftCrop.height * 100}%`
}
function resetCropFrame() {
  const ratio = +$<HTMLSelectElement>('#aspect').value, scale = +$<HTMLInputElement>('#crop-scale').value / 100
  const base = cropToAspect(width, height, ratio)
  draftCrop = { width: base.width * scale, height: base.height * scale, x: (1 - base.width * scale)/2, y: (1 - base.height * scale)/2 }; drawCrop()
}
function endCrop() { cropActive = false; $('#crop-panel').hidden = true; $('#crop-overlay').hidden = true; render() }
$('#crop-toggle').onclick = () => {
  cropActive = !cropActive; comparing = false; $('#crop-panel').hidden = !cropActive; $('#crop-overlay').hidden = !cropActive
  draftCrop = structuredClone(edit.crop); drawCrop(); render()
  if (cropActive) $('#crop-box').focus()
}
$('#aspect').onchange = resetCropFrame; $('#crop-scale').oninput = resetCropFrame
$('#crop-apply').onclick = () => { edit.crop = structuredClone(draftCrop); endCrop(); commit() }
$('#crop-cancel').onclick = endCrop
let drag: { x: number; y: number; left: number; top: number } | undefined
$('#crop-box').onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, left: draftCrop.x, top: draftCrop.y }; $('#crop-box').setPointerCapture(e.pointerId) }
function moveCrop(x: number, y: number) { draftCrop.x = Math.max(0, Math.min(1 - draftCrop.width, x)); draftCrop.y = Math.max(0, Math.min(1 - draftCrop.height, y)); drawCrop() }
$('#crop-box').onpointermove = e => { if (!drag) return; const bounds = $('#crop-overlay').getBoundingClientRect(); moveCrop(drag.left + (e.clientX - drag.x)/bounds.width, drag.top + (e.clientY - drag.y)/bounds.height) }
$('#crop-box').onpointerup = () => { drag = undefined }
$('#crop-box').onpointercancel = () => { drag = undefined }
$('#crop-box').onkeydown = e => {
  const delta = e.shiftKey ? .05 : .01
  const movement: Record<string, number[]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
  if (movement[e.key]) { e.preventDefault(); moveCrop(draftCrop.x + movement[e.key]![0]!, draftCrop.y + movement[e.key]![1]!) }
  if (e.key === 'Escape') endCrop()
}
function exportDimensions() { const size = dimensions(width, height, edit, +$<HTMLSelectElement>('#export-size').value || Infinity); $('#export-dimensions').textContent = `${size.width} × ${size.height} px · edits included` }
$('#export').onclick = () => { exportDimensions(); $<HTMLDialogElement>('#export-dialog').showModal() }
$('#export-size').onchange = exportDimensions
$('#quality').oninput = () => { $('#quality-value').textContent = `${$<HTMLInputElement>('#quality').value}%` }
$('#format').onchange = () => { $<HTMLInputElement>('#quality').disabled = $<HTMLSelectElement>('#format').value === 'image/png' }
function cancelExport() { exportWorker?.terminate(); exportWorker = undefined; $('#cancel-export').hidden = true; $<HTMLButtonElement>('#download').disabled = false }
$('#cancel-export').onclick = () => { cancelExport(); $('#export-status').textContent = 'Export cancelled. Your edits are safe.' }
$<HTMLDialogElement>('#export-dialog').onclose = cancelExport
$('#download').onclick = () => {
  if (!photo) return
  cancelExport(); $('#export-status').textContent = 'Preparing export…'; $('#cancel-export').hidden = false; $<HTMLButtonElement>('#download').disabled = true; $('#download-again').hidden = true
  const started = performance.now(), format = $<HTMLSelectElement>('#format').value
  exportWorker = new Worker(new URL('./photo.worker.ts', import.meta.url), { type: 'module' })
  exportWorker.onmessage = ({ data }) => {
    if (data.kind === 'progress') $('#export-status').textContent = data.value
    else if (data.kind === 'error') { $('#export-status').textContent = data.message; cancelExport() }
    else if (data.kind === 'export') {
      if (exportUrl) URL.revokeObjectURL(exportUrl)
      exportUrl = URL.createObjectURL(data.blob)
      const link = $<HTMLAnchorElement>('#download-again'); link.href = exportUrl; link.download = `${name.replace(/\.[^.]+$/, '')}-edited.${format === 'image/png' ? 'png' : 'jpg'}`; link.hidden = false; link.click()
      $('#export-status').textContent = `Ready · ${data.width} × ${data.height} px · ${(data.blob.size / 1024 / 1024).toFixed(1)} MB`
      performance.measure('photo-export', { start: started, end: performance.now() }); cancelExport()
    }
  }
  exportWorker.onerror = () => { $('#export-status').textContent = 'Export failed. Try a smaller output size.'; cancelExport() }
  exportWorker.postMessage({ id: 1, kind: 'export', file: photo, edit: structuredClone(edit), format, quality: +$<HTMLInputElement>('#quality').value / 100, max: +$<HTMLSelectElement>('#export-size').value })
}
async function clearPhoto(broadcast = true) {
  loadId++; worker?.terminate(); photo = undefined; history = new History(); edit = history.current; endCrop(); setBusy(false)
  $('#canvas-wrap').hidden = true; $('#empty').hidden = false; $('#filename').textContent = 'Untitled workspace'; $('#file-size').textContent = ''; $('#save-status').textContent = 'Nothing leaves this device'; drawHistogram([[],[],[]]); syncControls()
  if (broadcast) { await persistChain; await saveProject(null); channel?.postMessage('updated'); announce('Saved photo and edit history cleared from this browser.') }
}
$('#forget').onclick = () => { void clearPhoto().catch(() => announce('Could not clear browser storage. Try again.', () => void clearPhoto())) }
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); announce('Graphics connection lost. Reopen your photo to continue.', () => { renderer = undefined; if (photo) void openPhoto(photo, name, { file: photo, name, entries: history.entries, index: history.index, updated: Date.now() }) }) })
async function restore() {
  try { const saved = await readProject(); if (saved) await openPhoto(saved.file, saved.name, saved) }
  catch { announce('Saved workspace could not be restored. You can open a photo to start again.') }
}
if (channel) channel.onmessage = async () => {
  await persistChain
  try { const saved = await readProject(); if (saved) { await openPhoto(saved.file, saved.name, saved); announce('Workspace updated from another tab.') } else await clearPhoto(false) } catch { announce('Could not sync the workspace from another tab.') }
}
void restore()
