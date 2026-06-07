// Shared floating Prompt Editor panel for WorkflowConfig nodes.
// Exposes window.DazPromptEditor.open({ detail, onSave })
// onSave receives: { master_prompt, positive_prompt, negative_prompt, total_frames, fps }
//   where positive_prompt is { text, type } and the rest are typed objects.

;(function () {
  'use strict'

  let _overlay = null

  // ── Constants ─────────────────────────────────────────────────────────────

  const TA_STYLE =
    'box-sizing:border-box;width:100%;background:#000;color:#ddd;' +
    'border:1px solid #444;border-radius:4px;font-family:monospace;' +
    'font-size:11px;padding:4px 6px;resize:vertical'

  const NUM_STYLE =
    'width:56px;background:#000;color:#ddd;border:1px solid #555;' +
    'border-radius:3px;padding:2px 4px;font-family:monospace;font-size:11px'

  const SEG_PALETTE = [
    '#1e5c8a','#1e7a3a','#7a5210','#6a1e6a',
    '#5c1e1e','#1e5c5c','#6a6a1e','#4a2a1e',
  ]

  // ── HTML helpers ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function mkBtn(id, label, border, bg, color) {
    return `<button id="${id}"
      style="font-family:monospace;font-size:11px;padding:2px 8px;border-radius:3px;
             cursor:pointer;border:1px solid ${border};background:${bg};color:${color}"
      >${label}</button>`
  }

  function mkRadio(id, name, value, label, checked) {
    return `<label style="display:flex;align-items:center;gap:3px;cursor:pointer;color:#ccc;font-size:11px">
      <input type="radio" id="${id}" name="${name}" value="${value}"${checked ? ' checked' : ''}
        style="cursor:pointer;accent-color:#54af7b;margin:0">
      ${label}
    </label>`
  }

  function el(tag, css) {
    const e = document.createElement(tag)
    if (css) e.style.cssText = css
    return e
  }

  function greenDiv() {
    return el('div', 'border-top:1px solid #54af7b;margin:0 10px')
  }

  function sectionLabel(text) {
    return `<span style="color:#888;font-size:10px;letter-spacing:1px">${text}</span>`
  }

  // ── Segment parsing ───────────────────────────────────────────────────────

  const VALID_PROMPT_TYPES = new Set(['smart', 'beats', 'simple'])

  // Infer the serialised format of prompt text from its content.
  // Returns 'beats', 'smart', or null (= cannot determine, use declared type).
  function detectPromptFormat(text) {
    const lines = text.split('\n').filter(l => l.trim())
    // Beats: every non-empty line starts with a numeric range [X-Y] or [Xs-Ys]
    if (lines.length >= 2 && lines.every(l => /^\[(\d+)s?\s*[-–]\s*(\d+)s?\]/.test(l))) {
      return 'beats'
    }
    // Smart: multiple pipe-separated parts where at least one ends with [X-Y]
    const parts = text.split(/\s*\|\s*/).filter(p => p.trim())
    if (parts.length > 1 && parts.some(p => /\[(\d+)\s*[-–]\s*(\d+)\]\s*$/.test(p.trim()))) {
      return 'smart'
    }
    return null
  }

  function parseSegments(text, type, totalFrames, fps = 0) {
    if (!VALID_PROMPT_TYPES.has(type)) type = 'smart'
    text = (text || '').trim()
    if (!text) return [{ text: '', frames: Math.max(1, totalFrames) }]

    // If the text's actual format differs from the declared type, infer from
    // content so segment structure survives a type switch in the edit panel.
    // 'simple' is never overridden — it has no detectable markers.
    const detected  = type !== 'simple' ? detectPromptFormat(text) : null
    const parseType = detected ?? type

    if (parseType === 'smart') {
      const parts = text.split(/\s*\|\s*/)
      return parts.map(part => {
        const m = part.match(/^([\s\S]*?)\s*\[(\d+)\s*[-–]\s*(\d+)\]\s*$/)
        if (m) return { text: m[1].trim(), frames: Math.max(1, parseInt(m[3]) - parseInt(m[2])) }
        return { text: part.trim(), frames: Math.max(1, Math.floor(totalFrames / parts.length)) }
      })
    }

    if (parseType === 'beats') {
      const lines = text.split('\n').filter(l => l.trim())
      if (!lines.length) return [{ text: '', frames: totalFrames }]
      return lines.map(line => {
        // New format: [x-ys] text (seconds) — only end value carries the 's'
        const ms = line.match(/^\[(\d+)\s*[-–]\s*(\d+)s\]\s*([\s\S]*)$/)
        if (ms) {
          const frames = fps > 0
            ? Math.max(1, Math.round((parseInt(ms[2]) - parseInt(ms[1])) * fps))
            : Math.max(1, Math.floor(totalFrames / lines.length))
          return { text: ms[3].trim(), frames }
        }
        // Old format: [x-y] text (frames) — backward compat
        const mf = line.match(/^\[(\d+)\s*[-–]\s*(\d+)\]\s*([\s\S]*)$/)
        if (mf) return { text: mf[3].trim(), frames: Math.max(1, parseInt(mf[2]) - parseInt(mf[1])) }
        return { text: line.trim(), frames: Math.max(1, Math.floor(totalFrames / lines.length)) }
      })
    }

    // simple: one flat segment — no structural parsing
    return [{ text, frames: Math.max(1, totalFrames) }]
  }

  // ── Segment writing ───────────────────────────────────────────────────────

  function writeSegments(segments, type, fps = 0) {
    if (!segments.length) return ''
    if (type === 'smart') {
      let pos = 0
      return segments.map(s => {
        const end  = pos + s.frames
        const part = `${s.text} [${pos}-${end}]`
        pos = end
        return part
      }).join(' | ')
    }
    if (type === 'beats') {
      // half-down rounding: x.5 rounds to x (floor at midpoint)
      const halfDown = secs => Math.ceil(secs - 0.5)
      if (fps > 0) {
        let accFrames = 0
        let prevSec   = 0
        return segments.map(s => {
          accFrames  += s.frames
          const thisSec = halfDown(accFrames / fps)
          const line = `[${prevSec}-${thisSec}s] ${s.text}`
          prevSec = thisSec
          return line
        }).join('\n')
      }
      // fallback when fps unknown: use frame numbers
      let pos = 0
      return segments.map(s => {
        const end  = pos + s.frames
        const line = `[${pos}-${end}] ${s.text}`
        pos = end
        return line
      }).join('\n')
    }
    // simple
    return segments.map(s => s.text).join('\n')
  }

  // ── Main open ─────────────────────────────────────────────────────────────

  function open({ detail, onSave }) {
    if (_overlay) _overlay.remove()

    const fText  = v => (v && typeof v === 'object') ? (v.text  ?? '') : (v ?? '')
    const fValue = v => (v && typeof v === 'object') ? (v.value ?? 0)  : (v ?? 0)

    let totalFrames = Math.max(1, fValue(detail.total_frames))
    let fps         = fValue(detail.fps)
    let masterText  = fText(detail.master_prompt)
    let negText     = fText(detail.negative_prompt)
    let promptType  = (detail.positive_prompt && typeof detail.positive_prompt === 'object')
                        ? (detail.positive_prompt.type || 'smart') : 'smart'
    if (!VALID_PROMPT_TYPES.has(promptType)) promptType = 'smart'
    let segments    = parseSegments(fText(detail.positive_prompt), promptType, totalFrames, fps)
    let selIdx      = 0

    // ── Overlay / panel ───────────────────────────────────────────────────

    _overlay = el('div',
      'position:fixed;top:0;left:0;right:0;bottom:0;' +
      'background:rgba(0,0,0,0.75);z-index:10000;' +
      'display:flex;align-items:center;justify-content:center')

    const panel = el('div',
      'background:#1a1a1a;border:1px solid #444;border-radius:6px;' +
      'width:640px;max-height:90vh;overflow-y:auto;overflow-x:hidden;' +
      'font-family:monospace;font-size:12px;color:#ddd;' +
      'display:flex;flex-direction:column')

    _overlay.appendChild(panel)
    document.body.appendChild(_overlay)
    panel.addEventListener('click', e => e.stopPropagation())

    // ── State helpers ─────────────────────────────────────────────────────

    function clampSel() {
      if (selIdx >= segments.length) selIdx = Math.max(0, segments.length - 1)
    }

    function saveDomState() {
      const segTA    = panel.querySelector('#pe-seg-text')
      if (segTA    && segments[selIdx])  segments[selIdx].text = segTA.value
      const masterTA = panel.querySelector('#pe-master')
      if (masterTA) masterText = masterTA.value
      const negTA    = panel.querySelector('#pe-neg')
      if (negTA)    negText    = negTA.value
    }

    function equalize() {
      const n    = segments.length
      if (!n) return
      const base = Math.max(1, Math.floor(totalFrames / n))
      segments.forEach((s, i) => {
        s.frames = i === n - 1 ? Math.max(1, totalFrames - base * (n - 1)) : base
      })
    }

    function frameLabel(f) {
      if (!fps || fps <= 0) return `${f}`
      const secStr = (f / fps).toFixed(1).replace(/\.0$/, '')
      return `${f}(${secStr}s)`
    }

    function changeTotalFrames(nv) {
      const old = totalFrames
      totalFrames = nv
      if (nv >= old) { render(); return }
      // Proportional scale-down
      const ratio = nv / old
      segments = segments.map(s => ({ ...s, frames: Math.max(1, Math.round(s.frames * ratio)) }))
      let sum  = segments.reduce((a, s) => a + s.frames, 0)
      let safety = 200
      while (sum > nv && safety-- > 0) {
        const mi = segments.reduce((bi, s, i) => s.frames > segments[bi].frames ? i : bi, 0)
        if (segments[mi].frames <= 1) break
        segments[mi].frames--
        sum--
      }
      // All segments hit minimum 1 but still exceed totalFrames (more segments than frames).
      // Trim trailing segments and re-equalize so sum == totalFrames.
      if (sum > nv) {
        segments = segments.slice(0, Math.max(1, nv))
        equalize()
      }
      render()
    }

    // ── Segment bar ───────────────────────────────────────────────────────

    function makeSegBar() {
      const wrap    = el('div', 'padding:2px 10px 2px')
      wrap.id       = 'pe-bar'
      const row     = el('div', 'display:flex;height:22px')
      const used    = segments.reduce((a, s) => a + s.frames, 0)
      const unalloc = totalFrames - used

      segments.forEach((seg, i) => {
        const d = document.createElement('div')
        d.style.cssText = [
          `flex:${seg.frames} 0 0`,
          `background:${i === selIdx ? '#3a9a5a' : SEG_PALETTE[i % SEG_PALETTE.length]}`,
          `border:1px solid ${i === selIdx ? '#6adf9a' : 'transparent'}`,
          'cursor:pointer;box-sizing:border-box;min-width:4px',
          'overflow:hidden;display:flex;align-items:center;justify-content:center',
        ].join(';')
        d.title = `Segment ${i + 1}: ${seg.frames} frames`
        const lbl = document.createElement('span')
        lbl.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.7);white-space:nowrap;pointer-events:none;font-family:monospace'
        lbl.textContent = frameLabel(seg.frames)
        d.appendChild(lbl)
        d.addEventListener('click', () => { selIdx = i; render() })
        row.appendChild(d)
      })

      if (unalloc > 0) {
        const d = document.createElement('div')
        d.style.cssText =
          `flex:${unalloc} 0 0;background:#252525;border:1px solid #333;box-sizing:border-box;min-width:4px`
        d.title = `Unallocated: ${unalloc} frames`
        row.appendChild(d)
      }

      wrap.appendChild(row)

      if (unalloc < 0) {
        const warn = el('div', 'color:#f88;font-size:9px;font-family:monospace;padding:2px 0 0;text-align:right')
        warn.textContent = `segments exceed total by ${-unalloc} frames — equalize to fix`
        wrap.appendChild(warn)
      }

      return wrap
    }

    function refreshBar() {
      const old = panel.querySelector('#pe-bar')
      if (old) old.replaceWith(makeSegBar())
    }

    function confirmPopup(message, callback) {
      const ov  = el('div',
        'position:fixed;top:0;left:0;right:0;bottom:0;' +
        'background:rgba(0,0,0,0.6);z-index:10001;' +
        'display:flex;align-items:center;justify-content:center')
      const box = el('div',
        'background:#252525;border:1px solid #555;border-radius:6px;' +
        'padding:20px 24px;font-family:monospace;font-size:12px;color:#ddd;' +
        'display:flex;flex-direction:column;gap:16px;max-width:300px;text-align:center')
      const msgDiv = el('div', null)
      msgDiv.textContent = message
      const btnRow = el('div', 'display:flex;gap:10px;justify-content:center')
      btnRow.innerHTML =
        mkBtn('pe-popup-yes', 'Yes', '#2a8050', '#1a5c35', '#cde') +
        mkBtn('pe-popup-no',  'No',  '#555',    '#333',    '#ccc')
      box.appendChild(msgDiv)
      box.appendChild(btnRow)
      ov.appendChild(box)
      document.body.appendChild(ov)
      box.addEventListener('click', e => e.stopPropagation())
      btnRow.querySelector('#pe-popup-yes').addEventListener('click', () => { ov.remove(); callback(true)  })
      btnRow.querySelector('#pe-popup-no' ).addEventListener('click', () => { ov.remove(); callback(false) })
    }

    // ── Full render ───────────────────────────────────────────────────────

    function render() {
      clampSel()
      panel.innerHTML = ''

      // ── Top row: Frames / FPS / Master label ────────────────────────────
      const topRow = el('div',
        'display:flex;align-items:center;gap:8px;padding:8px 10px 4px;border-bottom:1px solid #2a2a2a')
      topRow.innerHTML = `
        <label style="color:#999;font-size:11px">Frames:</label>
        <input id="pe-tf"  type="number" min="1"        value="${esc(totalFrames)}" style="${NUM_STYLE}">
        <label style="color:#999;font-size:11px">FPS:</label>
        <input id="pe-fps" type="number" step="0.01" min="0" value="${esc(fps)}" style="${NUM_STYLE}">
        <span style="flex:1"></span>
        ${sectionLabel('MASTER')}
      `
      panel.appendChild(topRow)

      topRow.querySelector('#pe-tf').addEventListener('change', e => {
        const nv = Math.max(1, parseInt(e.target.value) || 1)
        e.target.value = nv
        changeTotalFrames(nv)
      })
      topRow.querySelector('#pe-fps').addEventListener('change', e => {
        fps = parseFloat(e.target.value) || 0
        render()
      })

      // ── Master ──────────────────────────────────────────────────────────
      const masterSec = el('div', 'padding:6px 10px')
      masterSec.innerHTML = `
        <textarea id="pe-master" style="${TA_STYLE};min-height:106px">${esc(masterText)}</textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:3px">
          ${mkBtn('pe-master-clear','clear','#555','#333','#999')}
        </div>
      `
      panel.appendChild(masterSec)
      masterSec.querySelector('#pe-master').addEventListener('input', e => { masterText = e.target.value })
      masterSec.querySelector('#pe-master-clear').addEventListener('click', () => {
        masterText = ''
        masterSec.querySelector('#pe-master').value = ''
      })

      panel.appendChild(greenDiv())

      // ── Prompt mode radios ──────────────────────────────────────────────
      const TYPE_HINTS = {
        smart:  'Warning! Prompt Relays work better with CFG 1.0',
        beats:  'Beats will coerce frame count into full seconds',
        simple: 'Simple prompt will remove all segments',
      }
      const promptHdr = el('div', 'display:flex;align-items:center;gap:10px;padding:6px 10px 4px')
      promptHdr.innerHTML = `
        ${mkRadio('pe-smart',  'pe-type', 'smart',  'Smart',  promptType === 'smart')}
        ${mkRadio('pe-beats',  'pe-type', 'beats',  'Beats',  promptType === 'beats')}
        ${mkRadio('pe-simple', 'pe-type', 'simple', 'Simple', promptType === 'simple')}
        <span id="pe-type-hint" style="flex:1;text-align:center;font-size:10px;font-family:monospace;color:#c8922a">${esc(TYPE_HINTS[promptType] ?? '')}</span>
        ${sectionLabel('PROMPT')}
      `
      panel.appendChild(promptHdr)
      promptHdr.querySelectorAll('input[name="pe-type"]').forEach(r => {
        r.addEventListener('change', e => {
          if (!e.target.checked) return
          saveDomState()
          const oldType = promptType
          const newType = e.target.value

          const doChange = () => {
            promptType = newType
            if (oldType === 'beats' && promptType !== 'beats') {
              segments = segments.map(s => ({
                ...s,
                text: s.text.replace(/^\[\d+s?\s*[-–]\s*\d+s?\]\s*/, '').trim(),
              }))
            }
            if (promptType === 'simple') {
              const merged = segments.map(s => s.text).filter(t => t.trim()).join('\n')
              segments = [{ text: merged, frames: totalFrames }]
            }
            render()
          }

          if (newType === 'simple' && oldType !== 'simple') {
            confirmPopup(
              'This will delete all segments. A simple prompt has no segments. Continue?',
              yes => {
                if (!yes) {
                  promptHdr.querySelector(`input[value="${oldType}"]`).checked = true
                  return
                }
                doChange()
              }
            )
            return
          }

          doChange()
        })
      })

      // ── Segment text area ───────────────────────────────────────────────
      const posSec = el('div', 'padding:0 10px 4px')
      posSec.innerHTML = `
        <textarea id="pe-seg-text" style="${TA_STYLE};min-height:106px">${esc(segments[selIdx]?.text ?? '')}</textarea>
      `
      panel.appendChild(posSec)
      posSec.querySelector('#pe-seg-text').addEventListener('input', e => {
        if (segments[selIdx]) segments[selIdx].text = e.target.value
      })

      // ── Ruler ───────────────────────────────────────────────────────────
      const q       = Math.round(totalFrames / 4)
      const ruler   = el('div',
        'display:flex;justify-content:space-between;padding:1px 10px 0;font-size:9px;color:#555')
      ruler.innerHTML = `<span>0</span><span>${frameLabel(q)}</span><span>${frameLabel(q*2)}</span><span>${frameLabel(q*3)}</span><span>${frameLabel(totalFrames)}</span>`
      panel.appendChild(ruler)

      // ── Segment bar ─────────────────────────────────────────────────────
      panel.appendChild(makeSegBar())

      // ── Segment controls ─────────────────────────────────────────────────
      const selSeg  = segments[selIdx]
      const segCtrl = el('div', 'display:flex;align-items:center;gap:6px;padding:4px 10px 8px')
      segCtrl.innerHTML = `
        <label style="color:#999;font-size:11px">Frames:</label>
        <input id="pe-seg-f" type="number" min="1" value="${esc(selSeg?.frames ?? 1)}" style="${NUM_STYLE}">
        ${mkBtn('pe-seg-clear',  'clear',    '#555',    '#333',    '#999')}
        <span style="flex:1"></span>
        <span id="pe-seg-err" style="color:#f88;font-size:10px"></span>
        ${mkBtn('pe-seg-del', 'delete',   '#803030', '#5c1a1a', '#f99')}
        ${mkBtn('pe-seg-eq',  'equalize', '#555',    '#333',    '#ccc')}
        ${mkBtn('pe-seg-add', 'add',      '#2a8050', '#1a5c35', '#cde')}
      `
      panel.appendChild(segCtrl)

      const segFInput = segCtrl.querySelector('#pe-seg-f')
      const segErr    = segCtrl.querySelector('#pe-seg-err')
      let   prevFrames = selSeg?.frames ?? 1

      segFInput.addEventListener('input', e => {
        const v = e.target.value
        if (v === '') return
        const n = parseInt(v, 10)
        if (isNaN(n) || n < 0) { e.target.value = ''; return }
        if (String(n) !== v) e.target.value = String(n)
      })

      segFInput.addEventListener('change', e => {
        const nv       = Math.max(1, parseInt(e.target.value, 10) || 1)
        e.target.value = nv
        const otherSum = segments.reduce((a, s, i) => i === selIdx ? a : a + s.frames, 0)
        const maxOk    = totalFrames - otherSum
        const isLast   = selIdx === segments.length - 1

        if (nv > prevFrames && nv > maxOk) {
          if (isLast) {
            segErr.textContent = `Max ${Math.max(0, maxOk)}`
            setTimeout(() => { segErr.textContent = '' }, 2000)
            e.target.value = prevFrames
            return
          }
          // Non-last segment: confirm then redistribute to right segments proportionally
          const leftSum    = segments.slice(0, selIdx).reduce((a, s) => a + s.frames, 0)
          const rightSegs  = segments.slice(selIdx + 1)
          const rightCount = rightSegs.length
          const maxNv      = totalFrames - leftSum - rightCount
          const actualNv   = Math.min(nv, maxNv)

          confirmPopup(
            'This will modify the number of frames on other segments. Continue?',
            yes => {
              if (!yes) { segFInput.value = prevFrames; return }

              segments[selIdx].frames = actualNv
              segFInput.value         = actualNv

              const newRightTotal  = totalFrames - leftSum - actualNv
              const origRightTotal = rightSegs.reduce((a, s) => a + s.frames, 0)

              if (origRightTotal <= 0) {
                const base = Math.floor(newRightTotal / rightCount)
                rightSegs.forEach((s, i) => {
                  s.frames = (i === rightCount - 1)
                    ? Math.max(1, newRightTotal - base * (rightCount - 1))
                    : Math.max(1, base)
                })
              } else {
                let assigned = 0
                rightSegs.forEach((s, i) => {
                  if (i === rightSegs.length - 1) {
                    s.frames = Math.max(1, newRightTotal - assigned)
                  } else {
                    const share = Math.max(1, Math.round(newRightTotal * (s.frames / origRightTotal)))
                    s.frames    = share
                    assigned   += share
                  }
                })
              }

              prevFrames = actualNv
              refreshBar()
            }
          )
          return
        }

        prevFrames = nv
        if (segments[selIdx]) segments[selIdx].frames = nv
        refreshBar()
      })

      segCtrl.querySelector('#pe-seg-clear').addEventListener('click', () => {
        if (segments[selIdx]) {
          segments[selIdx].text = ''
          posSec.querySelector('#pe-seg-text').value = ''
        }
      })

      segCtrl.querySelector('#pe-seg-del').addEventListener('click', () => {
        if (segments.length <= 1) return
        segments.splice(selIdx, 1)
        clampSel()
        render()
      })

      segCtrl.querySelector('#pe-seg-eq').addEventListener('click', () => {
        equalize()
        render()
      })

      segCtrl.querySelector('#pe-seg-add').addEventListener('click', () => {
        const maxSegs = Math.floor(totalFrames / 3)
        if (segments.length >= maxSegs) {
          segErr.textContent = 'Min 3 frames/seg'
          setTimeout(() => { segErr.textContent = '' }, 2000)
          return
        }
        const used = segments.reduce((a, s) => a + s.frames, 0)
        const rem  = totalFrames - used
        if (rem >= 1) {
          segments.push({ text: '', frames: rem })
        } else {
          segments.push({ text: '', frames: 1 })
          equalize()
        }
        selIdx = segments.length - 1
        render()
      })

      panel.appendChild(greenDiv())

      // ── Negative ────────────────────────────────────────────────────────
      const negHdr = el('div', 'display:flex;justify-content:flex-end;padding:6px 10px 2px')
      negHdr.innerHTML = sectionLabel('NEGATIVE')
      panel.appendChild(negHdr)

      const negSec = el('div', 'padding:0 10px 6px')
      negSec.innerHTML = `
        <textarea id="pe-neg" style="${TA_STYLE};min-height:92px">${esc(negText)}</textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:3px">
          ${mkBtn('pe-neg-clear','clear','#555','#333','#999')}
        </div>
      `
      panel.appendChild(negSec)
      negSec.querySelector('#pe-neg').addEventListener('input', e => { negText = e.target.value })
      negSec.querySelector('#pe-neg-clear').addEventListener('click', () => {
        negText = ''
        negSec.querySelector('#pe-neg').value = ''
      })

      panel.appendChild(greenDiv())

      // ── Footer ───────────────────────────────────────────────────────────
      const footer = el('div', 'display:flex;align-items:center;gap:8px;padding:8px 10px')
      footer.innerHTML = `
        ${mkBtn('pe-clear-all', 'clear all', '#803030', '#5c1a1a', '#f99')}
        <span style="flex:1"></span>
        ${mkBtn('pe-cancel', 'cancel', '#555', '#333', '#bbb')}
        ${mkBtn('pe-ok',     'ok',     '#2a8050', '#1a5c35', '#cde')}
      `
      panel.appendChild(footer)

      footer.querySelector('#pe-clear-all').addEventListener('click', () => {
        masterText = ''
        negText    = ''
        segments   = [{ text: '', frames: totalFrames }]
        selIdx     = 0
        render()
      })
      footer.querySelector('#pe-cancel').addEventListener('click', () => doCancel())
      footer.querySelector('#pe-ok').addEventListener('click',     () => doSave())
    }

    // ── Actions ───────────────────────────────────────────────────────────

    function doCancel() {
      if (!_overlay) return
      _overlay.remove()
      _overlay = null
    }

    function doSave() {
      if (!_overlay) return
      saveDomState()
      const fpsEl = panel.querySelector('#pe-fps')
      if (fpsEl) fps = parseFloat(fpsEl.value) || fps
      const tfEl = panel.querySelector('#pe-tf')
      if (tfEl) totalFrames = Math.max(1, parseInt(tfEl.value) || 1)
      onSave({
        master_prompt:   { text: masterText },
        positive_prompt: { text: writeSegments(segments, promptType, fps), type: promptType },
        negative_prompt: { text: negText },
        total_frames:    { value: totalFrames },
        fps:             { value: fps },
      })
      _overlay.remove()
      _overlay = null
    }

    render()
  }

  function rescalePrompt(text, type, oldTotal, newTotal, fps = 0) {
    if (!text || type === 'simple' || oldTotal <= 0 || newTotal <= 0 || oldTotal === newTotal) {
      return text
    }
    const segs = parseSegments(text, type, oldTotal, fps)
    if (!segs.length) return text

    const ratio  = newTotal / oldTotal
    let scaled   = segs.map(s => ({ ...s, frames: Math.max(1, Math.round(s.frames * ratio)) }))
    let sum      = scaled.reduce((a, s) => a + s.frames, 0)
    let safety   = 400

    while (sum > newTotal && safety-- > 0) {
      const mi = scaled.reduce((bi, s, i) => s.frames > scaled[bi].frames ? i : bi, 0)
      if (scaled[mi].frames <= 1) break
      scaled[mi].frames--
      sum--
    }
    while (sum < newTotal && safety-- > 0) {
      const mi = scaled.reduce((bi, s, i) => s.frames < scaled[bi].frames ? i : bi, 0)
      scaled[mi].frames++
      sum++
    }
    // Edge case: more segments than frames — trim and redistribute
    if (sum > newTotal) {
      scaled       = scaled.slice(0, Math.max(1, newTotal))
      const n      = scaled.length
      const base   = Math.max(1, Math.floor(newTotal / n))
      scaled       = scaled.map((s, i) => ({
        ...s,
        frames: i === n - 1 ? Math.max(1, newTotal - base * (n - 1)) : base,
      }))
    }

    // Use the actual serialised format (may differ from declared type if text was
    // written in a different mode) so rescaling never silently converts the format.
    const effectiveType = (type !== 'simple' ? detectPromptFormat(text) : null) ?? type
    return writeSegments(scaled, effectiveType, fps)
  }

  window.DazPromptEditor = { open, rescalePrompt }
})()
