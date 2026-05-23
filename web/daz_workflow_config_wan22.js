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
      wrap.querySelector('#daz-edit-btn')?.addEventListener('click', () => enterEditMode(node))
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

    // ── Edit mode ─────────────────────────────────────────────────────────────

    async function enterEditMode(node) {
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

      // Extract just the filename from an absolute path (for pre-selecting in the dropdown)
      const rawImagePath = data.image_path || ''
      const imageName = rawImagePath.split(/[\\/]/).pop() || ''

      function selectOpts(files, current) {
        return files.map(f =>
          `<option value="${esc(f)}"${f === current ? ' selected' : ''}>${esc(f)}</option>`
        ).join('')
      }

      // Image dropdown: add a blank placeholder when the stored value isn't in the input folder
      function selectOptsImage(files, current) {
        const placeholder = (!current || !files.includes(current))
          ? `<option value="">— select image —</option>`
          : ''
        return placeholder + selectOpts(files, current)
      }

      const fieldStyle = 'width:100%;background:#2b2b2b;color:#ddd;border:1px solid #555;font-size:11px;font-family:monospace;padding:2px 4px;box-sizing:border-box'
      const numStyle   = 'width:80px;background:#2b2b2b;color:#ddd;border:1px solid #555;font-size:11px;font-family:monospace;padding:2px 4px'
      const tdL        = 'style="color:#999;padding:3px 8px;white-space:nowrap;vertical-align:middle;font-size:11px;font-family:monospace"'
      const tdR        = 'style="padding:3px 8px"'

      wrap.innerHTML = `
        <div style="font-family:monospace;font-size:12px;padding:5px 8px 6px;
                    color:#aaa;border-bottom:1px solid #3a3a3a;margin-bottom:4px">
          Editing: <span style="color:#ddd">${esc(data.name || '')}</span>
        </div>
        <table style="border-collapse:collapse;width:100%">
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
        <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;justify-content:flex-end;border-top:1px solid #3a3a3a;margin-top:4px">
          <span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace"></span>
          <button id="daz-cancel-btn"
            style="font-family:monospace;font-size:11px;padding:3px 12px;background:#444;color:#ccc;
                   border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
          <button id="daz-save-btn"
            style="font-family:monospace;font-size:11px;padding:3px 12px;background:#1a5c35;color:#cde;
                   border:1px solid #2a8050;border-radius:3px;cursor:pointer">Save</button>
        </div>
      `

      wrap.querySelector('#daz-cancel-btn')?.addEventListener('click', () => {
        renderUseMode(node, node._dazWan22Detail || {}, true)
      })

      // Upload button triggers the hidden file input
      wrap.querySelector('#daz-upload-btn')?.addEventListener('click', () => {
        wrap.querySelector('#daz-upload-input')?.click()
      })

      // File selected → upload to ComfyUI input folder, refresh dropdown
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
          // Invalidate cache and refresh the dropdown
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

      wrap.querySelector('#daz-save-btn')?.addEventListener('click', () => saveConfig(node, wrap))

      node.setDirtyCanvas(true, true)
    }

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

        // Refresh labels and update widget
        const labelsResp = await fetch(`/daz/workflow-configs?class=${encodeURIComponent(CLASS)}`)
        if (labelsResp.ok) configLabels = await labelsResp.json()

        const configWidget = node.widgets?.find(w => w.name === 'config')
        if (configWidget) {
          configWidget.options.values = configLabels.length ? configLabels : ['(no configs)']
          configWidget.value = result.label
        }

        // Fetch updated detail and return to use mode
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

      const w = this.widgets?.find(w => w.name === 'config')
      if (w) {
        const origCb = w.callback
        w.callback = (value) => {
          origCb?.call(this, value)
          if (!this._dazWan22EditMode) loadDetail(this, value)
        }
        loadDetail(this, w.value)
      }

      this.size    = [NODE_W, NODE_H]
      this.minSize = [NODE_W, NODE_H]
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments)
      const self = this
      queueMicrotask(() => {
        const w = self.widgets?.find(w => w.name === 'config')
        if (w && !configLabels.includes(w.value)) syncWidget(self)
        if (!self._dazWan22EditMode) loadDetail(self, w?.value)
      })
    }
  },
})
