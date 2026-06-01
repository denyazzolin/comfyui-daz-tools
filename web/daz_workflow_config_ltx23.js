import { app } from '../../scripts/app.js'

const PANEL_H      = 528
const EDIT_PANEL_H = 960
const NODE_W       = 460
const NODE_H       = 708
const NODE_H_EDIT  = 1150

app.registerExtension({
  name: 'daz.workflowConfigLtx23',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'WorkflowConfigLtx23') return

    const CLASS = 'ltx2.3'

    // Available config files in _mgr/ for this class
    let _configFiles = []  // [{file, name}]
    try {
      const r = await fetch(`/daz/config-files?class=${encodeURIComponent(CLASS)}`)
      if (r.ok) _configFiles = await r.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] WorkflowConfigLtx23: could not load config files', e)
    }

    // Initial configs for the default/first file
    let _initialConfigs = []
    try {
      const firstFile = _configFiles[0]?.file ?? null
      const url = firstFile
        ? `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}&file=${encodeURIComponent(firstFile)}`
        : `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}`
      const resp = await fetch(url)
      if (resp.ok) _initialConfigs = await resp.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] WorkflowConfigLtx23: could not load configs', e)
    }

    const folderFiles = {}
    async function getFolderFiles(folder) {
      if (folderFiles[folder]) return folderFiles[folder]
      try {
        const r = await fetch(`/daz/folder-files?folder=${encodeURIComponent(folder)}`)
        folderFiles[folder] = r.ok ? await r.json() : []
      } catch {
        folderFiles[folder] = []
      }
      return folderFiles[folder]
    }

    // ── Per-node config file helpers ──────────────────────────────────────────

    function currentFile(node) {
      return node._dazConfigFile || null
    }

    function configsUrl(node, base) {
      const f = currentFile(node)
      return f ? `${base}&file=${encodeURIComponent(f)}` : base
    }

    async function reloadNodeConfigs(node) {
      const url = configsUrl(node,
        `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}`)
      try {
        const r = await fetch(url)
        if (r.ok) node._dazAllConfigs = await r.json()
      } catch (e) {
        console.warn('[DAZ TOOLS] WorkflowConfigLtx23: could not reload configs', e)
      }
    }

    // ── Typed-object accessors (backward-compatible) ───────────────────────

    function fName(val)  { return (val && typeof val === 'object') ? (val.name  ?? '') : (val ?? '') }
    function fValue(val) { return (val && typeof val === 'object') ? (val.value ?? 0)  : (val ?? 0)  }
    function fText(val)  { return (val && typeof val === 'object') ? (val.text  ?? '') : (val ?? '') }
    function fPath(val)  { return (val && typeof val === 'object') ? (val.path  ?? '') : (val ?? '') }
    function fFile(val)  { return (val && typeof val === 'object') ? (val.file  ?? '') : (val ?? '') }
    function fType(val)  { return (val && typeof val === 'object') ? (val.type  ?? 'smart') : 'smart' }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function filteredLabels(configs, typeFilter, groupFilter) {
      let filtered = configs
      if (typeFilter && typeFilter !== 'All') filtered = filtered.filter(c => c.type === typeFilter)
      if (groupFilter && groupFilter !== 'All') filtered = filtered.filter(c => c.group === groupFilter)
      return filtered.map(c => c.label)
    }

    function updateGroupFilterWidget(node) {
      if (!node._dazGroupFilterWidget) return
      const configs    = node._dazAllConfigs || []
      const typeFilter = node._dazTypeFilter || 'All'
      const base       = typeFilter === 'All' ? configs : configs.filter(c => c.type === typeFilter)
      const groups     = ['All', ...Array.from(new Set(base.map(c => c.group).filter(Boolean))).sort()]
      node._dazGroupFilterWidget.options.values = groups
      if (!groups.includes(node._dazGroupFilter)) {
        node._dazGroupFilter = 'All'
        node._dazGroupFilterWidget.value = 'All'
      }
    }

    function syncWidget(node) {
      const configs = node._dazAllConfigs || []
      const labels  = filteredLabels(configs, node._dazTypeFilter || 'All', node._dazGroupFilter || 'All')
      const w = node.widgets?.find(w => w.name === 'config')
      if (!w) return
      w.options.values = labels.length ? labels : ['(no configs)']
      if (!labels.includes(w.value)) {
        w.value = labels[0] ?? '(no configs)'
      }
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    function row(label, value) {
      const v = value !== undefined && value !== '' && value !== 0
        ? `<span style="color:#ddd">${esc(value)}</span>`
        : `<span style="color:#555">—</span>`
      return `<tr>
        <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">${label}</td>
        <td colspan="3" style="color:#ddd;padding:3px 10px;word-break:break-all">${v}</td>
      </tr>`
    }

    function trunc(s, n = 60) {
      if (!s) return ''
      return s.length > n ? s.substring(0, n) + '…' : s
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

    function disp(s, maxLen) {
      if (s === undefined || s === null || s === '') return s
      const d = String(s).replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '')
      return maxLen && d.length > maxLen ? d.substring(0, maxLen - 1) + '…' : d
    }

    function dualClipDisp(n1, n2) {
      const a = disp(n1, 9)
      const b = disp(n2, 9)
      if (a && b) return `${a}/${b}`
      return a || b || ''
    }

    function loraEnabled(val) {
      if (val && typeof val === 'object') return val.enabled !== false
      return true
    }

    function rowPairLora(l1, lora1, l2, lora2, id1, id2) {
      function cell(lora, id) {
        const enabled = loraEnabled(lora)
        const name    = fName(lora)
        const d       = name ? disp(name, 16) : ''
        const chk     = `<input type="checkbox"${enabled ? ' checked' : ''}${id ? ` id="${id}"` : ''}
                          style="margin:0 4px 0 0;vertical-align:middle;cursor:pointer;flex-shrink:0">`
        const txt     = d
          ? `<span style="color:${enabled ? '#ddd' : '#666'}">${esc(d)}</span>`
          : `<span style="color:#555">—</span>`
        return `<div style="display:flex;align-items:center">${chk}${txt}</div>`
      }
      const tdL = 'style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:middle"'
      const tdV = 'style="padding:3px 10px;width:30%"'
      return `<tr>
        <td ${tdL}>${l1}</td><td ${tdV}>${cell(lora1, id1)}</td>
        <td ${tdL}>${l2}</td><td ${tdV}>${cell(lora2, id2)}</td>
      </tr>`
    }

    function renderDetailHtml(data) {
      if (data.error) {
        return `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">${esc(data.error)}</p>`
      }
      const imagePath = fPath(data.image_path)
      const imageCell = imagePath
        ? `<div style="display:flex;align-items:flex-start;gap:6px">
             <span style="color:#ddd;word-break:break-all;flex:1">${esc(imagePath)}</span>
             <button id="daz-use-preview-btn"
               style="font-family:monospace;font-size:12px;padding:2px 6px;background:#000000;color:#ffffff;
                      border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Preview</button>
           </div>`
        : `<span style="color:#555">—</span>`
      const typeLabel = data.type === 'I2V' ? 'I2V' : data.type === 'T2V' ? 'T2V' : 'No type'
      const loras = data.loras ?? {}
      return `<table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
        ${row('Group',       fName(data.group))}
        ${row('Type',        typeLabel)}
        ${row('Checkpoint',  disp(fName(data.checkpoint)))}
        ${row('Transformer', disp(fName(data.unet_high)))}
        ${row('Video VAE',   disp(fName(data.vae)))}
        ${row('Audio VAE',   disp(fName(data.audio_vae)))}
        ${row('CLIP 2',      disp(fName(data.clip_2)))}
        ${row('CLIP',        disp(fName(data.clip)))}
        <tr>
          <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Image</td>
          <td colspan="3" style="color:#ddd;padding:3px 10px">${imageCell}</td>
        </tr>
        ${rowPairLora('Distill LoRA', loras.lora_1, 'LoRA 2', loras.lora_2, 'daz-use-lora-1', 'daz-use-lora-2')}
        ${rowPairLora('LoRA 3',      loras.lora_3, 'LoRA 4', loras.lora_4, 'daz-use-lora-3', 'daz-use-lora-4')}
        ${rowPairLora('LoRA 5',      loras.lora_5, 'LoRA 6', loras.lora_6, 'daz-use-lora-5', 'daz-use-lora-6')}
        ${row('Resolution',  fValue(data.width) && fValue(data.height) ? `${fValue(data.width)} × ${fValue(data.height)}` : '')}
        ${rowPair('Steps',   fValue(data.steps), 'Seed', fValue(data.seed))}
        ${row('CFG',         fValue(data.cfg_high))}
        ${rowPair('Frames',  fValue(data.total_frames), 'FPS', fValue(data.fps))}
        ${row('Master',      trunc(fText(data.master_prompt)))}
        ${row('Positive',    trunc(fText(data.positive_prompt)))}
        ${row('Negative',    trunc(fText(data.negative_prompt)))}
        ${row('Filename',    fFile(data.filename))}
      </table>`
    }

    // ── Output labels ─────────────────────────────────────────────────────────

    function updateOutputLabels(node, data) {
      if (!node.outputs) return
      const ckpt  = fName(data.checkpoint)
      const loras = data.loras ?? {}
      const values = [
        ckpt, ckpt, ckpt,
        fName(data.unet_high),
        fName(data.vae), fName(data.audio_vae),
        dualClipDisp(fName(data.clip_2), fName(data.clip)),
        fPath(data.image_path),
        fValue(data.width), fValue(data.height), fValue(data.steps), fValue(data.seed),
        trunc(fText(data.master_prompt), 20), trunc(fText(data.positive_prompt), 20), trunc(fText(data.negative_prompt), 20),
        fType(data.positive_prompt),
        fValue(data.cfg_high),
        fValue(data.total_frames), fValue(data.fps),
        loraEnabled(loras.lora_1) ? fName(loras.lora_1) : '',
        loraEnabled(loras.lora_2) ? fName(loras.lora_2) : '',
        loraEnabled(loras.lora_3) ? fName(loras.lora_3) : '',
        loraEnabled(loras.lora_4) ? fName(loras.lora_4) : '',
        loraEnabled(loras.lora_5) ? fName(loras.lora_5) : '',
        loraEnabled(loras.lora_6) ? fName(loras.lora_6) : '',
        fFile(data.filename),
        fName(data.unet_high),
        ckpt,
      ]
      values.forEach((val, i) => {
        if (!node.outputs[i]) return
        const orig = node.outputs[i].name
        const d = (val !== undefined && val !== null && val !== '' && val !== 0)
          ? disp(String(val), 20) : 'none'
        node.outputs[i].label = `(${d}) ${orig}`
      })
    }

    // ── Use mode ──────────────────────────────────────────────────────────────

    function renderUseMode(node, data, wasEditing = false) {
      node._dazLtx23EditMode = false
      const wrap = node._dazLtx23Wrap
      if (!wrap) return

      wrap.style.height = PANEL_H + 'px'
      if (wasEditing) {
        node.size    = [NODE_W, NODE_H]
        node.minSize = [NODE_W, NODE_H]
      }

      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;padding:0 6px 4px">
          <button id="daz-new-btn"
            style="font-family:monospace;font-size:12px;padding:2px 10px;
                   background:#000000;color:#ffffff;border:1px solid #54af7b;
                   border-radius:3px;cursor:pointer">New</button>
          <button id="daz-edit-btn"
            style="font-family:monospace;font-size:12px;padding:2px 10px;
                   background:#000000;color:#ffffff;border:1px solid #666;
                   border-radius:3px;cursor:pointer">Edit</button>
        </div>
        ${renderDetailHtml(data)}
        <div style="padding:4px 8px 6px">
          <button id="daz-prompt-editor-btn"
            style="font-family:monospace;font-size:11px;padding:3px 10px;width:100%;
                   background:#000000;color:#ddd;border:1px solid #54af7b;
                   border-radius:3px;cursor:pointer">Prompt Editor</button>
        </div>
      `
      wrap.querySelector('#daz-new-btn')?.addEventListener('click', () => enterEditForm(node, true))
      wrap.querySelector('#daz-edit-btn')?.addEventListener('click', () => enterEditForm(node, false))
      wrap.querySelector('#daz-prompt-editor-btn')?.addEventListener('click', () => openPromptEditorFromUse(node))
      wrap.querySelector('#daz-use-preview-btn')?.addEventListener('click', () => {
        const imagePath = fPath(data.image_path)
        const filename  = imagePath.split(/[\\/]/).pop()
        if (filename) showImagePreview(filename)
      })

      const loraKeys = ['lora_1','lora_2','lora_3','lora_4','lora_5','lora_6']
      loraKeys.forEach((key, i) => {
        wrap.querySelector(`#daz-use-lora-${i + 1}`)?.addEventListener('change', async (e) => {
          const detail = node._dazLtx23Detail
          if (!detail) return
          if (!detail.loras) detail.loras = {}
          const val = detail.loras[key]
          if (val && typeof val === 'object') {
            val.enabled = e.target.checked
          } else {
            detail.loras[key] = { name: fName(val), enabled: e.target.checked, strength: 1.0 }
          }
          const span = e.target.nextElementSibling
          if (span) span.style.color = e.target.checked ? '#ddd' : '#666'
          updateOutputLabels(node, detail)
          node.setDirtyCanvas(true, true)
          const cw = node.widgets?.find(w => w.name === 'config')
          const label = cw?.value
          if (!label || label === '(no configs)') return
          try {
            const r = await fetch('/daz/workflow-config-save', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                label,
                class:    CLASS,
                file:     currentFile(node),
                new_name: detail.name || '',
                loras:    { [key]: detail.loras[key] },
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            await reloadNodeConfigs(node)
            syncWidget(node)
            if (cw) cw.value = result.label
          } catch (err) {
            console.warn('[DAZ TOOLS] WorkflowConfigLtx23: could not save lora enabled state', err)
          }
        })
      })

      updateOutputLabels(node, data)
      node.setDirtyCanvas(true, true)
    }

    async function loadDetail(node, label) {
      if (!node._dazLtx23Wrap) return
      if (node._dazLtx23EditMode) return
      if (!label || label === '(no configs)') {
        node._dazLtx23Wrap.innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Select a config to preview.</p>'
        return
      }
      node._dazLtx23Wrap.innerHTML =
        '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Loading…</p>'
      try {
        const url = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(label)}`)
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(resp.statusText)
        const data = await resp.json()
        node._dazLtx23Detail = data
        renderUseMode(node, data)
      } catch (e) {
        node._dazLtx23Wrap.innerHTML =
          `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">Error: ${esc(e.message)}</p>`
      }
      node.setDirtyCanvas(true, true)
    }

    // ── Edit / New-config form ────────────────────────────────────────────────

    async function enterEditForm(node, isNew = false) {
      node._dazLtx23EditMode = true
      const wrap = node._dazLtx23Wrap
      if (!wrap) return

      wrap.style.height = EDIT_PANEL_H + 'px'
      wrap.innerHTML = '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Loading…</p>'
      node.size    = [NODE_W, NODE_H_EDIT]
      node.minSize = [NODE_W, NODE_H_EDIT]
      node.setDirtyCanvas(true, true)

      const [checkpointFiles, unetFiles, vaeFiles, clipFiles, inputFiles, loraFiles] = await Promise.all([
        getFolderFiles('checkpoints'),
        getFolderFiles('diffusion_models'),
        getFolderFiles('vae'),
        getFolderFiles('text_encoders'),
        getFolderFiles('input'),
        getFolderFiles('loras'),
      ])

      const data  = isNew ? {} : (node._dazLtx23Detail || {})
      const loras = data.loras ?? {}
      const rawImagePath = fPath(data.image_path)
      const imageName    = rawImagePath.split(/[\\/]/).pop() || ''

      function selectOptsOpt(files, current) {
        return `<option value="">— none —</option>` + files.map(f =>
          `<option value="${esc(f)}"${f === current ? ' selected' : ''}>${esc(f)}</option>`
        ).join('')
      }

      function selectOptsImage(files, current) {
        return `<option value="">— no image —</option>` + files.map(f =>
          `<option value="${esc(f)}"${f === current ? ' selected' : ''}>${esc(f)}</option>`
        ).join('')
      }

      const fieldStyle = 'width:100%;background:#000;color:#ddd;border:1px solid #555;border-radius:7px;font-size:11px;font-family:monospace;padding:2px 6px;box-sizing:border-box'
      const numStyle   = 'width:80px;background:#000;color:#ddd;border:1px solid #555;border-radius:7px;font-size:11px;font-family:monospace;padding:2px 6px'
      const taStyle    = 'width:100%;background:#000;color:#ddd;border:1px solid #555;border-radius:7px;font-size:11px;font-family:monospace;padding:4px 6px;box-sizing:border-box;resize:vertical;min-height:58px'
      const tdL        = 'style="color:#999;padding:3px 8px;white-space:nowrap;vertical-align:middle;font-size:11px;font-family:monospace"'
      const tdLTop     = 'style="color:#999;padding:6px 8px 0;white-space:nowrap;vertical-align:top;font-size:11px;font-family:monospace"'
      const tdR        = 'colspan="3" style="padding:3px 8px"'
      const tdRNum     = 'style="padding:3px 8px"'
      const divider    = `<tr><td colspan="4" style="padding:2px 0"><div style="border-top:1px solid #ffffff;margin:0 8px"></div></td></tr>`
      const btnBase    = 'font-family:monospace;font-size:12px;padding:3px 12px;border-radius:3px;cursor:pointer;border:1px solid'

      const header = `<div style="font-family:monospace;font-size:12px;padding:5px 8px 6px;
                       color:#aaa;border-bottom:1px solid #3a3a3a;margin-bottom:4px">
             ${isNew ? 'New Configuration' : 'Edit Configuration'}
           </div>`

      const nameRow = `<tr>
             <td ${tdL}>Name</td>
             <td ${tdR}><input id="daz-config-name" type="text"
               value="${esc(isNew ? '' : (data.name || ''))}"
               placeholder="Config name…"
               style="${fieldStyle}"></td>
           </tr>
           <tr>
             <td ${tdL}>Group</td>
             <td ${tdR}><input id="daz-group" type="text"
               value="${esc(fName(data.group))}"
               placeholder="Optional group…"
               style="${fieldStyle}"></td>
           </tr>
           <tr>
             <td ${tdL}>Type</td>
             <td ${tdR}><select id="daz-type" style="${fieldStyle}">
               <option value=""${!data.type ? ' selected' : ''}>— no type —</option>
               <option value="I2V"${data.type === 'I2V' ? ' selected' : ''}>I2V</option>
               <option value="T2V"${data.type === 'T2V' ? ' selected' : ''}>T2V</option>
             </select></td>
           </tr>`

      const footer = isNew
        ? `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;
                       justify-content:flex-end;border-top:1px solid #3a3a3a;margin-top:4px">
             <span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace"></span>
             ${(node._dazAllConfigs || []).length > 0 ? `<button id="daz-cancel-btn" style="${btnBase} #666;background:#444;color:#ccc">Cancel</button>` : ''}
             <button id="daz-create-btn" style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Create</button>
           </div>`
        : `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;
                       border-top:1px solid #3a3a3a;margin-top:4px">
             <button id="daz-duplicate-btn" style="${btnBase} #555;background:#333;color:#ddd">Duplicate</button>
             <button id="daz-delete-btn"    style="${btnBase} #803030;background:#5c1a1a;color:#f99">Delete</button>
             <span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace;padding:0 4px"></span>
             <button id="daz-cancel-btn" style="${btnBase} #666;background:#444;color:#ccc">Cancel</button>
             <button id="daz-save-btn"   style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Save</button>
           </div>`

      function loraRow(label, key) {
        const lora = loras[key] ?? {}
        const n    = key.replace('lora_', '')
        return `<tr>
          <td ${tdL}>${label}</td>
          <td ${tdR}><div style="display:flex;align-items:center;gap:6px">
            <select id="daz-lora-${n}" style="${fieldStyle}">${selectOptsOpt(loraFiles, fName(lora))}</select>
            <input type="number" id="daz-lora-${n}-strength" step="0.01" min="0" value="${lora.strength ?? 1.0}" title="Strength" style="width:52px;flex-shrink:0;background:#1a1a2e;color:#ccc;border:1px solid #444;border-radius:3px;padding:2px 4px">
            <input type="checkbox" id="daz-lora-${n}-enabled"${loraEnabled(lora) ? ' checked' : ''} title="Enabled" style="flex-shrink:0;width:14px;height:14px;cursor:pointer;accent-color:#54af7b">
          </div></td>
        </tr>`
      }

      wrap.innerHTML = `
        ${header}
        <table style="border-collapse:collapse;width:100%">
          ${nameRow}
          ${divider}
          <tr>
            <td ${tdL}>Checkpoint</td>
            <td ${tdR}><select id="daz-checkpoint" style="${fieldStyle}">${selectOptsOpt(checkpointFiles, fName(data.checkpoint))}</select></td>
          </tr>
          <tr>
            <td ${tdL}>Transformer</td>
            <td ${tdR}><select id="daz-unet-high" style="${fieldStyle}">${selectOptsOpt(unetFiles, fName(data.unet_high))}</select></td>
          </tr>
          <tr>
            <td ${tdL}>Video VAE</td>
            <td ${tdR}><select id="daz-vae" style="${fieldStyle}">${selectOptsOpt(vaeFiles, fName(data.vae))}</select></td>
          </tr>
          <tr>
            <td ${tdL}>Audio VAE</td>
            <td ${tdR}><select id="daz-audio-vae" style="${fieldStyle}">${selectOptsOpt(vaeFiles, fName(data.audio_vae))}</select></td>
          </tr>
          <tr>
            <td ${tdL}>CLIP 2</td>
            <td ${tdR}><select id="daz-clip-2" style="${fieldStyle}">${selectOptsOpt(clipFiles, fName(data.clip_2))}</select></td>
          </tr>
          <tr>
            <td ${tdL}>CLIP</td>
            <td ${tdR}><select id="daz-clip" style="${fieldStyle}">${selectOptsOpt(clipFiles, fName(data.clip))}</select></td>
          </tr>
          <tr>
            <td ${tdL}>Image</td>
            <td ${tdR}>
              <div style="display:flex;gap:4px;align-items:center">
                <select id="daz-image-path" style="${fieldStyle}">${selectOptsImage(inputFiles, imageName)}</select>
                <button id="daz-preview-btn"
                  style="font-family:monospace;font-size:12px;padding:2px 7px;background:#000000;color:#ffffff;
                         border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Preview</button>
                <button id="daz-upload-btn"
                  style="font-family:monospace;font-size:12px;padding:2px 7px;background:#000000;color:#ffffff;
                         border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Upload…</button>
                <input id="daz-upload-input" type="file" accept="image/*" style="display:none">
              </div>
            </td>
          </tr>
          ${divider}
          ${loraRow('Distill LoRA', 'lora_1')}
          ${loraRow('LoRA 2',       'lora_2')}
          ${loraRow('LoRA 3',       'lora_3')}
          ${loraRow('LoRA 4',       'lora_4')}
          ${loraRow('LoRA 5',       'lora_5')}
          ${loraRow('LoRA 6',       'lora_6')}
          ${divider}
          <tr>
            <td ${tdL}>Width</td>
            <td ${tdRNum}><input id="daz-width" type="number" value="${fValue(data.width)}" style="${numStyle}"></td>
            <td ${tdL}>Height</td>
            <td ${tdRNum}><input id="daz-height" type="number" value="${fValue(data.height)}" style="${numStyle}"></td>
          </tr>
          <tr>
            <td ${tdL}>Steps</td>
            <td ${tdRNum}><input id="daz-steps" type="number" value="${fValue(data.steps)}" style="${numStyle}"></td>
            <td ${tdL}>Seed</td>
            <td ${tdRNum}><input id="daz-seed" type="number" value="${fValue(data.seed)}" style="${numStyle}"></td>
          </tr>
          <tr>
            <td ${tdL}>CFG</td>
            <td ${tdRNum}><input id="daz-cfg" type="number" step="0.1" value="${fValue(data.cfg_high)}" style="${numStyle}"></td>
            <td colspan="2"></td>
          </tr>
          <tr>
            <td ${tdL}>Frames</td>
            <td ${tdRNum}><input id="daz-total-frames" type="number" value="${fValue(data.total_frames)}" style="${numStyle}"></td>
            <td ${tdL}>FPS</td>
            <td ${tdRNum}><input id="daz-fps" type="number" step="0.01" value="${fValue(data.fps)}" style="${numStyle}"></td>
          </tr>
          ${divider}
          <tr>
            <td ${tdLTop}>Master Prompt</td>
            <td ${tdR}><textarea id="daz-master-prompt" style="${taStyle}">${esc(fText(data.master_prompt))}</textarea></td>
          </tr>
          <tr>
            <td ${tdLTop}>Positive Prompt</td>
            <td ${tdR}>
              <textarea id="daz-positive-prompt" style="${taStyle}">${esc(fText(data.positive_prompt))}</textarea>
              <input type="hidden" id="daz-positive-prompt-type" value="${esc(fType(data.positive_prompt))}">
            </td>
          </tr>
          <tr>
            <td ${tdLTop}>Negative Prompt</td>
            <td ${tdR}><textarea id="daz-negative-prompt" style="${taStyle}">${esc(fText(data.negative_prompt))}</textarea></td>
          </tr>
          <tr>
            <td colspan="4" style="padding:4px 8px 6px">
              <button id="daz-prompt-editor-btn"
                style="font-family:monospace;font-size:11px;padding:3px 10px;width:100%;
                       background:#000000;color:#ddd;border:1px solid #54af7b;
                       border-radius:3px;cursor:pointer">Prompt Editor</button>
            </td>
          </tr>
          ${divider}
          <tr>
            <td ${tdL}>Filename</td>
            <td ${tdR}><input id="daz-filename" type="text"
              value="${esc(fFile(data.filename))}"
              placeholder="subdir/output_name"
              style="${fieldStyle}"></td>
          </tr>
        </table>
        ${footer}
      `

      // ── Shared handlers ───────────────────────────────────────────────────

      wrap.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        if (e.target.tagName !== 'INPUT') return
        if (e.target.type === 'file' || e.target.type === 'hidden') return
        e.preventDefault()
        const focusable = Array.from(
          wrap.querySelectorAll('input:not([type=file]):not([type=hidden]), select, textarea')
        )
        const idx = focusable.indexOf(e.target)
        if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus()
      })

      wrap.querySelector('#daz-preview-btn')?.addEventListener('click', () => {
        const filename = wrap.querySelector('#daz-image-path')?.value
        if (filename) showImagePreview(filename)
      })

      wrap.querySelector('#daz-upload-btn')?.addEventListener('click', () => {
        wrap.querySelector('#daz-upload-input')?.click()
      })

      wrap.querySelector('#daz-upload-input')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        const btn    = wrap.querySelector('#daz-upload-btn')
        const errDiv = wrap.querySelector('#daz-save-error')
        btn.textContent = 'Uploading…'
        btn.disabled    = true
        errDiv.textContent = ''
        try {
          const fd = new FormData()
          fd.append('image', file)
          fd.append('type', 'input')
          const r = await fetch('/upload/image', { method: 'POST', body: fd })
          if (!r.ok) throw new Error(r.statusText)
          const result = await r.json()
          delete folderFiles['input']
          const fresh = await getFolderFiles('input')
          const sel = wrap.querySelector('#daz-image-path')
          if (sel) sel.innerHTML = selectOptsImage(fresh, result.name)
        } catch (err) {
          errDiv.textContent = `Upload failed: ${esc(err.message)}`
        }
        btn.textContent = 'Upload…'
        btn.disabled    = false
      })

      // ── Mode-specific handlers ────────────────────────────────────────────

      if (isNew) {
        wrap.querySelector('#daz-create-btn')?.addEventListener('click', () => createConfig(node, wrap))
        wrap.querySelector('#daz-cancel-btn')?.addEventListener('click', () => {
          renderUseMode(node, node._dazLtx23Detail || {}, true)
        })
      } else {
        wrap.querySelector('#daz-duplicate-btn')?.addEventListener('click', () => duplicateConfig(node, wrap))
        wrap.querySelector('#daz-cancel-btn')?.addEventListener('click', () => {
          renderUseMode(node, node._dazLtx23Detail || {}, true)
        })
        wrap.querySelector('#daz-delete-btn')?.addEventListener('click', () => {
          showDeleteConfirm(node, wrap)
        })
        wrap.querySelector('#daz-save-btn')?.addEventListener('click', () => saveConfig(node, wrap))
      }

      wrap.querySelector('#daz-prompt-editor-btn')?.addEventListener('click', () => {
        openPromptEditorFromEdit(node, wrap, isNew)
      })

      node.setDirtyCanvas(true, true)
    }

    // ── Prompt Editor integration ─────────────────────────────────────────────

    function openPromptEditorFromUse(node) {
      if (!window.DazPromptEditor) return
      window.DazPromptEditor.open({
        detail: node._dazLtx23Detail || {},
        onSave: async (updates) => {
          const cw    = node.widgets?.find(w => w.name === 'config')
          const label = cw?.value
          if (!label || label === '(no configs)') return
          const detail = node._dazLtx23Detail || {}
          try {
            const r = await fetch('/daz/workflow-config-save', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                label,
                class:           CLASS,
                file:            currentFile(node),
                new_name:        detail.name || '',
                master_prompt:   updates.master_prompt,
                positive_prompt: updates.positive_prompt,
                negative_prompt: updates.negative_prompt,
                total_frames:    updates.total_frames,
                fps:             updates.fps,
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            await reloadNodeConfigs(node)
            if (cw) cw.value = result.label
            syncWidget(node)
            const detailUrl = configsUrl(node,
              `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}`)
            const detailResp = await fetch(detailUrl)
            if (detailResp.ok) node._dazLtx23Detail = await detailResp.json()
            renderUseMode(node, node._dazLtx23Detail, false)
          } catch (err) {
            console.warn('[DAZ TOOLS] WorkflowConfigLtx23: prompt editor save failed', err)
          }
        },
      })
    }

    function openPromptEditorFromEdit(node, wrap, isNewConfig = false) {
      if (!window.DazPromptEditor) return
      const posType = wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart'
      window.DazPromptEditor.open({
        detail: {
          master_prompt:   { text: wrap.querySelector('#daz-master-prompt')?.value   ?? '' },
          positive_prompt: { text: wrap.querySelector('#daz-positive-prompt')?.value ?? '', type: posType },
          negative_prompt: { text: wrap.querySelector('#daz-negative-prompt')?.value ?? '' },
          total_frames:    { value: parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) },
          fps:             { value: parseFloat(wrap.querySelector('#daz-fps')?.value ?? '0') },
        },
        onSave: (updates) => {
          const masterTA = wrap.querySelector('#daz-master-prompt')
          if (masterTA) masterTA.value = updates.master_prompt.text
          const posTA = wrap.querySelector('#daz-positive-prompt')
          if (posTA) posTA.value = updates.positive_prompt.text
          const posTypeInput = wrap.querySelector('#daz-positive-prompt-type')
          if (posTypeInput) posTypeInput.value = updates.positive_prompt.type
          const negTA = wrap.querySelector('#daz-negative-prompt')
          if (negTA) negTA.value = updates.negative_prompt.text
          const framesInput = wrap.querySelector('#daz-total-frames')
          if (framesInput) framesInput.value = updates.total_frames.value
          const fpsInput = wrap.querySelector('#daz-fps')
          if (fpsInput) fpsInput.value = updates.fps.value
          if (!isNewConfig) saveConfig(node, wrap)
        },
      })
    }

    // ── Build payload ─────────────────────────────────────────────────────────

    function buildPayload(wrap) {
      const loraKeys = ['lora_1','lora_2','lora_3','lora_4','lora_5','lora_6']
      const loras = {}
      loraKeys.forEach(key => {
        const n = key.replace('lora_', '')
        loras[key] = {
          name:     wrap.querySelector(`#daz-lora-${n}`)?.value          ?? '',
          enabled:  wrap.querySelector(`#daz-lora-${n}-enabled`)?.checked ?? true,
          strength: parseFloat(wrap.querySelector(`#daz-lora-${n}-strength`)?.value ?? '1') || 1.0,
        }
      })
      return {
        checkpoint:      { name:  wrap.querySelector('#daz-checkpoint')?.value       ?? '' },
        unet_high:       { name:  wrap.querySelector('#daz-unet-high')?.value        ?? '' },
        vae:             { name:  wrap.querySelector('#daz-vae')?.value              ?? '' },
        audio_vae:       { name:  wrap.querySelector('#daz-audio-vae')?.value        ?? '' },
        clip_2:          { name:  wrap.querySelector('#daz-clip-2')?.value           ?? '' },
        clip:            { name:  wrap.querySelector('#daz-clip')?.value             ?? '' },
        image_path:      { path:  wrap.querySelector('#daz-image-path')?.value       ?? '' },
        loras,
        master_prompt:   { text:  wrap.querySelector('#daz-master-prompt')?.value    ?? '' },
        positive_prompt: {
          text: wrap.querySelector('#daz-positive-prompt')?.value  ?? '',
          type: wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart',
        },
        negative_prompt: { text:  wrap.querySelector('#daz-negative-prompt')?.value  ?? '' },
        filename:        { file:  wrap.querySelector('#daz-filename')?.value         ?? '' },
        width:           { value: parseInt(wrap.querySelector('#daz-width')?.value        ?? '0', 10) },
        height:          { value: parseInt(wrap.querySelector('#daz-height')?.value       ?? '0', 10) },
        steps:           { value: parseInt(wrap.querySelector('#daz-steps')?.value        ?? '0', 10) },
        seed:            { value: parseInt(wrap.querySelector('#daz-seed')?.value         ?? '0', 10) },
        cfg_high:        { value: parseFloat(wrap.querySelector('#daz-cfg')?.value        ?? '0') },
        total_frames:    { value: parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) },
        fps:             { value: parseFloat(wrap.querySelector('#daz-fps')?.value        ?? '0') },
      }
    }

    // ── Create new config ─────────────────────────────────────────────────────

    async function createConfig(node, wrap) {
      const nameInput = wrap.querySelector('#daz-config-name')
      const name      = nameInput?.value.trim() ?? ''
      const errDiv    = wrap.querySelector('#daz-save-error')

      if (!name) {
        if (errDiv) errDiv.textContent = 'Config name is required.'
        nameInput?.focus()
        return
      }

      const createBtn = wrap.querySelector('#daz-create-btn')
      createBtn.textContent = 'Creating…'
      createBtn.disabled    = true
      errDiv.textContent    = ''

      const payload = {
        name,
        class: CLASS,
        file:  currentFile(node),
        group: { name: wrap.querySelector('#daz-group')?.value ?? '' },
        type:  wrap.querySelector('#daz-type')?.value ?? '',
        ...buildPayload(wrap),
      }

      try {
        const r = await fetch('/daz/workflow-config-create', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        await reloadNodeConfigs(node)
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        node._dazTypeFilter = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        node._dazGroupFilter = 'All'
        syncWidget(node)
        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) configWidget.value = result.label

        const detailUrl = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}`)
        const detailResp = await fetch(detailUrl)
        if (detailResp.ok) node._dazLtx23Detail = await detailResp.json()

        renderUseMode(node, node._dazLtx23Detail || {}, true)
      } catch (e) {
        createBtn.textContent = 'Create'
        createBtn.disabled    = false
        errDiv.textContent    = `Error: ${e.message}`
      }
    }

    // ── Save existing config ──────────────────────────────────────────────────

    async function saveConfig(node, wrap) {
      const cw = node.widgets?.find(w => w.name === 'config')
      const label = cw?.value
      if (!label || label === '(no configs)') return

      const saveBtn  = wrap.querySelector('#daz-save-btn')
      const errorDiv = wrap.querySelector('#daz-save-error')

      const newName = wrap.querySelector('#daz-config-name')?.value.trim() ?? ''
      if (!newName) {
        errorDiv.textContent = 'Config name is required.'
        wrap.querySelector('#daz-config-name')?.focus()
        return
      }

      saveBtn.textContent = 'Saving…'
      saveBtn.disabled    = true
      errorDiv.textContent = ''

      const payload = {
        label,
        class:    CLASS,
        file:     currentFile(node),
        new_name: newName,
        group:    { name: wrap.querySelector('#daz-group')?.value ?? '' },
        type:     wrap.querySelector('#daz-type')?.value ?? '',
        ...buildPayload(wrap),
      }

      try {
        const r = await fetch('/daz/workflow-config-save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        await reloadNodeConfigs(node)
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        node._dazTypeFilter = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        node._dazGroupFilter = 'All'
        syncWidget(node)
        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) configWidget.value = result.label

        const detailUrl = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}`)
        const detailResp = await fetch(detailUrl)
        if (detailResp.ok) node._dazLtx23Detail = await detailResp.json()

        renderUseMode(node, node._dazLtx23Detail || {}, true)
      } catch (e) {
        saveBtn.textContent = 'Save'
        saveBtn.disabled    = false
        errorDiv.textContent = `Error: ${e.message}`
      }
    }

    // ── Duplicate config ──────────────────────────────────────────────────────

    async function duplicateConfig(node, wrap) {
      const data = node._dazLtx23Detail || {}
      const originalName = data.name || ''
      if (!originalName) return

      const newName = `Copy-${originalName}`
      const errDiv = wrap.querySelector('#daz-save-error')
      const dupBtn = wrap.querySelector('#daz-duplicate-btn')
      if (dupBtn) { dupBtn.textContent = 'Duplicating…'; dupBtn.disabled = true }
      if (errDiv) errDiv.textContent = ''

      const payload = {
        name:            newName,
        class:           CLASS,
        file:            currentFile(node),
        group:           data.group           ?? { name: '' },
        type:            data.type            ?? '',
        checkpoint:      data.checkpoint      ?? { name: '' },
        unet_high:       data.unet_high       ?? { name: '' },
        vae:             data.vae             ?? { name: '' },
        audio_vae:       data.audio_vae       ?? { name: '' },
        clip_2:          data.clip_2          ?? { name: '' },
        clip:            data.clip            ?? { name: '' },
        image_path:      data.image_path      ?? { path: '' },
        loras:           data.loras           ?? {},
        master_prompt:   data.master_prompt   ?? { text: '' },
        positive_prompt: data.positive_prompt ?? { text: '' },
        negative_prompt: data.negative_prompt ?? { text: '' },
        filename:        data.filename        ?? { file: '' },
        width:           data.width           ?? { value: 0 },
        height:          data.height          ?? { value: 0 },
        steps:           data.steps           ?? { value: 0 },
        seed:            data.seed            ?? { value: 0 },
        cfg_high:        data.cfg_high        ?? { value: 0 },
        total_frames:    data.total_frames    ?? { value: 0 },
        fps:             data.fps             ?? { value: 0 },
      }

      try {
        const r = await fetch('/daz/workflow-config-create', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        await reloadNodeConfigs(node)
        syncWidget(node)

        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) configWidget.value = result.label

        const detailUrl = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}`)
        const detailResp = await fetch(detailUrl)
        if (detailResp.ok) node._dazLtx23Detail = await detailResp.json()

        renderUseMode(node, node._dazLtx23Detail || {}, true)
      } catch (e) {
        if (dupBtn) { dupBtn.textContent = 'Duplicate'; dupBtn.disabled = false }
        if (errDiv) errDiv.textContent = `Duplicate failed: ${e.message}`
      }
    }

    // ── Delete config ─────────────────────────────────────────────────────────

    function showDeleteConfirm(node, wrap) {
      const name  = node._dazLtx23Detail?.name || '?'
      const cw    = node.widgets?.find(w => w.name === 'config')
      const label = cw?.value || ''

      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;top:0;left:0;right:0;bottom:0',
        'background:rgba(0,0,0,0.75);z-index:10000',
        'display:flex;align-items:center;justify-content:center',
      ].join(';')

      const box = document.createElement('div')
      box.style.cssText = [
        'background:#2a2a2a;border:1px solid #555;border-radius:6px',
        'padding:20px 24px;width:340px;font-family:monospace',
      ].join(';')
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 6px">
          Delete &ldquo;${esc(name)}&rdquo;?
        </p>
        <p style="font-size:11px;color:#888;margin:0 0 18px">This cannot be undone.</p>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="dc-keep"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Keep</button>
          <button id="dc-confirm"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#5c1a1a;color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer">Delete</button>
        </div>
      `

      overlay.appendChild(box)
      document.body.appendChild(overlay)
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
      box.querySelector('#dc-keep')?.addEventListener('click',    () => overlay.remove())
      box.querySelector('#dc-confirm')?.addEventListener('click', () => {
        overlay.remove()
        deleteConfig(node, label)
      })
    }

    async function deleteConfig(node, label) {
      const wrap = node._dazLtx23Wrap
      if (wrap) {
        wrap.innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Deleting…</p>'
      }

      try {
        const r = await fetch('/daz/workflow-config-delete', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ label, class: CLASS, file: currentFile(node) }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        await reloadNodeConfigs(node)
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        node._dazTypeFilter = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        node._dazGroupFilter = 'All'
        syncWidget(node)
        const configWidget = node.widgets?.find(w => w.name === 'config')
        const remainingLabels = filteredLabels(node._dazAllConfigs || [], 'All', 'All')

        if (remainingLabels.length > 0) {
          if (configWidget) configWidget.value = remainingLabels[0]
          node._dazLtx23EditMode = false
          loadDetail(node, remainingLabels[0])
        } else {
          if (configWidget) {
            configWidget.options.values = ['(no configs)']
            configWidget.value = '(no configs)'
          }
          node._dazLtx23Detail   = {}
          node._dazLtx23EditMode = false
          enterEditForm(node, true)
        }
      } catch (e) {
        if (wrap) {
          wrap.innerHTML = `
            <p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">
              Delete failed: ${esc(e.message)}
            </p>
            <div style="padding:0 8px 8px;display:flex;justify-content:flex-end">
              <button id="daz-back-edit"
                style="font-family:monospace;font-size:11px;padding:3px 10px;background:#444;color:#ccc;
                       border:1px solid #666;border-radius:3px;cursor:pointer">Back</button>
            </div>`
          wrap.querySelector('#daz-back-edit')?.addEventListener('click', () => {
            node._dazLtx23EditMode = false
            enterEditForm(node, false)
          })
        }
      }
    }

    // ── Image preview modal ───────────────────────────────────────────────────

    function showImagePreview(filename) {
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;top:0;left:0;right:0;bottom:0',
        'background:rgba(0,0,0,0.88);z-index:10000',
        'display:flex;align-items:center;justify-content:center;cursor:pointer',
      ].join(';')

      const img = document.createElement('img')
      img.src = `/view?filename=${encodeURIComponent(filename)}&type=input`
      img.style.cssText =
        'max-width:90vw;max-height:90vh;border-radius:4px;box-shadow:0 4px 32px rgba(0,0,0,0.9);cursor:default'
      img.addEventListener('click', e => e.stopPropagation())

      overlay.appendChild(img)
      document.body.appendChild(overlay)
      overlay.addEventListener('click', () => overlay.remove())
    }

    // ── Lifecycle hooks ───────────────────────────────────────────────────────

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)

      // Per-node state
      this._dazAllConfigs  = _initialConfigs.slice()
      this._dazConfigFile  = _configFiles[0]?.file ?? null
      this._dazTypeFilter  = 'All'
      this._dazGroupFilter = 'All'

      // ── config_file picker widget (from INPUT_TYPES) ──────────────────────
      const cfWidget = this.widgets?.find(w => w.name === 'config_file')
      if (cfWidget) {
        if (_configFiles.length > 0) {
          cfWidget.options.values = _configFiles.map(f => f.file)
          cfWidget.value          = _configFiles[0].file
        }
        cfWidget.hidden = _configFiles.length <= 1

        this._dazConfigFileWidget = cfWidget
        const origCfCb = cfWidget.callback
        cfWidget.callback = async (value) => {
          origCfCb?.call(this, value)
          this._dazConfigFile = value === '(default)' ? null : value
          await reloadNodeConfigs(this)
          this._dazTypeFilter  = 'All'
          this._dazGroupFilter = 'All'
          if (this._dazTypeFilterWidget)  this._dazTypeFilterWidget.value  = 'All'
          if (this._dazGroupFilterWidget) this._dazGroupFilterWidget.value = 'All'
          updateGroupFilterWidget(this)
          syncWidget(this)
          if (!this._dazLtx23EditMode) {
            const cw = this.widgets?.find(w => w.name === 'config')
            if (cw) loadDetail(this, cw.value)
          }
        }
      }

      // ── Type / Group filter widgets ───────────────────────────────────────
      const typeFilterWidget = this.addWidget('combo', 'Type', 'All', (value) => {
        this._dazTypeFilter = value
        updateGroupFilterWidget(this)
        syncWidget(this)
        if (!this._dazLtx23EditMode) {
          const cw = this.widgets?.find(w => w.name === 'config')
          if (cw && cw.value !== '(no configs)') loadDetail(this, cw.value)
        }
      }, { values: ['All', 'I2V', 'T2V'] })
      this._dazTypeFilterWidget = typeFilterWidget

      const initialGroups = ['All', ...Array.from(new Set(_initialConfigs.map(c => c.group).filter(Boolean))).sort()]
      const groupFilterWidget = this.addWidget('combo', 'Group', 'All', (value) => {
        this._dazGroupFilter = value
        syncWidget(this)
        if (!this._dazLtx23EditMode) {
          const cw = this.widgets?.find(w => w.name === 'config')
          if (cw && cw.value !== '(no configs)') loadDetail(this, cw.value)
        }
      }, { values: initialGroups })
      this._dazGroupFilterWidget = groupFilterWidget

      // Reposition Type/Group filters before the config widget
      const ci = this.widgets.findIndex(w => w.name === 'config')
      if (ci >= 0) {
        [typeFilterWidget, groupFilterWidget].forEach(fw => {
          const fi = this.widgets.indexOf(fw)
          const currentCi = this.widgets.findIndex(w => w.name === 'config')
          if (fi > currentCi) {
            this.widgets.splice(fi, 1)
            this.widgets.splice(currentCi, 0, fw)
          }
        })
      }

      syncWidget(this)

      this.addWidget('button', '↺  Reload Configs', null, async () => {
        try {
          const fr = await fetch(`/daz/config-files?class=${encodeURIComponent(CLASS)}`)
          if (fr.ok) {
            _configFiles = await fr.json()
            if (cfWidget) {
              cfWidget.options.values = _configFiles.length > 0
                ? _configFiles.map(f => f.file)
                : ['(default)']
              cfWidget.hidden = _configFiles.length <= 1
              if (_configFiles.length > 0 && !_configFiles.find(f => f.file === cfWidget.value)) {
                cfWidget.value      = _configFiles[0].file
                this._dazConfigFile = _configFiles[0].file
              }
            }
          }
          await reloadNodeConfigs(this)
          updateGroupFilterWidget(this)
          syncWidget(this)
          if (this._dazLtx23EditMode) return
          const labels = filteredLabels(this._dazAllConfigs || [], this._dazTypeFilter || 'All', this._dazGroupFilter || 'All')
          if (!labels.length) {
            enterEditForm(this, true)
            return
          }
          const cw = this.widgets?.find(w => w.name === 'config')
          if (cw) loadDetail(this, cw.value)
        } catch (e) {
          console.warn('[DAZ TOOLS] WorkflowConfigLtx23: reload failed', e)
        }
      })

      const wrap = document.createElement('div')
      wrap.style.cssText =
        `box-sizing:border-box;padding:6px 0;overflow-y:auto;overflow-x:hidden;width:100%;height:${PANEL_H}px`
      this._dazLtx23Wrap     = wrap
      this._dazLtx23EditMode = false

      const self = this
      this.addDOMWidget('daz_ltx23_detail', 'html', wrap, {
        getValue:     () => '',
        setValue:     () => {},
        getMinHeight: () => self._dazLtx23EditMode ? EDIT_PANEL_H : PANEL_H,
        hideOnZoom:   false,
      })

      this.size    = [NODE_W, NODE_H]
      this.minSize = [NODE_W, NODE_H]

      const w = this.widgets?.find(w => w.name === 'config')
      if (w) {
        const origCb = w.callback
        w.callback = (value) => {
          origCb?.call(this, value)
          if (!this._dazLtx23EditMode) loadDetail(this, value)
        }
        if ((this._dazAllConfigs || []).length === 0) {
          enterEditForm(this, true)
        } else {
          loadDetail(this, w.value)
        }
      }
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments)
      const self = this
      queueMicrotask(async () => {
        // Restore the selected config file from the saved widget value, then reload its configs
        if (self._dazConfigFileWidget) {
          const savedFile = self._dazConfigFileWidget.value
          self._dazConfigFile = (!savedFile || savedFile === '(default)') ? null : savedFile
          if (self._dazConfigFile !== null) reloadNodeConfigs(self)
        }
        if (self._dazTypeFilterWidget)  self._dazTypeFilter  = self._dazTypeFilterWidget.value  || 'All'
        if (self._dazGroupFilterWidget) self._dazGroupFilter = self._dazGroupFilterWidget.value || 'All'
        updateGroupFilterWidget(self)
        if (!(self._dazAllConfigs || []).length) {
          if (!self._dazLtx23EditMode) enterEditForm(self, true)
          return
        }
        const w = self.widgets?.find(w => w.name === 'config')
        const labels = filteredLabels(self._dazAllConfigs || [], self._dazTypeFilter, self._dazGroupFilter)
        if (w && !labels.includes(w.value)) syncWidget(self)
        if (!self._dazLtx23EditMode) loadDetail(self, w?.value)
      })
    }
  },
})
