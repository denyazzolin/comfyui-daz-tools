import { app } from '../../scripts/app.js'

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.daz-mp-wrap {
  box-sizing: border-box;
  width: 100%;
  display: grid;
  justify-content: center;
  align-content: center;
  gap: 4px;
  overflow: hidden;
}
.daz-mp-empty { color: #888; font: 12px sans-serif; }
.daz-mp-cell {
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
  background: #111;
  border: 1px solid #333;
}
.daz-mp-cell img { display: block; width: 100%; height: 100%; object-fit: contain; }
.daz-mp-note {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #aaa;
}
.daz-mp-top { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 6px; }
.daz-mp-tag {
  background: rgba(0,0,0,0.6); color: #eee;
  font: 11px sans-serif; padding: 1px 4px; white-space: nowrap;
}
.daz-mp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.daz-mp-res  { flex-shrink: 0; margin-left: auto; }
.daz-mp-kind { position: absolute; left: 0; bottom: 0; }
`

function injectStyles() {
  if (document.getElementById('daz-mp-styles')) return
  const style = document.createElement('style')
  style.id = 'daz-mp-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}

// ── Grid ──────────────────────────────────────────────────────────────────────

const GAP        = 4
const MAX_COLS   = 3
const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Audio' }

function el(tag, cls, text) {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

// Square cells, up to three to a row, as large as the node's area lets them be.
function layout(node) {
  const wrap = node._dazMpWrap
  const n    = node._dazMpMedia?.length
  if (!n) return
  const cols = Math.min(MAX_COLS, n)
  const rows = Math.ceil(n / cols)
  const cell = Math.max(16, Math.floor(Math.min(
    (wrap.clientWidth  - GAP * (cols - 1)) / cols,
    (wrap.clientHeight - GAP * (rows - 1)) / rows)))
  wrap.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`
  wrap.style.gridAutoRows        = `${cell}px`
  for (const note of wrap.querySelectorAll('.daz-mp-note')) note.style.fontSize = `${Math.round(cell * 0.45)}px`
}

function render(node) {
  const wrap  = node._dazMpWrap
  const media = node._dazMpMedia
  wrap.replaceChildren()
  wrap.style.gridTemplateColumns = ''
  if (!media?.length) {
    wrap.append(el('div', 'daz-mp-empty', media ? 'No media' : 'Waiting for input…'))
    return
  }
  for (const m of media) {
    const cell = el('div', 'daz-mp-cell')
    if (m.filename) {
      const img = document.createElement('img')
      img.src = `/view?filename=${encodeURIComponent(m.filename)}&type=temp`
      cell.append(img)
    } else {
      cell.append(el('div', 'daz-mp-note', '♪'))
    }
    const top = el('div', 'daz-mp-top')
    if (m.name) {
      const name = el('span', 'daz-mp-tag daz-mp-name', m.name)
      name.title = m.name
      top.append(name)
    }
    if (m.width) top.append(el('span', 'daz-mp-tag daz-mp-res', `${m.width} x ${m.height}`))
    cell.append(top, el('span', 'daz-mp-tag daz-mp-kind', KIND_LABEL[m.kind] ?? m.kind))
    wrap.append(cell)
  }
  layout(node)
}

// ── ComfyUI extension ─────────────────────────────────────────────────────────

app.registerExtension({
  name: 'daz.mediaPreview',

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'daz_media_preview') return

    injectStyles()

    const TITLE_H = LiteGraph.NODE_TITLE_HEIGHT ?? 30

    const onNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments)

      const wrap = document.createElement('div')
      wrap.classList.add('daz-mp-wrap')

      this._dazMpWrap   = wrap
      this._dazMpMedia  = null
      this._dazMpHeight = 200

      this.addDOMWidget('daz_media_preview', 'html', wrap, {
        getValue:     () => '',
        setValue:     () => {},
        getMinHeight: () => this._dazMpHeight,
        hideOnZoom:   false,
      })

      // The cell size depends on the wrap's real width, which only exists once
      // the frontend has placed it.
      this._dazMpObserver = new ResizeObserver(() => layout(this))
      this._dazMpObserver.observe(wrap)

      render(this)
      this.setSize([420, 460])
      this._dazSyncSize()
    }

    nodeType.prototype._dazSyncSize = function () {
      const h = Math.max(60, this.size[1] - TITLE_H - 12)
      this._dazMpHeight = h
      if (this._dazMpWrap) this._dazMpWrap.style.height = h + 'px'
    }

    const onResize = nodeType.prototype.onResize
    nodeType.prototype.onResize = function (size) {
      onResize?.apply(this, arguments)
      this._dazSyncSize()
    }

    const onRemoved = nodeType.prototype.onRemoved
    nodeType.prototype.onRemoved = function () {
      onRemoved?.apply(this, arguments)
      this._dazMpObserver?.disconnect()
    }

    const onExecuted = nodeType.prototype.onExecuted
    nodeType.prototype.onExecuted = function (msg) {
      onExecuted?.apply(this, arguments)
      if (!this._dazMpWrap) return
      this._dazMpMedia = msg?.media ?? []
      render(this)
      this.setDirtyCanvas(true, true)
    }
  },
})
