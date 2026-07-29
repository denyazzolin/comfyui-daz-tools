// Full CRUD panel for the "Prompt Stack Manager" node.
// Self-contained (not folded into daz_workflow_config_shared.js, whose ~3500
// lines are built around the models/dims/loras WorkflowConfig schema).

import { app } from '../../scripts/app.js'

const MAX_PROMPTS = 10
const PANEL_H = 320
const NODE_W  = 340
const NODE_H  = 480

const TA_STYLE =
  'box-sizing:border-box;width:100%;background:#000;color:#ddd;' +
  'border:1px solid #444;border-radius:4px;font-family:monospace;' +
  'font-size:11px;padding:4px 6px;resize:vertical'

const VALID_PROMPT_TYPES = ['smart', 'beats', 'simple', 'timecode']

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
    ${fields.map(f => `
      <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">${esc(f.label)}</label>
      <input id="sf-${f.id}" type="text" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"
        style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
               border-radius:4px;font-family:monospace;font-size:11px;padding:4px 6px;margin-bottom:10px">
    `).join('')}
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

    async function reloadStackWidget(node) {
      const w = node.widgets?.find(w => w.name === 'stack')
      if (!w) return
      try {
        const r = await fetch('/daz/prompt-stack-list')
        const labels = r.ok ? await r.json() : []
        w.options.values = labels.length ? labels : ['(no prompt stacks)']
        if (!labels.includes(w.value)) w.value = labels[0] ?? '(no prompt stacks)'
      } catch (e) {
        console.warn('[DAZ TOOLS] PromptStackManager: could not reload stack list', e)
      }
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
        out.label = (p && p.label) ? p.label : `prompt_${i + 1}`
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

    // ── Per-prompt edit modal ─────────────────────────────────────────────

    function openRowEditor(node, idx) {
      const prompts = node._dazPrompts || []
      const p = prompts[idx] || emptyPrompt()
      const posType   = VALID_PROMPT_TYPES.includes(p.positive_prompt?.type) ? p.positive_prompt.type : 'smart'
      const masterPos = p.master_prompt?.position === 'after' ? 'after' : 'before'

      const { box, close } = overlayShell(480)
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 10px">Edit prompt ${idx + 1}</p>
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
        const list = (node._dazPrompts || []).slice()
        list[idx] = updated
        node._dazPrompts = list
        close()
        renderPanel(node)
        updateOutputLabels(node, node._dazPrompts)
      })
    }

    // ── CRUD actions ────────────────────────────────────────────────────────

    async function refreshAfterStackChange(node, selectLabel, selectSeqRaw) {
      await reloadStackWidget(node)
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (selectLabel && sw) sw.value = selectLabel
      const label = sw?.value
      await reloadSequenceWidget(node, label, selectSeqRaw)
      await loadDetail(node, label, node._dazSeqWidget?.value)
    }

    function doCreateStack(node) {
      smallFormModal('New Prompt Stack', [
        { id: 'name', label: 'Name' },
        { id: 'class', label: 'Class (optional)' },
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

    function doRenameStack(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)') return
      smallFormModal('Rename Stack', [
        { id: 'name', label: 'New name', value: node._dazStackName || '' },
        { id: 'class', label: 'Class', value: node._dazStackClass || '' },
      ], 'Rename', async (values) => {
        const newName = values.name.trim()
        if (!newName) throw new Error('Name is required.')
        const r = await fetch('/daz/prompt-stack-save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: sw.value, sequence: node._dazSeqRaw, sequence_name: node._dazSeqName,
            prompts: node._dazPrompts || [], save_mode: 'current',
            new_name: newName, class: values.class,
            fps: node._dazFpsWidget?.value, frame_count: node._dazFrameCountWidget?.value,
          }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)
        await refreshAfterStackChange(node, result.label, result.sequence)
      })
    }

    function doDuplicateStack(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)') return
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
        await refreshAfterStackChange(node, result.label, result.sequence)
      })
    }

    function doDeleteStack(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)') return
      confirmModal(
        `Delete stack "${node._dazStackName || sw.value}" and all its sequences? This cannot be undone.`,
        'Delete',
        async () => {
          const r = await fetch('/daz/prompt-stack-delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: sw.value, delete_mode: 'stack' }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)
          await refreshAfterStackChange(node, null, null)
        },
      )
    }

    function doNewSequence(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)') return
      smallFormModal('New Sequence', [
        { id: 'name', label: 'Sequence name', placeholder: 'e.g. v2' },
      ], 'Create', async (values) => {
        const r = await fetch('/daz/prompt-stack-save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: sw.value, sequence_name: values.name.trim(),
            prompts: node._dazPrompts || [], save_mode: 'new_sequence',
          }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)
        await reloadSequenceWidget(node, sw.value, result.sequence)
        await loadDetail(node, sw.value, node._dazSeqWidget?.value)
      })
    }

    function doDeleteSequence(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)') return
      confirmModal(
        `Delete sequence "${node._dazSeqName || node._dazSeqRaw}"? This cannot be undone.`,
        'Delete',
        async () => {
          const r = await fetch('/daz/prompt-stack-delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: sw.value, sequence: node._dazSeqRaw, delete_mode: 'sequence' }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)
          if (result.stack_deleted) {
            await refreshAfterStackChange(node, null, null)
          } else {
            await reloadSequenceWidget(node, sw.value)
            await loadDetail(node, sw.value, node._dazSeqWidget?.value)
          }
        },
      )
    }

    async function doSaveSequence(node) {
      const sw = node.widgets?.find(w => w.name === 'stack')
      if (!sw || sw.value === '(no prompt stacks)') return
      try {
        const r = await fetch('/daz/prompt-stack-save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: sw.value, sequence: node._dazSeqRaw, sequence_name: node._dazSeqName,
            prompts: node._dazPrompts || [], save_mode: 'current',
            fps: node._dazFpsWidget?.value, frame_count: node._dazFrameCountWidget?.value,
          }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)
        await refreshAfterStackChange(node, result.label, result.sequence)
      } catch (e) {
        console.warn('[DAZ TOOLS] PromptStackManager: save failed', e)
        alert(`Save failed: ${e.message}`)
      }
    }

    // ── Panel render ────────────────────────────────────────────────────────

    function renderPanel(node) {
      const wrap = node._dazWrap
      if (!wrap) return
      const prompts  = node._dazPrompts || []
      const hasStack = !!node._dazStackName

      if (!hasStack) {
        wrap.innerHTML = `
          <div style="padding:10px;font-family:monospace;font-size:11px;color:#888;text-align:center">
            No prompt stack selected.<br><br>
            ${mkBtn('ps-new-stack', '+ New Stack', '#3a7a3a', '#1e4a1e', '#9f9')}
          </div>`
        wrap.querySelector('#ps-new-stack')?.addEventListener('click', () => doCreateStack(node))
        return
      }

      const rowsHtml = prompts.map((p, i) => `
        <div style="display:flex;align-items:center;gap:6px;padding:3px 8px">
          <span style="color:#666;font-size:10px;width:14px">${i + 1}</span>
          <input data-idx="${i}" class="ps-label" type="text" value="${esc(p.label || '')}" placeholder="label"
            style="flex:1;box-sizing:border-box;background:#000;color:#ddd;border:1px solid #444;
                   border-radius:3px;font-family:monospace;font-size:11px;padding:3px 5px">
          ${mkBtn(`ps-edit-${i}`, 'Edit', '#555', '#333', '#ccc')}
          ${mkBtn(`ps-del-${i}`, '✕', '#663333', '#3a1e1e', '#e88')}
        </div>`).join('')

      wrap.innerHTML = `
        <div style="padding:0 8px 6px;font-size:10px;color:#777">
          Class: ${esc(node._dazStackClass || '(none)')}
        </div>
        <div style="padding:0 8px 6px">
          <label style="display:block;font-size:10px;color:#888;margin-bottom:2px">Sequence name</label>
          <input id="ps-seq-name" type="text" value="${esc(node._dazSeqName || '')}"
            style="box-sizing:border-box;width:100%;background:#000;color:#ddd;border:1px solid #444;
                   border-radius:3px;font-family:monospace;font-size:11px;padding:3px 5px">
        </div>
        <div style="border-top:1px solid #444;border-bottom:1px solid #444">
          ${rowsHtml || '<p style="padding:6px 8px;color:#666;font-size:11px">No prompts yet.</p>'}
        </div>
        <div style="padding:6px 8px;display:flex;gap:6px">
          ${mkBtn('ps-add', '+ Prompt', '#3a5a7a', '#1e2e4a', '#9cf', prompts.length >= MAX_PROMPTS)}
        </div>
        <div style="padding:6px 8px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid #444">
          ${mkBtn('ps-new-stack', 'New Stack', '#555', '#333', '#ccc')}
          ${mkBtn('ps-rename-stack', 'Rename Stack', '#555', '#333', '#ccc')}
          ${mkBtn('ps-dup-stack', 'Duplicate Stack', '#555', '#333', '#ccc')}
          ${mkBtn('ps-del-stack', 'Delete Stack', '#663333', '#3a1e1e', '#e88')}
        </div>
        <div style="padding:6px 8px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid #444">
          ${mkBtn('ps-new-seq', 'New Sequence', '#555', '#333', '#ccc')}
          ${mkBtn('ps-del-seq', 'Delete Sequence', '#663333', '#3a1e1e', '#e88')}
          ${mkBtn('ps-save', 'Save', '#3a7a3a', '#1e4a1e', '#9f9')}
        </div>`

      wrap.querySelectorAll('.ps-label').forEach(inp => {
        inp.addEventListener('change', () => {
          const idx  = Number(inp.dataset.idx)
          const list = (node._dazPrompts || []).slice()
          if (list[idx]) list[idx] = { ...list[idx], label: inp.value }
          node._dazPrompts = list
          updateOutputLabels(node, node._dazPrompts)
        })
      })
      prompts.forEach((_, i) => {
        wrap.querySelector(`#ps-edit-${i}`)?.addEventListener('click', () => openRowEditor(node, i))
        wrap.querySelector(`#ps-del-${i}`)?.addEventListener('click', () => {
          const list = (node._dazPrompts || []).slice()
          list.splice(i, 1)
          node._dazPrompts = list
          renderPanel(node)
          updateOutputLabels(node, node._dazPrompts)
        })
      })
      wrap.querySelector('#ps-seq-name')?.addEventListener('change', (e) => {
        node._dazSeqName = e.target.value
      })
      wrap.querySelector('#ps-add')?.addEventListener('click', () => {
        if ((node._dazPrompts || []).length >= MAX_PROMPTS) return
        const list = (node._dazPrompts || []).slice()
        list.push(emptyPrompt())
        node._dazPrompts = list
        renderPanel(node)
        updateOutputLabels(node, node._dazPrompts)
      })
      wrap.querySelector('#ps-new-stack')?.addEventListener('click', () => doCreateStack(node))
      wrap.querySelector('#ps-rename-stack')?.addEventListener('click', () => doRenameStack(node))
      wrap.querySelector('#ps-dup-stack')?.addEventListener('click', () => doDuplicateStack(node))
      wrap.querySelector('#ps-del-stack')?.addEventListener('click', () => doDeleteStack(node))
      wrap.querySelector('#ps-new-seq')?.addEventListener('click', () => doNewSequence(node))
      wrap.querySelector('#ps-del-seq')?.addEventListener('click', () => doDeleteSequence(node))
      wrap.querySelector('#ps-save')?.addEventListener('click', () => doSaveSequence(node))
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

      const stackWidget = this.widgets?.find(w => w.name === 'stack')
      const seqWidget   = this.widgets?.find(w => w.name === 'sequence')
      this._dazSeqWidget        = seqWidget
      this._dazFpsWidget        = this.widgets?.find(w => w.name === 'fps')
      this._dazFrameCountWidget = this.widgets?.find(w => w.name === 'frame_count')

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

      this.addDOMWidget('promptStackPanel', 'html', wrap, {
        getValue:     () => '',
        setValue:     () => {},
        getMinHeight: () => PANEL_H,
        hideOnZoom:   false,
      })

      this.addWidget('button', '↺  Reload Stacks', null, async () => {
        await reloadStackWidget(this)
        const sw = this.widgets?.find(w => w.name === 'stack')
        await reloadSequenceWidget(this, sw?.value)
        await loadDetail(this, sw?.value, this._dazSeqWidget?.value)
      })

      this.size    = [NODE_W, NODE_H]
      this.minSize = [NODE_W, NODE_H]

      if (stackWidget && stackWidget.value !== '(no prompt stacks)') {
        reloadSequenceWidget(this, stackWidget.value).then(() => {
          loadDetail(this, stackWidget.value, this._dazSeqWidget?.value)
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
