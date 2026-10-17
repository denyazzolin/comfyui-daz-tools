import { app } from '../../scripts/app.js'

// Relabels the Media Splitter's outputs with the slot names its last run
// carried. The label is kept on the output itself, so it is saved with the
// workflow and comes back with it; an empty one hands the output back its own
// name. Matched by output name rather than position, so preview is never touched.
app.registerExtension({
  name: 'daz.mediaSplitter',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'daz_media_splitter') return

    const onExecuted = nodeType.prototype.onExecuted
    nodeType.prototype.onExecuted = function (msg) {
      onExecuted?.apply(this, arguments)
      const pairs = msg?.labels
      if (!Array.isArray(pairs)) return
      for (const pair of pairs) {
        if (!Array.isArray(pair)) continue
        const [name, label] = pair
        const out = this.outputs?.find(o => o.name === name)
        if (!out) continue
        if (label) out.label = label
        else delete out.label
      }
      // Grown to fit a longer label, never shrunk below what the user set.
      const fit = this.computeSize()
      this.setSize([Math.max(this.size[0], fit[0]), Math.max(this.size[1], fit[1])])
      this.setDirtyCanvas(true, true)
    }
  },
})
