import { app } from '../../scripts/app.js'

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

    function syncWidget(node) {
      const w = node.widgets?.find(w => w.name === 'config')
      if (!w) return
      w.options.values = configLabels.length ? configLabels : ['(no configs)']
      if (!configLabels.includes(w.value)) {
        w.value = configLabels[0] ?? '(no configs)'
      }
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)
      syncWidget(this)
    }

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (config) {
      onConfigure?.apply(this, arguments)
      const self = this
      queueMicrotask(() => {
        const w = self.widgets?.find(w => w.name === 'config')
        // Restore saved value if it still exists; otherwise fall back to first.
        if (w && configLabels.includes(w.value)) return
        syncWidget(self)
      })
    }
  },
})
