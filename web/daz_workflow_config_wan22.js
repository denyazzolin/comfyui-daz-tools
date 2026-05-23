import { app } from '../../scripts/app.js'

app.registerExtension({
  name: 'daz.workflowConfigWan22',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'WorkflowConfigWan22') return

    let configNames = []
    try {
      const resp = await fetch('/daz/workflow-configs-wan22')
      if (resp.ok) configNames = await resp.json()
    } catch (e) {
      console.warn('[DAZ TOOLS] WorkflowConfigWan22: could not load configs', e)
    }

    function syncWidget(node) {
      const w = node.widgets?.find(w => w.name === 'config')
      if (!w) return
      w.options.values = configNames.length ? configNames : ['(no configs)']
      if (!configNames.includes(w.value)) {
        w.value = configNames[0] ?? '(no configs)'
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
        if (w && configNames.includes(w.value)) return
        syncWidget(self)
      })
    }
  },
})
