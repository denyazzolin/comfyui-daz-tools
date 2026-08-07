import { app } from "../../scripts/app.js"

const CLASS = "daz_sound_mixer"

const MAX_SOURCES = 16
const GRID_COLS = 4
const MIN_ROWS = 8
const MAX_BLOCK_ROWS = 30
const MAX_VISIBLE_ROWS = 31
const CROP_STEP = 0.0001 // tenths of a millisecond, in seconds

const COLORS = [
  "#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66", "#be5046",
  "#4fc1ff", "#c3e88d", "#f78c6c", "#ff5370", "#ba68c8", "#4dd0e1", "#ffd54f", "#8d6e63",
]

function colorFor(source) {
  const i = source && Number.isInteger(source.colorIndex) ? source.colorIndex : 0
  return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length]
}

function mkBtn(label, opts = {}) {
  const b = document.createElement("button")
  b.textContent = label
  b.type = "button"
  b.style.cssText = `
    padding:4px 10px; font-size:12px; border-radius:4px; cursor:pointer;
    border:1px solid ${opts.danger ? "#a33" : "#555"};
    background:${opts.danger ? "#3a1f1f" : "#333"}; color:#ddd;
  `
  if (opts.disabled) {
    b.disabled = true
    b.style.opacity = "0.4"
    b.style.cursor = "default"
  }
  if (opts.onClick) b.addEventListener("click", opts.onClick)
  return b
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function overlayShell(width, onClose) {
  const overlay = document.createElement("div")
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.6);
    display:flex; align-items:center; justify-content:center; z-index:10000;
  `
  const box = document.createElement("div")
  box.style.cssText = `
    background:#232323; color:#ddd; border:1px solid #444; border-radius:6px;
    width:${width}px; max-width:95vw; max-height:90vh; display:flex; flex-direction:column;
    font-family:sans-serif; font-size:13px; overflow:hidden;
  `
  overlay.appendChild(box)

  function close() {
    overlay.remove()
    if (onClose) onClose()
  }
  overlay.addEventListener("mousedown", (ev) => {
    if (ev.target === overlay) close()
  })
  document.body.appendChild(overlay)
  return { overlay, box, close }
}

// ---------------------------------------------------------------------------
// Audio decode / peaks / preview playback
// ---------------------------------------------------------------------------

let _ctx = null
function audioContext() {
  if (_ctx) return _ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  _ctx = new AC()
  return _ctx
}

function computePeaks(buffer, buckets = 400) {
  const ch = buffer.numberOfChannels
  const len = buffer.length
  const data = []
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c))
  const peaks = new Float32Array(buckets)
  const bucketSize = Math.max(1, Math.floor(len / buckets))
  for (let b = 0; b < buckets; b++) {
    let max = 0
    const start = b * bucketSize
    const end = Math.min(len, start + bucketSize)
    for (let c = 0; c < ch; c++) {
      const d = data[c]
      for (let i = start; i < end; i++) {
        const v = Math.abs(d[i])
        if (v > max) max = v
      }
    }
    peaks[b] = max
  }
  let norm = 0
  for (let i = 0; i < peaks.length; i++) if (peaks[i] > norm) norm = peaks[i]
  if (norm > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= norm
  return peaks
}

const _audioMetaCache = new Map() // filename -> Promise<{peaks, duration, buffer, error}>
function loadAudioMeta(filename) {
  if (_audioMetaCache.has(filename)) return _audioMetaCache.get(filename)
  const p = (async () => {
    try {
      const res = await fetch(`/view?filename=${encodeURIComponent(filename)}&type=input`)
      if (!res.ok) throw new Error(String(res.status))
      const bytes = await res.arrayBuffer()
      const ctx = audioContext()
      if (!ctx) throw new Error("no Web Audio support")
      const buffer = await ctx.decodeAudioData(bytes)
      return { peaks: computePeaks(buffer), duration: buffer.duration, buffer, error: false }
    } catch (e) {
      console.warn("[daz_sound_mixer] failed to decode", filename, e)
      return { peaks: null, duration: 0, buffer: null, error: true }
    }
  })()
  _audioMetaCache.set(filename, p)
  return p
}

async function uploadAudioFile(file) {
  const body = new FormData()
  body.append("image", file, file.name)
  body.append("type", "input")
  body.append("subfolder", "")
  const res = await fetch("/upload/image", { method: "POST", body })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
  const data = await res.json()
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name
}

let _activeNodes = []
function stopAllPreviews() {
  for (const n of _activeNodes) {
    try { n.stop() } catch { /* already stopped */ }
  }
  _activeNodes = []
}
function schedulePreview(buffer, cropStart, cropDur, gain, when = 0) {
  const ctx = audioContext()
  if (!ctx || !buffer || cropDur <= 0) return
  if (ctx.state === "suspended") ctx.resume()
  const gainNode = ctx.createGain()
  gainNode.gain.value = gain
  const bufSrc = ctx.createBufferSource()
  bufSrc.buffer = buffer
  bufSrc.connect(gainNode).connect(ctx.destination)
  bufSrc.start(ctx.currentTime + when, cropStart, cropDur)
  _activeNodes.push(bufSrc)
}

function drawWave(canvas, peaks, color, errored) {
  const ctx = canvas.getContext("2d")
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  if (!peaks) {
    ctx.fillStyle = errored ? "#c66" : "#666"
    ctx.font = "11px sans-serif"
    ctx.fillText(errored ? "could not decode" : "decoding…", 6, h / 2 + 4)
    return
  }
  const mid = h / 2
  const barW = w / peaks.length
  ctx.fillStyle = color
  for (let i = 0; i < peaks.length; i++) {
    const bh = Math.max(1, peaks[i] * (h - 4))
    ctx.fillRect(i * barW, mid - bh / 2, Math.max(1, barW - 1), bh)
  }
}

// ---------------------------------------------------------------------------
// State (mix_state widget JSON)
// ---------------------------------------------------------------------------

function mixStateWidget(node) {
  return node.widgets?.find((w) => w.name === "mix_state")
}
function durationWidget(node) {
  return node.widgets?.find((w) => w.name === "duration")
}

function readState(node) {
  const w = mixStateWidget(node)
  try {
    const parsed = JSON.parse(w?.value || "{}")
    const sources = (parsed && typeof parsed.sources === "object" && parsed.sources) || {}
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : []
    let overall_gain = Number(parsed?.overall_gain)
    if (!Number.isFinite(overall_gain)) overall_gain = 1.0
    return { sources, blocks, overall_gain }
  } catch {
    return { sources: {}, blocks: [], overall_gain: 1.0 }
  }
}

function writeState(node, state) {
  const w = mixStateWidget(node)
  if (!w) return
  w.value = JSON.stringify(state)
}

function nextColorIndex(sources) {
  const used = new Set(Object.values(sources).map((s) => s.colorIndex))
  for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i
  return 0
}

function usedRows(state) {
  return new Set(state.blocks.map((b) => b.row))
}
function nextEmptyRow(state) {
  const used = usedRows(state)
  for (let r = 0; r < MAX_BLOCK_ROWS; r++) if (!used.has(r)) return r
  return -1
}
function freeRows(state, count) {
  const used = usedRows(state)
  const free = []
  for (let r = 0; r < MAX_BLOCK_ROWS && free.length < count; r++) if (!used.has(r)) free.push(r)
  return free
}
function visibleRowCount(state) {
  const filled = Math.min(state.blocks.length, MAX_BLOCK_ROWS)
  return Math.min(MAX_VISIBLE_ROWS, Math.max(MIN_ROWS, filled + 1))
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function openMixEditor(node) {
  const state = readState(node)
  const meta = {} // sourceId -> {peaks, duration, buffer, error, _filename}
  let selectedBlockId = null
  let errorTimer = null
  let closeActivePopup = null
  const blockEls = new Map() // block id -> live DOM element, for drag-without-rebuild

  const { box, close: closeOverlay } = overlayShell(1040, () => {
    stopAllPreviews()
    clearTimeout(errorTimer)
    document.removeEventListener("keydown", onKeyDown)
  })

  function currentDuration() {
    const w = durationWidget(node)
    return Math.max(0.001, Number(w?.value) || 0.001)
  }

  function showError(msg) {
    errorEl.textContent = msg
    errorEl.style.display = "block"
    clearTimeout(errorTimer)
    errorTimer = setTimeout(() => { errorEl.style.display = "none" }, 4000)
  }

  function persist() {
    writeState(node, state)
    node.setDirtyCanvas(true, true)
  }

  // Header ---------------------------------------------------------------
  const header = document.createElement("div")
  header.style.cssText = "display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid #3a3a3a;"
  header.innerHTML = `<div style="font-weight:600; flex:1;">Sound Mixer</div>`
  const durLabel = document.createElement("label")
  durLabel.style.cssText = "display:flex; align-items:center; gap:6px; color:#aaa;"
  durLabel.append("Duration (s)")
  const durInput = document.createElement("input")
  durInput.type = "number"
  durInput.step = "0.001"
  durInput.min = "0"
  durInput.style.cssText = "width:80px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
  durInput.value = currentDuration()
  durInput.addEventListener("change", () => {
    const w = durationWidget(node)
    const v = Math.max(0, Number(durInput.value) || 0)
    if (w) w.value = v
    durInput.value = v
    node.setDirtyCanvas(true, true)
    renderTimeline()
  })
  durLabel.appendChild(durInput)
  header.appendChild(durLabel)
  box.appendChild(header)

  // Sources grid -----------------------------------------------------------
  const sourcesWrap = document.createElement("div")
  sourcesWrap.style.cssText = "padding:10px 14px; border-bottom:1px solid #3a3a3a;"
  const sourcesGrid = document.createElement("div")
  sourcesGrid.style.cssText = `
    display:grid; grid-template-columns:repeat(${GRID_COLS}, 1fr); gap:8px;
    max-height:460px; overflow-y:auto; padding-right:4px;
  `
  sourcesWrap.appendChild(sourcesGrid)
  box.appendChild(sourcesWrap)

  // Timeline -----------------------------------------------------------
  const timelineWrap = document.createElement("div")
  timelineWrap.style.cssText = "padding:10px 14px; flex:1; display:flex; flex-direction:column; min-height:0;"
  const rulerEl = document.createElement("div")
  rulerEl.style.cssText = "position:relative; height:16px; color:#888; font-size:11px; margin-bottom:2px;"
  const tracksEl = document.createElement("div")
  tracksEl.style.cssText = "position:relative; height:320px; overflow:hidden; border:1px solid #3a3a3a; border-radius:4px; background:#1c1c1c;"
  timelineWrap.appendChild(rulerEl)
  timelineWrap.appendChild(tracksEl)
  box.appendChild(timelineWrap)

  const errorEl = document.createElement("div")
  errorEl.style.cssText = "display:none; padding:4px 14px; color:#ff8080; font-size:12px;"
  box.appendChild(errorEl)

  // Bottom button bar -----------------------------------------------------
  const buttonRow = document.createElement("div")
  buttonRow.style.cssText = "display:flex; align-items:center; gap:6px; padding:10px 14px; border-top:1px solid #3a3a3a; flex-wrap:wrap;"
  box.appendChild(buttonRow)

  function sep() {
    const s = document.createElement("div")
    s.style.cssText = "width:1px; align-self:stretch; background:#444; margin:0 4px;"
    return s
  }

  // -------------------------------------------------------------------
  // Source boxes
  // -------------------------------------------------------------------

  function ensureMeta(sourceId, filename) {
    if (!filename) return
    if (meta[sourceId] && meta[sourceId]._filename === filename) return
    loadAudioMeta(filename).then((res) => {
      meta[sourceId] = { ...res, _filename: filename }
      renderSources()
      renderTimeline()
    })
  }

  function addEmptySource() {
    if (Object.keys(state.sources).length >= MAX_SOURCES) return
    const id = newId("s")
    state.sources[id] = {
      filename: "", label: "", colorIndex: nextColorIndex(state.sources),
      crop_start_s: 0, crop_end_s: 0,
    }
    persist()
    renderSources()
  }

  function deleteSource(id) {
    delete state.sources[id]
    delete meta[id]
    state.blocks = state.blocks.filter((b) => b.source !== id)
    if (selectedBlockId && !state.blocks.some((b) => b.id === selectedBlockId)) selectedBlockId = null
    persist()
    renderSources()
    renderTimeline()
  }

  function buildAddTile() {
    const tile = document.createElement("div")
    tile.style.cssText = `
      border:1px dashed #555; border-radius:5px; min-height:230px;
      display:flex; align-items:center; justify-content:center; cursor:pointer;
      font-size:32px; color:#777; user-select:none;
    `
    tile.textContent = "+"
    tile.addEventListener("click", addEmptySource)
    return tile
  }

  function buildSourceBox(id) {
    const src = state.sources[id]
    const hasFile = !!src.filename
    const color = colorFor(src)

    const el = document.createElement("div")
    el.style.cssText = `
      border:1px solid #3a3a3a; border-radius:5px; padding:8px; display:flex; flex-direction:column; gap:5px;
      background:#262626;
    `
    el.draggable = hasFile
    if (hasFile) {
      el.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", id)
        ev.dataTransfer.effectAllowed = "copy"
        const ghost = document.createElement("div")
        ghost.textContent = src.label || src.filename
        ghost.style.cssText = `
          position:absolute; top:-1000px; left:-1000px; padding:2px 6px; font-size:10px; color:#111;
          background:${color}; border-radius:3px; border:2px solid #fff; white-space:nowrap;
        `
        document.body.appendChild(ghost)
        ev.dataTransfer.setDragImage(ghost, 10, 10)
        setTimeout(() => ghost.remove(), 0)
      })
    }

    const filenameEl = document.createElement("div")
    filenameEl.style.cssText = "font-size:11px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
    filenameEl.textContent = src.filename || "(no file)"
    el.appendChild(filenameEl)

    const labelRow = document.createElement("div")
    labelRow.style.cssText = "display:flex; align-items:center; gap:6px;"
    const swatch = document.createElement("div")
    swatch.style.cssText = `width:14px; height:14px; border-radius:3px; background:${color}; flex:none;`
    const labelInput = document.createElement("input")
    labelInput.type = "text"
    labelInput.placeholder = "Label"
    labelInput.value = src.label || ""
    labelInput.disabled = !hasFile
    labelInput.style.cssText = "flex:1; min-width:0; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
    labelInput.addEventListener("change", () => {
      src.label = labelInput.value
      persist()
      renderTimeline()
    })
    labelRow.appendChild(swatch)
    labelRow.appendChild(labelInput)
    el.appendChild(labelRow)

    const canvas = document.createElement("canvas")
    canvas.width = 220
    canvas.height = 42
    canvas.style.cssText = "width:100%; height:42px; display:block; background:#151515; border-radius:3px;"
    el.appendChild(canvas)

    const m = meta[id]
    if (hasFile) drawWave(canvas, m?.peaks || null, color, m?.error)
    else drawWave(canvas, new Float32Array(1), "#3a3a3a")

    const dur = m?.duration || 0
    const cropStart = src.crop_start_s || 0
    const cropEnd = src.crop_end_s > 0 ? src.crop_end_s : dur

    const startSlider = document.createElement("input")
    startSlider.type = "range"
    startSlider.min = "0"; startSlider.max = String(Math.max(dur, CROP_STEP)); startSlider.step = String(CROP_STEP)
    startSlider.value = String(cropStart)
    startSlider.disabled = !hasFile || !m?.buffer
    startSlider.style.cssText = "width:100%; margin:0;"

    const endSlider = document.createElement("input")
    endSlider.type = "range"
    endSlider.min = "0"; endSlider.max = String(Math.max(dur, CROP_STEP)); endSlider.step = String(CROP_STEP)
    endSlider.value = String(cropEnd)
    endSlider.disabled = !hasFile || !m?.buffer
    endSlider.style.cssText = "width:100%; margin:0;"

    el.appendChild(startSlider)
    el.appendChild(endSlider)

    const startEndRow = document.createElement("div")
    startEndRow.style.cssText = "display:flex; gap:6px; align-items:center; font-size:11px; color:#aaa;"
    const startNum = document.createElement("input")
    const endNum = document.createElement("input")
    for (const inp of [startNum, endNum]) {
      inp.type = "number"
      inp.step = String(CROP_STEP)
      inp.min = "0"
      inp.disabled = !hasFile
      inp.style.cssText = "width:70px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
    }
    startNum.value = cropStart.toFixed(4)
    endNum.value = cropEnd.toFixed(4)
    startEndRow.append("Start:")
    startEndRow.appendChild(startNum)
    startEndRow.append("End:")
    startEndRow.appendChild(endNum)
    el.appendChild(startEndRow)

    function applyCrop(newStart, newEnd) {
      newStart = Math.max(0, Math.min(newStart, newEnd))
      newEnd = Math.max(newStart, Math.min(newEnd, dur || newEnd))
      src.crop_start_s = newStart
      src.crop_end_s = newEnd
      startSlider.value = String(newStart)
      endSlider.value = String(newEnd)
      startNum.value = newStart.toFixed(4)
      endNum.value = newEnd.toFixed(4)
      drawWave(canvas, m?.peaks || null, color)
      persist()
    }
    startSlider.addEventListener("input", () => applyCrop(Number(startSlider.value), Number(endSlider.value)))
    endSlider.addEventListener("input", () => applyCrop(Number(startSlider.value), Number(endSlider.value)))
    startNum.addEventListener("change", () => applyCrop(Number(startNum.value) || 0, Number(endNum.value) || 0))
    endNum.addEventListener("change", () => applyCrop(Number(startNum.value) || 0, Number(endNum.value) || 0))

    const btnRow = document.createElement("div")
    btnRow.style.cssText = "display:flex; gap:6px; margin-top:2px;"
    btnRow.appendChild(mkBtn("▶", {
      disabled: !hasFile || !m?.buffer,
      onClick: () => {
        stopAllPreviews()
        const cs = src.crop_start_s || 0
        const ce = src.crop_end_s > 0 ? src.crop_end_s : (m?.duration || 0)
        schedulePreview(m.buffer, cs, Math.max(0, ce - cs), 1, 0)
      },
    }))
    btnRow.appendChild(mkBtn("Upload", {
      onClick: () => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "audio/*,video/*"
        input.addEventListener("change", async () => {
          const file = input.files?.[0]
          if (!file) return
          try {
            const filename = await uploadAudioFile(file)
            src.filename = filename
            if (!src.label) src.label = file.name.replace(/\.[^.]+$/, "")
            src.crop_start_s = 0
            src.crop_end_s = 0
            delete meta[id]
            persist()
            renderSources()
            ensureMeta(id, filename)
          } catch (e) {
            showError(`Upload failed: ${e.message || e}`)
          }
        })
        input.click()
      },
    }))
    btnRow.appendChild(mkBtn("Delete", { danger: true, onClick: () => deleteSource(id) }))
    el.appendChild(btnRow)

    if (hasFile) ensureMeta(id, src.filename)

    return el
  }

  function renderSources() {
    sourcesGrid.innerHTML = ""
    for (const id of Object.keys(state.sources)) sourcesGrid.appendChild(buildSourceBox(id))
    if (Object.keys(state.sources).length < MAX_SOURCES) sourcesGrid.appendChild(buildAddTile())
  }

  // -------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------

  function pxPerSec() {
    const dur = currentDuration()
    const availW = Math.max(200, tracksEl.clientWidth - 4)
    return availW / dur
  }

  function addBlock(sourceId) {
    const row = nextEmptyRow(state)
    if (row < 0) {
      showError("Timeline is full (30 max).")
      return false
    }
    state.blocks.push({ id: newId("b"), source: sourceId, row, start_s: 0, gain: 1.0 })
    selectedBlockId = state.blocks[state.blocks.length - 1].id
    persist()
    renderTimeline()
    return true
  }

  function cloneSelected() {
    const blk = state.blocks.find((b) => b.id === selectedBlockId)
    if (!blk) return
    const row = nextEmptyRow(state)
    if (row < 0) {
      showError("Timeline is full (30 max).")
      return
    }
    const clone = { id: newId("b"), source: blk.source, row, start_s: 0, gain: blk.gain }
    state.blocks.push(clone)
    selectedBlockId = clone.id
    persist()
    renderTimeline()
  }

  function deleteBlock(id) {
    state.blocks = state.blocks.filter((b) => b.id !== id)
    if (selectedBlockId === id) selectedBlockId = null
    persist()
    renderTimeline()
  }

  function deleteAllBlocks() {
    state.blocks = []
    selectedBlockId = null
    persist()
    renderTimeline()
  }

  function addAllSources() {
    const ids = Object.keys(state.sources).filter((id) => state.sources[id].filename)
    if (ids.length === 0) return
    const free = freeRows(state, ids.length)
    if (free.length < ids.length) {
      showError(`Not enough room to add all ${ids.length} sound(s) (only ${free.length} free row(s)).`)
      return
    }
    ids.forEach((id, i) => {
      state.blocks.push({ id: newId("b"), source: id, row: free[i], start_s: 0, gain: 1.0 })
    })
    persist()
    renderTimeline()
  }

  function openAddPopup() {
    const ids = Object.keys(state.sources).filter((id) => state.sources[id].filename)
    const { box: pbox, close: closePopup } = overlayShell(320, () => { closeActivePopup = null })
    closeActivePopup = closePopup
    const close = closePopup
    const title = document.createElement("div")
    title.style.cssText = "padding:10px 14px; border-bottom:1px solid #3a3a3a; font-weight:600;"
    title.textContent = "Add sound"
    pbox.appendChild(title)
    const list = document.createElement("div")
    list.style.cssText = "display:flex; flex-direction:column; gap:4px; padding:10px 14px; max-height:300px; overflow-y:auto;"
    if (ids.length === 0) {
      const empty = document.createElement("div")
      empty.style.cssText = "color:#888;"
      empty.textContent = "No sounds uploaded yet."
      list.appendChild(empty)
    }
    for (const id of ids) {
      const src = state.sources[id]
      const b = mkBtn(src.label || src.filename, {
        onClick: () => {
          close()
          addBlock(id)
        },
      })
      b.style.textAlign = "left"
      b.style.borderLeft = `4px solid ${colorFor(src)}`
      list.appendChild(b)
    }
    pbox.appendChild(list)
    const foot = document.createElement("div")
    foot.style.cssText = "display:flex; justify-content:flex-end; padding:10px 14px; border-top:1px solid #3a3a3a;"
    foot.appendChild(mkBtn("Cancel", { onClick: close }))
    pbox.appendChild(foot)
  }

  function renderRuler() {
    const dur = currentDuration()
    rulerEl.innerHTML = `<span style="position:absolute; left:0;">0</span><span style="position:absolute; right:0;">${dur.toFixed(2)}s</span>`
  }

  function renderTimeline() {
    renderRuler()
    tracksEl.innerHTML = ""
    blockEls.clear()
    const rows = visibleRowCount(state)
    const rowH = tracksEl.clientHeight > 0 ? tracksEl.clientHeight / rows : 320 / rows
    const ppS = pxPerSec()
    const byRow = new Map(state.blocks.map((b) => [b.row, b]))

    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div")
      rowEl.style.cssText = `position:absolute; left:0; right:0; top:${r * rowH}px; height:${rowH}px; border-bottom:1px solid #2a2a2a; box-sizing:border-box;`
      tracksEl.appendChild(rowEl)

      const blk = byRow.get(r)
      if (!blk) continue
      const src = state.sources[blk.source]
      if (!src) continue
      const m = meta[blk.source]
      const cropStart = src.crop_start_s || 0
      const cropEnd = src.crop_end_s > 0 ? src.crop_end_s : (m?.duration || 0)
      const cropDur = Math.max(0.05, cropEnd - cropStart)
      const color = colorFor(src)

      const blockEl = document.createElement("div")
      blockEls.set(blk.id, blockEl)
      const selected = blk.id === selectedBlockId
      const label = `${src.label || src.filename} (${(blk.start_s || 0).toFixed(2)}s)`
      blockEl.style.cssText = `
        position:absolute; top:2px; bottom:2px; left:${(blk.start_s || 0) * ppS}px; width:${cropDur * ppS}px;
        background:${color}; border-radius:3px; cursor:grab; overflow:hidden;
        border:2px solid ${selected ? "#fff" : "transparent"}; box-sizing:border-box;
        font-size:10px; color:#111; padding:2px 4px; white-space:nowrap;
      `
      blockEl.textContent = label
      blockEl.addEventListener("mousedown", (ev) => {
        if (selectedBlockId !== blk.id) {
          selectedBlockId = blk.id
          for (const [bid, el] of blockEls) el.style.borderColor = bid === blk.id ? "#fff" : "transparent"
          renderButtonRow()
        }
        const startX = ev.clientX
        const origStart = blk.start_s || 0
        const maxStart = currentDuration()
        blockEl.style.cursor = "grabbing"
        function onMove(mv) {
          const deltaS = (mv.clientX - startX) / pxPerSec()
          blk.start_s = Math.max(0, Math.min(maxStart, origStart + deltaS))
          blockEl.style.left = `${blk.start_s * pxPerSec()}px`
          blockEl.textContent = `${src.label || src.filename} (${blk.start_s.toFixed(2)}s)`
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove)
          document.removeEventListener("mouseup", onUp)
          blockEl.style.cursor = "grab"
          persist()
          renderTimeline()
        }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
        ev.preventDefault()
      })
      rowEl.appendChild(blockEl)
    }

    renderButtonRow()
  }

  // -------------------------------------------------------------------
  // Button row
  // -------------------------------------------------------------------

  function renderButtonRow() {
    buttonRow.innerHTML = ""
    buttonRow.appendChild(mkBtn("▶ Play Mix", {
      onClick: () => {
        stopAllPreviews()
        const dur = currentDuration()
        for (const blk of state.blocks) {
          const src = state.sources[blk.source]
          const m = meta[blk.source]
          if (!src || !m?.buffer) continue
          const cropStart = src.crop_start_s || 0
          const cropEnd = src.crop_end_s > 0 ? src.crop_end_s : m.duration
          const cropDur = Math.max(0, cropEnd - cropStart)
          const startAt = Math.max(0, blk.start_s || 0)
          if (cropDur <= 0 || startAt >= dur) continue
          const playDur = Math.min(cropDur, dur - startAt)
          if (playDur <= 0) continue
          schedulePreview(m.buffer, cropStart, playDur, (blk.gain ?? 1) * (state.overall_gain ?? 1), startAt)
        }
      },
    }))
    buttonRow.appendChild(mkBtn("Add", { onClick: openAddPopup }))
    buttonRow.appendChild(mkBtn("Add All", { onClick: addAllSources }))
    buttonRow.appendChild(sep())

    const selBlock = state.blocks.find((b) => b.id === selectedBlockId)
    if (selBlock) {
      const src = state.sources[selBlock.source]
      const m = meta[selBlock.source]
      buttonRow.appendChild(mkBtn("▶", {
        disabled: !m?.buffer,
        onClick: () => {
          stopAllPreviews()
          const cs = src?.crop_start_s || 0
          const ce = src?.crop_end_s > 0 ? src.crop_end_s : (m?.duration || 0)
          schedulePreview(m.buffer, cs, Math.max(0, ce - cs), (selBlock.gain ?? 1) * (state.overall_gain ?? 1), 0)
        },
      }))

      const startLbl = document.createElement("label")
      startLbl.style.cssText = "display:flex; align-items:center; gap:4px; color:#aaa;"
      startLbl.append("Start:")
      const startInput = document.createElement("input")
      startInput.type = "number"
      startInput.step = "0.001"
      startInput.min = "0"
      startInput.value = (selBlock.start_s || 0).toFixed(3)
      startInput.style.cssText = "width:70px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
      startInput.addEventListener("change", () => {
        selBlock.start_s = Math.max(0, Number(startInput.value) || 0)
        persist()
        renderTimeline()
      })
      startLbl.appendChild(startInput)
      buttonRow.appendChild(startLbl)

      const gainLbl = document.createElement("label")
      gainLbl.style.cssText = "display:flex; align-items:center; gap:4px; color:#aaa;"
      gainLbl.append("Gain:")
      const gainInput = document.createElement("input")
      gainInput.type = "number"
      gainInput.step = "0.05"
      gainInput.min = "0"
      gainInput.value = selBlock.gain ?? 1.0
      gainInput.style.cssText = "width:60px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
      gainInput.addEventListener("change", () => {
        selBlock.gain = Math.max(0, Number(gainInput.value))
        if (!Number.isFinite(selBlock.gain)) selBlock.gain = 1.0
        persist()
      })
      gainLbl.appendChild(gainInput)
      buttonRow.appendChild(gainLbl)

      buttonRow.appendChild(mkBtn("Clone Selected", { onClick: cloneSelected }))
      buttonRow.appendChild(mkBtn("Delete Selected", { danger: true, onClick: () => deleteBlock(selBlock.id) }))
      buttonRow.appendChild(sep())
    }

    if (state.blocks.length > 0) {
      buttonRow.appendChild(mkBtn("Delete All", { danger: true, onClick: deleteAllBlocks }))
    }

    const overallLbl = document.createElement("label")
    overallLbl.style.cssText = "display:flex; align-items:center; gap:4px; color:#aaa; margin-left:auto;"
    overallLbl.append("Overall Gain:")
    const overallInput = document.createElement("input")
    overallInput.type = "number"
    overallInput.step = "0.05"
    overallInput.min = "0"
    overallInput.value = state.overall_gain ?? 1.0
    overallInput.style.cssText = "width:60px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
    overallInput.addEventListener("change", () => {
      state.overall_gain = Math.max(0, Number(overallInput.value))
      if (!Number.isFinite(state.overall_gain)) state.overall_gain = 1.0
      persist()
    })
    overallLbl.appendChild(overallInput)
    buttonRow.appendChild(overallLbl)

    buttonRow.appendChild(mkBtn("Close", { onClick: closeOverlay }))
  }

  // Drag-drop from source boxes into the timeline --------------------------
  tracksEl.addEventListener("dragover", (ev) => {
    ev.preventDefault()
    ev.dataTransfer.dropEffect = "copy"
  })
  tracksEl.addEventListener("drop", (ev) => {
    ev.preventDefault()
    const sourceId = ev.dataTransfer.getData("text/plain")
    if (sourceId && state.sources[sourceId]) addBlock(sourceId)
  })

  function onKeyDown(ev) {
    const tag = (ev.target?.tagName || "").toLowerCase()
    if (tag === "input" || tag === "textarea") return
    if (ev.key === "Escape") {
      if (closeActivePopup) closeActivePopup()
      else closeOverlay()
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && selectedBlockId) {
      deleteBlock(selectedBlockId)
    }
  }
  document.addEventListener("keydown", onKeyDown)

  renderSources()
  renderTimeline()
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

app.registerExtension({
  name: "daz.SoundMixer",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS) return

    const origOnNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      origOnNodeCreated?.apply(this, arguments)
      const w = mixStateWidget(this)
      if (w) w.hidden = true
      this.addWidget("button", "Edit Mix", null, () => openMixEditor(this))
      this.setDirtyCanvas(true, true)
    }

    const origOnConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function () {
      origOnConfigure?.apply(this, arguments)
      const w = mixStateWidget(this)
      if (w) w.hidden = true
    }
  },
})
