// Panel for the "Prompt Stack Manager" node: read-only display (Class/Stack/
// Sequence info + per-prompt Master/Positive/Negative/Type panels, styled
// like the WorkflowConfig "use mode" detail table) plus an "Edit Sequence"
// modal that hosts stack/sequence/prompt CRUD.
// Self-contained (not folded into daz_workflow_config_shared.js, whose ~3500
// lines are built around the models/dims/loras WorkflowConfig schema).

import { app } from '../../scripts/app.js'

const MAX_PROMPTS = 10
const MAX_SEQUENCES = 10 // sequences per stack, capped to match MAX_PROMPTS
const PANEL_H = 360
const NODE_W  = 340
const NODE_H  = 520

const EXTERNAL_PROMPT_LABEL = 'External Prompt'

const VALID_PROMPT_TYPES = ['smart', 'beats', 'simple', 'timecode', 'h3']
const PROMPT_TYPE_LABELS = { smart: 'Smart', beats: 'Beats', simple: 'Simple', timecode: 'Timecode', h3: 'H3' }

// Class filter display <-> stored class value
const CLASS_FILTER_VALUES = [
  'All', 'Wan 2.2', 'LTX 2.3', 'Images',
  'Krea2', 'Flux2 Klein 9B', 'Qwen Image', 'Chroma', 'Z-Image Turbo', 'FLux 2', 'Wan Image', 'MiniMax H3',
]
const CLASS_FILTER_TO_VALUE = {
  'All': '', 'Wan 2.2': 'Wan2.2', 'LTX 2.3': 'ltx2.3', 'Images': 'ImageInference',
  'Krea2': 'krea2', 'Flux2 Klein 9B': 'klein9b', 'Qwen Image': 'qwen', 'Chroma': 'chroma',
  'Z-Image Turbo': 'zit', 'FLux 2': 'flux2', 'Wan Image': 'wan_img', 'MiniMax H3': 'm_h3',
}

// Same set as the Class filter, but "All" -> "<no class>" (stored as ''),
// for use in the New Prompt Stack class dropdown.
const CLASS_CREATE_OPTIONS = [
  { label: '<no class>',      value: '' },
  { label: 'Wan 2.2',         value: 'Wan2.2' },
  { label: 'LTX 2.3',         value: 'ltx2.3' },
  { label: 'Images',          value: 'ImageInference' },
  { label: 'Krea2',           value: 'krea2' },
  { label: 'Flux2 Klein 9B',  value: 'klein9b' },
  { label: 'Qwen Image',      value: 'qwen' },
  { label: 'Chroma',          value: 'chroma' },
  { label: 'Z-Image Turbo',   value: 'zit' },
  { label: 'FLux 2',          value: 'flux2' },
  { label: 'Wan Image',       value: 'wan_img' },
  { label: 'MiniMax H3',      value: 'm_h3' },
]

function classValueToLabel(value) {
  const opt = CLASS_CREATE_OPTIONS.find(o => o.value === (value || ''))
  return opt ? opt.label : (value || '')
}

// ── HTML helpers ────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function mkBtn(id, label, border, bg, color, disabled = false) {
  return `<button id="${id}"${disabled ? ' disabled' : ''}
    style="font-family:monospace;font-size:11px;padding:2px 8px;border-radius:3px;
           cursor:${disabled ? 'default' : 'pointer'};border:1px solid ${border};background:${bg};
           color:${color};opacity:${disabled ? 0.4 : 1}"
    >${label}</button>`
}

function trunc(s, n = 60) {
  if (!s) return ''
  return s.length > n ? s.substring(0, n) + '…' : s
}

// Detail-table row helpers — mirror `row`/`rowPair`/`rowDiv` in
// daz_workflow_config_shared.js so the read-only display matches the
// WorkflowConfig "use mode" panel styling exactly.
function row(label, value) {
  const v = value !== undefined && value !== '' && value !== 0
    ? `<span style="color:#ddd">${esc(value)}</span>`
    : `<span style="color:#555">—</span>`
  return `<tr>
    <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">${label}</td>
    <td colspan="3" style="color:#ddd;padding:3px 10px;word-break:break-all">${v}</td>
  </tr>`
}

function rowPair(l1, v1, l2, v2) {
  function val(v) {
    return v !== undefined && v !== '' && v !== 0
      ? `<span style="color:#ddd">${esc(v)}</span>`
      : `<span style="color:#555">—</span>`
  }
  const tdL = 'style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top"'
  const tdV = 'style="color:#ddd;padding:3px 10px;width:30%"'
  return `<tr>
    <td ${tdL}>${l1}</td><td ${tdV}>${val(v1)}</td>
    <td ${tdL}>${l2}</td><td ${tdV}>${val(v2)}</td>
  </tr>`
}

function rowDivider() {
  return `<div style="border-top:1px solid #555;margin:4px 8px"></div>`
}

// Round box with title — mirrors `box()` in daz_workflow_config_shared.js,
// used by the Edit Sequence modal's "Stack details" / "Prompt Sequences" panels.
function box(title, html) {
  return `<fieldset style="border:1px solid #444;border-radius:4px;padding:7px 8px;margin:0;min-width:0;box-sizing:border-box">
    <legend style="color:#888;font-size:11px;padding:0 5px;font-family:monospace">${esc(title)}</legend>
    ${html}
  </fieldset>`
}

function overlayShell(width) {
  const overlay = document.createElement('div')
  overlay.style.cssText =
    'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);' +
    'z-index:10000;display:flex;align-items:center;justify-content:center'
  const box = document.createElement('div')
  box.style.cssText =
    `background:#2a2a2a;border:1px solid #555;border-radius:6px;padding:16px 18px;` +
    `width:${width}px;max-height:80vh;overflow-y:auto;font-family:monospace`
  overlay.appendChild(box)
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  return { overlay, box, close }
}

function confirmModal(message, confirmLabel, onConfirm) {
  const { box, close } = overlayShell(360)
  box.innerHTML = `
    <p style="font-size:13px;color:#ddd;margin:0 0 18px">${esc(message)}</p>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      ${mkBtn('cm-cancel', 'Cancel', '#666', '#444', '#ccc')}
      ${mkBtn('cm-confirm', confirmLabel, '#803030', '#5c1a1a', '#f99')}
    </div>`
  box.querySelector('#cm-cancel').addEventListener('click', close)
  box.querySelector('#cm-confirm').addEventListener('click', async () => {
    close()
    try {
      await onConfirm()
    } catch (e) {
      console.warn('[DAZ TOOLS] PromptStackManager: action failed', e)
      alert(e.message || String(e))
    }
  })
}

function smallFormModal(title, fields, okLabel, onSubmit) {
  const { box, close } = overlayShell(340)
  box.innerHTML = `
    <p style="font-size:13px;color:#ddd;margin:0 0 10px">${esc(title)}</p>
    ${fields.map(f => {
      const labelHtml = `<label style="display:block;font-size:10px;color:#888;margin-bottom:2px">${esc(f.label)}</label>`
      if (f.type === 'select') {
        const opts = (f.options || []).map(o =>
          `<option value="${esc(o.value)}"${o.value === (f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`
        ).join('')
        return `${labelHtml}
          <select id="sf-${f.id}"
            style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                   border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:10px">
            ${opts}
          </select>`
      }
      return `${labelHtml}
        <input id="sf-${f.id}" type="text" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"
          style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                 border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:10px">`
    }).join('')}
    <p id="sf-error" style="font-size:11px;color:#f88;margin:0 0 8px;display:none"></p>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      ${mkBtn('sf-cancel', 'Cancel', '#666', '#444', '#ccc')}
      ${mkBtn('sf-ok', okLabel, '#3a7a3a', '#1e4a1e', '#9f9')}
    </div>`
  box.querySelector('#sf-cancel').addEventListener('click', close)
  box.querySelector('#sf-ok').addEventListener('click', async () => {
    const values = {}
    fields.forEach(f => { values[f.id] = box.querySelector(`#sf-${f.id}`).value })
    try {
      await onSubmit(values)
      close()
    } catch (e) {
      const errEl = box.querySelector('#sf-error')
      errEl.textContent = e.message || String(e)
      errEl.style.display = 'block'
    }
  })
}

// ── Extension ────────────────────────────────────────────────────────────────

app.registerExtension({
  name: 'daz.PromptStackManager',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'PromptStackManager') return

    function rawSeq(display) {
      return String(display ?? '').split(' - ')[0].trim()
    }

    function seqDisplay(s) {
      return s.name ? `${s.sequence} - ${s.name}` : String(s.sequence)
    }

    function promptDisplay(idx, p) {
      const label = (p && p.label) ? String(p.label).trim() : ''
      return label ? `${idx + 1} - ${label}` : String(idx + 1)
    }

    // null when the "Prompt" widget is on "All", else the 0-based slot index
    // it's narrowed down to.
    function selectedPromptIndex(node) {
      const raw = rawSeq(node._dazPromptWidget?.value || 'All')
      if (!raw || raw === 'All') return null
      const idx = parseInt(raw, 10) - 1
      return Number.isInteger(idx) && idx >= 0 ? idx : null
    }

    // Resolves the node feeding external_prompt, if any — used to check its
    // mode (a muted source produces no output, so it should count as unwired).
    function getExternalPromptOriginNode(node) {
      const inp = node.inputs?.find(i => i.name === 'external_prompt')
      if (!inp || inp.link == null) return null
      const link = node.graph?.links?.[inp.link]
      if (!link) return null
      return node.graph.getNodeById(link.origin_id) || null
    }

    function isExternalPromptWired(node) {
      const inp = node.inputs?.find(i => i.name === 'external_prompt')
      if (!inp || inp.link == null) return false
      const origin = getExternalPromptOriginNode(node)
      // LiteGraph.NEVER (mode 2) === muted — ComfyUI drops a muted node's
      // links entirely when building the actual execution prompt, so the
      // dropdown should already treat it as if nothing were connected.
      if (origin && origin.mode === LiteGraph.NEVER) return false
      return true
    }

    function emptyPrompt() {
      return {
        label: '',
        master_prompt:   { text: '', position: 'before' },
        positive_prompt: { text: '', type: 'smart' },
        negative_prompt: { text: '' },
      }
    }

    // ── Class filter ─────────────────────────────────────────────────────

    function applyClassFilter(node) {
      const w = node.widgets?.find(w => w.name === 'stack')
      if (!w) return
      const all = node._dazAllStacks || []
      const filterVal = node._dazClassFilterWidget?.value || 'All'
      const classValue = CLASS_FILTER_TO_VALUE[filterVal] || ''
      const filtered = classValue ? all.filter(s => s.class === classValue) : all
      const labels = filtered.map(s => s.label)
      w.options.values = labels.length ? labels : ['(no prompt stacks)']
      if (!labels.includes(w.value)) w.value = labels[0] ?? '(no prompt stacks)'
    }

    async function reloadStackWidget(node) {
      try {
        const r = await fetch('/daz/prompt-stack-list')
        node._dazAllStacks = r.ok ? await r.json() : []
      } catch (e) {
        console.warn('[DAZ TOOLS] PromptStackManager: could not reload stack list', e)
        node._dazAllStacks = node._dazAllStacks || []
      }
      applyClassFilter(node)
    }

    async function reloadSequenceWidget(node, stackLabel, selectRawSeq = null) {
      const sw = node._dazSeqWidget
      if (!sw) return
      if (!stackLabel || stackLabel === '(no prompt stacks)') {
        sw.options.values = ['0']
        sw.value = '0'
        return
      }
      try {
        const r = await fetch(`/daz/prompt-stack-sequences?label=${encodeURIComponent(stackLabel)}`)
        const seqs = r.ok ? await r.json() : []
        const list = seqs.map(seqDisplay)
        sw.options.values = list.length ? list : ['0']
        const wantRaw = selectRawSeq != null ? String(selectRawSeq) : rawSeq(sw.value)
        const match = list.find(d => rawSeq(d) === wantRaw)
        sw.value = match ?? (list[list.length - 1] ?? '0')
      } catch (e) {
        console.warn('[DAZ TOOLS] PromptStackManager: could not reload sequences', e)
      }
    }

    // Options are derived from the already-loaded node._dazPrompts (set by
    // loadDetail) rather than a separate fetch — the active sequence's
    // prompts are already on hand by the time this runs.
    function reloadPromptWidget(node) {
      const pw = node._dazPromptWidget
      if (!pw) return
      const prompts = node._dazPrompts || []
      const list = ['All']
      if (isExternalPromptWired(node)) list.push(EXTERNAL_PROMPT_LABEL)
      list.push(...prompts.map((p, i) => promptDisplay(i, p)))
      pw.options.values = list
      const curRaw = rawSeq(pw.value)
      if (curRaw === 'All' || curRaw === '') {
        if (!list.includes(pw.value)) pw.value = 'All'
      } else if (curRaw === EXTERNAL_PROMPT_LABEL) {
        pw.value = list.includes(EXTERNAL_PROMPT_LABEL) ? EXTERNAL_PROMPT_LABEL : 'All'
      } else {
        const match = list.find(d => rawSeq(d) === curRaw)
        pw.value = match ?? 'All'
      }
    }

    function updateOutputLabels(node, prompts) {
      if (!node.outputs) return
      if (node.outputs[0]) node.outputs[0].label = 'selected prompt'
      for (let i = 0; i < MAX_PROMPTS; i++) {
        const out = node.outputs[i + 1]
        if (!out) continue
        const p = prompts[i]
        out.label = (p && p.label) ? p.label : String(i + 1)
      }
    }

    async function loadDetail(node, stackLabel, seqValue) {
      if (!stackLabel || stackLabel === '(no prompt stacks)') {
        node._dazStackName  = null
        node._dazStackId    = ''
        node._dazStackClass = ''
        node._dazSeqRaw     = '0'
        node._dazSeqName    = ''
        node._dazPrompts    = []
        reloadPromptWidget(node)
        renderPanel(node)
        updateOutputLabels(node, [])
        return
      }
      try {
        const url = `/daz/prompt-stack-detail?label=${encodeURIComponent(stackLabel)}` +
          `&sequence=${encodeURIComponent(rawSeq(seqValue))}`
        const r = await fetch(url)
        const data = await r.json()
        if (!r.ok || data.error) throw new Error(data.error || r.statusText)
        // Only sync fps/frame_count from the stored stack when actually
        // switching to a different stack — otherwise this would stomp a
        // value the user just typed into the node before it's been saved.
        const stackChanged  = node._dazStackName !== data.name
        node._dazStackName  = data.name
        node._dazStackId    = data.id || ''
        node._dazStackClass = data.class || ''
        node._dazSeqRaw     = data.sequence || '0'
        node._dazSeqName    = data.seq_name || ''
        node._dazPrompts    = (data.prompts || []).slice(0, MAX_PROMPTS)
        if (stackChanged) {
          if (node._dazFpsWidget)        node._dazFpsWidget.value = data.fps ?? 0
          if (node._dazFrameCountWidget) node._dazFrameCountWidget.value = data.frame_count ?? 0
        }
        reloadPromptWidget(node)
        renderPanel(node)
        updateOutputLabels(node, node._dazPrompts)
      } catch (e) {
        console.warn('[DAZ TOOLS] PromptStackManager: could not load detail', e)
      }
    }

    async function reloadPrompts(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      await reloadStackWidget(node)
      await reloadSequenceWidget(node, sw?.value)
      await loadDetail(node, sw?.value, node._dazSeqWidget?.value)
    }

    // Persists the node's live fps/frame_count widget values into the
    // currently-loaded stack entry. Called whenever either widget changes,
    // since those inputs aren't otherwise saved anywhere on their own.
    async function saveFrameSettings(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)' || !node._dazStackName) return
      try {
        const r = await fetch('/daz/prompt-stack-save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: sw.value, sequence: node._dazSeqRaw,
            sequence_name: node._dazSeqName, prompts: node._dazPrompts,
            save_mode: 'current',
            fps: node._dazFpsWidget?.value, frame_count: node._dazFrameCountWidget?.value,
          }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)
      } catch (e) {
        console.warn('[DAZ TOOLS] PromptStackManager: could not save fps/frame_count', e)
      }
    }

    async function refreshAfterStackChange(node, selectLabel, selectSeqRaw) {
      // Reset the Class filter so the affected stack is guaranteed to be
      // visible even if it doesn't match whatever filter was active.
      if (selectLabel && node._dazClassFilterWidget) node._dazClassFilterWidget.value = 'All'
      await reloadStackWidget(node)
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (selectLabel && sw) sw.value = selectLabel
      const label = sw?.value
      await reloadSequenceWidget(node, label, selectSeqRaw)
      await loadDetail(node, label, node._dazSeqWidget?.value)
    }

    // ── CRUD actions ────────────────────────────────────────────────────────

    function doCreateStack(node) {
      smallFormModal('New Prompt Stack', [
        { id: 'name', label: 'Name' },
        { id: 'class', label: 'Class', type: 'select', options: CLASS_CREATE_OPTIONS },
      ], 'Create', async (values) => {
        const name = values.name.trim()
        if (!name) throw new Error('Name is required.')
        const r = await fetch('/daz/prompt-stack-create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, class: values.class || '',
            fps: node._dazFpsWidget?.value, frame_count: node._dazFrameCountWidget?.value,
          }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)
        await refreshAfterStackChange(node, result.label, result.sequence)
      })
    }

    // ── Prompt editor (reused DazPromptEditor, in "stack mode") ─────────────
    // Opens the SAME modal the WorkflowConfig nodes use for a single prompt,
    // extended (opt-in, via `stackMode`) to edit one sequence's whole
    // prompts[] array. `hooks.refreshSeqList`/`hooks.closeOuter` let it keep
    // the outer Edit Stack popup (still open underneath) in sync.

    function openStackPromptEditor(node, sw, seqDetail, hooks) {
      if (!window.DazPromptEditor) return
      // Reassigned by onNewSequence when the editor switches to a freshly
      // created sequence, so onSave/onDeleteSequence always target whatever
      // sequence is currently loaded in the editor, not the one it opened on.
      let seqRaw = String(seqDetail.sequence)

      // fps/frame_count are entry-level (stack-wide) node inputs, not stored
      // sequence data — the live widget always wins over whatever's on file,
      // so the editor is fed straight from the node, not from seqDetail.
      const liveFps        = () => node._dazFpsWidget?.value        ?? seqDetail.fps ?? 0
      const liveFrameCount = () => node._dazFrameCountWidget?.value ?? seqDetail.frame_count ?? 0

      window.DazPromptEditor.open({
        stackMode: {
          sequenceName: seqDetail.seq_name || '',
          prompts:      seqDetail.prompts || [],
          fps:          { value: liveFps() },
          frameCount:   { value: liveFrameCount() },
          activeIndex:  Number.isInteger(hooks.activeIndex) ? hooks.activeIndex : null,

          onNewSequence: async () => {
            if (hooks.getSeqCount() >= MAX_SEQUENCES) {
              throw new Error(`A prompt stack can have at most ${MAX_SEQUENCES} sequences.`)
            }
            const r = await fetch('/daz/prompt-stack-save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: sw.value, sequence_name: 'New Sequence Name',
                prompts: [emptyPrompt()], save_mode: 'new_sequence',
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            const dr = await fetch(
              `/daz/prompt-stack-detail?label=${encodeURIComponent(sw.value)}` +
              `&sequence=${encodeURIComponent(result.sequence)}`)
            const d = await dr.json()
            if (!dr.ok || d.error) throw new Error(d.error || dr.statusText)
            seqRaw = String(result.sequence)
            await hooks.refreshSeqList(result.sequence)
            return {
              sequenceName: d.seq_name || '', prompts: d.prompts || [],
              fps: { value: liveFps() }, frameCount: { value: liveFrameCount() },
            }
          },

          onDeleteSequence: async () => {
            const r = await fetch('/daz/prompt-stack-delete', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ label: sw.value, sequence: seqRaw, delete_mode: 'sequence' }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            if (result.stack_deleted) {
              hooks.closeOuter()
              await refreshAfterStackChange(node, null, null)
            } else {
              await hooks.refreshSeqList()
              // Always resync (not just when the deleted sequence matched
              // the node's active one) — the real widget's option list just
              // changed and, if it was pointing at the now-deleted sequence,
              // it needs to fall back to a valid one rather than sit stale.
              await reloadSequenceWidget(node, sw.value)
              await loadDetail(node, sw.value, node._dazSeqWidget?.value)
            }
          },
        },

        onSave: async (updates) => {
          try {
            const r = await fetch('/daz/prompt-stack-save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: sw.value, sequence: seqRaw,
                sequence_name: updates.sequence_name, prompts: updates.prompts,
                save_mode: 'current',
                fps: liveFps(), frame_count: liveFrameCount(),
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            // refreshSeqList already syncs the node's real sequence widget to
            // whatever was just saved — saving a sequence here means the user
            // is done, so close the outer Edit Stack popup too instead of
            // making them come back and hit its Save button separately.
            await hooks.refreshSeqList(result.sequence)
            hooks.closeOuter()
          } catch (e) {
            console.warn('[DAZ TOOLS] PromptStackManager: could not save sequence', e)
            alert(e.message || String(e))
          }
        },
      })
    }

    // Opens the shared prompt editor directly for the node's currently
    // active sequence — used by the main panel's "Edit Sequence" button so
    // editing the active sequence no longer requires going through the
    // "Edit Stack" popup first. Mirrors the hooks openSequenceInEditor
    // builds for that popup, minus anything tied to its own DOM/dropdown.
    async function openSequenceEditorDirect(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)' || !node._dazStackName) return

      let seqCount = 0
      async function refreshCount(selectRaw) {
        try {
          const r = await fetch(`/daz/prompt-stack-sequences?label=${encodeURIComponent(sw.value)}`)
          const seqs = r.ok ? await r.json() : []
          seqCount = seqs.length
        } catch (e) {
          console.warn('[DAZ TOOLS] PromptStackManager: could not reload sequence count', e)
        }
        if (selectRaw != null) {
          await reloadSequenceWidget(node, sw.value, selectRaw)
          await loadDetail(node, sw.value, node._dazSeqWidget?.value)
        }
      }

      await refreshCount()
      const seqRawToOpen = node._dazSeqRaw || '0'
      try {
        const url = `/daz/prompt-stack-detail?label=${encodeURIComponent(sw.value)}` +
          `&sequence=${encodeURIComponent(seqRawToOpen)}`
        const r = await fetch(url)
        const data = await r.json()
        if (!r.ok || data.error) throw new Error(data.error || r.statusText)
        openStackPromptEditor(node, sw, data, {
          refreshSeqList: refreshCount,
          closeOuter:     () => {},
          getSeqCount:    () => seqCount,
          activeIndex:    selectedPromptIndex(node),
        })
      } catch (e) {
        console.warn('[DAZ TOOLS] PromptStackManager: could not open sequence editor', e)
        alert(e.message || String(e))
      }
    }

    // ── Edit Sequence modal ─────────────────────────────────────────────────

    function openEditSequenceModal(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)' || !node._dazStackName) return

      let seqList        = []
      let selectedSeqRaw = node._dazSeqRaw || '0'
      let stackNameVal   = node._dazStackName || ''
      let classVal       = node._dazStackClass || ''

      // Raw DOM overlay/panel/header/body/footer — mirrors enterEditForm's
      // skeleton in daz_workflow_config_shared.js. Deliberately has NO
      // backdrop-click-to-close listener: only Cancel/Save dismiss this modal.
      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;' +
        'display:flex;align-items:flex-start;justify-content:center;padding:16px 8px;overflow-y:auto'

      const panel = document.createElement('div')
      panel.style.cssText =
        'background:#1a1a1a;border:1px solid #444;border-radius:6px;display:flex;' +
        'flex-direction:column;width:420px;min-width:340px;font-family:monospace;' +
        'flex-shrink:0;max-height:calc(100vh - 32px)'

      const panelHeader = document.createElement('div')
      panelHeader.style.cssText =
        'padding:7px 14px;border-bottom:1px solid #333;color:#aaa;font-size:12px;flex-shrink:0'
      panelHeader.textContent = `Edit Stack: ${stackNameVal}`

      const panelBody = document.createElement('div')
      panelBody.style.cssText =
        'display:flex;flex-direction:column;gap:10px;padding:10px;overflow-y:auto;overflow-x:hidden;flex:1'

      const panelFooter = document.createElement('div')
      panelFooter.style.cssText =
        'display:flex;justify-content:flex-end;gap:8px;padding:7px 12px;border-top:1px solid #333;flex-shrink:0'

      panel.appendChild(panelHeader)
      panel.appendChild(panelBody)
      panel.appendChild(panelFooter)
      overlay.appendChild(panel)
      document.body.appendChild(overlay)

      const close = () => overlay.remove()

      async function refreshSeqList(selectRaw) {
        try {
          const r = await fetch(`/daz/prompt-stack-sequences?label=${encodeURIComponent(sw.value)}`)
          seqList = r.ok ? await r.json() : []
        } catch (e) {
          console.warn('[DAZ TOOLS] PromptStackManager: could not reload sequence list', e)
        }
        if (selectRaw != null) selectedSeqRaw = String(selectRaw)
        else if (!seqList.some(s => String(s.sequence) === selectedSeqRaw)) {
          selectedSeqRaw = seqList.length ? String(seqList[seqList.length - 1].sequence) : '0'
        }
        render()
        // This modal's own dropdown is otherwise fully decoupled from the
        // node's real `sequence` widget (the one actually serialized for
        // graph execution) — whenever a sequence is explicitly selected here
        // (edited/created/duplicated), keep that widget pointed at it too,
        // or the executed graph silently keeps using whatever sequence was
        // active before this modal was opened.
        if (selectRaw != null) {
          await reloadSequenceWidget(node, sw.value, selectedSeqRaw)
          await loadDetail(node, sw.value, node._dazSeqWidget?.value)
        }
      }

      // Fetches one sequence's detail and opens it in the shared prompt
      // editor (stack mode) — used by Edit/New/Duplicate Sequence so all
      // three land the user directly in the editor for that sequence.
      async function openSequenceInEditor(seqRawToOpen) {
        await refreshSeqList(seqRawToOpen)
        try {
          const url = `/daz/prompt-stack-detail?label=${encodeURIComponent(sw.value)}` +
            `&sequence=${encodeURIComponent(seqRawToOpen)}`
          const r = await fetch(url)
          const data = await r.json()
          if (!r.ok || data.error) throw new Error(data.error || r.statusText)
          openStackPromptEditor(node, sw, data, {
            refreshSeqList, closeOuter: close, getSeqCount: () => seqList.length,
          })
        } catch (e) {
          const errEl = panelBody.querySelector('#es-error')
          if (errEl) { errEl.textContent = e.message || String(e); errEl.style.display = 'block' }
        }
      }

      function render() {
        panelBody.innerHTML = `
          ${box('Stack details', `
            <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Stack name</label>
            <input id="es-stack-name" type="text" value="${esc(stackNameVal)}"
              style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                     border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:8px">
            <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Class</label>
            <select id="es-class"
              style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                     border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:10px">
              ${CLASS_CREATE_OPTIONS.map(o =>
                `<option value="${esc(o.value)}"${o.value === classVal ? ' selected' : ''}>${esc(o.label)}</option>`
              ).join('')}
            </select>
            <div style="display:flex;gap:6px">
              ${mkBtn('es-dup-stack', 'Duplicate', '#555', '#333', '#ccc')}
              ${mkBtn('es-del-stack', 'Delete', '#663333', '#3a1e1e', '#e88')}
            </div>`)}

          ${box('Prompt Sequences', `
            <p style="text-align:center;color:#ccc;font-size:11px;margin:4px 0 10px">
              This stack currently has ${seqList.length} sequence${seqList.length === 1 ? '' : 's'}
            </p>
            <select id="es-seq-select"
              style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                     border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:10px">
              ${seqList.map(s => {
                const raw = String(s.sequence)
                return `<option value="${esc(raw)}"${raw === selectedSeqRaw ? ' selected' : ''}>${esc(seqDisplay(s))}</option>`
              }).join('')}
            </select>
            <div style="display:flex;justify-content:center;margin-bottom:10px">
              ${mkBtn('es-edit-seq', 'Edit Sequence', '#3a5a7a', '#1e2e4a', '#9cf', seqList.length === 0)}
            </div>
            <div style="border-top:1px solid #444;margin:0 0 8px"></div>
            <div style="display:flex;gap:6px">
              ${mkBtn('es-new-seq', 'New Sequence', '#555', '#333', '#ccc', seqList.length >= MAX_SEQUENCES)}
              ${mkBtn('es-dup-seq', 'Duplicate Sequence', '#555', '#333', '#ccc', seqList.length === 0 || seqList.length >= MAX_SEQUENCES)}
              ${mkBtn('es-del-seq', 'Delete Sequence', '#663333', '#3a1e1e', '#e88', seqList.length === 0)}
            </div>`)}

          <p id="es-error" style="font-size:11px;color:#f88;margin:0;display:none"></p>`

        panelBody.querySelector('#es-stack-name').addEventListener('change', e => { stackNameVal = e.target.value })
        panelBody.querySelector('#es-class').addEventListener('change', e => { classVal = e.target.value })
        panelBody.querySelector('#es-seq-select')?.addEventListener('change', e => { selectedSeqRaw = e.target.value })

        panelBody.querySelector('#es-edit-seq')?.addEventListener('click', () => {
          openSequenceInEditor(selectedSeqRaw)
        })

        panelBody.querySelector('#es-dup-stack')?.addEventListener('click', () => {
          smallFormModal('Duplicate Stack', [
            { id: 'name', label: 'New stack name' },
          ], 'Duplicate', async (values) => {
            const newName = values.name.trim()
            if (!newName) throw new Error('Name is required.')
            const r = await fetch('/daz/prompt-stack-duplicate', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: sw.value, new_name: newName,
                duplicate_mode: 'current_sequence', sequence: node._dazSeqRaw,
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            close()
            await refreshAfterStackChange(node, result.label, result.sequence)
          })
        })

        panelBody.querySelector('#es-del-stack')?.addEventListener('click', () => {
          confirmModal(
            `Delete stack "${stackNameVal}" and all its sequences? This cannot be undone.`,
            'Delete',
            async () => {
              const r = await fetch('/daz/prompt-stack-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: sw.value, delete_mode: 'stack' }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
              close()
              await refreshAfterStackChange(node, null, null)
            },
          )
        })

        panelBody.querySelector('#es-new-seq')?.addEventListener('click', () => {
          smallFormModal('New Sequence', [
            { id: 'name', label: 'Sequence name', placeholder: 'e.g. v2' },
          ], 'Create', async (values) => {
            if (seqList.length >= MAX_SEQUENCES) {
              throw new Error(`A prompt stack can have at most ${MAX_SEQUENCES} sequences.`)
            }
            const r = await fetch('/daz/prompt-stack-save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: sw.value, sequence_name: values.name.trim(),
                prompts: [emptyPrompt()], save_mode: 'new_sequence',
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            await openSequenceInEditor(result.sequence)
          })
        })

        panelBody.querySelector('#es-dup-seq')?.addEventListener('click', () => {
          if (!selectedSeqRaw) return
          smallFormModal('Duplicate Sequence', [
            { id: 'name', label: 'New sequence name' },
          ], 'Duplicate', async (values) => {
            if (seqList.length >= MAX_SEQUENCES) {
              throw new Error(`A prompt stack can have at most ${MAX_SEQUENCES} sequences.`)
            }
            const dr = await fetch(`/daz/prompt-stack-detail?label=${encodeURIComponent(sw.value)}` +
              `&sequence=${encodeURIComponent(selectedSeqRaw)}`)
            const detail = await dr.json()
            if (!dr.ok || detail.error) throw new Error(detail.error || dr.statusText)
            const r = await fetch('/daz/prompt-stack-save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: sw.value, sequence_name: values.name.trim(),
                prompts: detail.prompts || [], save_mode: 'new_sequence',
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            await openSequenceInEditor(result.sequence)
          })
        })

        panelBody.querySelector('#es-del-seq')?.addEventListener('click', () => {
          if (!selectedSeqRaw) return
          const target = seqList.find(s => String(s.sequence) === selectedSeqRaw)
          const label  = target ? seqDisplay(target) : selectedSeqRaw
          confirmModal(
            `Delete sequence "${label}"? This cannot be undone.`,
            'Delete',
            async () => {
              const r = await fetch('/daz/prompt-stack-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: sw.value, sequence: selectedSeqRaw, delete_mode: 'sequence' }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
              close()
              if (result.stack_deleted) {
                await refreshAfterStackChange(node, null, null)
              } else {
                await reloadSequenceWidget(node, sw.value)
                await loadDetail(node, sw.value, node._dazSeqWidget?.value)
              }
            },
          )
        })
      }

      render()
      refreshSeqList(selectedSeqRaw)

      panelFooter.innerHTML = `
        ${mkBtn('es-cancel', 'Cancel', '#666', '#444', '#ccc')}
        ${mkBtn('es-save', 'Save', '#3a7a3a', '#1e4a1e', '#9f9')}`

      panelFooter.querySelector('#es-cancel').addEventListener('click', close)
      panelFooter.querySelector('#es-save').addEventListener('click', async () => {
        const newName = stackNameVal.trim()
        if (!newName) {
          const errEl = panelBody.querySelector('#es-error')
          errEl.textContent = 'Stack name is required.'
          errEl.style.display = 'block'
          return
        }
        try {
          const r = await fetch('/daz/prompt-stack-save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label: sw.value, sequence: node._dazSeqRaw, sequence_name: node._dazSeqName,
              prompts: node._dazPrompts, save_mode: 'current',
              new_name: newName, class: classVal,
              fps: node._dazFpsWidget?.value, frame_count: node._dazFrameCountWidget?.value,
            }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)
          close()
          // The save call above always targets the node's already-active
          // sequence (it exists only to persist stack name/class, since the
          // backend requires a sequence+prompts pair for any "current" save)
          // — so `result.sequence` just echoes that back. What the node
          // should switch to is whatever sequence is picked in this modal's
          // own dropdown.
          await refreshAfterStackChange(node, result.label, selectedSeqRaw)
        } catch (e) {
          const errEl = panelBody.querySelector('#es-error')
          errEl.textContent = e.message || String(e)
          errEl.style.display = 'block'
        }
      })
    }

    // ── Panel render (read-only display) ────────────────────────────────────

    function promptPanelHtml(p, idx) {
      const posType = VALID_PROMPT_TYPES.includes(p.positive_prompt?.type) ? p.positive_prompt.type : 'smart'
      return `
        <div style="padding:4px 10px 0;color:#54af7b;font-size:10px;font-weight:bold">Prompt ${idx + 1}${p.label ? ` — ${esc(p.label)}` : ''}</div>
        <table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
          ${row('Master',      trunc(p.master_prompt?.text || ''))}
          ${row('Positive',    trunc(p.positive_prompt?.text || ''))}
          ${row('Negative',    trunc(p.negative_prompt?.text || ''))}
          ${row('Qualifiers',  trunc(p.trail_prompt?.text || ''))}
          ${row('Prompt Type', PROMPT_TYPE_LABELS[posType] || 'Smart')}
        </table>`
    }

    function renderPanel(node) {
      const wrap = node._dazWrap
      if (!wrap) return
      const prompts  = node._dazPrompts || []
      const hasStack = !!node._dazStackName

      if (!hasStack) {
        wrap.innerHTML = `
          <div style="padding:20px 10px;font-family:monospace;font-size:11px;color:#888;text-align:center">
            No prompt stack selected.<br><br>
            ${mkBtn('ps-new-stack-empty', '+ New Prompt Stack', '#3a7a3a', '#1e4a1e', '#9f9')}
          </div>`
        wrap.querySelector('#ps-new-stack-empty')?.addEventListener('click', () => doCreateStack(node))
        return
      }

      // "Prompt" widget narrows the panel to a single slot; "All" (the
      // default) keeps every prompt visible, unchanged from before this
      // filter existed. Slot numbers in the display always reflect the
      // prompt's real position in the sequence, even when filtered down.
      const selectedIdx = selectedPromptIndex(node)
      const visiblePrompts = (selectedIdx != null && prompts[selectedIdx])
        ? [[selectedIdx, prompts[selectedIdx]]]
        : prompts.map((p, i) => [i, p])

      const promptsHtml = visiblePrompts.length
        ? visiblePrompts.map(([i, p]) => promptPanelHtml(p, i)).join('')
        : `<p style="padding:6px 10px;color:#666;font-size:11px">No prompts in this sequence.</p>`

      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:6px;padding:4px 8px 6px">
          ${mkBtn('ps-new-stack', 'New Prompt Stack', '#3a7a3a', '#1e4a1e', '#9f9')}
          ${mkBtn('ps-edit-stack', 'Edit Stack', '#555', '#333', '#ccc')}
          ${mkBtn('ps-edit-seq', selectedIdx != null ? 'Edit Prompt' : 'Edit Sequence', '#555', '#333', '#ccc')}
        </div>
        ${rowDivider()}
        <table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
          ${row('Class',    classValueToLabel(node._dazStackClass))}
          ${row('Stack',    node._dazStackName || '')}
          ${row('ID',       node._dazStackId || '')}
          ${row('Sequence', node._dazSeqName || '')}
          ${row('Prompts',  String(prompts.length))}
          ${rowPair('FPS', node._dazFpsWidget?.value, 'Frame Count', node._dazFrameCountWidget?.value)}
        </table>
        ${rowDivider()}
        ${promptsHtml}
      `

      wrap.querySelector('#ps-new-stack')?.addEventListener('click', () => doCreateStack(node))
      wrap.querySelector('#ps-edit-stack')?.addEventListener('click', () => openEditSequenceModal(node))
      wrap.querySelector('#ps-edit-seq')?.addEventListener('click', () => openSequenceEditorDirect(node))
    }

    // ── Lifecycle hooks ─────────────────────────────────────────────────────

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)

      this._dazStackName  = null
      this._dazStackId    = ''
      this._dazStackClass = ''
      this._dazSeqRaw     = '0'
      this._dazSeqName    = ''
      this._dazPrompts    = []
      this._dazLastExtWired = false
      this._dazAllStacks  = []

      const stackWidget  = this.widgets?.find(w => w.name === 'stack')
      const seqWidget    = this.widgets?.find(w => w.name === 'sequence')
      const promptWidget = this.widgets?.find(w => w.name === 'prompt')
      this._dazSeqWidget        = seqWidget
      this._dazPromptWidget     = promptWidget
      this._dazFpsWidget        = this.widgets?.find(w => w.name === 'fps')
      this._dazFrameCountWidget = this.widgets?.find(w => w.name === 'frame_count')

      if (stackWidget)  stackWidget.label  = 'Prompt Stack'
      if (seqWidget)    seqWidget.label    = 'Prompt Sequence'
      if (promptWidget) promptWidget.label = 'Prompt'

      const externalPromptInput = this.inputs?.find(i => i.name === 'external_prompt')
      if (externalPromptInput) externalPromptInput.label = 'external prompt'
      const externalNegPromptInput = this.inputs?.find(i => i.name === 'external_negative_prompt')
      if (externalNegPromptInput) externalNegPromptInput.label = 'external negative prompt'

      // JS-only "Class" filter widget — narrows the visible options of the
      // real `stack` combo client-side, same pattern as the Type/Group
      // filters in daz_workflow_config_shared.js.
      const classFilterWidget = this.addWidget(
        'combo', 'Class', 'All',
        async (value) => {
          applyClassFilter(this)
          const sw = this.widgets?.find(w => w.name === 'stack')
          await reloadSequenceWidget(this, sw?.value)
          await loadDetail(this, sw?.value, this._dazSeqWidget?.value)
        },
        { values: CLASS_FILTER_VALUES },
      )
      this._dazClassFilterWidget = classFilterWidget
      {
        const stackIdx = this.widgets.findIndex(w => w.name === 'stack')
        const fi = this.widgets.indexOf(classFilterWidget)
        if (stackIdx >= 0 && fi > stackIdx) {
          this.widgets.splice(fi, 1)
          this.widgets.splice(stackIdx, 0, classFilterWidget)
        }
      }

      if (stackWidget) {
        const origCb = stackWidget.callback
        stackWidget.callback = async (value) => {
          origCb?.call(this, value)
          await reloadSequenceWidget(this, value)
          await loadDetail(this, value, this._dazSeqWidget?.value)
        }
      }
      if (seqWidget) {
        const origCb = seqWidget.callback
        seqWidget.callback = async (value) => {
          origCb?.call(this, value)
          await loadDetail(this, stackWidget?.value, value)
        }
      }
      if (promptWidget) {
        // Purely a display filter + which slot feeds "selected prompt" at
        // execution time — the prompt data itself is already cached in
        // node._dazPrompts, so no re-fetch is needed, just a re-render.
        const origCb = promptWidget.callback
        promptWidget.callback = (value) => {
          origCb?.call(this, value)
          renderPanel(this)
        }
      }
      if (this._dazFpsWidget) {
        const origCb = this._dazFpsWidget.callback
        this._dazFpsWidget.callback = async (value) => {
          origCb?.call(this, value)
          await saveFrameSettings(this)
        }
      }
      if (this._dazFrameCountWidget) {
        const origCb = this._dazFrameCountWidget.callback
        this._dazFrameCountWidget.callback = async (value) => {
          origCb?.call(this, value)
          await saveFrameSettings(this)
        }
      }

      const wrap = document.createElement('div')
      wrap.style.cssText =
        `box-sizing:border-box;padding:6px 0;overflow-y:auto;overflow-x:hidden;width:100%;height:${PANEL_H}px`
      this._dazWrap = wrap

      this.addWidget('button', 'Reload Prompts', null, () => reloadPrompts(this))

      this.addDOMWidget('promptStackPanel', 'html', wrap, {
        getValue:     () => '',
        setValue:     () => {},
        getMinHeight: () => PANEL_H,
        hideOnZoom:   false,
      })

      this.size    = [NODE_W, NODE_H]
      this.minSize = [NODE_W, NODE_H]

      if (stackWidget && stackWidget.value !== '(no prompt stacks)') {
        reloadStackWidget(this).then(() => {
          const sw = this.widgets?.find(w => w.name === 'stack')
          return reloadSequenceWidget(this, sw?.value).then(() => loadDetail(this, sw?.value, this._dazSeqWidget?.value))
        })
      } else {
        renderPanel(this)
      }
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments)
      const self = this
      queueMicrotask(async () => {
        await reloadStackWidget(self)
        const sw = self.widgets?.find(w => w.name === 'stack')
        const savedSeq = self._dazSeqWidget?.value
        if (sw && sw.value !== '(no prompt stacks)') {
          await reloadSequenceWidget(self, sw.value, savedSeq ? rawSeq(savedSeq) : null)
          await loadDetail(self, sw.value, self._dazSeqWidget?.value)
        } else {
          renderPanel(self)
        }
      })
    }

    // The "prompt" dropdown only offers EXTERNAL_PROMPT_LABEL while the
    // external_prompt socket is actually wired — connecting/disconnecting it
    // needs to add/remove that option live, and fall back to 'All' if it was
    // selected and the wire is then pulled.
    const onConnectionsChange = nodeType.prototype.onConnectionsChange
    nodeType.prototype.onConnectionsChange = function (type, index, connected, linkInfo, ioSlot) {
      onConnectionsChange?.apply(this, arguments)
      if (type !== LiteGraph.INPUT) return
      const slot = ioSlot || this.inputs?.[index]
      if (slot?.name !== 'external_prompt') return
      this._dazLastExtWired = isExternalPromptWired(this)
      reloadPromptWidget(this)
      renderPanel(this)
    }

    // Muting the node feeding external_prompt (Ctrl+M) doesn't change the
    // link itself, only that node's `mode` — no connection event fires for
    // that, so the dropdown can only notice it by polling. Piggybacks on the
    // canvas's own draw loop rather than a timer; the check is cheap and only
    // reruns the dropdown refresh when the effective wired state actually flips.
    const onDrawForeground = nodeType.prototype.onDrawForeground
    nodeType.prototype.onDrawForeground = function (ctx, canvas) {
      onDrawForeground?.apply(this, arguments)
      const nowWired = isExternalPromptWired(this)
      if (nowWired !== this._dazLastExtWired) {
        this._dazLastExtWired = nowWired
        reloadPromptWidget(this)
        renderPanel(this)
      }
    }
  },
})
