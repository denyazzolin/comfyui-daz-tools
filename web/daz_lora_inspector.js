import { app } from '../../scripts/app.js'

app.registerExtension({
  name: 'daz.loraInspector',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'LoraInspector') return

    let lorasByCategory = {}
    try {
      const resp = await fetch('/daz/loras-by-category')
      if (resp.ok) lorasByCategory = await resp.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] LoraInspector: could not load category data', e)
    }

    function syncLoraWidget(node) {
      const catWidget  = node.widgets?.find(w => w.name === 'category')
      const loraWidget = node.widgets?.find(w => w.name === 'lora')
      if (!catWidget || !loraWidget) return
      const loras = lorasByCategory[catWidget.value] || []
      loraWidget.options.values = loras.length ? loras : ['(no loras found)']
      if (!loras.includes(loraWidget.value)) {
        loraWidget.value = loras[0] ?? '(no loras found)'
      }
    }

    async function loadPreview(node, loraValue) {
      if (!node._dazLoraWrap) return
      const placeholder = (msg) =>
        `<p style="font-family:monospace;font-size:13px;color:#666;padding:6px">${msg}</p>`

      if (!loraValue || loraValue === '(no loras found)') {
        node._dazLoraWrap.innerHTML = placeholder('Select a lora to preview.')
        return
      }

      const idx  = loraValue.indexOf(' - ')
      const path = idx >= 0 ? loraValue.slice(idx + 3) : loraValue
      node._dazLoraWrap.innerHTML = placeholder('Loading…')

      try {
        const resp = await fetch(`/daz/lora-info?path=${encodeURIComponent(path)}`)
        if (!resp.ok) throw new Error(resp.statusText)
        const data = await resp.json()
        node._dazLoraWrap.innerHTML = data.html
      } catch (e) {
        const msg = String(e.message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        node._dazLoraWrap.innerHTML = placeholder(`Error: ${msg}`)
      }

      node.setDirtyCanvas(true, true)
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)

      const catWidget  = this.widgets?.find(w => w.name === 'category')
      const loraWidget = this.widgets?.find(w => w.name === 'lora')

      if (catWidget) {
        syncLoraWidget(this)
        const origCatCb = catWidget.callback
        catWidget.callback = (value) => {
          origCatCb?.call(this, value)
          syncLoraWidget(this)
          const lw = this.widgets?.find(w => w.name === 'lora')
          if (lw) loadPreview(this, lw.value)
        }
      }

      this._dazLoraHeight = 350
      const wrap = document.createElement('div')
      wrap.style.cssText = `box-sizing:border-box;padding:10px 14px;overflow-y:auto;overflow-x:hidden;width:100%;height:${this._dazLoraHeight}px`
      this._dazLoraWrap = wrap

      this.addDOMWidget('daz_lora_preview', 'html', wrap, {
        getValue:     () => '',
        setValue:     () => {},
        getMinHeight: () => this._dazLoraHeight,
        hideOnZoom:   false,
      })

      if (loraWidget) {
        const origLoraCb = loraWidget.callback
        loraWidget.callback = (value) => {
          origLoraCb?.call(this, value)
          loadPreview(this, value)
        }
        loadPreview(this, loraWidget.value)
      }

      this.setSize([480, 560])
      this._dazSyncSize()
    }

    nodeType.prototype._dazSyncSize = function () {
      const titleH  = LiteGraph.NODE_TITLE_HEIGHT  ?? 30
      const widgetH = LiteGraph.NODE_WIDGET_HEIGHT ?? 20
      // Use 32px margin so the panel never pushes the node taller than its set size.
      const h = Math.max(150, this.size[1] - titleH - widgetH * 3 - 32)
      this._dazLoraHeight = h
      if (this._dazLoraWrap) this._dazLoraWrap.style.height = h + 'px'
    }

    const onResize = nodeType.prototype.onResize
    nodeType.prototype.onResize = function (size) {
      onResize?.apply(this, arguments)
      this._dazSyncSize()
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments)
      const self = this
      queueMicrotask(() => {
        self._dazSyncSize()
        syncLoraWidget(self)
        const lw = self.widgets?.find(w => w.name === 'lora')
        if (lw) loadPreview(self, lw.value)
      })
    }
  },
})
