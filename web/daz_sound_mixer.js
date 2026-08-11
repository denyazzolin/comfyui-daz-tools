import { app } from "../../scripts/app.js"

const CLASS = "daz_sound_mixer"

const MAX_SOURCES = 16
const GRID_COLS = 4
const EDITOR_BASE_WIDTH = 1040
const VIDEO_PANEL_WIDTH = 288
const MIN_ROWS = 8
const MAX_BLOCK_ROWS = 30
const MAX_VISIBLE_ROWS = 31
const CROP_STEP = 0.001 // milliseconds, in seconds
// Brightness factor the waveform is drawn at outside the crop. Fades ramp
// between this and 1.0, so a fade region reads as a gradient from the same
// half-intensity the trimmed-away part uses up to the source's full color.
const DIM_FACTOR = 0.45
const FADE_HANDLE_COLOR = "#2f6ad9"
const FPS_CUSTOM_COLOR = "#e05a5a"
// Geometric Shapes rather than the Media Controls block, whose glyphs some
// platform fonts substitute with full-color emoji next to a plain "▶".
const PLAY_GLYPH = "▶"
const STOP_GLYPH = "■"

const COLORS = [
  "#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66", "#be5046",
  "#4fc1ff", "#c3e88d", "#f78c6c", "#ff5370", "#ba68c8", "#4dd0e1", "#ffd54f", "#8d6e63",
]

function colorFor(source) {
  const i = source && Number.isInteger(source.colorIndex) ? source.colorIndex : 0
  return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length]
}

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const f = (c) => Math.round(c * factor)
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`
}

function darken(hex, amount = 0.55) {
  return shade(hex, 1 - amount)
}

// Seconds between labeled ruler ticks, picked so ticks stay >=40px apart
// regardless of zoom (duration vs. timeline width) — otherwise a long
// duration would generate thousands of DOM nodes.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
function tickStep(ppS) {
  for (const s of TICK_STEPS) if (s * ppS >= 40) return s
  return TICK_STEPS[TICK_STEPS.length - 1]
}

// Sub-second (0.1s) dots only make sense between whole-second major ticks,
// and only once they're spaced far enough apart to be legible.
function computeTicks(dur, ppS) {
  const step = tickStep(ppS)
  const majors = []
  for (let s = 0; s <= dur + 1e-9; s += step) majors.push(s)
  const minors = []
  if (step === 1 && ppS * 0.1 >= 3) {
    for (let s = 0; s < dur - 1e-9; s++) {
      for (let d = 1; d <= 9; d++) {
        const ds = s + d * 0.1
        if (ds < dur - 1e-9) minors.push(ds)
      }
    }
  }
  return { majors, minors }
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

// The only rule in this file that can't be expressed as an inline style:
// spin buttons are reachable solely through pseudo-elements. Chrome reveals
// them on hover and lays them over the field's own text, which in a box only
// wide enough for "x.yyy" clipped the last digit. Injected once, on first
// use, since this module has no other stylesheet.
let _numStyleInjected = false
function ensureNumberInputStyles() {
  if (_numStyleInjected) return
  _numStyleInjected = true
  const style = document.createElement("style")
  style.textContent = `
    .daz-sm-num::-webkit-outer-spin-button,
    .daz-sm-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .daz-sm-num { -moz-appearance: textfield; appearance: textfield; }
  `
  document.head.appendChild(style)
}

function overlayShell(width, onClose, opts = {}) {
  const { closeOnBackdropClick = true } = opts
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
  if (closeOnBackdropClick) {
    overlay.addEventListener("mousedown", (ev) => {
      if (ev.target === overlay) close()
    })
  }
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

// fps/duration/frame count come from the server (PyAV), since browsers don't
// reliably expose a container's real frame rate.
async function probeMovie(filename) {
  const res = await fetch(`/daz/sound-mixer/video-info?filename=${encodeURIComponent(filename)}`)
  const info = await res.json()
  if (!res.ok || info.error) throw new Error(info.error || `probe failed (${res.status})`)
  return info
}

let _activeNodes = []
function stopAllPreviews() {
  for (const n of _activeNodes) {
    try { n.stop() } catch { /* already stopped */ }
  }
  _activeNodes = []
}
// `playDur` is how long the source actually sounds (Play Mix truncates it at
// the mix duration); `envDur` is the untruncated crop length the fade-out is
// anchored to, so a block running past the end of the mix gets its fade-out
// cut off exactly like sound_mixer.py cuts it off, rather than pulled early.
function schedulePreview(buffer, cropStart, playDur, gain, when = 0, opts = {}) {
  const { fadeIn = 0, fadeOut = 0, envDur = playDur } = opts
  const ctx = audioContext()
  if (!ctx || !buffer || playDur <= 0) return
  if (ctx.state === "suspended") ctx.resume()
  const gainNode = ctx.createGain()
  const t0 = ctx.currentTime + when
  const fi = Math.max(0, Math.min(fadeIn, envDur))
  const fo = Math.max(0, Math.min(fadeOut, envDur - fi))
  gainNode.gain.setValueAtTime(fi > 0 ? 0 : gain, t0)
  if (fi > 0) gainNode.gain.linearRampToValueAtTime(gain, t0 + fi)
  if (fo > 0) {
    gainNode.gain.setValueAtTime(gain, t0 + envDur - fo)
    gainNode.gain.linearRampToValueAtTime(0, t0 + envDur)
  }
  const bufSrc = ctx.createBufferSource()
  bufSrc.buffer = buffer
  bufSrc.connect(gainNode).connect(ctx.destination)
  bufSrc.start(t0, cropStart, playDur)
  _activeNodes.push(bufSrc)
}

function drawWave(canvas, peaks, color, opts = {}) {
  const { errored, cropStart = 0, cropEnd = 0, dur = 0, fadeIn = 0, fadeOut = 0 } = opts
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
  const shaded = dur > 0 && (cropStart > 0 || cropEnd < dur || fadeIn > 0 || fadeOut > 0)
  // Brightness of the bar at time `t`: DIM_FACTOR outside the crop, a linear
  // ramp up/down across each fade region, full color everywhere else.
  function factorAt(t) {
    if (t < cropStart || t > cropEnd) return DIM_FACTOR
    let f = 1
    if (fadeIn > 0 && t < cropStart + fadeIn) {
      f = Math.min(f, DIM_FACTOR + (1 - DIM_FACTOR) * ((t - cropStart) / fadeIn))
    }
    if (fadeOut > 0 && t > cropEnd - fadeOut) {
      f = Math.min(f, DIM_FACTOR + (1 - DIM_FACTOR) * ((cropEnd - t) / fadeOut))
    }
    return f
  }
  for (let i = 0; i < peaks.length; i++) {
    const bh = Math.max(1, peaks[i] * (h - 4))
    let fill = color
    if (shaded) {
      const f = factorAt(((i + 0.5) / peaks.length) * dur)
      if (f < 1) fill = shade(color, f)
    }
    ctx.fillStyle = fill
    ctx.fillRect(i * barW, mid - bh / 2, Math.max(1, barW - 1), bh)
  }
}

// ---------------------------------------------------------------------------
// State (mix_state widget JSON)
// ---------------------------------------------------------------------------

function mixStateWidget(node) {
  return node.widgets?.find((w) => w.name === "mix_state")
}
// A file's own rate is often fractional (29.97); a custom rate is always an
// integer, so this really just trims the original's trailing zeros.
function fmtFps(v) {
  return String(Number(Number(v).toFixed(3)))
}

function durationWidget(node) {
  return node.widgets?.find((w) => w.name === "duration")
}

function readState(node) {
  const w = mixStateWidget(node)
  try {
    const parsed = JSON.parse(w?.value || "{}")
    const sources = (parsed && typeof parsed.sources === "object" && parsed.sources) || {}
    const blocks = normalizeBlocks(Array.isArray(parsed?.blocks) ? parsed.blocks : [])
    let overall_gain = Number(parsed?.overall_gain)
    if (!Number.isFinite(overall_gain)) overall_gain = 1.0
    // Only the filename and any fps override are kept: the movie is a
    // reference-timing aid, not part of the mix, and its real fps/duration
    // are re-probed on reopen so a replaced file on disk can't leave stale
    // frame math behind. This object is rebuilt from scratch on every read,
    // so a field missing here is dropped from the widget on the next write —
    // add, don't assume.
    const movie_filename = typeof parsed?.movie_filename === "string" ? parsed.movie_filename : ""
    // 0 means "play at the file's own rate". Anything else is the integer
    // rate the user says the movie runs at, which rescales playback and the
    // frame -> timeline-seconds math without touching the file itself. Kept
    // with the workflow because block placements were made against it.
    let movie_fps = Number(parsed?.movie_fps)
    if (!Number.isFinite(movie_fps) || movie_fps <= 0) movie_fps = 0
    return { sources, blocks, overall_gain, movie_filename, movie_fps }
  } catch {
    return { sources: {}, blocks: [], overall_gain: 1.0, movie_filename: "", movie_fps: 0 }
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

// Row is a display-grid concept only (the timeline renders one block per
// row via a row->block Map), but nothing else in the app groups by row —
// two blocks sharing (or missing) a row silently collapse to one visible
// box while both still get mixed, so any invalid/duplicate row must be
// repaired before the state is used for anything.
function normalizeBlocks(blocks) {
  const seen = new Set()
  for (const blk of blocks) {
    if (Number.isInteger(blk.row) && blk.row >= 0 && blk.row < MAX_BLOCK_ROWS && !seen.has(blk.row)) {
      seen.add(blk.row)
    } else {
      blk.row = -1
    }
  }
  for (const blk of blocks) {
    if (blk.row === -1) {
      let r = 0
      while (r < MAX_BLOCK_ROWS && seen.has(r)) r++
      if (r < MAX_BLOCK_ROWS) {
        blk.row = r
        seen.add(r)
      }
    }
  }
  return blocks.filter((b) => b.row >= 0)
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
  const sourcePlayheads = new Map() // sourceId -> waveform playhead line element
  let timelinePlayhead = null
  let activeRafs = []
  let videoPanel = null // DOM element for the movie side panel, when open
  let videoState = null // {filename, fps, duration, frameCount, addAtTime, videoEl, listEl}
  let videoStopTimer = null // pauses the video at the mix duration when Play Mix is used
  const playButtons = new Map() // play-button id -> live button element
  let playingId = null // id of the button whose playback is currently sounding
  let playbackEndTimer = null
  let editorClosed = false // guards work that resumes after an await (see restoreMovie)

  ensureNumberInputStyles()

  const { box, close: closeOverlay } = overlayShell(EDITOR_BASE_WIDTH, () => {
    editorClosed = true
    stopAll()
    // A popup normally can't outlive the editor — its backdrop covers every
    // way of closing one — but committing the fps box by clicking Ok opens a
    // prompt out of that very click, and it would be left behind writing to
    // a node whose editor is gone.
    closeActivePopup?.()
    clearTimeout(errorTimer)
    document.removeEventListener("keydown", onKeyDown)
  }, { closeOnBackdropClick: false })

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

  // Animates `el`'s `left` (in `unit`, "%" or "px") over `durationS` seconds,
  // hiding it when done; returns nothing, but registers a canceller so
  // stopAll() can cut every in-flight playhead animation at once.
  function animatePlayhead(el, getPos, durationS, unit) {
    if (!el || !(durationS > 0)) return
    const startT = performance.now()
    let raf
    function tick() {
      const elapsed = (performance.now() - startT) / 1000
      if (elapsed >= durationS) { el.style.display = "none"; return }
      el.style.display = "block"
      el.style.left = `${getPos(elapsed)}${unit}`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    activeRafs.push(() => { cancelAnimationFrame(raf); el.style.display = "none" })
  }

  // Every play button doubles as a stop button, and only one preview ever
  // sounds at a time (each play path calls stopAll first), so a single
  // `playingId` is enough to say which button should be showing its stop
  // label. The label is re-derived from it whenever a button is built, so a
  // rebuild mid-playback (selecting a block, a source finishing decoding)
  // can't strand a stale glyph on the new button.
  function registerPlayButton(id, btn, playLabel, stopLabel) {
    btn.dataset.playLabel = playLabel
    btn.dataset.stopLabel = stopLabel
    playButtons.set(id, btn)
    btn.textContent = playingId === id ? stopLabel : playLabel
    return btn
  }

  function syncPlayButtons() {
    for (const [id, btn] of playButtons) {
      // Selecting block after block registers one entry each, and the rows are
      // rebuilt rather than reused — drop the buttons those rebuilds detached.
      // Safe to test here: this only ever runs from a play/stop action, never
      // mid-render, so a live button is always in the document by now.
      if (!btn.isConnected) {
        playButtons.delete(id)
        continue
      }
      btn.textContent = playingId === id ? btn.dataset.stopLabel : btn.dataset.playLabel
    }
  }

  // Web Audio fires nothing when a scheduled source simply runs out, so the
  // button is flipped back on a timer matched to the length the playback was
  // scheduled for. The small margin keeps the glyph from snapping back a
  // frame early on the last of the audio.
  function beginPlayback(id, durationS) {
    clearTimeout(playbackEndTimer)
    playbackEndTimer = null
    playingId = id
    if (durationS > 0 && Number.isFinite(durationS)) {
      playbackEndTimer = setTimeout(() => {
        playbackEndTimer = null
        playingId = null
        syncPlayButtons()
      }, durationS * 1000 + 60)
    }
    syncPlayButtons()
  }

  function stopAll() {
    stopAllPreviews()
    for (const cancel of activeRafs) cancel()
    activeRafs = []
    clearTimeout(playbackEndTimer)
    playbackEndTimer = null
    playingId = null
    syncPlayButtons()
    clearTimeout(videoStopTimer)
    videoStopTimer = null
    try { videoState?.stopLoopPlayback?.() } catch { /* nothing to stop */ }
    try { videoState?.videoEl?.pause() } catch { /* nothing to pause */ }
  }

  // Header ---------------------------------------------------------------
  const header = document.createElement("div")
  header.style.cssText = "display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid #3a3a3a;"
  header.innerHTML = `<div style="font-weight:600; flex:1;">Sound Mixer</div>`
  const movieFileInput = document.createElement("input")
  movieFileInput.type = "file"
  movieFileInput.accept = "video/*"
  movieFileInput.style.display = "none"
  movieFileInput.addEventListener("change", async () => {
    const file = movieFileInput.files?.[0]
    movieFileInput.value = ""
    if (!file) return
    try {
      const filename = await uploadAudioFile(file)
      const info = await probeMovie(filename)
      state.movie_filename = filename
      state.movie_fps = 0 // a new movie always starts at its own rate
      persist()
      openVideoPanel(filename, info)
      maybeWarnDurationMismatch(info.duration)
    } catch (e) {
      showError(`Could not load movie: ${e.message || e}`)
    }
  })
  header.appendChild(movieFileInput)
  header.appendChild(mkBtn("Upload a Movie", { onClick: () => movieFileInput.click() }))
  // Discarding is the only way to forget the movie — closeVideoPanel alone
  // just tears down the DOM (openVideoPanel calls it to replace one movie
  // with another), so clearing the persisted filename belongs here.
  const discardMovieBtn = mkBtn("Discard Movie", {
    danger: true,
    onClick: () => {
      state.movie_filename = ""
      state.movie_fps = 0
      persist()
      closeVideoPanel()
    },
  })
  discardMovieBtn.style.display = "none"
  header.appendChild(discardMovieBtn)
  const durLabel = document.createElement("label")
  durLabel.style.cssText = "display:flex; align-items:center; gap:6px; color:#aaa;"
  durLabel.append("Duration (s)")
  const durInput = document.createElement("input")
  durInput.type = "number"
  durInput.className = "daz-sm-num"
  durInput.step = "0.001"
  durInput.min = "0"
  durInput.style.cssText = "width:56px; box-sizing:border-box; font-size:12px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
  durInput.value = currentDuration()
  function setDuration(v) {
    const w = durationWidget(node)
    const val = Math.max(0, Number(v) || 0)
    if (w) w.value = val
    durInput.value = val
    node.setDirtyCanvas(true, true)
    renderTimeline()
  }
  durInput.addEventListener("change", () => setDuration(durInput.value))
  durLabel.appendChild(durInput)
  header.appendChild(durLabel)

  // Overrides the rate the movie is treated as running at. Only meaningful
  // with a movie loaded, so it appears and disappears with the panel; the
  // value itself lives in videoState, which openVideoPanel rebuilds from
  // scratch — that is what makes discarding or re-uploading reset it.
  const fpsLabel = document.createElement("label")
  fpsLabel.style.cssText = "display:none; align-items:center; gap:6px; color:#aaa;"
  fpsLabel.append("FPS")
  const fpsInput = document.createElement("input")
  fpsInput.type = "number"
  fpsInput.className = "daz-sm-num"
  fpsInput.step = "1"
  fpsInput.min = "1"
  fpsInput.title = "Play the movie as if it ran at this frame rate. Esc restores the file's own rate."
  fpsInput.style.cssText = "width:46px; box-sizing:border-box; font-size:12px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"
  fpsLabel.appendChild(fpsInput)
  header.appendChild(fpsLabel)

  // Red is the entire hint that the movie is no longer running at its own
  // rate, so it has to be re-derived from the values rather than latched by
  // whichever handler last touched the box.
  let lastSyncedFps = ""
  function syncFpsInput() {
    if (!videoState) return
    lastSyncedFps = fmtFps(videoState.timelineFps)
    fpsInput.value = lastSyncedFps
    fpsInput.style.color = videoState.timelineFps === videoState.sourceFps ? "#ddd" : FPS_CUSTOM_COLOR
  }
  // Committed on Enter or blur rather than on `change`. With the spin buttons
  // hidden the arrow keys still adjust a number input, and browsers fire
  // `change` on every tick — holding one down would stop playback, rescale
  // the whole timeline and raise a duration prompt once per step. This way
  // the number can be dialled in freely and nothing moves until it's meant to.
  function commitFps() {
    // Leaving the box untouched must never count as a change. A custom rate
    // is an integer but a file's own rate usually isn't (29.97, 23.976), so
    // committing the text the box already held would round it to 30 or 24 —
    // a rate the user never typed, rescaling the timeline on a stray click.
    if (fpsInput.value === lastSyncedFps) return
    videoState?.setTimelineFps?.(Number(fpsInput.value))
  }
  fpsInput.addEventListener("blur", commitFps)
  fpsInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault()
      commitFps()
      return
    }
    if (ev.key !== "Escape") return
    // The editor's own Escape handler already ignores events from inputs, so
    // this can't close the editor today — stopped anyway so that guard and
    // this reset stay independent.
    ev.stopPropagation()
    ev.preventDefault()
    videoState?.setTimelineFps?.(0) // 0 = back to the file's own rate
  })

  box.appendChild(header)

  // Body row — a main column (sources/timeline/buttons) plus an optional
  // video panel appended to its right when a movie is loaded. Kept as a
  // sibling row rather than nesting the video panel inside any one section,
  // since the panel spans the full height of the editor per the wireframe.
  const bodyRow = document.createElement("div")
  bodyRow.style.cssText = "display:flex; flex:1; min-height:0; overflow:hidden;"
  box.appendChild(bodyRow)
  const mainCol = document.createElement("div")
  mainCol.style.cssText = "display:flex; flex-direction:column; flex:1; min-width:0; min-height:0;"
  bodyRow.appendChild(mainCol)

  // Sources grid -----------------------------------------------------------
  const sourcesWrap = document.createElement("div")
  sourcesWrap.style.cssText = "padding:10px 14px; border-bottom:1px solid #3a3a3a;"
  const sourcesGrid = document.createElement("div")
  sourcesGrid.style.cssText = `
    display:grid; grid-template-columns:repeat(${GRID_COLS}, 1fr); gap:8px; align-items:start;
    max-height:460px; overflow-y:auto; padding-right:4px;
  `
  sourcesWrap.appendChild(sourcesGrid)
  mainCol.appendChild(sourcesWrap)

  // Timeline -----------------------------------------------------------
  const timelineWrap = document.createElement("div")
  timelineWrap.style.cssText = "padding:10px 14px; flex:1; display:flex; flex-direction:column; min-height:0;"
  const rulerEl = document.createElement("div")
  rulerEl.style.cssText = "position:relative; height:22px; color:#888; font-size:10px; margin-bottom:2px;"
  const tracksEl = document.createElement("div")
  tracksEl.style.cssText = "position:relative; height:320px; overflow:hidden; border:1px solid #3a3a3a; border-radius:4px; background:#1c1c1c;"
  timelineWrap.appendChild(rulerEl)
  timelineWrap.appendChild(tracksEl)
  mainCol.appendChild(timelineWrap)

  const errorEl = document.createElement("div")
  errorEl.style.cssText = "display:none; padding:4px 14px; color:#ff8080; font-size:12px;"
  mainCol.appendChild(errorEl)

  // Bottom button bar -----------------------------------------------------
  const buttonRow = document.createElement("div")
  buttonRow.style.cssText = "display:flex; align-items:center; gap:6px; padding:10px 14px; border-top:1px solid #3a3a3a; flex-wrap:wrap;"
  mainCol.appendChild(buttonRow)

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

  function createEmptySource() {
    if (Object.keys(state.sources).length >= MAX_SOURCES) return null
    const id = newId("s")
    state.sources[id] = {
      filename: "", label: "", colorIndex: nextColorIndex(state.sources),
      crop_start_s: 0, crop_end_s: 0,
      fade_in_s: 0, fade_out_s: 0,
      // Editor-only: whether this box's waveform sliders currently drive the
      // fades instead of the crop. Persisted so it survives reopening; the
      // Python side ignores it.
      fade_mode: false,
    }
    return id
  }

  function addEmptySource() {
    const id = createEmptySource()
    if (!id) return
    persist()
    renderSources()
  }

  function uploadForSource(id) {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "audio/*,video/*"
    input.addEventListener("change", async () => {
      const file = input.files?.[0]
      if (!file) return
      const src = state.sources[id]
      if (!src) return
      try {
        const filename = await uploadAudioFile(file)
        src.filename = filename
        if (!src.label) src.label = file.name.replace(/\.[^.]+$/, "")
        src.crop_start_s = 0
        src.crop_end_s = 0
        src.fade_in_s = 0
        src.fade_out_s = 0
        delete meta[id]
        persist()
        renderSources()
        ensureMeta(id, filename)
      } catch (e) {
        showError(`Upload failed: ${e.message || e}`)
      }
    })
    input.click()
  }

  function deleteSource(id) {
    // Its play button is about to disappear, so anything it started would
    // otherwise keep sounding with no way to stop it.
    if (playingId === `src:${id}`) stopAll()
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
      border:1px dashed #555; border-radius:5px; padding:8px;
      display:flex; flex-direction:column; gap:8px;
    `
    const plus = document.createElement("div")
    plus.style.cssText = `
      flex:1; display:flex; align-items:center; justify-content:center; cursor:pointer;
      font-size:32px; color:#777; user-select:none;
    `
    plus.textContent = "+"
    plus.addEventListener("click", addEmptySource)
    tile.appendChild(plus)
    tile.appendChild(mkBtn("Upload", {
      onClick: () => {
        const id = createEmptySource()
        if (!id) return
        persist()
        renderSources()
        uploadForSource(id)
      },
    }))
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
    // Interactive controls (crop sliders, canvas click-to-crop, buttons) must
    // not be hijacked into starting the box's own HTML5 drag — a custom-styled
    // range thumb can otherwise lose its native drag recognition and the
    // ancestor's draggable=true wins instead, showing a no-drop cursor.
    // `label` matters as much as `input` here: a click on the Fade
    // checkbox's text targets the <label>, which has the checkbox as a child
    // rather than an ancestor, so closest() would not otherwise see it — and
    // a drag started that way swallows the click that would have toggled it.
    let suppressBoxDrag = false
    el.addEventListener("mousedown", (ev) => {
      suppressBoxDrag = !!ev.target.closest?.("input, canvas, button, label")
    })
    if (hasFile) {
      el.addEventListener("dragstart", (ev) => {
        if (suppressBoxDrag) { ev.preventDefault(); return }
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

    const waveWrap = document.createElement("div")
    waveWrap.style.cssText = "position:relative; width:100%; height:42px;"
    const canvas = document.createElement("canvas")
    canvas.width = 220
    canvas.height = 42
    canvas.style.cssText = "width:100%; height:42px; display:block; background:#151515; border-radius:3px;"
    waveWrap.appendChild(canvas)
    el.appendChild(waveWrap)

    const m = meta[id]
    const dur = m?.duration || 0

    // Live readers — the crop/fade values are mutated in place by the drag
    // handlers, so nothing may capture them in a local at build time.
    // crop_end_s === 0 means "uncropped, full duration" everywhere in this
    // file (and in sound_mixer.py), so it must be resolved before ever being
    // used as an actual end value.
    const cropStartNow = () => src.crop_start_s || 0
    const cropEndNow = () => (src.crop_end_s > 0 ? src.crop_end_s : dur)
    const fadeInNow = () => src.fade_in_s || 0
    const fadeOutNow = () => src.fade_out_s || 0

    // Custom-drawn crop handles instead of native <input type=range> thumbs:
    // a native thumb's travel is inset by half its own width from the track
    // edges, which never lines up with the plain linear time->pixel math the
    // waveform/playhead use, so the handle visibly drifted from the true
    // crop point. Positioning these ourselves keeps them pixel-exact and
    // lets the line be as thin as we want.
    function handleLine(background) {
      const el = document.createElement("div")
      el.style.cssText = `
        position:absolute; top:0; bottom:0; width:1px; background:${background};
        pointer-events:none; box-shadow:0 0 2px rgba(0,0,0,0.9); z-index:3;
      `
      return el
    }
    const startHandleEl = handleLine("#fff")
    const endHandleEl = handleLine("#fff")
    // Fade handles sit at the inner end of each fade, i.e. offset from the
    // crop edge they are anchored to — so they follow the white handles when
    // the crop moves, in either mode.
    const fadeInHandleEl = handleLine(FADE_HANDLE_COLOR)
    const fadeOutHandleEl = handleLine(FADE_HANDLE_COLOR)
    fadeInHandleEl.style.zIndex = "4"
    fadeOutHandleEl.style.zIndex = "4"
    waveWrap.appendChild(startHandleEl)
    waveWrap.appendChild(endHandleEl)
    waveWrap.appendChild(fadeInHandleEl)
    waveWrap.appendChild(fadeOutHandleEl)

    const playheadEl = document.createElement("div")
    playheadEl.style.cssText = `
      position:absolute; top:0; bottom:0; width:1px; background:#3ecf3e; display:none;
      pointer-events:none; box-shadow:0 0 2px #3ecf3e; z-index:5;
    `
    waveWrap.appendChild(playheadEl)
    sourcePlayheads.set(id, playheadEl)

    const startEndRow = document.createElement("div")
    startEndRow.style.cssText = "display:flex; gap:4px; align-items:center; font-size:11px; color:#aaa; overflow:hidden;"
    const startLabelEl = document.createElement("span")
    const endLabelEl = document.createElement("span")
    const startNum = document.createElement("input")
    const endNum = document.createElement("input")
    for (const inp of [startNum, endNum]) {
      inp.type = "number"
      inp.step = String(CROP_STEP)
      inp.min = "0"
      inp.disabled = !hasFile
      inp.className = "daz-sm-num" // suppresses the spin buttons; see ensureNumberInputStyles
      // border-box so the declared width is the whole footprint — with the
      // Fade checkbox now sharing this row, content-box padding/border would
      // silently add 16px and push "Fade" out of the tile once the editor is
      // narrowed by max-width:95vw. font-size is set explicitly rather than
      // left at the browser's ~13px input default, which is what made an
      // x.yyy value overrun the field.
      inp.style.cssText = "width:52px; flex:none; box-sizing:border-box; font-size:11px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 3px;"
    }
    const fadeLbl = document.createElement("label")
    fadeLbl.style.cssText = "display:flex; align-items:center; gap:3px; margin-left:auto; cursor:pointer; white-space:nowrap;"
    const fadeChk = document.createElement("input")
    fadeChk.type = "checkbox"
    fadeChk.checked = !!src.fade_mode
    fadeChk.disabled = !hasFile
    fadeChk.style.cssText = "margin:0;"
    fadeLbl.appendChild(fadeChk)
    fadeLbl.append("Fade")
    startEndRow.appendChild(startLabelEl)
    startEndRow.appendChild(startNum)
    startEndRow.appendChild(endLabelEl)
    startEndRow.appendChild(endNum)
    startEndRow.appendChild(fadeLbl)
    el.appendChild(startEndRow)

    // Repaints everything derived from the crop/fade values: both handle
    // pairs, the two number boxes (whose meaning depends on the mode), and
    // the waveform's dim/gradient shading.
    function refresh() {
      const cs = cropStartNow(), ce = cropEndNow()
      const fi = fadeInNow(), fo = fadeOutNow()
      startHandleEl.style.left = dur > 0 ? `${(cs / dur) * 100}%` : "0%"
      endHandleEl.style.left = dur > 0 ? `${(ce / dur) * 100}%` : "100%"
      fadeInHandleEl.style.display = fi > 0 ? "block" : "none"
      fadeOutHandleEl.style.display = fo > 0 ? "block" : "none"
      if (dur > 0) {
        fadeInHandleEl.style.left = `${((cs + fi) / dur) * 100}%`
        fadeOutHandleEl.style.left = `${((ce - fo) / dur) * 100}%`
      }
      if (src.fade_mode) {
        startLabelEl.textContent = "In:"
        endLabelEl.textContent = "Out:"
        startNum.value = fi.toFixed(3)
        endNum.value = fo.toFixed(3)
      } else {
        startLabelEl.textContent = "Start:"
        endLabelEl.textContent = "End:"
        startNum.value = cs.toFixed(3)
        endNum.value = ce.toFixed(3)
      }
      if (hasFile) {
        drawWave(canvas, m?.peaks || null, color, {
          errored: m?.error, cropStart: cs, cropEnd: ce, fadeIn: fi, fadeOut: fo, dur,
        })
      } else {
        drawWave(canvas, new Float32Array(1), "#3a3a3a")
      }
    }

    // Fades live inside the cropped span and never overlap each other, so a
    // crop that shrinks past them has to pull them in with it.
    function clampFadesToCrop() {
      const span = Math.max(0, cropEndNow() - cropStartNow())
      const fi = Math.max(0, Math.min(fadeInNow(), span))
      src.fade_in_s = fi
      src.fade_out_s = Math.max(0, Math.min(fadeOutNow(), span - fi))
    }

    function applyCrop(newStart, newEnd) {
      newStart = Math.max(0, Math.min(newStart, newEnd))
      newEnd = Math.max(newStart, Math.min(newEnd, dur || newEnd))
      src.crop_start_s = newStart
      src.crop_end_s = newEnd
      clampFadesToCrop()
      refresh()
      persist()
      renderTimeline()
    }

    // `driving` says which of the two the user is actually moving: that one
    // gets clamped against the other and stops dead there, leaving the other
    // untouched — the same way a crop handle stops at its partner instead of
    // shoving it along (and losing whatever it was set to).
    function applyFade(newIn, newOut, driving) {
      const span = Math.max(0, cropEndNow() - cropStartNow())
      if (driving === "out") {
        newIn = Math.max(0, Math.min(newIn, span))
        newOut = Math.max(0, Math.min(newOut, span - newIn))
      } else {
        newOut = Math.max(0, Math.min(newOut, span))
        newIn = Math.max(0, Math.min(newIn, span - newOut))
      }
      src.fade_in_s = newIn
      src.fade_out_s = newOut
      refresh()
      persist()
    }

    startNum.addEventListener("change", () => {
      if (src.fade_mode) applyFade(Number(startNum.value) || 0, fadeOutNow(), "in")
      else applyCrop(Number(startNum.value) || 0, Number(endNum.value) || 0)
    })
    endNum.addEventListener("change", () => {
      if (src.fade_mode) applyFade(fadeInNow(), Number(endNum.value) || 0, "out")
      else applyCrop(Number(startNum.value) || 0, Number(endNum.value) || 0)
    })
    fadeChk.addEventListener("change", () => {
      src.fade_mode = fadeChk.checked
      refresh()
      persist()
    })

    // A single mousedown on the waveform picks whichever boundary is nearer,
    // snaps it to the click point, and keeps dragging it for the rest of this
    // same mouse-down — no need to release and click again. The Fade
    // checkbox decides whether that boundary pair is the crop (white) or the
    // fades (blue).
    waveWrap.addEventListener("mousedown", (ev) => {
      if (!hasFile || !m?.buffer || !dur) return
      const rect = waveWrap.getBoundingClientRect()
      const timeAt = (clientX) => Math.max(0, Math.min(dur, ((clientX - rect.left) / rect.width) * dur))
      const t0 = timeAt(ev.clientX)
      let setFromTime
      if (src.fade_mode) {
        const cs = cropStartNow(), ce = cropEndNow()
        const draggingIn = Math.abs(t0 - (cs + fadeInNow())) <= Math.abs(t0 - (ce - fadeOutNow()))
        setFromTime = (t) => (draggingIn
          ? applyFade(t - cs, fadeOutNow(), "in")
          : applyFade(fadeInNow(), ce - t, "out"))
      } else {
        const draggingStart = Math.abs(t0 - cropStartNow()) <= Math.abs(t0 - cropEndNow())
        setFromTime = (t) => (draggingStart
          ? applyCrop(t, cropEndNow())
          : applyCrop(cropStartNow(), t))
      }
      setFromTime(t0)
      function onMove(mv) {
        setFromTime(timeAt(mv.clientX))
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
      ev.preventDefault()
    })

    refresh()

    const btnRow = document.createElement("div")
    btnRow.style.cssText = "display:flex; gap:6px; margin-top:2px;"
    const playBtnId = `src:${id}`
    const playBtn = mkBtn("", {
      disabled: !hasFile || !m?.buffer,
      onClick: () => {
        if (playingId === playBtnId) { stopAll(); return }
        stopAll()
        const cs = cropStartNow()
        const durS = Math.max(0, cropEndNow() - cs)
        if (durS <= 0) return
        schedulePreview(m.buffer, cs, durS, 1, 0, { fadeIn: fadeInNow(), fadeOut: fadeOutNow() })
        if (dur > 0) animatePlayhead(playheadEl, (elapsed) => ((cs + elapsed) / dur) * 100, durS, "%")
        beginPlayback(playBtnId, durS)
      },
    })
    btnRow.appendChild(registerPlayButton(playBtnId, playBtn, PLAY_GLYPH, STOP_GLYPH))
    btnRow.appendChild(mkBtn("Upload", { onClick: () => uploadForSource(id) }))
    btnRow.appendChild(mkBtn("Delete", { danger: true, onClick: () => deleteSource(id) }))
    el.appendChild(btnRow)

    if (hasFile) ensureMeta(id, src.filename)

    return el
  }

  function renderSources() {
    sourcesGrid.innerHTML = ""
    sourcePlayheads.clear()
    const ids = Object.keys(state.sources)
    for (const id of ids) sourcesGrid.appendChild(buildSourceBox(id))
    if (ids.length < MAX_SOURCES) {
      const tile = buildAddTile()
      sourcesGrid.appendChild(tile)
      // Source boxes all share the same structure, so any rendered one is a
      // representative height to match — otherwise the add-tile's own
      // (much shorter) content would size it differently from the rest.
      if (ids.length > 0) {
        const h = sourcesGrid.children[0].getBoundingClientRect().height
        if (h > 0) tile.style.minHeight = `${h}px`
      }
    }
    renderVideoSourceList()
  }

  // -------------------------------------------------------------------
  // Movie panel — upload a video, scrub through its exact frames (per the
  // file's real fps, probed server-side via PyAV since browsers don't
  // reliably expose native container frame rate), and use the scrubbed
  // time as the start_s for a newly-added source block.
  // -------------------------------------------------------------------

  function closeVideoPanel() {
    if (!videoPanel) return
    clearTimeout(videoStopTimer)
    videoStopTimer = null
    try { videoState?.stopLoopPlayback?.() } catch { /* nothing to stop */ }
    try { videoState?.videoEl?.pause() } catch { /* nothing to pause */ }
    videoPanel.remove()
    videoPanel = null
    videoState = null
    discardMovieBtn.style.display = "none"
    fpsLabel.style.display = "none"
    box.style.width = `${EDITOR_BASE_WIDTH}px`
  }

  // Asked whenever the two lengths disagree in either direction: a mix that
  // stops before the movie ends and one that runs on past it are equally
  // worth offering to fix. The tolerance keeps float noise in the probe — or
  // a frame count that doesn't divide evenly — from prompting about a
  // difference nobody can hear.
  function maybeWarnDurationMismatch(movieDuration) {
    const mixDuration = currentDuration()
    if (Math.abs(movieDuration - mixDuration) <= 0.001) return
    const longer = movieDuration > mixDuration
    // An fps box can be retyped faster than a popup gets dismissed; never
    // leave the earlier one orphaned behind the new one.
    closeActivePopup?.()
    const { box: pbox, close } = overlayShell(340, () => { closeActivePopup = null })
    closeActivePopup = close
    const title = document.createElement("div")
    title.style.cssText = "padding:10px 14px; border-bottom:1px solid #3a3a3a; font-weight:600;"
    title.textContent = longer ? "Movie longer than mix" : "Movie shorter than mix"
    pbox.appendChild(title)
    const body = document.createElement("div")
    body.style.cssText = "padding:10px 14px;"
    body.textContent = `The video is ${longer ? "longer" : "shorter"} than the current mixed audio `
      + `duration (${movieDuration.toFixed(3)}s vs ${mixDuration.toFixed(3)}s)`
    pbox.appendChild(body)
    const foot = document.createElement("div")
    foot.style.cssText = "display:flex; justify-content:flex-end; gap:8px; padding:10px 14px; border-top:1px solid #3a3a3a;"
    foot.appendChild(mkBtn("Ignore", { onClick: close }))
    foot.appendChild(mkBtn("Match", { onClick: () => { setDuration(movieDuration); close() } }))
    pbox.appendChild(foot)
  }

  function renderVideoSourceList() {
    if (!videoState?.listEl) return
    const list = videoState.listEl
    list.innerHTML = ""
    const ids = Object.keys(state.sources).filter((id) => state.sources[id].filename)
    if (ids.length === 0) {
      const empty = document.createElement("div")
      empty.style.cssText = "color:#888;"
      empty.textContent = "No sounds uploaded yet."
      list.appendChild(empty)
      return
    }
    for (const id of ids) {
      const src = state.sources[id]
      const b = mkBtn(src.label || src.filename, {
        onClick: () => {
          const at = videoState?.addAtTime || 0
          if (at > currentDuration()) {
            showError(`That time (${at.toFixed(3)}s) is past the mixed audio duration (${currentDuration().toFixed(3)}s).`)
            return
          }
          addBlock(id, at)
        },
      })
      b.style.textAlign = "left"
      b.style.width = "100%"
      b.style.padding = "2px 10px"
      b.style.borderLeft = `4px solid ${colorFor(src)}`
      list.appendChild(b)
    }
  }

  function openVideoPanel(filename, info, customFps = 0) {
    closeVideoPanel()
    discardMovieBtn.style.display = ""
    fpsLabel.style.display = "flex"
    videoState = {
      filename,
      // Two rates, deliberately kept apart. sourceFps is the file's real
      // rate and governs everything touching videoEl — the file's own
      // timestamps don't move just because the user renamed its rate.
      // timelineFps is the rate the user says it runs at, and governs the
      // frame <-> mix-timeline-seconds mapping. Equal until an override.
      sourceFps: info.fps,
      timelineFps: customFps > 0 ? Math.max(1, Math.round(customFps)) : info.fps,
      duration: info.duration, // source-domain seconds
      frameCount: Math.max(1, info.frame_count | 0),
      addAtTime: 0,
      videoEl: null,
      listEl: null,
    }

    videoPanel = document.createElement("div")
    videoPanel.style.cssText = `
      flex:0 0 ${VIDEO_PANEL_WIDTH}px; width:${VIDEO_PANEL_WIDTH}px; border-left:1px solid #3a3a3a;
      display:flex; flex-direction:column; gap:8px; padding:10px 14px;
      box-sizing:border-box; overflow-y:auto; overflow-x:hidden;
    `

    const topRow = document.createElement("div")
    topRow.style.cssText = "display:flex; align-items:center; gap:8px; min-width:0;"
    const nameEl = document.createElement("div")
    nameEl.style.cssText = "font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1;"
    nameEl.title = filename
    nameEl.textContent = filename
    topRow.appendChild(nameEl)
    const playAudioLbl = document.createElement("label")
    playAudioLbl.style.cssText = "display:flex; align-items:center; gap:4px; color:#aaa; white-space:nowrap; flex-shrink:0;"
    const playAudioChk = document.createElement("input")
    playAudioChk.type = "checkbox"
    playAudioLbl.appendChild(playAudioChk)
    playAudioLbl.append("Play Audio")
    topRow.appendChild(playAudioLbl)
    videoPanel.appendChild(topRow)

    // Favors a 9:16 slot regardless of the source video's own aspect ratio;
    // object-fit:contain centers and letterboxes/pillarboxes non-9:16 frames.
    const displayWrap = document.createElement("div")
    displayWrap.style.cssText = `
      width:100%; aspect-ratio:9/16; background:#000; flex-shrink:0;
      display:flex; align-items:center; justify-content:center;
      border:1px solid #3a3a3a; border-radius:4px; overflow:hidden;
    `
    const videoEl = document.createElement("video")
    videoEl.src = `/view?filename=${encodeURIComponent(filename)}&type=input`
    videoEl.muted = true
    videoEl.preload = "auto"
    videoEl.style.cssText = "max-width:100%; max-height:100%; object-fit:contain;"
    displayWrap.appendChild(videoEl)
    videoPanel.appendChild(displayWrap)
    videoState.videoEl = videoEl
    // Unmuted only while checked, so Play Mix's video.play() lets the OS mix
    // the video's own soundtrack in alongside the constructed Web Audio mix.
    playAudioChk.addEventListener("change", () => { videoEl.muted = !playAudioChk.checked })

    const scrub = document.createElement("input")
    scrub.type = "range"
    scrub.min = "0"
    scrub.max = String(Math.max(0, videoState.frameCount - 1))
    scrub.step = "1"
    scrub.value = "0"
    scrub.style.cssText = "width:100%;"
    videoPanel.appendChild(scrub)

    // Appended later, merged into the same row as the source list's title.
    const atInput = document.createElement("input")
    atInput.type = "number"
    atInput.step = "0.0001"
    atInput.min = "0"
    atInput.style.cssText = "width:90px; background:#1a1a1a; color:#ddd; border:1px solid #444; border-radius:3px; padding:2px 4px;"

    // Where a frame actually sits inside the file. Always the file's own
    // rate — an FPS override doesn't move the file's timestamps, so seeking
    // by anything else would land on the wrong frame.
    function sourceTime(frameIdx) {
      return Math.min(videoState.duration, Math.max(0, frameIdx) / videoState.sourceFps)
    }
    // Where that same frame lands on the mix timeline, which is the whole
    // point of an override: at 30 fps frame 60 is 2 s in, at 24 fps it's 2.5.
    function timelineTime(frameIdx) {
      return Math.max(0, frameIdx) / videoState.timelineFps
    }
    function timelineDuration() {
      return videoState.frameCount / videoState.timelineFps
    }

    // Reinterpreting the same frames at another rate is exactly a uniform
    // time scale, which is all <video> can do — no frames are added or
    // dropped, they're just held for a different span. Browsers accept
    // roughly 0.0625x-16x, so every realistic conversion is well inside.
    // The rate the override asks for, and the rate the browser will actually
    // honour. They only differ at extremes, where the movie silently drifts
    // from the mix — hence the warning, kept separate below.
    function wantedRate() {
      const want = videoState.timelineFps / videoState.sourceFps
      return Number.isFinite(want) && want > 0 ? want : 1
    }
    function usableRate() {
      return Math.min(16, Math.max(0.0625, wantedRate()))
    }
    function applyPlayRate() {
      const rate = usableRate()
      try {
        // Loading media resets playbackRate to defaultPlaybackRate, and this
        // runs while the element is still loading — set both so the rate
        // survives that rather than snapping back to 1x.
        videoEl.defaultPlaybackRate = rate
        videoEl.playbackRate = rate
      } catch { /* not supported by this UA; it plays at 1x */ }
    }
    videoState.applyPlayRate = applyPlayRate

    // Deliberately not part of applyPlayRate, which also runs on every play
    // click: the warning belongs to the moment a rate is chosen, not to each
    // replay of one already chosen.
    function warnIfRateUnreachable() {
      const want = wantedRate()
      const rate = usableRate()
      if (Math.abs(rate - want) <= 1e-6) return
      showError(
        `${fmtFps(videoState.timelineFps)} fps needs ${want.toFixed(3)}x playback, ` +
        `past what browsers allow — the movie will run at ${rate.toFixed(3)}x and drift from the mix.`
      )
    }

    // A seek decodes forward from the nearest keyframe to reach the exact
    // frame, which isn't instant — dragging the scrubber fires many `input`
    // events faster than the decoder can keep up, and assigning currentTime
    // on every one of them queues up seeks that arrive stale, which reads as
    // stutter. Only one seek is ever in flight; a seek requested while one is
    // already pending just overwrites what to seek to next, so the video
    // always ends up settled on the most recent frame the user asked for
    // without decoding every frame in between.
    let seekPending = false
    let pendingFrame = null
    let seekWatchdog = null
    // Lets external code (Play Mix) drop a stale queued scrub target before
    // repositioning the video itself, so a drag the user made just before
    // hitting Play doesn't yank playback back to the scrubber position once
    // that queued seek is finally serviced.
    videoState.cancelPendingScrub = () => { pendingFrame = null }
    function onSeekSettled() {
      if (seekWatchdog) {
        clearTimeout(seekWatchdog)
        seekWatchdog = null
      }
      seekPending = false
      if (pendingFrame !== null) {
        const next = pendingFrame
        pendingFrame = null
        runSeek(next)
      }
    }
    function runSeek(frameIdx) {
      seekPending = true
      videoEl.currentTime = sourceTime(frameIdx)
      // Some browsers don't fire `seeked` for a seek issued before metadata
      // is loaded, or for a seek to the time the video is already sitting
      // at (nothing to decode, so no event) — either would wedge
      // seekPending permanently and freeze the scrubber. This bounds the
      // wait so a stuck flag always self-clears.
      seekWatchdog = setTimeout(onSeekSettled, 300)
    }
    videoEl.addEventListener("seeked", onSeekSettled)
    function requestSeek(frameIdx) {
      if (seekPending) pendingFrame = frameIdx
      else runSeek(frameIdx)
    }

    // The numeric readout tracks the scrubber instantly regardless of how
    // far behind the decoded frame is lagging.
    function updateReadout(frameIdx) {
      // Timeline domain: this feeds "Add a sound at", which is a mix time.
      const t = timelineTime(frameIdx)
      videoState.addAtTime = t
      atInput.value = t.toFixed(4)
      return t
    }
    function setFromFrame(frameIdx) {
      updateReadout(frameIdx)
      requestSeek(frameIdx)
    }
    // currentTime assignments before metadata loads are silently dropped by
    // some browsers, so re-apply the current frame once it's actually ready.
    videoEl.addEventListener("loadedmetadata", () => requestSeek(Number(scrub.value)), { once: true })

    scrub.addEventListener("input", () => setFromFrame(Number(scrub.value)))

    atInput.addEventListener("change", () => {
      let t = Number(atInput.value)
      if (!Number.isFinite(t) || t < 0) t = 0
      // Compared against the movie's length *at the current rate*, not the
      // file's own length, since that is the number the box shows.
      const maxT = timelineDuration()
      if (t > maxT) {
        showError(`Time exceeds movie duration (${maxT.toFixed(3)}s).`)
        t = maxT
      }
      const frameIdx = Math.min(videoState.frameCount - 1, Math.max(0, Math.round(t * videoState.timelineFps)))
      scrub.value = String(frameIdx)
      setFromFrame(frameIdx)
    })

    // Anything <= 0 (Esc) means "back to the file's own rate". The rate is
    // always an integer otherwise; only the file's original may be
    // fractional, and that one is never typed, only restored.
    videoState.setTimelineFps = (fps) => {
      const prev = videoState.timelineFps
      const next = fps > 0 && Number.isFinite(fps)
        ? Math.max(1, Math.round(fps))
        : videoState.sourceFps
      videoState.timelineFps = next
      syncFpsInput()
      // Retyping the rate it already has (or anything that rounds to it) is
      // not a change — stop before rescaling by 1 and re-asking about a
      // duration that hasn't moved. The box is re-synced first so a typed
      // "30.4" still snaps to the canonical text.
      if (next === prev) return

      // Anything sounding right now was scheduled against the old rate and
      // the old block positions, both of which are about to move under it.
      stopAll()
      state.movie_fps = next === videoState.sourceFps ? 0 : next
      rescaleBlocks(prev / next)
      persist()
      applyPlayRate()
      warnIfRateUnreachable()
      // The scrubber is still on the same frame, but the timeline second
      // that frame corresponds to just changed.
      updateReadout(Number(scrub.value))
      renderTimeline()
      // The movie is now a different number of seconds long — offer to match,
      // the same way uploading one does.
      maybeWarnDurationMismatch(timelineDuration())
    }

    syncFpsInput()
    applyPlayRate()
    warnIfRateUnreachable() // a restored override can be out of range too
    setFromFrame(0)

    // Click the video frame to loop-play, starting from the slider's current
    // position for the first pass only; once it reaches the end it loops
    // from the very beginning of the video (ignoring the slider) from then
    // on. Click again to stop. Honors the "Play Audio" checkbox live.
    displayWrap.style.cursor = "pointer"
    displayWrap.title = "Click to play/stop"
    let loopPlaying = false
    function onLoopTimeUpdate() {
      // currentTime is a source-domain time whatever the playback rate is.
      const frameIdx = Math.min(videoState.frameCount - 1, Math.round(videoEl.currentTime * videoState.sourceFps))
      scrub.value = String(frameIdx)
      updateReadout(frameIdx)
    }
    function onLoopEnded() {
      videoEl.currentTime = 0
      videoEl.play().catch(() => { /* autoplay may be blocked */ })
    }
    function stopLoopPlayback() {
      if (!loopPlaying) return
      loopPlaying = false
      videoEl.removeEventListener("timeupdate", onLoopTimeUpdate)
      videoEl.removeEventListener("ended", onLoopEnded)
      try { videoEl.pause() } catch { /* already stopped */ }
    }
    function startLoopPlayback() {
      videoState.cancelPendingScrub?.()
      videoEl.muted = !playAudioChk.checked
      applyPlayRate()
      loopPlaying = true
      videoEl.addEventListener("timeupdate", onLoopTimeUpdate)
      videoEl.addEventListener("ended", onLoopEnded)
      const p = videoEl.play()
      if (p?.catch) p.catch(() => { loopPlaying = false })
    }
    displayWrap.addEventListener("click", () => {
      if (loopPlaying) stopLoopPlayback()
      else startLoopPlayback()
    })
    videoState.stopLoopPlayback = stopLoopPlayback

    const listTitle = document.createElement("div")
    listTitle.style.cssText = "display:flex; align-items:center; gap:6px; color:#aaa; margin-top:4px; white-space:nowrap;"
    listTitle.append("Add a sound at:")
    listTitle.appendChild(atInput)
    videoPanel.appendChild(listTitle)

    const list = document.createElement("div")
    list.style.cssText = "display:flex; flex-direction:column; gap:4px; max-height:220px; overflow-y:auto; overflow-x:hidden; flex-shrink:0; padding-right:4px;"
    videoPanel.appendChild(list)
    videoState.listEl = list
    renderVideoSourceList()

    bodyRow.appendChild(videoPanel)
    box.style.width = `${EDITOR_BASE_WIDTH + VIDEO_PANEL_WIDTH}px`
  }

  // -------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------

  function pxPerSec() {
    const dur = currentDuration()
    const availW = Math.max(200, tracksEl.clientWidth - 4)
    return availW / dur
  }

  function addBlock(sourceId, startS = 0) {
    const row = nextEmptyRow(state)
    if (row < 0) {
      showError("Timeline is full (30 max).")
      return false
    }
    state.blocks.push({ id: newId("b"), source: sourceId, row, start_s: Math.max(0, startS || 0), gain: 1.0 })
    selectedBlockId = state.blocks[state.blocks.length - 1].id
    persist()
    renderTimeline()
    return true
  }

  // Blocks are placed against what is happening on screen, so they are really
  // pinned to video frames rather than to seconds. Re-rating the movie doesn't
  // move a block off its frame — it moves the second that frame happens at, so
  // a sound on frame 32 of a 32 fps movie sits at 1s and lands at 2s once the
  // movie is called 16 fps.
  //
  // Deliberately not clamped to the mix duration: an unclamped multiply is
  // exactly invertible, so Esc (or typing the old rate back) returns every
  // block to where it was. Clamping would collapse anything past the end onto
  // it, and no later fps change could undo that.
  function rescaleBlocks(factor) {
    if (!(factor > 0) || Math.abs(factor - 1) < 1e-9) return
    for (const blk of state.blocks) blk.start_s = Math.max(0, (blk.start_s || 0) * factor)
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
    // Same reason as deleteSource: the stop button for this block is about to
    // be rebuilt away, and anything it started would keep sounding unstoppably.
    if (playingId === `block:${id}`) stopAll()
    state.blocks = state.blocks.filter((b) => b.id !== id)
    if (selectedBlockId === id) selectedBlockId = null
    persist()
    renderTimeline()
  }

  function deleteAllBlocks() {
    if (playingId?.startsWith("block:")) stopAll()
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
    const ppS = pxPerSec()
    rulerEl.innerHTML = ""
    const { majors, minors } = computeTicks(dur, ppS)
    for (const s of majors) {
      const x = s * ppS
      const label = document.createElement("div")
      label.style.cssText = `position:absolute; left:${x}px; top:0; transform:translateX(${s === 0 ? "0" : "-50%"}); white-space:nowrap;`
      label.textContent = `${s}s`
      rulerEl.appendChild(label)
      const bar = document.createElement("div")
      bar.style.cssText = `position:absolute; left:${x}px; bottom:0; width:1px; height:8px; background:#777;`
      rulerEl.appendChild(bar)
    }
    for (const s of minors) {
      const dot = document.createElement("div")
      dot.style.cssText = `position:absolute; left:${s * ppS}px; bottom:2px; width:2px; height:2px; border-radius:50%; background:#555;`
      rulerEl.appendChild(dot)
    }
  }

  function renderTimeline() {
    renderRuler()
    tracksEl.innerHTML = ""
    blockEls.clear()
    const rows = visibleRowCount(state)
    const rowH = tracksEl.clientHeight > 0 ? tracksEl.clientHeight / rows : 320 / rows
    const ppS = pxPerSec()
    const dur = currentDuration()
    const byRow = new Map(state.blocks.map((b) => [b.row, b]))

    const { majors, minors } = computeTicks(dur, ppS)
    for (const s of minors) {
      const line = document.createElement("div")
      line.style.cssText = `position:absolute; left:${s * ppS}px; top:0; bottom:0; width:0; border-left:1px dotted #2a2a2a;`
      tracksEl.appendChild(line)
    }
    for (const s of majors) {
      const line = document.createElement("div")
      line.style.cssText = `position:absolute; left:${s * ppS}px; top:0; bottom:0; width:0; border-left:1px dotted #444;`
      tracksEl.appendChild(line)
    }

    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div")
      rowEl.style.cssText = `position:absolute; left:0; right:0; top:${r * rowH}px; height:${rowH}px; border-bottom:1px dotted #2a2a2a; box-sizing:border-box;`
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
        font-size:10px; color:#111; padding:2px 4px; white-space:normal; overflow-wrap:break-word; line-height:1.2;
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

    timelinePlayhead = document.createElement("div")
    timelinePlayhead.style.cssText = `
      position:absolute; top:0; bottom:0; width:1px; background:#3ecf3e; display:none;
      pointer-events:none; box-shadow:0 0 2px #3ecf3e; z-index:6;
    `
    tracksEl.appendChild(timelinePlayhead)

    renderButtonRow()
  }

  // -------------------------------------------------------------------
  // Button row
  // -------------------------------------------------------------------

  function renderButtonRow() {
    buttonRow.innerHTML = ""
    const mixBtn = mkBtn("", {
      onClick: () => {
        if (playingId === "mix") { stopAll(); return }
        stopAll()
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
          schedulePreview(m.buffer, cropStart, playDur, (blk.gain ?? 1) * (state.overall_gain ?? 1), startAt, {
            fadeIn: src.fade_in_s || 0, fadeOut: src.fade_out_s || 0, envDur: cropDur,
          })
        }
        animatePlayhead(timelinePlayhead, (elapsed) => elapsed * pxPerSec(), dur, "px")
        if (videoState?.videoEl) {
          const v = videoState.videoEl
          videoState.cancelPendingScrub?.()
          v.currentTime = 0
          // An FPS override makes the movie cover its frames faster or
          // slower; the stop timer below is wall-clock, so it still lands on
          // the mix duration either way.
          videoState.applyPlayRate?.()
          const p = v.play()
          if (p?.catch) p.catch(() => { /* autoplay may be blocked; audio still plays */ })
          videoStopTimer = setTimeout(() => { try { v.pause() } catch { /* already stopped */ } }, dur * 1000)
        }
        beginPlayback("mix", dur)
      },
    })
    buttonRow.appendChild(registerPlayButton("mix", mixBtn, `${PLAY_GLYPH} Play Mix`, `${STOP_GLYPH} Stop Mix`))
    buttonRow.appendChild(mkBtn("Add", { onClick: openAddPopup }))
    buttonRow.appendChild(mkBtn("Add All", { onClick: addAllSources }))
    buttonRow.appendChild(sep())

    const selBlock = state.blocks.find((b) => b.id === selectedBlockId)
    if (selBlock) {
      const src = state.sources[selBlock.source]
      const m = meta[selBlock.source]
      // Keyed by block id, not a bare "block": selecting a different block
      // while one is playing rebuilds this row, and a shared key would show
      // the new block's button as already-playing.
      const blockBtnId = `block:${selBlock.id}`
      const blockBtn = mkBtn("", {
        disabled: !m?.buffer,
        onClick: () => {
          if (playingId === blockBtnId) { stopAll(); return }
          stopAll()
          const cs = src?.crop_start_s || 0
          const ce = src?.crop_end_s > 0 ? src.crop_end_s : (m?.duration || 0)
          const durS = Math.max(0, ce - cs)
          if (durS <= 0) return
          schedulePreview(m.buffer, cs, durS, (selBlock.gain ?? 1) * (state.overall_gain ?? 1), 0, {
            fadeIn: src?.fade_in_s || 0, fadeOut: src?.fade_out_s || 0,
          })
          const ph = sourcePlayheads.get(selBlock.source)
          if (ph && m?.duration > 0) animatePlayhead(ph, (elapsed) => ((cs + elapsed) / m.duration) * 100, durS, "%")
          beginPlayback(blockBtnId, durS)
        },
      })
      buttonRow.appendChild(registerPlayButton(blockBtnId, blockBtn, PLAY_GLYPH, STOP_GLYPH))

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

    buttonRow.appendChild(mkBtn("Ok", { onClick: closeOverlay }))
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

  // Reopening the editor rebuilds the movie panel from the remembered
  // filename. Deliberately no duration-mismatch prompt here — that belongs
  // to the moment a movie is chosen, not to every reopen.
  async function restoreMovie() {
    const filename = state.movie_filename
    if (!filename) return
    try {
      const info = await probeMovie(filename)
      // The editor can be dismissed while the probe is still in flight.
      // Building the panel now would attach a preload="auto" <video> to a
      // detached tree, downloading the whole movie with nothing left to
      // pause it — closeVideoPanel and stopAll have already run.
      if (editorClosed) return
      // The blocks on the timeline were placed against the overridden rate,
      // so it comes back with the movie.
      openVideoPanel(filename, info, state.movie_fps)
    } catch (e) {
      // Nothing to tell the user once the editor is gone; leave the filename
      // in place so the next open re-probes and reports the failure properly.
      if (editorClosed) return
      // The upload lives in ComfyUI's input directory and can be cleared out
      // from under a saved workflow, so a failure here just forgets it
      // rather than leaving a movie that can never load.
      state.movie_filename = ""
      state.movie_fps = 0
      persist()
      showError(`Could not reload movie '${filename}': ${e.message || e}`)
    }
  }

  persist() // write back any row de-duplication normalizeBlocks() applied on load
  renderSources()
  renderTimeline()
  restoreMovie()
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
