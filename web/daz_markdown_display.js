import { app } from '../../scripts/app.js'

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.daz-md-wrap {
  box-sizing: border-box;
  padding: 10px 14px;
  overflow-y: auto;
  max-height: 600px;
  color: #ddd;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.6;
}
.daz-md-wrap h1 {
  font-size: 1.4em; font-weight: bold; color: #fff;
  border-bottom: 1px solid #555; padding-bottom: 0.2em;
  margin: 0.5em 0 0.3em;
}
.daz-md-wrap h2 {
  font-size: 1.15em; font-weight: bold; color: #adf;
  margin: 0.9em 0 0.2em;
}
.daz-md-wrap h3 {
  font-size: 1em; font-weight: bold; color: #aaa;
  margin: 0.6em 0 0.1em;
}
.daz-md-wrap hr {
  border: none; border-top: 1px solid #444; margin: 0.7em 0;
}
.daz-md-wrap table {
  border-collapse: collapse; width: 100%; margin: 0.5em 0;
}
.daz-md-wrap th, .daz-md-wrap td {
  border: 1px solid #555; padding: 5px 10px; text-align: left;
}
.daz-md-wrap th {
  background: rgba(255,255,255,0.08); color: #fff;
}
.daz-md-wrap tr:nth-child(even) td {
  background: rgba(255,255,255,0.03);
}
.daz-md-wrap code {
  background: rgba(255,255,255,0.1); padding: 1px 5px;
  border-radius: 3px; font-family: monospace;
}
.daz-md-wrap strong { color: #fff; }
.daz-md-wrap p { margin: 0.2em 0; }
`

function injectStyles() {
  if (document.getElementById('daz-md-styles')) return
  const style = document.createElement('style')
  style.id = 'daz-md-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function esc(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inlineFmt(text) {
  return esc(text)
    .replace(/\\\|/g, '&#124;')                        // escaped pipes → entity
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')  // **bold**
    .replace(/`([^`]+)`/g, '<code>$1</code>')          // `code`
}

function splitTableRow(line) {
  // Split on unescaped | and trim, strip leading/trailing |
  return line
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map(c => c.trim())
}

function renderTable(lines) {
  if (lines.length < 2) return lines.map(l => `<p>${inlineFmt(l)}</p>`).join('')
  const headers = splitTableRow(lines[0])
  const rows    = lines.slice(2).map(splitTableRow)   // skip separator row

  const thead = '<thead><tr>' +
    headers.map(h => `<th>${inlineFmt(h)}</th>`).join('') +
    '</tr></thead>'

  const tbody = '<tbody>' +
    rows.map(row =>
      '<tr>' + row.map(cell => `<td>${inlineFmt(cell)}</td>`).join('') + '</tr>'
    ).join('') +
    '</tbody>'

  return `<table>${thead}${tbody}</table>`
}

function renderMarkdown(text) {
  const lines = text.split('\n')
  const out   = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Header
    const hMatch = line.match(/^(#{1,3}) (.+)$/)
    if (hMatch) {
      const lvl = hMatch[1].length
      out.push(`<h${lvl}>${inlineFmt(hMatch[2])}</h${lvl}>`)
      i++; continue
    }

    // Horizontal rule
    if (line.trim() === '---') {
      out.push('<hr>')
      i++; continue
    }

    // Table block (collect contiguous pipe-starting lines)
    if (line.startsWith('|')) {
      const block = []
      while (i < lines.length && lines[i].startsWith('|')) {
        block.push(lines[i])
        i++
      }
      out.push(renderTable(block))
      continue
    }

    // Blank line — skip silently
    if (line.trim() === '') {
      i++; continue
    }

    // Paragraph
    out.push(`<p>${inlineFmt(line)}</p>`)
    i++
  }

  return out.join('\n')
}

// ── ComfyUI extension ─────────────────────────────────────────────────────────

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

      this.addDOMWidget('daz_markdown', 'html', wrap, {
        getValue:     () => this._dazMdText,
        setValue:     (v) => {
          this._dazMdText = v
          if (v) this._dazMdWrap.innerHTML = renderMarkdown(v)
        },
        getMinHeight: () => 120,
        hideOnZoom:   false,
      })

      this.setSize([440, 320])
    }

    const onExecuted = nodeType.prototype.onExecuted
    nodeType.prototype.onExecuted = function (msg) {
      onExecuted?.apply(this, arguments)
      const md = msg?.markdown?.[0]
      if (!md || !this._dazMdWrap) return
      this._dazMdText = md
      this._dazMdWrap.innerHTML = renderMarkdown(md)
      this.setDirtyCanvas(true, true)
    }
  },
})
