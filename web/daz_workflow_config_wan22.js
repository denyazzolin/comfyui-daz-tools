import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'

const PANEL_H = 578
const NODE_W  = 460
const NODE_H  = 790

app.registerExtension({
  name: 'daz.workflowConfigWan22',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'WorkflowConfigWan22') return

    const CLASS = 'Wan2.2'

    let _configFiles = []
    try {
      const r = await fetch(`/daz/config-files?class=${encodeURIComponent(CLASS)}`)
      if (r.ok) _configFiles = await r.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not load config files', e)
    }

    let _initialConfigs = []
    try {
      const firstFile = _configFiles[0]?.file ?? null
      const url = firstFile
        ? `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}&file=${encodeURIComponent(firstFile)}`
        : `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}`
      const resp = await fetch(url)
      if (resp.ok) _initialConfigs = await resp.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not load configs', e)
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
        console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not reload configs', e)
      }
    }

    async function reloadVersionWidget(node, configLabel, selectVersion = null) {
      const vw = node._dazVersionWidget
      if (!vw) return
      if (!configLabel || configLabel === '(no configs)') {
        vw.options.values = ['1']
        vw.value = '1'
        node._dazCurrentVersion = '1'
        return
      }
      const gen = (node._dazVersionReloadGen = (node._dazVersionReloadGen || 0) + 1)
      try {
        const url = configsUrl(node,
          `/daz/workflow-config-versions?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(configLabel)}`)
        const r = await fetch(url)
        if (!r.ok) return
        const versions = await r.json()
        if (gen !== node._dazVersionReloadGen) return
        if (versions.error) return
        const vList = versions.map(v => v.version).filter(Boolean)
        vw.options.values = vList.length ? vList : ['1']
        if (selectVersion && vList.includes(selectVersion)) {
          vw.value = selectVersion
        } else if (!vList.includes(vw.value)) {
          vw.value = vList[vList.length - 1] ?? '1'
        }
        node._dazCurrentVersion = vw.value
      } catch (e) {
        console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not reload versions', e)
      }
    }

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

    // ── Schema v1 typed-object accessors ──────────────────────────────────────
    function fName(val)  { return (val && typeof val === 'object') ? (val.name  ?? '') : (val ?? '') }
    function fValue(val) { return (val && typeof val === 'object') ? (val.value ?? 0)  : (val ?? 0)  }
    function fText(val)  { return (val && typeof val === 'object') ? (val.text  ?? '') : (val ?? '') }
    function fPath(val)  { return (val && typeof val === 'object') ? (val.path  ?? '') : (val ?? '') }
    function fFile(val)  { return (val && typeof val === 'object') ? (val.file  ?? '') : (val ?? '') }
    function fType(val)       { return (val && typeof val === 'object') ? (val.type      ?? 'smart') : 'smart'  }
    function fRandomize(val)  { return (val && typeof val === 'object') ? (val.randomize === true)   : false    }
    function fFlagLabel(val, def = '') { return (val && typeof val === 'object') ? (val.label ?? def) : def     }
    function fFlagValue(val)           { return (val && typeof val === 'object') ? (val.value === true) : false }
    function fNote(val)                { return (val && typeof val === 'object') ? (val.value ?? '')    : ''    }

    function rowNote(text) {
      if (!text) return `<tr>
        <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Note</td>
        <td colspan="3" style="padding:3px 10px"><span style="color:#555">—</span></td>
      </tr>`
      const lines   = text.split('\n')
      const display = lines.length > 4 ? lines.slice(0, 4).join('\n') + '…' : text.trimEnd()
      return `<tr>
        <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Note</td>
        <td colspan="3" style="padding:3px 10px">
          <span style="color:#ddd;white-space:pre-wrap;word-break:break-word">${esc(display)}</span>
        </td>
      </tr>`
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

    function loraName(val) {
      if (val && typeof val === 'object') return val.name ?? ''
      return val ?? ''
    }

    function loraEnabled(val) {
      if (val && typeof val === 'object') return val.enabled !== false
      return true
    }

    function rowPairLora(l1, lora1, l2, lora2, id1, id2) {
      function cell(lora, id) {
        const enabled = loraEnabled(lora)
        const name    = loraName(lora)
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
      const loras    = data.loras ?? {}
      const imagePath = fPath(data.image_path)
      const imageCell = imagePath
        ? `<div style="display:flex;align-items:flex-start;gap:6px">
             <span style="color:#ddd;word-break:break-all;flex:1">${esc(imagePath)}</span>
             <button id="daz-use-preview-btn"
               style="font-family:monospace;font-size:12px;padding:2px 6px;background:#000000;color:#ffffff;
                      border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Preview</button>
           </div>`
        : `<span style="color:#555">—</span>`
      const typeLabel = data.type === 'I2V' ? 'I2V' : data.type === 'T2V' ? 'T2V' : data.type === 'MULTI' ? 'MULTI' : 'No type'
      return `<table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
        ${row('Group',      fName(data.group))}
        ${row('Type',       typeLabel)}
        ${rowNote(fNote(data.note))}
        ${row('UNet High',  disp(fName(data.unet_high)))}
        ${row('UNet Low',   disp(fName(data.unet_low)))}
        ${row('VAE',        disp(fName(data.vae)))}
        ${row('CLIP',       disp(fName(data.clip)))}
        <tr>
          <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Image</td>
          <td colspan="3" style="color:#ddd;padding:3px 10px">${imageCell}</td>
        </tr>
        ${rowPairLora('LoRA 1 High', loras.lora_1, 'LoRA 1 Low', loras.lora_2, 'daz-use-lora-1', 'daz-use-lora-2')}
        ${rowPairLora('LoRA 2 High', loras.lora_3, 'LoRA 2 Low', loras.lora_4, 'daz-use-lora-3', 'daz-use-lora-4')}
        ${rowPairLora('LoRA 3 High', loras.lora_5, 'LoRA 3 Low', loras.lora_6, 'daz-use-lora-5', 'daz-use-lora-6')}
        ${rowPairLora('LoRA 4 High', loras.lora_7, 'LoRA 4 Low', loras.lora_8, 'daz-use-lora-7', 'daz-use-lora-8')}
        ${row('Resolution',  fValue(data.width) && fValue(data.height) ? `${fValue(data.width)} × ${fValue(data.height)}` : '')}
        ${rowPair('Steps',    fValue(data.steps),       'Split Step', fValue(data.split_step))}
        <tr>
          <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Seed</td>
          <td colspan="3" style="padding:3px 10px">
            <div style="display:flex;align-items:center;gap:6px">
              ${fValue(data.seed) ? `<span style="color:#ddd">${esc(String(fValue(data.seed)))}</span>` : '<span style="color:#555">—</span>'}
              <input type="checkbox" id="daz-use-seed-randomize"${fRandomize(data.seed) ? ' checked' : ''}
                style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
              <span style="color:#999;font-size:11px;font-family:monospace">rnd</span>
            </div>
          </td>
        </tr>
        ${rowPair('CFG High', fValue(data.cfg_high),    'CFG Low',    fValue(data.cfg_low))}
        ${rowPair('Frames',   fValue(data.total_frames), 'FPS',       fValue(data.fps))}
        ${row('Master',      trunc(fText(data.master_prompt)))}
        ${row('Positive',    trunc(fText(data.positive_prompt)))}
        ${row('Negative',    trunc(fText(data.negative_prompt)))}
        ${row('Filename',    fFile(data.filename))}
        <tr>
          <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:middle">Flags</td>
          <td colspan="3" style="padding:3px 10px">
            <div style="display:flex;align-items:center;gap:16px">
              <div style="display:flex;align-items:center;gap:4px">
                <input type="checkbox" id="daz-use-flag-1"${fFlagValue(data.flags?.flag_1) ? ' checked' : ''}
                  style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
                <span style="color:#999;font-size:11px;font-family:monospace">${esc(fFlagLabel(data.flags?.flag_1, 'flag 1'))}</span>
              </div>
              <div style="display:flex;align-items:center;gap:4px">
                <input type="checkbox" id="daz-use-flag-2"${fFlagValue(data.flags?.flag_2) ? ' checked' : ''}
                  style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
                <span style="color:#999;font-size:11px;font-family:monospace">${esc(fFlagLabel(data.flags?.flag_2, 'flag 2'))}</span>
              </div>
            </div>
          </td>
        </tr>
      </table>`
    }

    // ── Output labels ─────────────────────────────────────────────────────────

    function updateOutputLabels(node, data) {
      if (!node.outputs) return
      const loras  = data.loras ?? {}
      const values = [
        fName(data.unet_high), fName(data.unet_low),
        fName(data.vae), fName(data.clip),
        fPath(data.image_path),
        fValue(data.width), fValue(data.height),
        fValue(data.steps), fValue(data.split_step),
        fRandomize(data.seed) ? 'rnd' : fValue(data.seed),
        trunc(fText(data.master_prompt), 20),
        trunc(fText(data.positive_prompt), 20),
        trunc(fText(data.negative_prompt), 20),
        fType(data.positive_prompt),
        fValue(data.cfg_high), fValue(data.cfg_low),
        fValue(data.total_frames), fValue(data.fps),
        loraEnabled(loras.lora_1) ? loraName(loras.lora_1) : '',
        loraEnabled(loras.lora_2) ? loraName(loras.lora_2) : '',
        loraEnabled(loras.lora_3) ? loraName(loras.lora_3) : '',
        loraEnabled(loras.lora_4) ? loraName(loras.lora_4) : '',
        loraEnabled(loras.lora_5) ? loraName(loras.lora_5) : '',
        loraEnabled(loras.lora_6) ? loraName(loras.lora_6) : '',
        loraEnabled(loras.lora_7) ? loraName(loras.lora_7) : '',
        loraEnabled(loras.lora_8) ? loraName(loras.lora_8) : '',
        fFile(data.filename),
        fName(data.unet_high),
        fName(data.unet_low),
        fFlagLabel(data.flags?.flag_1, 'flag 1') + ': ' + fFlagValue(data.flags?.flag_1),
        fFlagLabel(data.flags?.flag_2, 'flag 2') + ': ' + fFlagValue(data.flags?.flag_2),
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

    function renderUseMode(node, data) {
      node._dazWan22EditMode = false
      const wrap = node._dazWan22Wrap
      if (!wrap) return
      wrap.style.height = PANEL_H + 'px'

      if (!(node._dazAllConfigs || []).length) {
        wrap.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                      height:100%;gap:14px;font-family:monospace">
            <p style="font-size:13px;color:#888;margin:0;text-align:center">
              No configuration available.<br>Create one.
            </p>
            <button id="daz-create-first-btn"
              style="font-size:12px;padding:4px 18px;background:#000;color:#cde;
                     border:1px solid #2a8050;border-radius:3px;cursor:pointer">Create</button>
          </div>`
        wrap.querySelector('#daz-create-first-btn')?.addEventListener('click', () => enterEditForm(node, true))
        node.setDirtyCanvas(true, true)
        return
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
        const filename = fPath(data.image_path).split(/[\\/]/).pop()
        if (filename) showImagePreview(filename)
      })

      const loraKeys = ['lora_1','lora_2','lora_3','lora_4','lora_5','lora_6','lora_7','lora_8']
      loraKeys.forEach((key, i) => {
        wrap.querySelector(`#daz-use-lora-${i + 1}`)?.addEventListener('change', async (e) => {
          const detail = node._dazWan22Detail
          if (!detail) return
          if (!detail.loras) detail.loras = {}
          const lora = detail.loras[key]
          const oldLora = lora && typeof lora === 'object' ? { ...lora } : lora
          if (lora && typeof lora === 'object') {
            lora.enabled = e.target.checked
          } else {
            detail.loras[key] = { name: lora || '', enabled: e.target.checked, strength: 1.0 }
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
                label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                version: node._dazCurrentVersion || '1', save_mode: 'current',
                loras: { [key]: detail.loras[key] },
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            await reloadNodeConfigs(node)
            syncWidget(node)
            if (cw) cw.value = result.label
          } catch (err) {
            detail.loras[key] = oldLora
            e.target.checked = loraEnabled(oldLora)
            if (span) span.style.color = loraEnabled(oldLora) ? '#ddd' : '#666'
            updateOutputLabels(node, detail)
            node.setDirtyCanvas(true, true)
            console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not save lora enabled state', err)
          }
        })
      })

      wrap.querySelector('#daz-use-seed-randomize')?.addEventListener('change', async (e) => {
        const detail = node._dazWan22Detail
        if (!detail) return
        const oldDetailSeed = detail.seed
        const seed = oldDetailSeed && typeof oldDetailSeed === 'object' ? oldDetailSeed : { value: 0 }
        detail.seed = { ...seed, randomize: e.target.checked }
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
              label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
              version: node._dazCurrentVersion || '1', save_mode: 'current',
              seed: detail.seed,
            }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)
          await reloadNodeConfigs(node)
          syncWidget(node)
          if (cw) cw.value = result.label
        } catch (err) {
          detail.seed = oldDetailSeed
          e.target.checked = fRandomize(oldDetailSeed)
          updateOutputLabels(node, detail)
          node.setDirtyCanvas(true, true)
          console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not save seed randomize', err)
        }
      })

      ;[['flag_1', 'daz-use-flag-1'], ['flag_2', 'daz-use-flag-2']].forEach(([flagKey, id]) => {
        wrap.querySelector(`#${id}`)?.addEventListener('change', async (e) => {
          const detail = node._dazWan22Detail
          if (!detail) return
          if (!detail.flags) detail.flags = {}
          const oldFlagEntry = detail.flags[flagKey] ? { ...detail.flags[flagKey] } : null
          if (!detail.flags[flagKey]) detail.flags[flagKey] = { label: flagKey.replace('_', ' '), value: false }
          detail.flags[flagKey].value = e.target.checked
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
                label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                version: node._dazCurrentVersion || '1', save_mode: 'current',
                flags: { [flagKey]: detail.flags[flagKey] },
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            await reloadNodeConfigs(node)
            syncWidget(node)
            if (cw) cw.value = result.label
          } catch (err) {
            if (oldFlagEntry !== null) detail.flags[flagKey] = oldFlagEntry
            else delete detail.flags[flagKey]
            e.target.checked = oldFlagEntry !== null ? oldFlagEntry.value : false
            updateOutputLabels(node, detail)
            node.setDirtyCanvas(true, true)
            console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not save flag', err)
          }
        })
      })

      updateOutputLabels(node, data)
      node.setDirtyCanvas(true, true)
    }

    async function loadDetail(node, label, version = null) {
      if (!node._dazWan22Wrap) return
      if (node._dazWan22EditMode) return
      if (!label || label === '(no configs)') {
        node._dazWan22Wrap.innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Select a config to preview.</p>'
        return
      }
      node._dazWan22Wrap.innerHTML =
        '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Loading…</p>'
      try {
        const ver = version ?? node._dazCurrentVersion ?? node._dazVersionWidget?.value ?? '1'
        const url = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(label)}&version=${encodeURIComponent(ver)}`)
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(resp.statusText)
        const data = await resp.json()
        if ('_source_file' in data) {
          const correctFile = data._source_file || null
          node._dazConfigFile = correctFile
          if (node._dazConfigFileWidget) {
            node._dazConfigFileWidget.value = correctFile || '(default)'
          }
          delete data._source_file
          await reloadNodeConfigs(node)
          syncWidget(node)
        }
        if (data.version && node._dazVersionWidget) {
          if (!node._dazVersionWidget.options.values.includes(data.version)) {
            node._dazVersionWidget.options.values = [...node._dazVersionWidget.options.values, data.version]
          }
          node._dazVersionWidget.value = data.version
          node._dazCurrentVersion = data.version
        }
        node._dazWan22Detail = data
        renderUseMode(node, data)
      } catch (e) {
        node._dazWan22Wrap.innerHTML =
          `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">Error: ${esc(e.message)}</p>`
      }
      node.setDirtyCanvas(true, true)
    }

    // ── Floating edit panel ───────────────────────────────────────────────────

    async function enterEditForm(node, isNew = false) {
      if (node._dazWan22EditMode) return
      node._dazWan22EditMode = true

      let unetFiles, vaeFiles, clipFiles, inputFiles, loraFiles
      try {
        ;[unetFiles, vaeFiles, clipFiles, inputFiles, loraFiles] = await Promise.all([
          getFolderFiles('diffusion_models'),
          getFolderFiles('vae'),
          getFolderFiles('text_encoders'),
          getFolderFiles('input'),
          getFolderFiles('loras'),
        ])
      } catch (e) {
        node._dazWan22EditMode = false
        console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not load folder files for edit panel', e)
        return
      }

      const data        = isNew ? {} : (node._dazWan22Detail || {})
      const loras       = data.loras ?? {}
      const imageName   = fPath(data.image_path).split(/[\\/]/).pop() || ''
      const posType     = fType(data.positive_prompt)
      const curVer      = isNew ? '1' : (node._dazCurrentVersion || data.version || '1')
      const uid         = `w${node.id || Math.random().toString(36).slice(2, 7)}`

      // ── DOM skeleton ──────────────────────────────────────────────────────
      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;' +
        'display:flex;align-items:flex-start;justify-content:center;padding:16px 8px;overflow-y:auto'

      const panel = document.createElement('div')
      panel.style.cssText =
        'background:#1a1a1a;border:1px solid #444;border-radius:6px;display:flex;' +
        'flex-direction:column;width:1275px;min-width:600px;font-family:monospace;' +
        'flex-shrink:0;max-height:calc(100vh - 32px)'

      const panelHeader = document.createElement('div')
      panelHeader.style.cssText =
        'padding:7px 14px;border-bottom:1px solid #333;color:#aaa;font-size:12px;flex-shrink:0'
      panelHeader.textContent = isNew
        ? 'New Configuration'
        : `Edit Configuration — version ${curVer}`

      const panelBody = document.createElement('div')
      panelBody.setAttribute('data-daz-panel-body', '1')
      panelBody.style.cssText =
        'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px;overflow-y:auto;overflow-x:hidden;flex:1'

      const panelFooter = document.createElement('div')
      panelFooter.style.cssText =
        'display:flex;align-items:center;gap:4px;padding:7px 12px;border-top:1px solid #333;' +
        'flex-shrink:0;flex-wrap:wrap'

      panel.appendChild(panelHeader)
      panel.appendChild(panelBody)
      panel.appendChild(panelFooter)
      overlay.appendChild(panel)
      document.body.appendChild(overlay)
      node._dazWan22EditOverlay = overlay

      // ── Style helpers ─────────────────────────────────────────────────────
      const fs  = 'width:100%;background:#111;color:#ddd;border:1px solid #555;border-radius:4px;' +
                  'font-size:11px;font-family:monospace;padding:2px 5px;box-sizing:border-box'
      const ns  = 'background:#111;color:#ddd;border:1px solid #555;border-radius:4px;' +
                  'font-size:11px;font-family:monospace;padding:2px 5px'
      const tas = 'width:100%;background:#111;color:#ddd;border:1px solid #555;border-radius:4px;' +
                  'font-size:11px;font-family:monospace;padding:4px 5px;box-sizing:border-box;resize:vertical'
      const lbl = 'color:#888;font-size:10px;display:block;margin-bottom:2px'
      const rw  = 'margin-bottom:5px'
      const cb  = 'font-family:monospace;font-size:10px;padding:1px 7px;background:#111;color:#666;' +
                  'border:1px solid #444;border-radius:3px;cursor:pointer'

      function box(title, html) {
        return `<fieldset style="border:1px solid #444;border-radius:4px;padding:7px 8px;margin:0;min-width:0;box-sizing:border-box;overflow:hidden">
          <legend style="color:#888;font-size:11px;padding:0 5px;font-family:monospace">${title}</legend>
          ${html}
        </fieldset>`
      }

      function selOpt(files, cur) {
        return `<option value="">— none —</option>` +
          files.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('')
      }

      function selOptImg(files, cur) {
        return `<option value="">— no image —</option>` +
          files.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('')
      }

      function loraRow(label, key) {
        const lora = loras[key]
        return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
          <span style="color:#888;font-size:10px;width:62px;flex-shrink:0">${label}</span>
          <select id="daz-${key}" style="flex:1;background:#111;color:#ddd;border:1px solid #555;
            border-radius:4px;font-size:11px;font-family:monospace;padding:1px 3px;min-width:0">
            ${selOpt(loraFiles, loraName(lora))}
          </select>
          <input type="number" id="daz-${key}-strength" step="0.01" min="0"
            value="${lora?.strength ?? 1.0}"
            style="width:44px;flex-shrink:0;${ns};padding:1px 3px">
          <input type="checkbox" id="daz-${key}-enabled"${loraEnabled(lora) ? ' checked' : ''}
            style="flex-shrink:0;width:13px;height:13px;cursor:pointer;accent-color:#54af7b">
        </div>`
      }

      // ── Left column ───────────────────────────────────────────────────────
      const colLeft = `
        ${box('Name and Filters', `
          <div style="${rw}"><label style="${lbl}">Name</label>
            <input id="daz-config-name" type="text"
              value="${esc(isNew ? '' : (data.name || ''))}"
              placeholder="Config name…" style="${fs}">
          </div>
          <div style="${rw}"><label style="${lbl}">Group</label>
            <input id="daz-group" type="text" value="${esc(fName(data.group))}"
              placeholder="Optional group…" style="${fs}">
          </div>
          <div style="${rw}"><label style="${lbl}">Type</label>
            <select id="daz-type" style="${fs}">
              <option value=""${!data.type ? ' selected' : ''}>— no type —</option>
              <option value="I2V"${data.type === 'I2V' ? ' selected' : ''}>I2V</option>
              <option value="T2V"${data.type === 'T2V' ? ' selected' : ''}>T2V</option>
              <option value="MULTI"${data.type === 'MULTI' ? ' selected' : ''}>MULTI</option>
            </select>
          </div>
          <div style="${rw}"><label style="${lbl}">Note</label>
            <textarea id="daz-note" maxlength="900"
              style="${tas};height:60px;resize:none">${esc(fNote(data.note))}</textarea>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button id="daz-name-clear" style="${cb}">clear</button>
          </div>
        `)}
        ${box('Reference Image', `
          <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px">
            <select id="daz-image-path" style="flex:1;background:#111;color:#ddd;border:1px solid #555;
              border-radius:4px;font-size:11px;font-family:monospace;padding:1px 3px;min-width:0">
              ${selOptImg(inputFiles, imageName)}
            </select>
            <button id="daz-upload-btn"
              style="font-family:monospace;font-size:11px;padding:2px 6px;background:#111;color:#ccc;
                     border:1px solid #555;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Upload…</button>
            <input id="daz-upload-input" type="file" accept="image/*" style="display:none">
            <button id="daz-img-clear" style="${cb}">clear</button>
          </div>
          <div id="daz-img-preview-box"
            style="width:100%;height:170px;background:#2a2a2a;border:1px solid #444;border-radius:3px;
                   display:flex;align-items:center;justify-content:center;overflow:hidden">
            <img id="daz-img-preview-el"
              style="${imageName ? '' : 'display:none;'}width:100%;height:100%;object-fit:contain">
            <span id="daz-img-preview-ph"
              style="color:#555;font-size:11px${imageName ? ';display:none' : ''}">Image preview here</span>
          </div>
        `)}
        ${box('Dimensions and More', `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
            <div><label style="${lbl}">Width</label>
              <input id="daz-width" type="number" value="${fValue(data.width) || 0}"
                style="width:100%;${ns}"></div>
            <div><label style="${lbl}">Height</label>
              <input id="daz-height" type="number" value="${fValue(data.height) || 0}"
                style="width:100%;${ns}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
            <div><label style="${lbl}">Steps</label>
              <input id="daz-steps" type="number" value="${fValue(data.steps) || 0}"
                style="width:100%;${ns}"></div>
            <div><label style="${lbl}">Split Step</label>
              <input id="daz-split-step" type="number" value="${fValue(data.split_step) || 0}"
                style="width:100%;${ns}"></div>
          </div>
          <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:4px">
            <div style="flex:1"><label style="${lbl}">Seed</label>
              <input id="daz-seed" type="number" value="${fValue(data.seed) ?? 0}"
                style="width:100%;${ns}"></div>
            <div style="display:flex;align-items:center;gap:4px;padding-bottom:3px">
              <input type="checkbox" id="daz-seed-randomize"${fRandomize(data.seed) ? ' checked' : ''}
                title="Randomize seed" style="width:13px;height:13px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
              <span style="color:#888;font-size:10px">Rnd</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
            <div><label style="${lbl}">CFG Hi</label>
              <input id="daz-cfg-high" type="number" step="0.1" value="${fValue(data.cfg_high) || 0}"
                style="width:100%;${ns}"></div>
            <div><label style="${lbl}">CFG Lo</label>
              <input id="daz-cfg-low" type="number" step="0.1" value="${fValue(data.cfg_low) || 0}"
                style="width:100%;${ns}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px">
            <div><label style="${lbl}">Frames</label>
              <input id="daz-total-frames" type="number" value="${fValue(data.total_frames) || 0}"
                style="width:100%;${ns}"></div>
            <div><label style="${lbl}">FPS</label>
              <input id="daz-fps" type="number" step="0.01" value="${fValue(data.fps) || 0}"
                style="width:100%;${ns}"></div>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button id="daz-dims-clear" style="${cb}">clear</button>
          </div>
        `)}
      `

      // ── Center column ─────────────────────────────────────────────────────
      const colCenter = `
        ${box('Prompt', `
          <div style="display:flex;gap:16px;margin-bottom:7px">
            <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
              <input type="radio" name="daz-pos-type-${uid}" value="smart"
                ${posType === 'smart' ? 'checked' : ''}>Smart
            </label>
            <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
              <input type="radio" name="daz-pos-type-${uid}" value="beats"
                ${posType === 'beats' ? 'checked' : ''}>Beat
            </label>
            <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
              <input type="radio" name="daz-pos-type-${uid}" value="simple"
                ${posType === 'simple' ? 'checked' : ''}>Simple
            </label>
          </div>
          <input type="hidden" id="daz-positive-prompt-type" value="${esc(posType)}">
          <label style="${lbl}">Master</label>
          <textarea id="daz-master-prompt"
            style="${tas};height:100px;margin-bottom:2px">${esc(fText(data.master_prompt))}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
            <button id="daz-master-clear" style="${cb}">clear</button>
          </div>
          <label style="${lbl}">Positive</label>
          <textarea id="daz-positive-prompt"
            style="${tas};height:150px;margin-bottom:2px">${esc(fText(data.positive_prompt))}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
            <button id="daz-positive-clear" style="${cb}">clear</button>
          </div>
          <label style="${lbl}">Negative</label>
          <textarea id="daz-negative-prompt"
            style="${tas};height:100px;margin-bottom:2px">${esc(fText(data.negative_prompt))}</textarea>
          <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
            <button id="daz-negative-clear" style="${cb}">clear</button>
          </div>
          <button id="daz-prompt-editor-btn"
            style="font-family:monospace;font-size:11px;padding:4px 10px;width:100%;
                   background:#1a3a1a;color:#9dc;border:1px solid #54af7b;
                   border-radius:3px;cursor:pointer">Prompt Editor</button>
        `)}
      `

      // ── Right column ──────────────────────────────────────────────────────
      const colRight = `
        ${box('Models', `
          <div style="${rw}"><label style="${lbl}">Unet High</label>
            <select id="daz-unet-high" style="${fs}">${selOpt(unetFiles, fName(data.unet_high))}</select>
          </div>
          <div style="${rw}"><label style="${lbl}">Unet Low</label>
            <select id="daz-unet-low" style="${fs}">${selOpt(unetFiles, fName(data.unet_low))}</select>
          </div>
          <div style="${rw}"><label style="${lbl}">VAE</label>
            <select id="daz-vae" style="${fs}">${selOpt(vaeFiles, fName(data.vae))}</select>
          </div>
          <div style="${rw}"><label style="${lbl}">Clip</label>
            <select id="daz-clip" style="${fs}">${selOpt(clipFiles, fName(data.clip))}</select>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button id="daz-models-clear" style="${cb}">clear</button>
          </div>
        `)}
        ${box('LoRAs', `
          ${loraRow('Lora 1 Hi', 'lora_1')}
          ${loraRow('Lora 1 Lo', 'lora_2')}
          ${loraRow('Lora 2 Hi', 'lora_3')}
          ${loraRow('Lora 2 Lo', 'lora_4')}
          ${loraRow('Lora 3 Hi', 'lora_5')}
          ${loraRow('Lora 3 Lo', 'lora_6')}
          ${loraRow('Lora 4 Hi', 'lora_7')}
          ${loraRow('Lora 4 Lo', 'lora_8')}
          <div style="display:flex;justify-content:flex-end;margin-top:3px">
            <button id="daz-loras-clear" style="${cb}">clear</button>
          </div>
        `)}
        ${box('Other', `
          <div style="${rw}">
            <div style="display:flex;align-items:flex-end;gap:4px">
              <div style="flex:1"><label style="${lbl}">Filename</label>
                <input id="daz-filename" type="text" value="${esc(fFile(data.filename))}"
                  placeholder="subdir/output_name" style="${fs}"></div>
              <button id="daz-filename-clear" style="${cb};margin-bottom:1px">clear</button>
            </div>
          </div>
          <div style="margin-bottom:4px"><label style="${lbl}">Flag 1</label>
            <div style="display:flex;align-items:center;gap:6px">
              <input id="daz-flag-1-label" type="text"
                value="${esc(fFlagLabel(data.flags?.flag_1, 'flag 1'))}"
                placeholder="flag 1" style="flex:1;${fs}">
              <input type="checkbox" id="daz-flag-1-value"${fFlagValue(data.flags?.flag_1) ? ' checked' : ''}
                style="width:14px;height:14px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
            </div>
          </div>
          <div style="margin-bottom:5px"><label style="${lbl}">Flag 2</label>
            <div style="display:flex;align-items:center;gap:6px">
              <input id="daz-flag-2-label" type="text"
                value="${esc(fFlagLabel(data.flags?.flag_2, 'flag 2'))}"
                placeholder="flag 2" style="flex:1;${fs}">
              <input type="checkbox" id="daz-flag-2-value"${fFlagValue(data.flags?.flag_2) ? ' checked' : ''}
                style="width:14px;height:14px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button id="daz-other-clear" style="${cb}">clear</button>
          </div>
        `)}
      `

      panelBody.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden">${colLeft}</div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden">${colCenter}</div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden">${colRight}</div>
      `

      const btnBase = 'font-family:monospace;font-size:12px;padding:3px 12px;border-radius:3px;cursor:pointer;border:1px solid'
      panelFooter.innerHTML = isNew
        ? `<span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace"></span>
           <button id="daz-cancel-btn" style="${btnBase} #666;background:#444;color:#ccc">Cancel</button>
           <button id="daz-create-btn" style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Create</button>`
        : `<button id="daz-duplicate-btn"  style="${btnBase} #555;background:#333;color:#ddd">Duplicate</button>
           <button id="daz-del-config-btn"  style="${btnBase} #cc2222;background:#3d0f0f;color:#f99">Del All</button>
           <span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace;padding:0 4px;min-width:0"></span>
           <button id="daz-cancel-btn"      style="${btnBase} #666;background:#444;color:#ccc">Cancel</button>
           <button id="daz-del-version-btn" style="${btnBase} #803030;background:#5c1a1a;color:#f99">Delete Version</button>
           <button id="daz-new-version-btn" style="${btnBase} #2a5080;background:#1a3a5c;color:#9cd">+ Version</button>
           <button id="daz-save-btn"        style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Save</button>`

      // ── Initial image preview ─────────────────────────────────────────────
      if (imageName) {
        const el = panel.querySelector('#daz-img-preview-el')
        if (el) el.src = `/view?filename=${encodeURIComponent(imageName)}&type=input`
      }

      // ── Event handlers ────────────────────────────────────────────────────

      // Enter-key navigation
      if (node._dazEditKeydownPanel && node._dazEditKeydownHandler) {
        node._dazEditKeydownPanel.removeEventListener('keydown', node._dazEditKeydownHandler)
      }
      node._dazEditKeydownHandler = (e) => {
        if (e.key !== 'Enter') return
        if (e.target.tagName !== 'INPUT') return
        if (['file','hidden','checkbox','radio'].includes(e.target.type)) return
        e.preventDefault()
        const els = Array.from(panel.querySelectorAll(
          'input:not([type=file]):not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea'
        ))
        const idx = els.indexOf(e.target)
        if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus()
      }
      node._dazEditKeydownPanel = panel
      panel.addEventListener('keydown', node._dazEditKeydownHandler)

      // Radio → hidden type
      panel.querySelectorAll(`input[name="daz-pos-type-${uid}"]`).forEach(r => {
        r.addEventListener('change', () => {
          const h = panel.querySelector('#daz-positive-prompt-type')
          if (h) h.value = r.value
        })
      })

      // Live image preview
      const imgSel = panel.querySelector('#daz-image-path')
      const prevEl = panel.querySelector('#daz-img-preview-el')
      const prevPH = panel.querySelector('#daz-img-preview-ph')
      function updatePreview(filename) {
        if (!prevEl || !prevPH) return
        if (filename) {
          prevEl.src = `/view?filename=${encodeURIComponent(filename)}&type=input`
          prevEl.style.display = 'block'
          prevPH.style.display = 'none'
        } else {
          prevEl.src = ''
          prevEl.style.display = 'none'
          prevPH.style.display = ''
        }
      }
      imgSel?.addEventListener('change', e => updatePreview(e.target.value))

      // Upload
      panel.querySelector('#daz-upload-btn')?.addEventListener('click', () => {
        panel.querySelector('#daz-upload-input')?.click()
      })
      panel.querySelector('#daz-upload-input')?.addEventListener('change', async (e) => {
        const file   = e.target.files?.[0]
        if (!file) return
        const btn    = panel.querySelector('#daz-upload-btn')
        const errDiv = panel.querySelector('#daz-save-error')
        if (!btn) return
        btn.textContent = 'Uploading…'
        btn.disabled    = true
        if (errDiv) errDiv.textContent = ''
        try {
          const fd = new FormData()
          fd.append('image', file)
          fd.append('type', 'input')
          const r = await fetch('/upload/image', { method: 'POST', body: fd })
          if (!r.ok) throw new Error(r.statusText)
          const result = await r.json()
          delete folderFiles['input']
          const fresh = await getFolderFiles('input')
          const sel = panel.querySelector('#daz-image-path')
          if (sel) sel.innerHTML = selOptImg(fresh, result.name)
          updatePreview(result.name)
        } catch (err) {
          if (errDiv) errDiv.textContent = `Upload failed: ${esc(err.message)}`
        }
        btn.textContent = 'Upload…'
        btn.disabled    = false
      })

      // Seed randomize (save immediately when changed in edit mode, matches existing behavior)
      panel.querySelector('#daz-seed-randomize')?.addEventListener('change', async (e) => {
        if (isNew) return
        const cw    = node.widgets?.find(w => w.name === 'config')
        const label = cw?.value
        if (!label || label === '(no configs)') return
        const detail  = node._dazWan22Detail || {}
        const seedVal = parseInt(panel.querySelector('#daz-seed')?.value ?? '0', 10)
        const newSeed = { value: seedVal, randomize: e.target.checked }
        try {
          const r = await fetch('/daz/workflow-config-save', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
              version: node._dazCurrentVersion || '1', save_mode: 'current', seed: newSeed,
            }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)
          if (node._dazWan22Detail) node._dazWan22Detail.seed = newSeed
          await reloadNodeConfigs(node)
          syncWidget(node)
          if (cw) cw.value = result.label
        } catch (err) {
          console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not save seed randomize', err)
        }
      })

      // Clear buttons
      panel.querySelector('#daz-name-clear')?.addEventListener('click', () => {
        ;['#daz-config-name','#daz-group'].forEach(id => {
          const el = panel.querySelector(id); if (el) el.value = ''
        })
        const t = panel.querySelector('#daz-type'); if (t) t.value = ''
        const n = panel.querySelector('#daz-note'); if (n) n.value = ''
      })
      panel.querySelector('#daz-img-clear')?.addEventListener('click', () => {
        const sel = panel.querySelector('#daz-image-path')
        if (sel) sel.value = ''
        updatePreview('')
      })
      panel.querySelector('#daz-dims-clear')?.addEventListener('click', () => {
        ;['#daz-width','#daz-height','#daz-steps','#daz-split-step','#daz-seed',
          '#daz-cfg-high','#daz-cfg-low','#daz-total-frames','#daz-fps'].forEach(id => {
          const el = panel.querySelector(id); if (el) el.value = '0'
        })
        const r = panel.querySelector('#daz-seed-randomize'); if (r) r.checked = false
      })
      panel.querySelector('#daz-master-clear')?.addEventListener('click', () => {
        const ta = panel.querySelector('#daz-master-prompt'); if (ta) ta.value = ''
      })
      panel.querySelector('#daz-positive-clear')?.addEventListener('click', () => {
        const ta = panel.querySelector('#daz-positive-prompt'); if (ta) ta.value = ''
      })
      panel.querySelector('#daz-negative-clear')?.addEventListener('click', () => {
        const ta = panel.querySelector('#daz-negative-prompt'); if (ta) ta.value = ''
      })
      panel.querySelector('#daz-models-clear')?.addEventListener('click', () => {
        ;['#daz-unet-high','#daz-unet-low','#daz-vae','#daz-clip'].forEach(id => {
          const el = panel.querySelector(id); if (el) el.value = ''
        })
      })
      panel.querySelector('#daz-loras-clear')?.addEventListener('click', () => {
        ;['lora_1','lora_2','lora_3','lora_4','lora_5','lora_6','lora_7','lora_8'].forEach(key => {
          const s = panel.querySelector(`#daz-${key}`);          if (s) s.value = ''
          const w = panel.querySelector(`#daz-${key}-strength`); if (w) w.value = '1'
          const c = panel.querySelector(`#daz-${key}-enabled`);  if (c) c.checked = true
        })
      })
      panel.querySelector('#daz-filename-clear')?.addEventListener('click', () => {
        const el = panel.querySelector('#daz-filename'); if (el) el.value = ''
      })
      panel.querySelector('#daz-other-clear')?.addEventListener('click', () => {
        const fn = panel.querySelector('#daz-filename');    if (fn) fn.value = ''
        const l1 = panel.querySelector('#daz-flag-1-label'); if (l1) l1.value = 'flag 1'
        const v1 = panel.querySelector('#daz-flag-1-value'); if (v1) v1.checked = false
        const l2 = panel.querySelector('#daz-flag-2-label'); if (l2) l2.value = 'flag 2'
        const v2 = panel.querySelector('#daz-flag-2-value'); if (v2) v2.checked = false
      })

      // Cancel
      function closePanel() {
        if (node._dazWan22EditOverlay) {
          node._dazWan22EditOverlay.remove()
          node._dazWan22EditOverlay = null
        }
        node._dazWan22EditMode = false
      }

      panel.querySelector('#daz-cancel-btn')?.addEventListener('click', () => {
        closePanel()
        renderUseMode(node, node._dazWan22Detail || {})
      })

      // Mode-specific action buttons
      if (isNew) {
        panel.querySelector('#daz-create-btn')?.addEventListener('click', () => createConfig(node, panel))
      } else {
        panel.querySelector('#daz-duplicate-btn')?.addEventListener('click', () => showDuplicateModal(node, panel))
        panel.querySelector('#daz-del-version-btn')?.addEventListener('click', () => showDeleteVersionConfirm(node, panel))
        panel.querySelector('#daz-del-config-btn')?.addEventListener('click', () => showDeleteConfigConfirm(node, panel))
        panel.querySelector('#daz-save-btn')?.addEventListener('click', () => saveConfig(node, panel, 'current'))
        panel.querySelector('#daz-new-version-btn')?.addEventListener('click', () => saveConfig(node, panel, 'new_version'))
      }

      panel.querySelector('#daz-prompt-editor-btn')?.addEventListener('click', () => {
        openPromptEditorFromEdit(node, panel, isNew)
      })

      node.setDirtyCanvas(true, true)
    }

    // ── Prompt Editor integration ─────────────────────────────────────────────

    function openPromptEditorFromUse(node) {
      if (!window.DazPromptEditor) return
      window.DazPromptEditor.open({
        detail: node._dazWan22Detail || {},
        onSave: async (updates) => {
          const cw    = node.widgets?.find(w => w.name === 'config')
          const label = cw?.value
          if (!label || label === '(no configs)') return
          const detail = node._dazWan22Detail || {}
          try {
            const r = await fetch('/daz/workflow-config-save', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                version: node._dazCurrentVersion || '1', save_mode: 'current',
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
              `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(node._dazCurrentVersion || '1')}`)
            const detailResp = await fetch(detailUrl)
            if (detailResp.ok) node._dazWan22Detail = await detailResp.json()
            renderUseMode(node, node._dazWan22Detail)
          } catch (err) {
            console.warn('[DAZ TOOLS] WorkflowConfigWan22: prompt editor save failed', err)
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
          if (!isNewConfig) saveConfig(node, wrap, 'current', true)
        },
      })
    }

    // ── Build typed-object payload from the edit form ─────────────────────────

    function buildPayload(wrap) {
      const loraKeys = ['lora_1','lora_2','lora_3','lora_4','lora_5','lora_6','lora_7','lora_8']
      const loras = {}
      loraKeys.forEach(key => {
        loras[key] = {
          name:     wrap.querySelector(`#daz-${key}`)?.value                            ?? '',
          enabled:  wrap.querySelector(`#daz-${key}-enabled`)?.checked                 ?? true,
          strength: parseFloat(wrap.querySelector(`#daz-${key}-strength`)?.value ?? '1') || 1.0,
        }
      })
      return {
        unet_high:       { name: wrap.querySelector('#daz-unet-high')?.value       ?? '' },
        unet_low:        { name: wrap.querySelector('#daz-unet-low')?.value        ?? '' },
        vae:             { name: wrap.querySelector('#daz-vae')?.value             ?? '' },
        clip:            { name: wrap.querySelector('#daz-clip')?.value            ?? '' },
        image_path:      { path: wrap.querySelector('#daz-image-path')?.value      ?? '' },
        loras,
        master_prompt:   { text: wrap.querySelector('#daz-master-prompt')?.value   ?? '' },
        positive_prompt: {
          text: wrap.querySelector('#daz-positive-prompt')?.value ?? '',
          type: wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart',
        },
        negative_prompt: { text: wrap.querySelector('#daz-negative-prompt')?.value ?? '' },
        filename:        { file: wrap.querySelector('#daz-filename')?.value         ?? '' },
        width:        { value: parseInt(wrap.querySelector('#daz-width')?.value        ?? '0', 10) },
        height:       { value: parseInt(wrap.querySelector('#daz-height')?.value       ?? '0', 10) },
        steps:        { value: parseInt(wrap.querySelector('#daz-steps')?.value        ?? '0', 10) },
        split_step:   { value: parseInt(wrap.querySelector('#daz-split-step')?.value   ?? '0', 10) },
        seed:         { value: parseInt(wrap.querySelector('#daz-seed')?.value         ?? '0', 10),
                        randomize: wrap.querySelector('#daz-seed-randomize')?.checked  ?? false },
        flags: {
          flag_1: { label: wrap.querySelector('#daz-flag-1-label')?.value ?? 'flag 1', value: wrap.querySelector('#daz-flag-1-value')?.checked ?? false },
          flag_2: { label: wrap.querySelector('#daz-flag-2-label')?.value ?? 'flag 2', value: wrap.querySelector('#daz-flag-2-value')?.checked ?? false },
        },
        note:         { value: (wrap.querySelector('#daz-note')?.value ?? '').substring(0, 900) },
        cfg_high:     { value: parseFloat(wrap.querySelector('#daz-cfg-high')?.value   ?? '0') },
        cfg_low:      { value: parseFloat(wrap.querySelector('#daz-cfg-low')?.value    ?? '0') },
        total_frames: { value: parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) },
        fps:          { value: parseFloat(wrap.querySelector('#daz-fps')?.value        ?? '0') },
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
      if (!createBtn || !errDiv) return
      createBtn.textContent = 'Creating…'
      createBtn.disabled    = true
      errDiv.textContent    = ''

      const payload = {
        name, class: CLASS, file: currentFile(node),
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
        if (r.status === 409) {
          createBtn.textContent = 'Create'
          createBtn.disabled    = false
          showNameClashModal(wrap.querySelector('#daz-config-name'), () => createConfig(node, wrap))
          return
        }
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        if (node._dazWan22EditOverlay) {
          node._dazWan22EditOverlay.remove()
          node._dazWan22EditOverlay = null
        }
        node._dazWan22EditMode = false

        await reloadNodeConfigs(node)
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        node._dazTypeFilter = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        node._dazGroupFilter = 'All'
        syncWidget(node)
        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) configWidget.value = result.label

        await reloadVersionWidget(node, result.label, result.version || '1')

        const detailUrl = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(result.version || '1')}`)
        const detailResp = await fetch(detailUrl)
        if (detailResp.ok) node._dazWan22Detail = await detailResp.json()

        renderUseMode(node, node._dazWan22Detail || {})
      } catch (e) {
        createBtn.textContent = 'Create'
        createBtn.disabled    = false
        errDiv.textContent    = `Error: ${e.message}`
      }
    }

    // ── Save existing config ──────────────────────────────────────────────────

    async function saveConfig(node, wrap, saveMode = 'current', skipRescale = false, nameChangeConfirmed = false) {
      const cw    = node.widgets?.find(w => w.name === 'config')
      const label = cw?.value
      if (!label || label === '(no configs)') return

      const saveBtn  = wrap.querySelector('#daz-save-btn')
      const nvBtn    = wrap.querySelector('#daz-new-version-btn')
      const errorDiv = wrap.querySelector('#daz-save-error')
      const activeBtn = saveMode === 'new_version' ? nvBtn : saveBtn
      if (!activeBtn || !errorDiv) return

      const newName = wrap.querySelector('#daz-config-name')?.value.trim() ?? ''
      if (!newName) {
        errorDiv.textContent = 'Config name is required.'
        wrap.querySelector('#daz-config-name')?.focus()
        return
      }

      if (!nameChangeConfirmed && newName !== (node._dazWan22Detail?.name || '')) {
        showNameChangeConfirm(node, wrap, saveMode, skipRescale)
        return
      }

      activeBtn.textContent = saveMode === 'new_version' ? 'Adding…' : 'Saving…'
      activeBtn.disabled    = true
      errorDiv.textContent  = ''

      if (!skipRescale && window.DazPromptEditor?.rescalePrompt) {
        const oldTotal = fValue((node._dazWan22Detail || {}).total_frames)
        const newTotal = parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) || 0
        if (oldTotal > 0 && newTotal > 0 && oldTotal !== newTotal) {
          const posTA   = wrap.querySelector('#daz-positive-prompt')
          const posType = wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart'
          if (posTA) posTA.value = window.DazPromptEditor.rescalePrompt(posTA.value, posType, oldTotal, newTotal)
        }
      }

      const payload = {
        label, class: CLASS, file: currentFile(node), new_name: newName,
        version: node._dazCurrentVersion || '1', save_mode: saveMode,
        group: { name: wrap.querySelector('#daz-group')?.value ?? '' },
        type:  wrap.querySelector('#daz-type')?.value ?? '',
        ...buildPayload(wrap),
      }

      try {
        const r = await fetch('/daz/workflow-config-save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        if (r.status === 409) {
          activeBtn.textContent = saveMode === 'new_version' ? '+ Version' : 'Save'
          activeBtn.disabled    = false
          showNameClashModal(wrap.querySelector('#daz-config-name'), () => saveConfig(node, wrap, saveMode, true, true))
          return
        }
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        if (node._dazWan22EditOverlay) {
          node._dazWan22EditOverlay.remove()
          node._dazWan22EditOverlay = null
        }
        node._dazWan22EditMode = false

        await reloadNodeConfigs(node)
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        node._dazTypeFilter = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        node._dazGroupFilter = 'All'
        syncWidget(node)
        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) configWidget.value = result.label

        await reloadVersionWidget(node, result.label, result.version)
        node._dazCurrentVersion = result.version

        const detailUrl = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(result.version)}`)
        const detailResp = await fetch(detailUrl)
        if (detailResp.ok) node._dazWan22Detail = await detailResp.json()

        renderUseMode(node, node._dazWan22Detail || {})
      } catch (e) {
        activeBtn.textContent = saveMode === 'new_version' ? '+ Version' : 'Save'
        activeBtn.disabled    = false
        errorDiv.textContent  = `Error: ${e.message}`
      }
    }

    // ── Duplicate config ──────────────────────────────────────────────────────

    function showDuplicateModal(node, wrap) {
      const data         = node._dazWan22Detail || {}
      const originalName = data.name || ''
      if (!originalName) return

      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;top:0;left:0;right:0;bottom:0',
        'background:rgba(0,0,0,0.75);z-index:10000',
        'display:flex;align-items:center;justify-content:center',
      ].join(';')
      const box = document.createElement('div')
      box.style.cssText = [
        'background:#2a2a2a;border:1px solid #555;border-radius:6px',
        'padding:20px 24px;width:400px;font-family:monospace',
      ].join(';')
      const fieldStyle = 'width:100%;background:#000;color:#ddd;border:1px solid #555;border-radius:4px;font-size:11px;font-family:monospace;padding:4px 8px;box-sizing:border-box'
      const btnStyle   = 'font-family:monospace;font-size:11px;padding:7px 12px;border-radius:3px;cursor:pointer;border:1px solid #555;width:100%;text-align:left;margin-bottom:6px;background:#1a1a1a;color:#ddd'
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 12px">Duplicate &ldquo;${esc(originalName)}&rdquo;</p>
        <p style="font-size:11px;color:#888;margin:0 0 4px">New config name (options 1 &amp; 2):</p>
        <input id="dup-name" type="text" value="${esc('Copy of ' + originalName)}"
          style="${fieldStyle};margin-bottom:14px">
        <button id="dup-all-sets" style="${btnStyle}">Duplicate as a new config with all versions</button>
        <button id="dup-cur-set"  style="${btnStyle}">Duplicate as a new config with the current version</button>
        <button id="dup-new-ver"  style="${btnStyle};border-color:#2a5080;color:#9cd">Duplicate as a new version in this config</button>
        <div style="display:flex;justify-content:flex-end;margin-top:10px">
          <button id="dup-cancel" style="font-family:monospace;font-size:11px;padding:4px 14px;background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
        </div>
      `
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
      box.querySelector('#dup-cancel')?.addEventListener('click', () => overlay.remove())
      box.querySelector('#dup-all-sets')?.addEventListener('click', () => {
        const n = box.querySelector('#dup-name')?.value.trim() || `Copy of ${originalName}`
        overlay.remove()
        duplicateConfigToNew(node, wrap, n, 'all_sets')
      })
      box.querySelector('#dup-cur-set')?.addEventListener('click', () => {
        const n = box.querySelector('#dup-name')?.value.trim() || `Copy of ${originalName}`
        overlay.remove()
        duplicateConfigToNew(node, wrap, n, 'current_set')
      })
      box.querySelector('#dup-new-ver')?.addEventListener('click', () => {
        overlay.remove()
        saveConfig(node, wrap, 'new_version')
      })
    }

    async function duplicateConfigToNew(node, wrap, newName, duplicateMode) {
      const cw    = node.widgets?.find(w => w.name === 'config')
      const label = cw?.value
      if (!label || label === '(no configs)') return
      const errDiv = wrap.querySelector('#daz-save-error')
      const dupBtn = wrap.querySelector('#daz-duplicate-btn')
      if (dupBtn) { dupBtn.textContent = 'Duplicating…'; dupBtn.disabled = true }
      if (errDiv) errDiv.textContent = ''

      try {
        const r = await fetch('/daz/workflow-config-duplicate-config', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            label, class: CLASS, file: currentFile(node), new_name: newName,
            version: node._dazCurrentVersion || '1', duplicate_mode: duplicateMode,
          }),
        })
        if (r.status === 409) {
          if (dupBtn) { dupBtn.textContent = 'Duplicate'; dupBtn.disabled = false }
          const fakeInput = { value: newName }
          showNameClashModal(fakeInput, () => duplicateConfigToNew(node, wrap, fakeInput.value, duplicateMode))
          return
        }
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        if (node._dazWan22EditOverlay) {
          node._dazWan22EditOverlay.remove()
          node._dazWan22EditOverlay = null
        }
        node._dazWan22EditMode = false

        await reloadNodeConfigs(node)
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        node._dazTypeFilter = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        node._dazGroupFilter = 'All'
        syncWidget(node)
        if (cw) cw.value = result.label

        await reloadVersionWidget(node, result.label, result.version || '1')
        node._dazCurrentVersion = result.version || '1'

        const detailUrl = configsUrl(node,
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(result.version || '1')}`)
        const detailResp = await fetch(detailUrl)
        if (detailResp.ok) node._dazWan22Detail = await detailResp.json()

        renderUseMode(node, node._dazWan22Detail || {})
      } catch (e) {
        if (dupBtn) { dupBtn.textContent = 'Duplicate'; dupBtn.disabled = false }
        if (errDiv) errDiv.textContent = `Duplicate failed: ${e.message}`
      }
    }

    // ── Name change confirm ───────────────────────────────────────────────────

    function showNameChangeConfirm(node, wrap, saveMode, skipRescale) {
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;top:0;left:0;right:0;bottom:0',
        'background:rgba(0,0,0,0.75);z-index:10000',
        'display:flex;align-items:center;justify-content:center',
      ].join(';')
      const box = document.createElement('div')
      box.style.cssText = [
        'background:#2a2a2a;border:1px solid #555;border-radius:6px',
        'padding:20px 24px;width:380px;font-family:monospace',
      ].join(';')
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 8px">Rename all versions?</p>
        <p style="font-size:11px;color:#888;margin:0 0 20px">
          Changing the name will affect all versions of this config, not just the one being saved.
        </p>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="ncc-cancel"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
          <button id="ncc-continue"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#1a5c35;color:#cde;border:1px solid #2a8050;border-radius:3px;cursor:pointer">Continue</button>
        </div>
      `
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      box.querySelector('#ncc-cancel')?.addEventListener('click', () => overlay.remove())
      box.querySelector('#ncc-continue')?.addEventListener('click', () => {
        overlay.remove()
        saveConfig(node, wrap, saveMode, skipRescale, true)
      })
    }

    // ── Name clash modal ──────────────────────────────────────────────────────

    function showNameClashModal(nameInput, onRetry) {
      const name = nameInput?.value.trim() ?? ''
      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;top:0;left:0;right:0;bottom:0',
        'background:rgba(0,0,0,0.75);z-index:10000',
        'display:flex;align-items:center;justify-content:center',
      ].join(';')
      const box = document.createElement('div')
      box.style.cssText = [
        'background:#2a2a2a;border:1px solid #555;border-radius:6px',
        'padding:20px 24px;width:360px;font-family:monospace',
      ].join(';')
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 6px">
          A config named &ldquo;${esc(name)}&rdquo; already exists.
        </p>
        <p style="font-size:11px;color:#888;margin:0 0 18px">Cancel to go back, or auto-generate a unique name.</p>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="nc-cancel"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
          <button id="nc-autoname"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#1a5c35;color:#cde;border:1px solid #2a8050;border-radius:3px;cursor:pointer">Auto name</button>
        </div>
      `
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      box.querySelector('#nc-cancel')?.addEventListener('click', () => overlay.remove())
      box.querySelector('#nc-autoname')?.addEventListener('click', () => {
        overlay.remove()
        const suffix = '_alt' + (Math.floor(Math.random() * 9000) + 1000)
        if (nameInput) nameInput.value = name + suffix
        onRetry()
      })
    }

    // ── Delete version confirm ────────────────────────────────────────────────

    function showDeleteVersionConfirm(node, wrap) {
      const name    = node._dazWan22Detail?.name || '?'
      const version = node._dazCurrentVersion || '1'
      const cw      = node.widgets?.find(w => w.name === 'config')
      const label   = cw?.value || ''

      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;top:0;left:0;right:0;bottom:0',
        'background:rgba(0,0,0,0.75);z-index:10000',
        'display:flex;align-items:center;justify-content:center',
      ].join(';')
      const box = document.createElement('div')
      box.style.cssText = [
        'background:#2a2a2a;border:1px solid #555;border-radius:6px',
        'padding:20px 24px;width:360px;font-family:monospace',
      ].join(';')
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 6px">
          Delete version <strong>${esc(version)}</strong> of &ldquo;${esc(name)}&rdquo;?
        </p>
        <p style="font-size:11px;color:#888;margin:0 0 18px">This cannot be undone. If this is the last version, the entire config will be removed.</p>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="dv-keep"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Keep</button>
          <button id="dv-confirm"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#5c1a1a;color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer">Delete Version</button>
        </div>
      `
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
      box.querySelector('#dv-keep')?.addEventListener('click', () => overlay.remove())
      box.querySelector('#dv-confirm')?.addEventListener('click', () => {
        overlay.remove()
        deleteVersion(node, label, version)
      })
    }

    async function deleteVersion(node, label, version) {
      const editOverlay = node._dazWan22EditOverlay
      const panelBody   = editOverlay?.querySelector('[data-daz-panel-body]')
      if (panelBody) panelBody.innerHTML =
        '<p style="font-family:monospace;font-size:12px;color:#555;padding:16px">Deleting…</p>'

      try {
        const r = await fetch('/daz/workflow-config-delete', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ label, class: CLASS, file: currentFile(node), version, delete_mode: 'version' }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        if (node._dazWan22EditOverlay) {
          node._dazWan22EditOverlay.remove()
          node._dazWan22EditOverlay = null
        }
        node._dazWan22EditMode = false

        await reloadNodeConfigs(node)
        updateGroupFilterWidget(node)

        if (result.config_deleted) {
          if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
          node._dazTypeFilter = 'All'
          if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
          node._dazGroupFilter = 'All'
          syncWidget(node)
          const configWidget    = node.widgets?.find(w => w.name === 'config')
          const remainingLabels = filteredLabels(node._dazAllConfigs || [], 'All', 'All')
          if (remainingLabels.length > 0) {
            if (configWidget) configWidget.value = remainingLabels[0]
            await reloadVersionWidget(node, remainingLabels[0])
            loadDetail(node, remainingLabels[0], node._dazVersionWidget?.value)
          } else {
            if (configWidget) { configWidget.options.values = ['(no configs)']; configWidget.value = '(no configs)' }
            node._dazWan22Detail = {}
            renderUseMode(node, {})
          }
        } else {
          syncWidget(node)
          const configWidget = node.widgets?.find(w => w.name === 'config')
          if (configWidget && configWidget.value !== '(no configs)') {
            await reloadVersionWidget(node, configWidget.value)
            loadDetail(node, configWidget.value, node._dazVersionWidget?.value)
          }
        }
      } catch (e) {
        if (panelBody) {
          panelBody.innerHTML = `
            <p style="font-family:monospace;font-size:12px;color:#f88;padding:12px">Delete failed: ${esc(e.message)}</p>
            <div style="padding:0 12px 12px;display:flex;justify-content:flex-end">
              <button id="daz-back-edit"
                style="font-family:monospace;font-size:11px;padding:3px 10px;background:#444;
                       color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Back</button>
            </div>`
          panelBody.querySelector('#daz-back-edit')?.addEventListener('click', () => {
            if (node._dazWan22EditOverlay) {
              node._dazWan22EditOverlay.remove()
              node._dazWan22EditOverlay = null
            }
            enterEditForm(node, false)
          })
        }
      }
    }

    // ── Delete config confirm ─────────────────────────────────────────────────

    function showDeleteConfigConfirm(node, wrap) {
      const name  = node._dazWan22Detail?.name || '?'
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
        'padding:20px 24px;width:360px;font-family:monospace',
      ].join(';')
      box.innerHTML = `
        <p style="font-size:13px;color:#ddd;margin:0 0 6px">
          Delete all versions of &ldquo;${esc(name)}&rdquo;?
        </p>
        <p style="font-size:11px;color:#888;margin:0 0 18px">This cannot be undone.</p>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="dc-keep"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Keep</button>
          <button id="dc-confirm"
            style="font-family:monospace;font-size:11px;padding:4px 14px;
                   background:#5c1a1a;color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer">Delete All</button>
        </div>
      `
      overlay.appendChild(box)
      document.body.appendChild(overlay)
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
      box.querySelector('#dc-keep')?.addEventListener('click', () => overlay.remove())
      box.querySelector('#dc-confirm')?.addEventListener('click', () => {
        overlay.remove()
        deleteConfig(node, label)
      })
    }

    async function deleteConfig(node, label) {
      const editOverlay = node._dazWan22EditOverlay
      const panelBody   = editOverlay?.querySelector('[data-daz-panel-body]')
      if (panelBody) panelBody.innerHTML =
        '<p style="font-family:monospace;font-size:12px;color:#555;padding:16px">Deleting…</p>'

      try {
        const r = await fetch('/daz/workflow-config-delete', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ label, class: CLASS, file: currentFile(node), delete_mode: 'config' }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        if (node._dazWan22EditOverlay) {
          node._dazWan22EditOverlay.remove()
          node._dazWan22EditOverlay = null
        }
        node._dazWan22EditMode = false

        await reloadNodeConfigs(node)
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        node._dazTypeFilter = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        node._dazGroupFilter = 'All'
        syncWidget(node)
        const configWidget    = node.widgets?.find(w => w.name === 'config')
        const remainingLabels = filteredLabels(node._dazAllConfigs || [], 'All', 'All')

        if (remainingLabels.length > 0) {
          if (configWidget) configWidget.value = remainingLabels[0]
          await reloadVersionWidget(node, remainingLabels[0])
          loadDetail(node, remainingLabels[0], node._dazVersionWidget?.value)
        } else {
          if (configWidget) { configWidget.options.values = ['(no configs)']; configWidget.value = '(no configs)' }
          node._dazWan22Detail = {}
          renderUseMode(node, {})
        }
      } catch (e) {
        if (panelBody) {
          panelBody.innerHTML = `
            <p style="font-family:monospace;font-size:12px;color:#f88;padding:12px">Delete failed: ${esc(e.message)}</p>
            <div style="padding:0 12px 12px;display:flex;justify-content:flex-end">
              <button id="daz-back-edit"
                style="font-family:monospace;font-size:11px;padding:3px 10px;background:#444;
                       color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Back</button>
            </div>`
          panelBody.querySelector('#daz-back-edit')?.addEventListener('click', () => {
            if (node._dazWan22EditOverlay) {
              node._dazWan22EditOverlay.remove()
              node._dazWan22EditOverlay = null
            }
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

      this._dazAllConfigs      = _initialConfigs.slice()
      this._dazConfigFile      = _configFiles[0]?.file ?? null
      this._dazTypeFilter      = 'All'
      this._dazGroupFilter     = 'All'
      this._dazCurrentVersion  = '1'

      // ── config_file picker widget ─────────────────────────────────────────
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
          if (!this._dazWan22EditMode) {
            const cw = this.widgets?.find(w => w.name === 'config')
            if (cw) {
              await reloadVersionWidget(this, cw.value)
              loadDetail(this, cw.value, this._dazVersionWidget?.value)
            }
          }
        }
      }

      // ── version widget ────────────────────────────────────────────────────
      const versionWidget = this.widgets?.find(w => w.name === 'version')
      if (versionWidget) {
        this._dazVersionWidget = versionWidget
        const origVwCb = versionWidget.callback
        versionWidget.callback = (value) => {
          origVwCb?.call(this, value)
          this._dazCurrentVersion = value
          if (!this._dazWan22EditMode) {
            const cw = this.widgets?.find(w => w.name === 'config')
            if (cw && cw.value !== '(no configs)') loadDetail(this, cw.value, value)
          }
        }
      }

      // ── Type / Group filter widgets ───────────────────────────────────────
      const typeFilterWidget = this.addWidget('combo', 'Type', 'All', (value) => {
        this._dazTypeFilter = value
        updateGroupFilterWidget(this)
        syncWidget(this)
        if (!this._dazWan22EditMode) {
          const cw = this.widgets?.find(w => w.name === 'config')
          if (cw && cw.value !== '(no configs)') loadDetail(this, cw.value, this._dazCurrentVersion)
        }
      }, { values: ['All', 'I2V', 'T2V', 'MULTI'] })
      this._dazTypeFilterWidget = typeFilterWidget

      const initialGroups = ['All', ...Array.from(new Set(_initialConfigs.map(c => c.group).filter(Boolean))).sort()]
      const groupFilterWidget = this.addWidget('combo', 'Group', 'All', (value) => {
        this._dazGroupFilter = value
        syncWidget(this)
        if (!this._dazWan22EditMode) {
          const cw = this.widgets?.find(w => w.name === 'config')
          if (cw && cw.value !== '(no configs)') loadDetail(this, cw.value, this._dazCurrentVersion)
        }
      }, { values: initialGroups })
      this._dazGroupFilterWidget = groupFilterWidget

      // Reposition Type/Group filters before the config widget
      const ci = this.widgets.findIndex(w => w.name === 'config')
      if (ci >= 0) {
        ;[typeFilterWidget, groupFilterWidget].forEach(fw => {
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
          if (this._dazWan22EditMode) return
          const labels = filteredLabels(this._dazAllConfigs || [], this._dazTypeFilter || 'All', this._dazGroupFilter || 'All')
          if (!labels.length) {
            renderUseMode(this, {})
            return
          }
          const cw = this.widgets?.find(w => w.name === 'config')
          if (cw) {
            await reloadVersionWidget(this, cw.value)
            loadDetail(this, cw.value, this._dazVersionWidget?.value)
          }
        } catch (e) {
          console.warn('[DAZ TOOLS] WorkflowConfigWan22: reload failed', e)
        }
      })

      const wrap = document.createElement('div')
      wrap.style.cssText =
        `box-sizing:border-box;padding:6px 0;overflow-y:auto;overflow-x:hidden;width:100%;height:${PANEL_H}px`
      this._dazWan22Wrap     = wrap
      this._dazWan22EditMode = false

      const self = this
      this.addDOMWidget('daz_wan22_detail', 'html', wrap, {
        getValue:     () => '',
        setValue:     () => {},
        getMinHeight: () => PANEL_H,
        hideOnZoom:   false,
      })

      this.size    = [NODE_W, NODE_H]
      this.minSize = [NODE_W, NODE_H]

      const w = this.widgets?.find(w => w.name === 'config')
      if (w) {
        const origCb = w.callback
        w.callback = async (value) => {
          origCb?.call(this, value)
          if (!this._dazWan22EditMode) {
            await reloadVersionWidget(this, value)
            loadDetail(this, value, this._dazVersionWidget?.value)
          }
        }
        if ((this._dazAllConfigs || []).length === 0) {
          renderUseMode(this, {})
        } else {
          reloadVersionWidget(this, w.value).then(() => {
            loadDetail(this, w.value, this._dazVersionWidget?.value)
          })
        }
      }

      const executedHandler = ({ detail }) => {
        if (String(detail.node) !== String(this.id)) return
        if (this._dazWan22EditMode) return
        const cw = this.widgets?.find(w => w.name === 'config')
        if (cw && cw.value && cw.value !== '(no configs)') loadDetail(this, cw.value, this._dazCurrentVersion)
      }
      api.addEventListener('executed', executedHandler)
      this._dazWan22ExecutedHandler = executedHandler
    }

    const onRemoved = nodeType.prototype.onRemoved
    nodeType.prototype.onRemoved = function () {
      onRemoved?.apply(this, arguments)
      if (this._dazWan22ExecutedHandler) {
        api.removeEventListener('executed', this._dazWan22ExecutedHandler)
      }
      if (this._dazWan22EditOverlay) {
        this._dazWan22EditOverlay.remove()
        this._dazWan22EditOverlay = null
      }
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments)
      const savedVersion = this._dazVersionWidget?.value || '1'
      const self = this
      queueMicrotask(async () => {
        if (self._dazConfigFileWidget) {
          const savedFile = self._dazConfigFileWidget.value
          const isValidFile = savedFile && savedFile !== '(default)' &&
            savedFile.startsWith('dx_') && savedFile.endsWith('.json')
          self._dazConfigFile = isValidFile ? savedFile : null
          if (!isValidFile) self._dazConfigFileWidget.value = '(default)'
          if (self._dazConfigFile !== null) await reloadNodeConfigs(self)
        }
        if (self._dazTypeFilterWidget)  self._dazTypeFilter  = self._dazTypeFilterWidget.value  || 'All'
        if (self._dazGroupFilterWidget) self._dazGroupFilter = self._dazGroupFilterWidget.value || 'All'
        updateGroupFilterWidget(self)
        if (!(self._dazAllConfigs || []).length) {
          if (!self._dazWan22EditMode) renderUseMode(self, {})
          return
        }
        const w = self.widgets?.find(w => w.name === 'config')
        const labels = filteredLabels(self._dazAllConfigs || [], self._dazTypeFilter, self._dazGroupFilter)
        if (w && !labels.includes(w.value)) syncWidget(self)
        await reloadVersionWidget(self, w?.value, savedVersion)
        self._dazCurrentVersion = self._dazVersionWidget?.value || '1'
        if (!self._dazWan22EditMode) loadDetail(self, w?.value, self._dazCurrentVersion)
      })
    }
  },
})
