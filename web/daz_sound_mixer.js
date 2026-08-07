// Panel + popup editor for the "Sound Mixer" (daz_sound_mixer) node.
// Each sound_N widget is a plain file-picker combo (like core's LoadAudio) —
// wiring a slot reveals the next one. The "Edit Mix" button opens a timeline
// editor where each picked file gets a client-side-decoded waveform (Web
// Audio API, no backend route needed) that can be cropped, and placed
// (possibly more than once, at any time, with its own gain) onto a timeline.
// All state lives as JSON in the hidden `mix_state` widget, which travels
// with the workflow — see nodes/sound_mixer.py's docstring for the schema.

import { app } from '../../scripts/app.js'

const CLASS = 'daz_sound_mixer'
const NONE = '(none)'
const COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#be5046']

// ── small DOM/format helpers (self-contained, mirrors the style of
// web/daz_prompt_stack_manager.js's local esc()/mkBtn()/overlayShell()) ────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function mkBtn(label, border, bg, color, disabled = false) {
  const b = document.createElement('button')
  b.textContent = label
  b.disabled = !!disabled
  b.style.cssText = `font-family:monospace;font-size:11px;padding:3px 10px;border-radius:3px;
    cursor:${disabled ? 'default' : 'pointer'};border:1px solid ${border};background:${bg};
    color:${color};opacity:${disabled ? 0.4 : 1}`
  return b
}

// `onClose` runs on every close path (button, Escape, click-outside) so
// callers can register a single cleanup hook instead of having to wrap
// `close` themselves for each trigger.
function overlayShell(width, onClose) {
  const overlay = document.createElement('div')
  overlay.style.cssText =
    'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);' +
    'z-index:10000;display:flex;align-items:center;justify-content:center'
  const box = document.createElement('div')
  box.style.cssText =
    `background:#2a2a2a;border:1px solid #555;border-radius:6px;padding:14px 16px;` +
    `width:${width}px;max-width:95vw;max-height:90vh;overflow-y:auto;font-family:monospace;color:#ddd`
  overlay.appendChild(box)
  document.body.appendChild(overlay)
  const close = () => { if (onClose) onClose(); overlay.remove() }
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  return { overlay, box, close }
}

function colorFor(slotKey) {
  const n = parseInt(String(slotKey).replace('sound_', ''), 10) || 0
  return COLORS[(n - 1) % COLORS.length]
}

// ── node-side widget plumbing ───────────────────────────────────────────────

function soundWidgets(node) {
  return (node.widgets || [])
    .filter(w => /^sound_\d+$/.test(w.name))
    .sort((a, b) => parseInt(a.name.slice(6), 10) - parseInt(b.name.slice(6), 10))
}

function mixStateWidget(node) {
  return (node.widgets || []).find(w => w.name === 'mix_state')
}

function durationWidget(node) {
  return (node.widgets || []).find(w => w.name === 'duration')
}

function readState(node) {
  const w = mixStateWidget(node)
  try {
    const parsed = JSON.parse(w?.value || '{}')
    return {
      sources: (parsed && typeof parsed.sources === 'object' && parsed.sources) || {},
      blocks: Array.isArray(parsed?.blocks) ? parsed.blocks : [],
    }
  } catch {
    return { sources: {}, blocks: [] }
  }
}

function writeState(node, state) {
  const w = mixStateWidget(node)
  if (w) w.value = JSON.stringify(state)
  node.setDirtyCanvas(true, true)
}

function filledSlotKeys(node) {
  return soundWidgets(node).filter(w => w.value && w.value !== NONE).map(w => w.name)
}

function refreshSlotVisibility(node) {
  const slots = soundWidgets(node)
  let lastFilled = -1
  slots.forEach((w, i) => { if (w.value && w.value !== NONE) lastFilled = i })
  const showCount = Math.min(slots.length, lastFilled + 2)
  slots.forEach((w, i) => { w.hidden = i >= showCount })
  node.setSize(node.computeSize())
  node.setDirtyCanvas(true, true)
}

function pruneOrphanState(node) {
  const filled = new Set(filledSlotKeys(node))
  const state = readState(node)
  let changed = false
  for (const key of Object.keys(state.sources)) {
    if (!filled.has(key)) { delete state.sources[key]; changed = true }
  }
  const before = state.blocks.length
  state.blocks = state.blocks.filter(b => filled.has(b.source))
  if (state.blocks.length !== before) changed = true
  if (changed) writeState(node, state)
  return changed
}

function newBlockId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// ── waveform decode (Web Audio API) + bar rendering ─────────────────────────

let _audioCtx = null
function audioContext() {
  if (!_audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (Ctor) _audioCtx = new Ctor()
  }
  return _audioCtx
}

const _peakCache = new Map() // filename -> Promise<{peaks:Float32Array, duration:number, error:bool}>
const PEAK_BUCKETS = 400

function loadPeaksAndDuration(filename) {
  if (_peakCache.has(filename)) return _peakCache.get(filename)
  const promise = (async () => {
    try {
      const res = await fetch(`/view?filename=${encodeURIComponent(filename)}&type=input`, { cache: 'force-cache' })
      if (!res.ok) throw new Error(String(res.status))
      const bytes = await res.arrayBuffer()
      const ctx = audioContext()
      if (!ctx) throw new Error('no Web Audio support')
      const buffer = await ctx.decodeAudioData(bytes)
      const channels = Math.min(buffer.numberOfChannels, 2)
      const peaks = new Float32Array(PEAK_BUCKETS)
      const per = buffer.length / PEAK_BUCKETS
      for (let c = 0; c < channels; c++) {
        const data = buffer.getChannelData(c)
        for (let i = 0; i < PEAK_BUCKETS; i++) {
          const from = Math.floor(i * per)
          const to = Math.min(data.length, Math.floor((i + 1) * per))
          let peak = 0
          const stride = Math.max(1, Math.floor((to - from) / 200))
          for (let j = from; j < to; j += stride) {
            const v = Math.abs(data[j])
            if (v > peak) peak = v
          }
          if (peak > peaks[i]) peaks[i] = peak
        }
      }
      let max = 0
      for (let i = 0; i < PEAK_BUCKETS; i++) if (peaks[i] > max) max = peaks[i]
      if (max > 0.0001) for (let i = 0; i < PEAK_BUCKETS; i++) peaks[i] /= max
      return { peaks, duration: buffer.duration, error: false }
    } catch (e) {
      console.warn('[daz_sound_mixer] failed to decode', filename, e)
      return { peaks: null, duration: 0, error: true }
    }
  })()
  _peakCache.set(filename, promise)
  return promise
}

// Draws a peaks array as bars into `canvas`. If `sel` is given ({from,to} in
// [0,1] of the canvas width) the region outside it is dimmed and two drag
// handles are drawn; returns the handle x-positions (css px) for hit-testing.
function drawWave(canvas, peaks, color, sel) {
  if (!canvas) return null
  const dpr = window.devicePixelRatio || 1
  const cssW = Math.max(1, canvas.clientWidth)
  const cssH = Math.max(1, canvas.clientHeight)
  const w = Math.max(1, Math.round(cssW * dpr))
  const h = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  if (!peaks) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '11px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('loading…', cssW / 2, cssH / 2 + 4)
    return null
  }

  const fromPx = sel ? Math.max(0, Math.min(cssW, sel.from * cssW)) : 0
  const toPx = sel ? Math.max(fromPx, Math.min(cssW, sel.to * cssW)) : cssW

  const n = peaks.length
  const bw = cssW / n
  const mid = cssH / 2
  for (let i = 0; i < n; i++) {
    const x = i * bw
    const inSel = !sel || (x + bw / 2 >= fromPx && x + bw / 2 <= toPx)
    ctx.fillStyle = inSel ? color : 'rgba(255,255,255,0.18)'
    const bh = Math.max(1, peaks[i] * (cssH - 6))
    ctx.fillRect(x + bw * 0.15, mid - bh / 2, Math.max(0.6, bw * 0.7), bh)
  }

  if (sel) {
    ctx.fillStyle = color
    ctx.fillRect(Math.max(0, fromPx - 1), 0, 2, cssH)
    ctx.fillRect(Math.min(cssW - 2, toPx - 1), 0, 2, cssH)
  }
  return { fromPx, toPx }
}

// Client-side "what the mix will sound like" preview: resamples each block's
// (cropped) source peaks onto a shared pixel timeline and sums them.
function buildOutputPreview(state, meta, totalDurationS, widthPx) {
  const sums = new Float32Array(Math.max(1, widthPx))
  if (totalDurationS <= 0) return sums
  const pxPerSec = widthPx / totalDurationS
  for (const block of state.blocks) {
    const m = meta[block.source]
    if (!m || !m.peaks) continue
    const src = state.sources[block.source] || {}
    const cropStart = src.crop_start_s || 0
    const cropEnd = src.crop_end_s > 0 ? src.crop_end_s : m.duration
    const cropDur = Math.max(0, cropEnd - cropStart)
    if (cropDur <= 0) continue
    const gain = Math.pow(10, (block.gain_db || 0) / 20)
    const startPx = Math.round((block.start_s || 0) * pxPerSec)
    const blockWidthPx = Math.max(1, Math.round(cropDur * pxPerSec))
    for (let x = 0; x < blockWidthPx; x++) {
      const px = startPx + x
      if (px < 0 || px >= widthPx) continue
      const tInSrc = cropStart + x / pxPerSec
      const bucket = Math.min(m.peaks.length - 1, Math.max(0, Math.floor((tInSrc / m.duration) * m.peaks.length)))
      sums[px] += m.peaks[bucket] * gain
    }
  }
  let max = 0
  for (let i = 0; i < sums.length; i++) if (sums[i] > max) max = sums[i]
  if (max > 1) for (let i = 0; i < sums.length; i++) sums[i] /= max
  return sums
}

// ── the editor ───────────────────────────────────────────────────────────

function openMixEditor(node) {
  const state = readState(node)
  const meta = {} // slotKey -> {filename, duration, peaks}
  let selectedBlockId = null

  const slots = filledSlotKeys(node)
  const filenameOf = slotKey => (node.widgets.find(w => w.name === slotKey) || {}).value

  // Default: every filled slot with no blocks yet gets one at t=0 so a
  // newly-picked file actually takes part in the mix without extra clicks.
  let seeded = false
  for (const slotKey of slots) {
    if (!state.blocks.some(b => b.source === slotKey)) {
      state.blocks.push({ id: newBlockId(), source: slotKey, start_s: 0, gain_db: 0 })
      seeded = true
    }
  }
  if (seeded) writeState(node, state)

  let removeKeydown = () => {}
  const { box, close } = overlayShell(960, () => removeKeydown())
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:14px;color:#fff">Edit Mix — ${esc(node.title || 'Sound Mixer')}</div>
      <div style="display:flex;align-items:center;gap:14px">
        <label style="font-size:11px;color:#999">Duration (s)
          <input id="sm-duration" type="number" step="0.001" min="0" style="width:80px;margin-left:6px;
            background:#1c1c1c;border:1px solid #555;color:#ddd;border-radius:3px;padding:2px 4px;font-family:monospace">
        </label>
      </div>
    </div>
    <div id="sm-sources" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>
    <div style="font-size:12px;color:#999;margin:6px 0 4px">Timeline</div>
    <div id="sm-timeline-wrap" style="overflow-x:auto;border:1px solid #444;border-radius:4px;padding:6px 0;background:#232323"></div>
    <div id="sm-toolbar" style="display:flex;align-items:center;gap:10px;margin-top:10px;min-height:26px"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <div id="sm-close-slot"></div>
    </div>
  `
  box.querySelector('#sm-close-slot').appendChild(mkBtn('Close', '#666', '#3a3a3a', '#ccc'))
  box.querySelector('#sm-close-slot button').addEventListener('click', close)

  const durInput = box.querySelector('#sm-duration')
  durInput.value = (durationWidget(node)?.value ?? 10).toFixed(3)
  durInput.addEventListener('change', () => {
    const w = durationWidget(node)
    const v = Math.max(0, parseFloat(durInput.value) || 0)
    durInput.value = v.toFixed(3)
    if (w) { w.value = v; node.setDirtyCanvas(true, true) }
    renderTimeline()
  })

  const sourcesEl = box.querySelector('#sm-sources')
  const timelineWrap = box.querySelector('#sm-timeline-wrap')
  const toolbarEl = box.querySelector('#sm-toolbar')

  function currentDuration() {
    return Math.max(0, parseFloat(durInput.value) || 0)
  }

  function timelineWidthPx() {
    const dur = Math.max(0.001, currentDuration())
    const pxPerSec = Math.max(6, Math.min(80, 900 / dur))
    return { pxPerSec, widthPx: Math.max(200, Math.round(dur * pxPerSec)) }
  }

  // ── sources panel (one row per filled slot: label, waveform + crop) ──────
  function renderSources() {
    sourcesEl.innerHTML = ''
    for (const slotKey of slots) {
      const filename = filenameOf(slotKey)
      if (!filename || filename === NONE) continue
      const color = colorFor(slotKey)
      const srcState = state.sources[slotKey] || {}

      const row = document.createElement('div')
      row.style.cssText = 'border:1px solid #444;border-radius:4px;padding:6px 8px;background:#262626'
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="width:10px;height:10px;border-radius:2px;background:${color};flex:none"></div>
          <input class="sm-label" type="text" placeholder="${esc(filename)}"
            style="flex:1;background:#1c1c1c;border:1px solid #555;color:#ddd;border-radius:3px;
                   padding:2px 6px;font-family:monospace;font-size:12px">
          <span style="font-size:10px;color:#777;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(filename)}</span>
          <span class="sm-add"></span>
        </div>
        <canvas class="sm-wave" style="width:100%;height:44px;display:block;cursor:ew-resize;border-radius:3px;background:#151515"></canvas>
        <div style="display:flex;gap:14px;margin-top:4px">
          <label style="font-size:10px;color:#999">start
            <input class="sm-start" type="number" step="0.001" min="0" style="width:70px;margin-left:4px;
              background:#1c1c1c;border:1px solid #555;color:#ddd;border-radius:3px;padding:1px 4px;font-family:monospace">
          </label>
          <label style="font-size:10px;color:#999">end
            <input class="sm-end" type="number" step="0.001" min="0" style="width:70px;margin-left:4px;
              background:#1c1c1c;border:1px solid #555;color:#ddd;border-radius:3px;padding:1px 4px;font-family:monospace">
          </label>
          <span class="sm-dur" style="font-size:10px;color:#666;align-self:center"></span>
        </div>
      `
      sourcesEl.appendChild(row)

      const labelInput = row.querySelector('.sm-label')
      labelInput.value = srcState.label || ''
      labelInput.addEventListener('change', () => {
        state.sources[slotKey] = state.sources[slotKey] || {}
        state.sources[slotKey].label = labelInput.value
        writeState(node, state)
        renderTimeline()
      })

      const addSlot = row.querySelector('.sm-add')
      addSlot.appendChild(mkBtn('+ Add to timeline', '#666', '#333', '#ccc'))
      addSlot.querySelector('button').addEventListener('click', () => {
        const dur = currentDuration()
        state.blocks.push({ id: newBlockId(), source: slotKey, start_s: 0, gain_db: 0 })
        writeState(node, state)
        renderTimeline()
      })

      const canvas = row.querySelector('.sm-wave')
      const startInput = row.querySelector('.sm-start')
      const endInput = row.querySelector('.sm-end')
      const durLabel = row.querySelector('.sm-dur')

      // Read meta[slotKey] fresh on every call (rather than caching it once
      // at row-build time) since it's populated later by an async decode —
      // a stale capture would leave the row stuck on "decoding…" forever.
      function curMeta() { return meta[slotKey] }

      function currentSel() {
        const dur = curMeta()?.duration || 0
        if (dur <= 0) return null
        const cs = state.sources[slotKey]?.crop_start_s || 0
        const ce = state.sources[slotKey]?.crop_end_s > 0 ? state.sources[slotKey].crop_end_s : dur
        return { from: cs / dur, to: ce / dur, dur }
      }

      let handles = null
      function redraw() {
        const m = curMeta()
        const sel = currentSel()
        handles = m ? drawWave(canvas, m.peaks, color, sel ? { from: sel.from, to: sel.to } : null) : null
        if (sel) {
          startInput.value = (sel.from * sel.dur).toFixed(3)
          endInput.value = (sel.to * sel.dur).toFixed(3)
          durLabel.textContent = `clip: ${((sel.to - sel.from) * sel.dur).toFixed(3)}s / file: ${sel.dur.toFixed(3)}s`
        } else {
          durLabel.textContent = m ? '' : 'decoding…'
        }
      }
      redraw()

      function setCrop(startS, endS) {
        const dur = curMeta()?.duration || 0
        if (dur <= 0) return
        startS = Math.max(0, Math.min(dur, startS))
        endS = Math.max(startS, Math.min(dur, endS))
        state.sources[slotKey] = state.sources[slotKey] || {}
        state.sources[slotKey].crop_start_s = startS
        state.sources[slotKey].crop_end_s = endS >= dur ? 0 : endS
        writeState(node, state)
        redraw()
        renderTimeline()
      }

      startInput.addEventListener('change', () => {
        const dur = curMeta()?.duration || 0
        const curEnd = state.sources[slotKey]?.crop_end_s > 0 ? state.sources[slotKey].crop_end_s : dur
        setCrop(parseFloat(startInput.value) || 0, curEnd)
      })
      endInput.addEventListener('change', () => {
        const curStart = state.sources[slotKey]?.crop_start_s || 0
        setCrop(curStart, parseFloat(endInput.value) || (curMeta()?.duration || 0))
      })

      // Drag handles are only live between mousedown and mouseup (same
      // pattern as the timeline block drag below) so repeatedly opening the
      // editor doesn't pile up permanent window-level listeners.
      canvas.addEventListener('mousedown', ev => {
        const m = curMeta()
        if (!handles || !m || m.duration <= 0) return
        const rect = canvas.getBoundingClientRect()
        const x = ev.clientX - rect.left
        let dragMode = Math.abs(x - handles.fromPx) <= Math.abs(x - handles.toPx) ? 'start' : 'end'
        function onMove(mv) {
          const mm = curMeta()
          if (!mm || mm.duration <= 0) return
          const r = canvas.getBoundingClientRect()
          const x2 = Math.max(0, Math.min(r.width, mv.clientX - r.left))
          const t = (x2 / r.width) * mm.duration
          const curStart = state.sources[slotKey]?.crop_start_s || 0
          const curEnd = state.sources[slotKey]?.crop_end_s > 0 ? state.sources[slotKey].crop_end_s : mm.duration
          if (dragMode === 'start') setCrop(t, curEnd)
          else setCrop(curStart, t)
        }
        function onUp() {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        onMove(ev)
        ev.preventDefault()
      })

      if (!meta[slotKey]) {
        loadPeaksAndDuration(filename).then(res => {
          meta[slotKey] = res
          redraw()
          renderTimeline()
        })
      }
    }
  }

  // ── timeline (one row per slot + an "Output" preview row) ────────────────
  function renderTimeline() {
    const { pxPerSec, widthPx } = timelineWidthPx()
    const dur = currentDuration()
    timelineWrap.innerHTML = ''

    const inner = document.createElement('div')
    inner.style.cssText = `width:${widthPx}px;min-width:100%`
    timelineWrap.appendChild(inner)

    // ruler
    const ruler = document.createElement('div')
    ruler.style.cssText = `position:relative;height:16px;margin-left:110px;border-bottom:1px solid #444`
    const step = dur > 60 ? 10 : dur > 20 ? 5 : 1
    for (let t = 0; t <= dur; t += step) {
      const tick = document.createElement('div')
      tick.style.cssText = `position:absolute;left:${t * pxPerSec}px;top:0;font-size:9px;color:#666`
      tick.textContent = t.toFixed(step < 1 ? 3 : 0)
      ruler.appendChild(tick)
    }
    inner.appendChild(ruler)

    for (const slotKey of slots) {
      const filename = filenameOf(slotKey)
      if (!filename || filename === NONE) continue
      const color = colorFor(slotKey)
      const m = meta[slotKey]
      const cropDur = m ? Math.max(0, (state.sources[slotKey]?.crop_end_s > 0 ? state.sources[slotKey].crop_end_s : m.duration) - (state.sources[slotKey]?.crop_start_s || 0)) : 0

      const rowEl = document.createElement('div')
      rowEl.style.cssText = 'display:flex;align-items:center;height:34px'
      const label = document.createElement('div')
      label.style.cssText = 'width:110px;flex:none;font-size:10px;color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:6px'
      label.textContent = state.sources[slotKey]?.label || filename
      rowEl.appendChild(label)

      const track = document.createElement('div')
      track.style.cssText = `position:relative;height:26px;flex:1;background:#1b1b1b;border-radius:3px;width:${widthPx}px`
      rowEl.appendChild(track)
      inner.appendChild(rowEl)

      const blocks = state.blocks.filter(b => b.source === slotKey)
      for (const block of blocks) {
        const w = Math.max(4, cropDur * pxPerSec)
        const div = document.createElement('div')
        const selected = block.id === selectedBlockId
        div.style.cssText = `position:absolute;top:2px;left:${(block.start_s || 0) * pxPerSec}px;width:${w}px;height:22px;
          background:${color};opacity:0.85;border-radius:3px;cursor:grab;
          border:${selected ? '2px solid #fff' : '1px solid rgba(0,0,0,0.4)'};box-sizing:border-box`
        div.title = `${state.sources[slotKey]?.label || filename}  @ ${block.start_s.toFixed(3)}s  gain ${(block.gain_db || 0).toFixed(1)}dB`
        track.appendChild(div)

        div.addEventListener('mousedown', ev => {
          ev.stopPropagation()
          selectedBlockId = block.id
          renderTimeline()
          const startX = ev.clientX
          const origStart = block.start_s || 0
          function onMove(mv) {
            const deltaS = (mv.clientX - startX) / pxPerSec
            block.start_s = Math.max(0, Math.min(currentDuration(), origStart + deltaS))
            div.style.left = `${block.start_s * pxPerSec}px`
          }
          function onUp() {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            writeState(node, state)
            renderTimeline()
            renderToolbar()
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        })
      }
    }

    // output preview row
    const outRow = document.createElement('div')
    outRow.style.cssText = 'display:flex;align-items:center;height:44px;margin-top:6px'
    const outLabel = document.createElement('div')
    outLabel.style.cssText = 'width:110px;flex:none;font-size:10px;color:#ddd;padding-right:6px'
    outLabel.textContent = 'Output (mix)'
    outRow.appendChild(outLabel)
    const outCanvas = document.createElement('canvas')
    outCanvas.style.cssText = `width:${widthPx}px;height:40px;background:#151515;border-radius:3px`
    outRow.appendChild(outCanvas)
    inner.appendChild(outRow)
    const preview = buildOutputPreview(state, meta, dur, widthPx)
    drawWave(outCanvas, preview, '#9aa0ff', null)

    renderToolbar()
  }

  function renderToolbar() {
    toolbarEl.innerHTML = ''
    const block = state.blocks.find(b => b.id === selectedBlockId)
    if (!block) {
      const hint = document.createElement('span')
      hint.style.cssText = 'font-size:11px;color:#666'
      hint.textContent = 'Click a block on the timeline to edit its start time, gain, clone, or delete it.'
      toolbarEl.appendChild(hint)
      return
    }
    const label = document.createElement('span')
    label.style.cssText = 'font-size:11px;color:#ccc'
    label.textContent = `${state.sources[block.source]?.label || filenameOf(block.source)} —`
    toolbarEl.appendChild(label)

    const startLbl = document.createElement('label')
    startLbl.style.cssText = 'font-size:10px;color:#999'
    startLbl.textContent = 'start (s)'
    const startInput = document.createElement('input')
    startInput.type = 'number'; startInput.step = '0.001'; startInput.min = '0'
    startInput.value = (block.start_s || 0).toFixed(3)
    startInput.style.cssText = 'width:80px;margin-left:4px;background:#1c1c1c;border:1px solid #555;color:#ddd;border-radius:3px;padding:2px 4px;font-family:monospace'
    startInput.addEventListener('change', () => {
      block.start_s = Math.max(0, parseFloat(startInput.value) || 0)
      writeState(node, state)
      renderTimeline()
    })
    startLbl.appendChild(startInput)
    toolbarEl.appendChild(startLbl)

    const gainLbl = document.createElement('label')
    gainLbl.style.cssText = 'font-size:10px;color:#999'
    gainLbl.textContent = 'gain (dB)'
    const gainInput = document.createElement('input')
    gainInput.type = 'number'; gainInput.step = '0.5'
    gainInput.value = (block.gain_db || 0).toFixed(1)
    gainInput.style.cssText = 'width:70px;margin-left:4px;background:#1c1c1c;border:1px solid #555;color:#ddd;border-radius:3px;padding:2px 4px;font-family:monospace'
    gainInput.addEventListener('change', () => {
      block.gain_db = parseFloat(gainInput.value) || 0
      writeState(node, state)
      renderTimeline()
    })
    gainLbl.appendChild(gainInput)
    toolbarEl.appendChild(gainLbl)

    const cloneBtn = mkBtn('Clone', '#666', '#333', '#ccc')
    cloneBtn.addEventListener('click', () => {
      const m = meta[block.source]
      const cropDur = m ? Math.max(0.05, (state.sources[block.source]?.crop_end_s > 0 ? state.sources[block.source].crop_end_s : m.duration) - (state.sources[block.source]?.crop_start_s || 0)) : 0.5
      const clone = { id: newBlockId(), source: block.source, start_s: Math.min(currentDuration(), (block.start_s || 0) + cropDur), gain_db: block.gain_db || 0 }
      state.blocks.push(clone)
      selectedBlockId = clone.id
      writeState(node, state)
      renderTimeline()
    })
    toolbarEl.appendChild(cloneBtn)

    const delBtn = mkBtn('Delete', '#844', '#3a2222', '#f88')
    delBtn.addEventListener('click', () => {
      state.blocks = state.blocks.filter(b => b.id !== block.id)
      selectedBlockId = null
      writeState(node, state)
      renderTimeline()
    })
    toolbarEl.appendChild(delBtn)
  }

  function onKeyDown(ev) {
    if (!selectedBlockId) return
    const tag = (document.activeElement && document.activeElement.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      state.blocks = state.blocks.filter(b => b.id !== selectedBlockId)
      selectedBlockId = null
      writeState(node, state)
      renderTimeline()
      ev.preventDefault()
    } else if (ev.key === 'Escape') {
      close()
    }
  }
  window.addEventListener('keydown', onKeyDown)
  removeKeydown = () => window.removeEventListener('keydown', onKeyDown)

  renderSources()
  renderTimeline()
}

// ── extension registration ──────────────────────────────────────────────

app.registerExtension({
  name: 'daz.SoundMixer',
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined
      const node = this

      const msw = mixStateWidget(node)
      if (msw) msw.hidden = true

      for (const w of soundWidgets(node)) {
        w._dazLastValue = w.value
        const origCallback = w.callback
        w.callback = function (...args) {
          // Litegraph already assigns the new value to w.value before
          // invoking the widget's callback, so comparing against w.value
          // here would never see a difference — track the previous value
          // on the widget itself instead.
          const prevValue = w._dazLastValue
          const ret = origCallback ? origCallback.apply(this, args) : undefined
          if (w.value !== prevValue) {
            if (!w.value || w.value === NONE) {
              pruneOrphanState(node)
            } else {
              const state = readState(node)
              if (state.sources[w.name]) {
                delete state.sources[w.name]
                writeState(node, state)
              }
            }
          }
          w._dazLastValue = w.value
          refreshSlotVisibility(node)
          return ret
        }
      }

      node.addWidget('button', 'Edit Mix', null, () => openMixEditor(node))
      refreshSlotVisibility(node)
      return r
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined
      const msw = mixStateWidget(this)
      if (msw) msw.hidden = true
      for (const w of soundWidgets(this)) w._dazLastValue = w.value
      refreshSlotVisibility(this)
      return r
    }
  },
})
