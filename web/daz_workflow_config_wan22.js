import { app } from '../../scripts/app.js'

const PANEL_H = 220
const NODE_W  = 460
const NODE_H  = 350  // title + dropdown + reload button + panel + margins

app.registerExtension({
  name: 'daz.workflowConfigWan22',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'WorkflowConfigWan22') return

    let configLabels = []
    try {
      const resp = await fetch('/daz/workflow-configs-wan22')
      if (resp.ok) configLabels = await resp.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not load configs', e)
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

    function renderDetail(data) {
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

    async function loadDetail(node, label) {
      if (!node._dazWan22Wrap) return
      if (!label || label === '(no configs)') {
        node._dazWan22Wrap.innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Select a config to preview.</p>'
        return
      }
      node._dazWan22Wrap.innerHTML =
        '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Loading…</p>'
      try {
        const resp = await fetch(`/daz/workflow-config-wan22-detail?label=${encodeURIComponent(label)}`)
        if (!resp.ok) throw new Error(resp.statusText)
        node._dazWan22Wrap.innerHTML = renderDetail(await resp.json())
      } catch (e) {
        node._dazWan22Wrap.innerHTML =
          `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">Error: ${esc(e.message)}</p>`
      }
      node.setDirtyCanvas(true, true)
    }

    // ── Lifecycle hooks ───────────────────────────────────────────────────────

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)
      syncWidget(this)

      const wrap = document.createElement('div')
      wrap.style.cssText =
        `box-sizing:border-box;padding:6px 0;overflow-y:auto;overflow-x:hidden;width:100%;height:${PANEL_H}px`
      this._dazWan22Wrap = wrap

      this.addDOMWidget('daz_wan22_detail', 'html', wrap, {
        getValue:     () => '',
        setValue:     () => {},
        getMinHeight: () => PANEL_H,
        hideOnZoom:   false,
      })

      const w = this.widgets?.find(w => w.name === 'config')
      if (w) {
        const origCb = w.callback
        w.callback = (value) => {
          origCb?.call(this, value)
          loadDetail(this, value)
        }
        loadDetail(this, w.value)
      }

      this.addWidget('button', '↺  Reload Configs', null, () => {
        fetch('/daz/workflow-configs-wan22')
          .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
          .then(labels => {
            configLabels = labels
            syncWidget(this)
            const cw = this.widgets?.find(w => w.name === 'config')
            if (cw) loadDetail(this, cw.value)
          })
          .catch(e => console.warn('[DAZ TOOLS] WorkflowConfigWan22: reload failed', e))
      })

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
        loadDetail(self, w?.value)
      })
    }
  },
})
