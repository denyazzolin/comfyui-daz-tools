// Panel for the "Prompt Stack Manager" node: read-only display (Class/Stack/
// Sequence info + per-prompt Master/Positive/Negative/Type panels, styled
// like the WorkflowConfig "use mode" detail table) plus an "Edit Sequence"
// modal that hosts stack/sequence/prompt CRUD.
// Self-contained (not folded into daz_workflow_config_shared.js, whose ~3500
// lines are built around the models/dims/loras WorkflowConfig schema).

import { app } from '../../scripts/app.js'

const MAX_PROMPTS = 10
const PANEL_H = 360
const NODE_W  = 340
const NODE_H  = 520

const TA_STYLE =
  'box-sizing:border-box;width:100%;background:#000;color:#ddd;' +
  'border:1px solid #444;border-radius:4px;font-family:monospace;' +
  'font-size:11px;padding:4px 6px;resize:vertical'

const VALID_PROMPT_TYPES = ['smart', 'beats', 'simple', 'timecode']
const PROMPT_TYPE_LABELS = { smart: 'Smart', beats: 'Beats', simple: 'Simple', timecode: 'Timecode' }

// Class filter display <-> stored class value
const CLASS_FILTER_VALUES = ['All', 'Wan 2.2', 'LTX 2.3', 'Images']
const CLASS_FILTER_TO_VALUE = { 'All': '', 'Wan 2.2': 'Wan2.2', 'LTX 2.3': 'ltx2.3', 'Images': 'ImageInference' }

// Same set as the Class filter, but "All" -> "<no class>" (stored as ''),
// for use in the New Prompt Stack class dropdown.
const CLASS_CREATE_OPTIONS = [
  { label: '<no class>', value: '' },
  { label: 'Wan 2.2',    value: 'Wan2.2' },
  { label: 'LTX 2.3',    value: 'ltx2.3' },
  { label: 'Images',     value: 'ImageInference' },
]

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

function mkRadio(id, name, value, label, checked) {
  return `<label style="display:flex;align-items:center;gap:3px;cursor:pointer;color:#ccc;font-size:11px">
    <input type="radio" id="${id}" name="${name}" value="${value}"${checked ? ' checked' : ''}
      style="cursor:pointer;accent-color:#54af7b;margin:0">
    ${label}
  </label>`
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

    function emptyPrompt() {
      return {
        label: '',
        master_prompt:   { text: '', position: 'before' },
        positive_prompt: { text: '', type: 'smart' },
        negative_prompt: { text: '' },
      }
    }

    function clonePrompts(prompts) {
      return (prompts || []).map(p => ({
        label: p.label || '',
        master_prompt:   { ...(p.master_prompt   || {}) },
        positive_prompt: { ...(p.positive_prompt || {}) },
        negative_prompt: { ...(p.negative_prompt || {}) },
      }))
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

    function updateOutputLabels(node, prompts) {
      if (!node.outputs) return
      for (let i = 0; i < MAX_PROMPTS; i++) {
        const out = node.outputs[i]
        if (!out) continue
        const p = prompts[i]
        out.label = (p && p.label) ? p.label : `prompt_seq_${i + 1}`
      }
    }

    async function loadDetail(node, stackLabel, seqValue) {
      if (!stackLabel || stackLabel === '(no prompt stacks)') {
        node._dazStackName  = null
        node._dazStackClass = ''
        node._dazSeqRaw     = '0'
        node._dazSeqName    = ''
        node._dazPrompts    = []
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
        node._dazStackName  = data.name
        node._dazStackClass = data.class || ''
        node._dazSeqRaw     = data.sequence || '0'
        node._dazSeqName    = data.seq_name || ''
        node._dazPrompts    = (data.prompts || []).slice(0, MAX_PROMPTS)
        if (node._dazFpsWidget)         node._dazFpsWidget.value = data.fps ?? 0
        if (node._dazFrameCountWidget)  node._dazFrameCountWidget.value = data.frame_count ?? 0
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

    // ── Per-prompt edit modal (nested inside Edit Sequence) ────────────────

    function openRowEditor(prompt, onSave) {
      const p = prompt || emptyPrompt()
      const posType   = VALID_PROMPT_TYPES.includes(p.positive_prompt?.type) ? p.positive_prompt.type : 'smart'
      const masterPos = p.master_prompt?.position === 'after' ? 'after' : 'before'

      const { box, close } = overlayShell(480)
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 10px">Edit prompt</p>
        <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Label</label>
        <input id="pe-label" type="text" value="${esc(p.label || '')}"
          style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                 border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:10px">

        <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Positive prompt</label>
        <textarea id="pe-positive" rows="4" style="${TA_STYLE};margin-bottom:6px">${esc(p.positive_prompt?.text || '')}</textarea>
        <div style="display:flex;gap:12px;margin-bottom:10px">
          ${VALID_PROMPT_TYPES.map(t => mkRadio(`pe-type-${t}`, 'pe-type', t, t, t === posType)).join('')}
        </div>

        <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Master prompt</label>
        <textarea id="pe-master" rows="3" style="${TA_STYLE};margin-bottom:6px">${esc(p.master_prompt?.text || '')}</textarea>
        <div style="display:flex;gap:12px;margin-bottom:10px">
          ${mkRadio('pe-pos-before', 'pe-master-pos', 'before', 'before', masterPos === 'before')}
          ${mkRadio('pe-pos-after',  'pe-master-pos', 'after',  'after',  masterPos === 'after')}
        </div>

        <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Negative prompt</label>
        <textarea id="pe-negative" rows="3" style="${TA_STYLE};margin-bottom:14px">${esc(p.negative_prompt?.text || '')}</textarea>

        <div style="display:flex;justify-content:flex-end;gap:8px">
          ${mkBtn('pe-cancel', 'Cancel', '#666', '#444', '#ccc')}
          ${mkBtn('pe-ok', 'OK', '#3a7a3a', '#1e4a1e', '#9f9')}
        </div>`

      box.querySelector('#pe-cancel').addEventListener('click', close)
      box.querySelector('#pe-ok').addEventListener('click', () => {
        const updated = {
          label: box.querySelector('#pe-label').value,
          master_prompt: {
            text:     box.querySelector('#pe-master').value,
            position: box.querySelector('input[name="pe-master-pos"]:checked')?.value || 'before',
          },
          positive_prompt: {
            text: box.querySelector('#pe-positive').value,
            type: box.querySelector('input[name="pe-type"]:checked')?.value || 'smart',
          },
          negative_prompt: { text: box.querySelector('#pe-negative').value },
        }
        close()
        onSave(updated)
      })
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
          body: JSON.stringify({ name, class: values.class || '' }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)
        await refreshAfterStackChange(node, result.label, result.sequence)
      })
    }

    // ── Edit Sequence modal ─────────────────────────────────────────────────

    function openEditSequenceModal(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)' || !node._dazStackName) return

      let workingPrompts = clonePrompts(node._dazPrompts)
      let seqNameVal      = node._dazSeqName || ''
      let stackNameVal    = node._dazStackName || ''
      let classVal        = node._dazStackClass || ''

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

      function render() {
        const rowsHtml = workingPrompts.map((p, i) => `
          <div style="display:flex;align-items:center;gap:6px;padding:3px 6px;${i > 0 ? 'border-top:1px solid #222' : ''}">
            <span style="color:#666;font-size:10px;width:14px">${i + 1}</span>
            <span style="flex:1;color:#ccc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${esc(p.label || trunc(p.positive_prompt?.text || '', 30) || '(empty)')}
            </span>
            ${mkBtn(`es-edit-${i}`, 'Edit', '#555', '#333', '#ccc')}
            ${mkBtn(`es-del-${i}`, '✕', '#663333', '#3a1e1e', '#e88')}
          </div>`).join('')

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
            <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Sequence name</label>
            <input id="es-seq-name" type="text" value="${esc(seqNameVal)}"
              style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                     border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:8px">
            <div style="border-top:1px solid #444;margin:0 0 8px"></div>
            <div id="es-prompt-list" style="height:156px;overflow-y:auto;border:1px solid #222;
                 background:#141414;border-radius:3px;margin-bottom:8px">
              ${rowsHtml || '<p style="padding:6px 8px;color:#666;font-size:11px">No prompts yet.</p>'}
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
              ${mkBtn('es-del-all', 'Delete All', '#663333', '#3a1e1e', '#e88', workingPrompts.length === 0)}
              ${mkBtn('es-add', '+ Prompt', '#3a5a7a', '#1e2e4a', '#9cf', workingPrompts.length >= MAX_PROMPTS)}
            </div>
            <div style="border-top:1px solid #444;margin:0 0 8px"></div>
            <div style="display:flex;gap:6px">
              ${mkBtn('es-new-seq', 'New Sequence', '#555', '#333', '#ccc')}
              ${mkBtn('es-del-seq', 'Delete Sequence', '#663333', '#3a1e1e', '#e88')}
            </div>`)}

          <p id="es-error" style="font-size:11px;color:#f88;margin:0;display:none"></p>`

        panelBody.querySelector('#es-stack-name').addEventListener('change', e => { stackNameVal = e.target.value })
        panelBody.querySelector('#es-class').addEventListener('change', e => { classVal = e.target.value })
        panelBody.querySelector('#es-seq-name').addEventListener('change', e => { seqNameVal = e.target.value })

        workingPrompts.forEach((_, i) => {
          panelBody.querySelector(`#es-edit-${i}`)?.addEventListener('click', () => {
            openRowEditor(workingPrompts[i], (updated) => {
              workingPrompts[i] = updated
              render()
            })
          })
          panelBody.querySelector(`#es-del-${i}`)?.addEventListener('click', () => {
            workingPrompts.splice(i, 1)
            render()
          })
        })
        panelBody.querySelector('#es-add')?.addEventListener('click', () => {
          if (workingPrompts.length >= MAX_PROMPTS) return
          workingPrompts.push(emptyPrompt())
          render()
        })
        panelBody.querySelector('#es-del-all')?.addEventListener('click', () => {
          if (workingPrompts.length === 0) return
          confirmModal('Delete all prompts in this sequence? This cannot be undone.', 'Delete All', async () => {
            workingPrompts = []
            render()
          })
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
            const r = await fetch('/daz/prompt-stack-save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label: sw.value, sequence_name: values.name.trim(),
                prompts: workingPrompts, save_mode: 'new_sequence',
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            close()
            await reloadSequenceWidget(node, sw.value, result.sequence)
            await loadDetail(node, sw.value, node._dazSeqWidget?.value)
          })
        })

        panelBody.querySelector('#es-del-seq')?.addEventListener('click', () => {
          confirmModal(
            `Delete sequence "${seqNameVal || node._dazSeqRaw}"? This cannot be undone.`,
            'Delete',
            async () => {
              const r = await fetch('/daz/prompt-stack-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: sw.value, sequence: node._dazSeqRaw, delete_mode: 'sequence' }),
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
              label: sw.value, sequence: node._dazSeqRaw, sequence_name: seqNameVal,
              prompts: workingPrompts, save_mode: 'current',
              new_name: newName, class: classVal,
              fps: node._dazFpsWidget?.value, frame_count: node._dazFrameCountWidget?.value,
            }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)
          close()
          await refreshAfterStackChange(node, result.label, result.sequence)
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

      const promptsHtml = prompts.length
        ? prompts.map((p, i) => promptPanelHtml(p, i)).join('')
        : `<p style="padding:6px 10px;color:#666;font-size:11px">No prompts in this sequence.</p>`

      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;padding:4px 8px 6px">
          ${mkBtn('ps-new-stack', 'New Prompt Stack', '#3a7a3a', '#1e4a1e', '#9f9')}
          ${mkBtn('ps-edit-seq', 'Edit Sequence', '#555', '#333', '#ccc')}
        </div>
        ${rowDivider()}
        <table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
          ${row('Class',    node._dazStackClass || '')}
          ${row('Stack',    node._dazStackName || '')}
          ${row('Sequence', node._dazSeqName || '')}
          ${row('Prompts',  String(prompts.length))}
          ${rowPair('FPS', node._dazFpsWidget?.value, 'Frame Count', node._dazFrameCountWidget?.value)}
        </table>
        ${rowDivider()}
        ${promptsHtml}
      `

      wrap.querySelector('#ps-new-stack')?.addEventListener('click', () => doCreateStack(node))
      wrap.querySelector('#ps-edit-seq')?.addEventListener('click', () => openEditSequenceModal(node))
    }

    // ── Lifecycle hooks ─────────────────────────────────────────────────────

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)

      this._dazStackName  = null
      this._dazStackClass = ''
      this._dazSeqRaw     = '0'
      this._dazSeqName    = ''
      this._dazPrompts    = []
      this._dazAllStacks  = []

      const stackWidget = this.widgets?.find(w => w.name === 'stack')
      const seqWidget   = this.widgets?.find(w => w.name === 'sequence')
      this._dazSeqWidget        = seqWidget
      this._dazFpsWidget        = this.widgets?.find(w => w.name === 'fps')
      this._dazFrameCountWidget = this.widgets?.find(w => w.name === 'frame_count')

      if (stackWidget) stackWidget.label = 'Prompt Stack'
      if (seqWidget)   seqWidget.label   = 'Prompt Sequence'

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
  },
})
