import { app } from '../../scripts/app.js'

const CSS = `
.daz-md-wrap {
  box-sizing: border-box;
  padding: 10px 14px;
  overflow-y: auto;
  max-height: 600px;
  color: #ddd;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
}
.daz-md-wrap h1 { font-size: 1.4em; font-weight: bold; margin: 0.4em 0 0.2em; color: #fff; border-bottom: 1px solid #555; padding-bottom: 0.2em; }
.daz-md-wrap h2 { font-size: 1.15em; font-weight: bold; margin: 0.8em 0 0.2em; color: #ccc; }
.daz-md-wrap h3 { font-size: 1em; font-weight: bold; margin: 0.6em 0 0.1em; color: #aaa; }
.daz-md-wrap p  { margin: 0.3em 0; }
.daz-md-wrap hr { border: none; border-top: 1px solid #444; margin: 0.6em 0; }
.daz-md-wrap table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
.daz-md-wrap th, .daz-md-wrap td { border: 1px solid #555; padding: 5px 8px; text-align: left; }
.daz-md-wrap th { background: rgba(255,255,255,0.08); }
.daz-md-wrap code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; }
.daz-md-wrap strong { color: #fff; }
`

function injectStyles() {
  if (document.getElementById('daz-md-styles')) return
  const style = document.createElement('style')
  style.id = 'daz-md-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}

async function renderMarkdown(text) {
  if (window.MTB?.mdParser) {
    try {
      return await MTB.mdParser.parse(text)
    } catch (_) {}
  }
  // Fallback: minimal markdown → HTML (no table support; MTB handles those)
  const BLOCK = /^(<h[123]>|<hr>)/
  return text
    .split('\n')
    .map(line => {
      const esc = line
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const processed = esc
        .replace(/^### (.+)$/, '<h3>$1</h3>')
        .replace(/^## (.+)$/,  '<h2>$1</h2>')
        .replace(/^# (.+)$/,   '<h1>$1</h1>')
        .replace(/^---$/,      '<hr>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g,     '<code>$1</code>')
      return BLOCK.test(processed) ? processed : (processed || '<br>')
    })
    .join('\n')
}

app.registerExtension({
  name: 'daz.markdownDisplay',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'MarkdownDisplay') return

    injectStyles()

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)

      const wrap = document.createElement('div')
      wrap.classList.add('daz-md-wrap')
      wrap.textContent = 'Waiting for input…'

      this._dazMdWrap = wrap
      this._dazMdText = ''

      this.addDOMWidget('daz_markdown', 'div', wrap, {
        getValue: () => this._dazMdText,
        setValue: (v) => { this._dazMdText = v },
        getMinHeight: () => 120,
        hideOnZoom: false,
      })

      this.setSize([420, 300])
    }

    const onExecuted = nodeType.prototype.onExecuted
    nodeType.prototype.onExecuted = function (msg) {
      onExecuted?.apply(this, arguments)
      const md = msg?.markdown?.[0]
      if (!md || !this._dazMdWrap) return
      this._dazMdText = md
      renderMarkdown(md).then(html => {
        this._dazMdWrap.innerHTML = html
        this.setDirtyCanvas(true, true)
      })
    }
  },
})
