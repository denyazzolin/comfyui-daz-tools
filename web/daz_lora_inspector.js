import { app } from '../../scripts/app.js'

app.registerExtension({
  name: 'daz.loraInspector',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'LoraInspector') return

    // Fetch categorized data once at extension load time.
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

      // Keep current value if it still belongs to this category, else reset.
      if (!loras.includes(loraWidget.value)) {
        loraWidget.value = loras[0] ?? '(no loras found)'
      }
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)

      const catWidget = this.widgets?.find(w => w.name === 'category')
      if (!catWidget) return

      // Apply filter for the initial category.
      syncLoraWidget(this)

      // Re-filter whenever the category changes.
      const origCallback = catWidget.callback
      catWidget.callback = (value) => {
        origCallback?.call(this, value)
        syncLoraWidget(this)
      }
    }

    // Re-apply filter after a saved workflow restores widget values.
    // queueMicrotask ensures this runs after LiteGraph finishes setting all widget values.
    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments)
      const self = this
      queueMicrotask(() => syncLoraWidget(self))
    }
  },
})
