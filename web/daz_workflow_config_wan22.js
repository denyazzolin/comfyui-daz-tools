import { app } from '../../scripts/app.js'

const PANEL_H      = 220
const EDIT_PANEL_H = 370
const NODE_W       = 460
const NODE_H       = 350
const NODE_H_EDIT  = 500

app.registerExtension({
  name: 'daz.workflowConfigWan22',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'WorkflowConfigWan22') return

    const CLASS = 'Wan2.2'

    let configLabels = []
    try {
      const resp = await fetch(`/daz/workflow-configs?class=${encodeURIComponent(CLASS)}`)
      if (resp.ok) configLabels = await resp.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not load configs', e)
    }

    // Lazily fetched model file lists, keyed by folder name
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    function syncWidget(node) {
      const w = node.widgets?.find(w => w.name === 'config')
      if (!w) return
      w.options.values = configLabels.length ? configLabels : ['(no configs)']
      if (!configLabels.includes(w.value)) {
        w.value = configLabels[0] ?? '(no configs)'
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
        <td style="color:#ddd;padding:3px 10px;word-break:break-all">${v}</td>
      </tr>`
    }

    function renderDetailHtml(data) {
      if (data.error) {
        return `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">${esc(data.error)}</p>`
      }
      return `<table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
        ${row('UNet High',  data.unet_high)}
        ${row('UNet Low',   data.unet_low)}
        ${row('VAE',        data.vae)}
        ${row('CLIP',       data.clip)}
        ${row('Image',      data.image_path)}
        ${row('Resolution', data.width && data.height ? `${data.width} × ${data.height}` : '')}
        ${row('Steps',      data.steps)}
        ${row('Split Step', data.split_step)}
      </table>`
    }

    // ── Use mode ──────────────────────────────────────────────────────────────

    function renderUseMode(node, data, wasEditing = false) {
      node._dazWan22EditMode = false
      const wrap = node._dazWan22Wrap
      if (!wrap) return

      wrap.style.height = PANEL_H + 'px'
      if (wasEditing) {
        node.size    = [NODE_W, NODE_H]
        node.minSize = [NODE_W, NODE_H]
      }

      wrap.innerHTML = `
        <div style="display:flex;justify-content:flex-end;padding:0 6px 4px">
          <button id="daz-edit-btn"
            style="font-family:monospace;font-size:11px;padding:2px 10px;
                   background:#444;color:#ccc;border:1px solid #666;
                   border-radius:3px;cursor:pointer">Edit</button>
        </div>
        ${renderDetailHtml(data)}
      `
      wrap.querySelector('#daz-edit-btn')?.addEventListener('click', () => enterEditForm(node, false))
      node.setDirtyCanvas(true, true)
    }

    async function loadDetail(node, label) {
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
        const resp = await fetch(
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(label)}`
        )
        if (!resp.ok) throw new Error(resp.statusText)
        const data = await resp.json()
        node._dazWan22Detail = data
        renderUseMode(node, data)
      } catch (e) {
        node._dazWan22Wrap.innerHTML =
          `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">Error: ${esc(e.message)}</p>`
      }
      node.setDirtyCanvas(true, true)
    }

    // ── Edit / New-config form (unified) ──────────────────────────────────────

    async function enterEditForm(node, isNew = false) {
      node._dazWan22EditMode = true
      const wrap = node._dazWan22Wrap
      if (!wrap) return

      wrap.style.height = EDIT_PANEL_H + 'px'
      wrap.innerHTML = '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Loading…</p>'
      node.size    = [NODE_W, NODE_H_EDIT]
      node.minSize = [NODE_W, NODE_H_EDIT]
      node.setDirtyCanvas(true, true)

      const [unetFiles, vaeFiles, clipFiles, inputFiles] = await Promise.all([
        getFolderFiles('diffusion_models'),
        getFolderFiles('vae'),
        getFolderFiles('text_encoders'),
        getFolderFiles('input'),
      ])

      const data = node._dazWan22Detail || {}
      const rawImagePath = data.image_path || ''
      const imageName = rawImagePath.split(/[\\/]/).pop() || ''

      function selectOpts(files, current) {
        if (!files.length) return `<option value="">— no files found —</option>`
        return files.map(f =>
          `<option value="${esc(f)}"${f === current ? ' selected' : ''}>${esc(f)}</option>`
        ).join('')
      }

      function selectOptsImage(files, current) {
        const placeholder = (!current || !files.includes(current))
          ? `<option value="">— select image —</option>`
          : ''
        return placeholder + selectOpts(files, current)
      }

      const fieldStyle = 'width:100%;background:#2b2b2b;color:#ddd;border:1px solid #555;border-radius:4px;font-size:11px;font-family:monospace;padding:2px 4px;box-sizing:border-box'
      const numStyle   = 'width:80px;background:#2b2b2b;color:#ddd;border:1px solid #555;border-radius:4px;font-size:11px;font-family:monospace;padding:2px 4px'
      const tdL        = 'style="color:#999;padding:3px 8px;white-space:nowrap;vertical-align:middle;font-size:11px;font-family:monospace"'
      const tdR        = 'style="padding:3px 8px"'
      const btnBase    = 'font-family:monospace;font-size:11px;padding:3px 12px;border-radius:3px;cursor:pointer;border:1px solid'

      const header = isNew
        ? `<div style="font-family:monospace;font-size:12px;padding:5px 8px 6px;
                       color:#aaa;border-bottom:1px solid #3a3a3a;margin-bottom:4px">
             New Configuration
           </div>`
        : `<div style="font-family:monospace;font-size:12px;padding:5px 8px 6px;
                       color:#aaa;border-bottom:1px solid #3a3a3a;margin-bottom:4px">
             Editing: <span style="color:#ddd">${esc(data.name || '')}</span>
           </div>`

      const nameRow = isNew
        ? `<tr>
             <td ${tdL}>Name</td>
             <td ${tdR}><input id="daz-config-name" type="text" placeholder="Config name…"
               style="${fieldStyle}"></td>
           </tr>`
        : ''

      const footer = isNew
        ? `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;
                       justify-content:flex-end;border-top:1px solid #3a3a3a;margin-top:4px">
             <span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace"></span>
             <button id="daz-create-btn" style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Create</button>
           </div>`
        : `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;
                       justify-content:flex-end;border-top:1px solid #3a3a3a;margin-top:4px">
             <span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace"></span>
             <button id="daz-delete-btn" style="${btnBase} #803030;background:#5c1a1a;color:#f99;margin-right:auto">Delete</button>
             <button id="daz-cancel-btn" style="${btnBase} #666;background:#444;color:#ccc">Cancel</button>
             <button id="daz-save-btn"   style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Save</button>
           </div>`

      wrap.innerHTML = `
        ${header}
        <table style="border-collapse:collapse;width:100%">
          ${nameRow}
          <tr>
            <td ${tdL}>UNet High</td>
            <td ${tdR}><select id="daz-unet-high" style="${fieldStyle}">${selectOpts(unetFiles, data.unet_high)}</select></td>
          </tr>
          <tr>
            <td ${tdL}>UNet Low</td>
            <td ${tdR}><select id="daz-unet-low" style="${fieldStyle}">${selectOpts(unetFiles, data.unet_low)}</select></td>
          </tr>
          <tr>
            <td ${tdL}>VAE</td>
            <td ${tdR}><select id="daz-vae" style="${fieldStyle}">${selectOpts(vaeFiles, data.vae)}</select></td>
          </tr>
          <tr>
            <td ${tdL}>CLIP</td>
            <td ${tdR}><select id="daz-clip" style="${fieldStyle}">${selectOpts(clipFiles, data.clip)}</select></td>
          </tr>
          <tr>
            <td ${tdL}>Image</td>
            <td ${tdR}>
              <div style="display:flex;gap:4px;align-items:center">
                <select id="daz-image-path" style="${fieldStyle}">${selectOptsImage(inputFiles, imageName)}</select>
                <button id="daz-preview-btn"
                  style="font-family:monospace;font-size:11px;padding:2px 7px;background:#444;color:#ccc;
                         border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Preview</button>
                <button id="daz-upload-btn"
                  style="font-family:monospace;font-size:11px;padding:2px 7px;background:#444;color:#ccc;
                         border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Upload…</button>
                <input id="daz-upload-input" type="file" accept="image/*" style="display:none">
              </div>
            </td>
          </tr>
          <tr>
            <td ${tdL}>Width</td>
            <td ${tdR}><input id="daz-width" type="number" value="${data.width || 0}" style="${numStyle}"></td>
          </tr>
          <tr>
            <td ${tdL}>Height</td>
            <td ${tdR}><input id="daz-height" type="number" value="${data.height || 0}" style="${numStyle}"></td>
          </tr>
          <tr>
            <td ${tdL}>Steps</td>
            <td ${tdR}><input id="daz-steps" type="number" value="${data.steps || 0}" style="${numStyle}"></td>
          </tr>
          <tr>
            <td ${tdL}>Split Step</td>
            <td ${tdR}><input id="daz-split-step" type="number" value="${data.split_step || 0}" style="${numStyle}"></td>
          </tr>
        </table>
        ${footer}
      `

      // ── Shared handlers ───────────────────────────────────────────────────

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
      } else {
        wrap.querySelector('#daz-cancel-btn')?.addEventListener('click', () => {
          renderUseMode(node, node._dazWan22Detail || {}, true)
        })
        wrap.querySelector('#daz-delete-btn')?.addEventListener('click', () => {
          showDeleteConfirm(node, wrap)
        })
        wrap.querySelector('#daz-save-btn')?.addEventListener('click', () => saveConfig(node, wrap))
      }

      node.setDirtyCanvas(true, true)
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
        class:      CLASS,
        unet_high:  wrap.querySelector('#daz-unet-high')?.value  ?? '',
        unet_low:   wrap.querySelector('#daz-unet-low')?.value   ?? '',
        vae:        wrap.querySelector('#daz-vae')?.value        ?? '',
        clip:       wrap.querySelector('#daz-clip')?.value       ?? '',
        image_path: wrap.querySelector('#daz-image-path')?.value ?? '',
        width:      parseInt(wrap.querySelector('#daz-width')?.value      ?? '0', 10),
        height:     parseInt(wrap.querySelector('#daz-height')?.value     ?? '0', 10),
        steps:      parseInt(wrap.querySelector('#daz-steps')?.value      ?? '0', 10),
        split_step: parseInt(wrap.querySelector('#daz-split-step')?.value ?? '0', 10),
      }

      try {
        const r = await fetch('/daz/workflow-config-create', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        const labelsResp = await fetch(`/daz/workflow-configs?class=${encodeURIComponent(CLASS)}`)
        if (labelsResp.ok) configLabels = await labelsResp.json()

        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) {
          configWidget.options.values = configLabels.length ? configLabels : ['(no configs)']
          configWidget.value = result.label
        }

        const detailResp = await fetch(
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}`
        )
        if (detailResp.ok) node._dazWan22Detail = await detailResp.json()

        renderUseMode(node, node._dazWan22Detail || {}, true)
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
      saveBtn.textContent = 'Saving…'
      saveBtn.disabled    = true
      errorDiv.textContent = ''

      const payload = {
        label,
        class:      CLASS,
        unet_high:  wrap.querySelector('#daz-unet-high')?.value  ?? '',
        unet_low:   wrap.querySelector('#daz-unet-low')?.value   ?? '',
        vae:        wrap.querySelector('#daz-vae')?.value        ?? '',
        clip:       wrap.querySelector('#daz-clip')?.value       ?? '',
        image_path: wrap.querySelector('#daz-image-path')?.value ?? '',
        width:      parseInt(wrap.querySelector('#daz-width')?.value      ?? '0', 10),
        height:     parseInt(wrap.querySelector('#daz-height')?.value     ?? '0', 10),
        steps:      parseInt(wrap.querySelector('#daz-steps')?.value      ?? '0', 10),
        split_step: parseInt(wrap.querySelector('#daz-split-step')?.value ?? '0', 10),
      }

      try {
        const r = await fetch('/daz/workflow-config-save', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        const labelsResp = await fetch(`/daz/workflow-configs?class=${encodeURIComponent(CLASS)}`)
        if (labelsResp.ok) configLabels = await labelsResp.json()

        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) {
          configWidget.options.values = configLabels.length ? configLabels : ['(no configs)']
          configWidget.value = result.label
        }

        const detailResp = await fetch(
          `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}`
        )
        if (detailResp.ok) node._dazWan22Detail = await detailResp.json()

        renderUseMode(node, node._dazWan22Detail || {}, true)
      } catch (e) {
        saveBtn.textContent = 'Save'
        saveBtn.disabled    = false
        errorDiv.textContent = `Error: ${e.message}`
      }
    }

    // ── Delete config ─────────────────────────────────────────────────────────

    function showDeleteConfirm(node, wrap) {
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
      const wrap = node._dazWan22Wrap
      if (wrap) {
        wrap.innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Deleting…</p>'
      }

      try {
        const r = await fetch('/daz/workflow-config-delete', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ label, class: CLASS }),
        })
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || r.statusText)

        const labelsResp = await fetch(`/daz/workflow-configs?class=${encodeURIComponent(CLASS)}`)
        if (labelsResp.ok) configLabels = await labelsResp.json()

        const configWidget = node.widgets?.find(w => w.name === 'config')

        if (configLabels.length > 0) {
          if (configWidget) {
            configWidget.options.values = configLabels
            configWidget.value = configLabels[0]
          }
          node._dazWan22EditMode = false
          loadDetail(node, configLabels[0])
        } else {
          if (configWidget) {
            configWidget.options.values = ['(no configs)']
            configWidget.value = '(no configs)'
          }
          node._dazWan22Detail   = {}
          node._dazWan22EditMode = false
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
            node._dazWan22EditMode = false
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
      syncWidget(this)

      this.addWidget('button', '↺  Reload Configs', null, () => {
        fetch(`/daz/workflow-configs?class=${encodeURIComponent(CLASS)}`)
          .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
          .then(labels => {
            configLabels = labels
            syncWidget(this)
            if (this._dazWan22EditMode) return
            if (!labels.length) {
              enterEditForm(this, true)
              return
            }
            const cw = this.widgets?.find(w => w.name === 'config')
            if (cw) loadDetail(this, cw.value)
          })
          .catch(e => console.warn('[DAZ TOOLS] WorkflowConfigWan22: reload failed', e))
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
        getMinHeight: () => self._dazWan22EditMode ? EDIT_PANEL_H : PANEL_H,
        hideOnZoom:   false,
      })

      // Default size — enterEditForm overrides this synchronously if needed
      this.size    = [NODE_W, NODE_H]
      this.minSize = [NODE_W, NODE_H]

      const w = this.widgets?.find(w => w.name === 'config')
      if (w) {
        const origCb = w.callback
        w.callback = (value) => {
          origCb?.call(this, value)
          if (!this._dazWan22EditMode) loadDetail(this, value)
        }
        if (configLabels.length === 0) {
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
      queueMicrotask(() => {
        if (!configLabels.length) {
          if (!self._dazWan22EditMode) enterEditForm(self, true)
          return
        }
        const w = self.widgets?.find(w => w.name === 'config')
        if (w && !configLabels.includes(w.value)) syncWidget(self)
        if (!self._dazWan22EditMode) loadDetail(self, w?.value)
      })
    }
  },
})
