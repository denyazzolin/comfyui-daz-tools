import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'

// ── Factory ───────────────────────────────────────────────────────────────────
// cfg fields:
//   extName, nodeDataName, CLASS
//   PANEL_H, NODE_W, NODE_H
//   keys: { detail, editMode, editOverlay, wrap, executedHandler, domWidget }
//   uidPrefix, folderNames, loraLabels, loraLabelWidth, useModeLoraCount
//   dimsClearIds, modelsClearIds
//   unetGgufFields: [{ select, checkbox }] — pairs whose select should swap
//     between the 'diffusion_models' and 'unet_gguf' folder listings
//   hideType, hideAudioPath, hideLorasBox
//   renderDetailHtml(data, h, extra), updateOutputLabels(node, data, h),
//   buildModelsHtml(folderMap, data, h), buildDimsHtml(data, h),
//   buildPayload(wrap)

export function buildWorkflowConfigExtension(cfg) {
  return {
    name: cfg.extName,

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== cfg.nodeDataName) return

      const {
        CLASS, PANEL_H, NODE_W, NODE_H,
        keys, uidPrefix, folderNames,
        loraLabels, loraLabelWidth, useModeLoraCount,
        dimsClearIds, modelsClearIds,
        unetGgufFields = [],
        hideType      = false,
        hideAudioPath = false,
        hideLorasBox  = false,
        renderDetailHtml:   renderDetailHtmlFn,
        updateOutputLabels: updateOutputLabelsFn,
        buildModelsHtml:    buildModelsHtmlFn,
        buildDimsHtml:      buildDimsHtmlFn,
        buildPayload:       buildPayloadFn,
      } = cfg

      // ── Initial data load ─────────────────────────────────────────────────

      let _configFiles = []
      try {
        const r = await fetch(`/daz/config-files?class=${encodeURIComponent(CLASS)}`)
        if (r.ok) _configFiles = await r.json()
      } catch (e) {
        console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not load config files`, e)
      }

      let _initialConfigs = []
      try {
        const firstFile = _configFiles[0]?.file ?? null
        const url = firstFile
          ? `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}&file=${encodeURIComponent(firstFile)}`
          : `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}`
        const resp = await fetch(url)
        if (resp.ok) _initialConfigs = await resp.json()
      } catch (e) {
        console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not load configs`, e)
      }

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

      // ── Per-node config file helpers ──────────────────────────────────────

      function fileLabel(f) {
        return `(${f.file.replace(/\.json$/, '')}) ${f.name}`
      }
      function labelToFile(label) {
        if (!label || label === '(default)') return null
        const m = label.match(/^\(([^)]+)\)/)
        return m ? m[1] + '.json' : label
      }
      function fileLabelName(label) {
        return (label || '').replace(/^\([^)]*\)\s*/, '')
      }

      function currentFile(node) { return node._dazConfigFile || null }

      function configsUrl(node, base) {
        const f = currentFile(node)
        return f ? `${base}&file=${encodeURIComponent(f)}` : base
      }

      function rawVersion(display) {
        if (!display) return display
        const s = String(display)
        const dash = s.indexOf(' - ')
        return dash !== -1 ? s.substring(0, dash) : s
      }

      async function reloadNodeConfigs(node) {
        const url = configsUrl(node,
          `/daz/workflow-configs-with-type?class=${encodeURIComponent(CLASS)}`)
        try {
          const r = await fetch(url)
          if (r.ok) node._dazAllConfigs = await r.json()
        } catch (e) {
          console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not reload configs`, e)
        }
      }

      async function reloadVersionWidget(node, configLabel, selectVersion = null) {
        const vw = node._dazVersionWidget
        if (!vw) return
        if (!configLabel || configLabel === '(no configs)') {
          vw.options.values = ['1']
          vw.value = '1'
          node._dazCurrentVersion = '1'
          return
        }
        const gen = (node._dazVersionReloadGen = (node._dazVersionReloadGen || 0) + 1)
        try {
          const url = configsUrl(node,
            `/daz/workflow-config-versions?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(configLabel)}`)
          const r = await fetch(url)
          if (!r.ok) return
          const versions = await r.json()
          if (gen !== node._dazVersionReloadGen) return
          if (versions.error) return
          node._dazVersionData = versions
          const typeFilter  = node._dazTypeFilter  || 'All'
          const groupFilter = node._dazGroupFilter || 'All'
          let visible = versions
          if (typeFilter  !== 'All') visible = visible.filter(v => v.type === 'all' || (v.type  || '') === typeFilter)
          if (groupFilter !== 'All') visible = visible.filter(v => (v.group || '') === groupFilter)
          if (!visible.length) visible = versions
          const makeDisplay = v => v.label ? `${v.version} - ${v.label}` : String(v.version)
          const selectRaw   = selectVersion != null ? rawVersion(String(selectVersion)) : null
          const vList = visible.map(makeDisplay).filter(Boolean)
          vw.options.values = vList.length ? vList : ['1']
          const selectDisplay = selectRaw ? vList.find(d => rawVersion(d) === selectRaw) : null
          if (selectDisplay) {
            vw.value = selectDisplay
          } else if (!vList.some(d => rawVersion(d) === rawVersion(String(vw.value || '')))) {
            vw.value = vList[vList.length - 1] ?? '1'
          }
          node._dazCurrentVersion = rawVersion(vw.value)
        } catch (e) {
          console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not reload versions`, e)
        }
      }

      // ── Shared helpers ────────────────────────────────────────────────────

      function filteredLabels(configs, typeFilter, groupFilter) {
        let filtered = configs
        if (typeFilter && typeFilter !== 'All')
          filtered = filtered.filter(c => {
            const types = c.types ?? [c.type]
            return types.includes(typeFilter) || types.includes('all')
          })
        if (groupFilter && groupFilter !== 'All')
          filtered = filtered.filter(c => (c.groups ?? [c.group]).includes(groupFilter))
        return filtered.map(c => c.label)
      }

      function updateGroupFilterWidget(node) {
        if (!node._dazGroupFilterWidget) return
        const configs    = node._dazAllConfigs || []
        const typeFilter = node._dazTypeFilter || 'All'
        const base = typeFilter === 'All' ? configs
          : configs.filter(c => { const types = c.types ?? [c.type]; return types.includes(typeFilter) || types.includes('all') })
        const groups = ['All', ...Array.from(new Set(
          base.flatMap(c => c.groups ?? [c.group]).filter(Boolean)
        )).sort()]
        node._dazGroupFilterWidget.options.values = groups
        if (!groups.includes(node._dazGroupFilter)) {
          node._dazGroupFilter = 'All'
          node._dazGroupFilterWidget.value = 'All'
        }
      }

      function syncWidget(node) {
        const configs = node._dazAllConfigs || []
        const labels  = filteredLabels(configs, node._dazTypeFilter || 'All', node._dazGroupFilter || 'All')
        const w = node.widgets?.find(w => w.name === 'scene')
        if (!w) return
        w.options.values = labels.length ? labels : ['(no configs)']
        if (!labels.includes(w.value)) w.value = labels[0] ?? '(no configs)'
      }

      function esc(s) {
        return String(s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      }

      // Typed-object accessors
      function fName(val)  { return (val && typeof val === 'object') ? (val.name  ?? '') : (val ?? '') }
      function fValue(val) { return (val && typeof val === 'object') ? (val.value ?? 0)  : (val ?? 0)  }
      function fText(val)  { return (val && typeof val === 'object') ? (val.text  ?? '') : (val ?? '') }
      function fPath(val)  { return (val && typeof val === 'object') ? (val.path  ?? '') : (val ?? '') }
      function fFile(val)  { return (val && typeof val === 'object') ? (val.file  ?? '') : (val ?? '') }
      function fType(val)       { return (val && typeof val === 'object') ? (val.type      || 'smart') : 'smart'  }
      function fPosition(val)   {
        return (val && typeof val === 'object' && (val.position === 'before' || val.position === 'after'))
          ? val.position : 'before'
      }
      // Resolves defaultMasterPrompt/defaultTrailPrompt against the current
      // workflow type — same convention as resolveTypedDefault() in
      // daz_prompt_editor.js: a plain string is used as-is, an object is keyed
      // by workflowType ('I2V'/'T2V'/'MULTI') with 'default' as the fallback.
      function resolveTypedDefault(def, workflowType) {
        if (def && typeof def === 'object') return def[workflowType] ?? def.default ?? ''
        return def || ''
      }

      // Master/Qualifiers/Negative defaults can vary by workflow type — keep
      // their Default buttons' disabled state in sync with #daz-type. Shared
      // (not nested in enterEditForm) so every path that can change #daz-type
      // on an open panel — the Type dropdown itself, the Name-box clear
      // button, and Apply Preset — can call it after mutating the value.
      function updateDefaultButtonsState(panel) {
        const workflowType = panel.querySelector('#daz-type')?.value || ''
        const setBtn = (id, disabled) => {
          const btn = panel.querySelector(id)
          if (!btn) return
          btn.disabled      = disabled
          btn.style.opacity = disabled ? '0.4' : '1'
          btn.style.cursor  = disabled ? 'default' : 'pointer'
        }
        setBtn('#daz-master-default',   !resolveTypedDefault(cfg.defaultMasterPrompt, workflowType))
        setBtn('#daz-trail-default',    !resolveTypedDefault(cfg.defaultTrailPrompt,  workflowType))
        setBtn('#daz-negative-default', !cfg.defaultNegativePrompt)
      }

      function fRandomize(val)  { return (val && typeof val === 'object') ? (val.randomize === true)   : false    }
      function fFlagLabel(val, def = '') { return (val && typeof val === 'object') ? (val.label ?? def) : def     }
      function fFlagValue(val)           { return (val && typeof val === 'object') ? (val.value === true) : false }
      function fCustomValue(val)         { return (val && typeof val === 'object') ? (val.value ?? '')   : ''    }
      function fNote(val)                { return (val && typeof val === 'object') ? (val.value ?? '')    : ''    }

      function loraEnabled(val) {
        if (val && typeof val === 'object') return val.enabled !== false
        return true
      }

      function rowNote(text) {
        if (!text) return `<tr>
          <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Note</td>
          <td colspan="3" style="padding:3px 10px"><span style="color:#555">—</span></td>
        </tr>`
        const lines   = text.split('\n')
        const display = lines.length > 4 ? lines.slice(0, 4).join('\n') + '…' : text.trimEnd()
        return `<tr>
          <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Note</td>
          <td colspan="3" style="padding:3px 10px">
            <span style="color:#ddd;white-space:pre-wrap;word-break:break-word">${esc(display)}</span>
          </td>
        </tr>`
      }

      function row(label, value) {
        const v = value !== undefined && value !== '' && value !== 0
          ? `<span style="color:#ddd">${esc(value)}</span>`
          : `<span style="color:#555">—</span>`
        return `<tr>
          <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">${label}</td>
          <td colspan="3" style="color:#ddd;padding:3px 10px;word-break:break-all">${v}</td>
        </tr>`
      }

      function trunc(s, n = 60) {
        if (!s) return ''
        return s.length > n ? s.substring(0, n) + '…' : s
      }

      function rowPair(l1, v1, l2, v2) {
        function val(v) {
          return v !== undefined && v !== '' && v !== 0
            ? `<span style="color:#ddd">${esc(v)}</span>`
            : `<span style="color:#555">—</span>`
        }
        const tdL = 'style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top"'
        const tdV = 'style="color:#ddd;padding:3px 10px;width:30%"'
        return `<tr>
          <td ${tdL}>${l1}</td><td ${tdV}>${val(v1)}</td>
          <td ${tdL}>${l2}</td><td ${tdV}>${val(v2)}</td>
        </tr>`
      }

      function disp(s, maxLen) {
        if (s === undefined || s === null || s === '') return s
        const d = String(s).replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '')
        return maxLen && d.length > maxLen ? d.substring(0, maxLen - 1) + '…' : d
      }

      function rowDiv() {
        return `<tr><td colspan="4" style="padding:0"><div style="border-top:1px solid #555;margin:2px 8px"></div></td></tr>`
      }

      function rowPairLora(l1, lora1, l2, lora2, id1, id2) {
        function cell(lora, id) {
          const enabled = loraEnabled(lora)
          const name    = fName(lora)
          const d       = name ? disp(name, 16) : ''
          const chk     = `<input type="checkbox"${enabled ? ' checked' : ''}${id ? ` id="${id}"` : ''}
                            style="margin:0 4px 0 0;vertical-align:middle;cursor:pointer;flex-shrink:0">`
          const txt     = d
            ? `<span style="color:${enabled ? '#ddd' : '#666'}">${esc(d)}</span>`
            : `<span style="color:#555">—</span>`
          return `<div style="display:flex;align-items:center">${chk}${txt}</div>`
        }
        const tdL = 'style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:middle"'
        const tdV = 'style="padding:3px 10px;width:30%"'
        return `<tr>
          <td ${tdL}>${l1}</td><td ${tdV}>${cell(lora1, id1)}</td>
          <td ${tdL}>${l2}</td><td ${tdV}>${cell(lora2, id2)}</td>
        </tr>`
      }

      // Style constants and component helpers (used in enterEditForm and per-class fns)
      const fs  = 'width:100%;background:#111;color:#ddd;border:1px solid #555;border-radius:4px;' +
                  'font-size:11px;font-family:monospace;padding:2px 5px;box-sizing:border-box'
      const ns  = 'background:#111;color:#ddd;border:1px solid #555;border-radius:4px;' +
                  'font-size:11px;font-family:monospace;padding:2px 5px'
      const tas = 'width:100%;background:#111;color:#ddd;border:1px solid #555;border-radius:4px;' +
                  'font-size:11px;font-family:monospace;padding:4px 5px;box-sizing:border-box;resize:vertical'
      const lbl = 'color:#888;font-size:10px;display:block;margin-bottom:2px'
      const rw  = 'margin-bottom:5px'
      const cb  = 'font-family:monospace;font-size:10px;padding:1px 7px;background:#111;color:#666;' +
                  'border:1px solid #444;border-radius:3px;cursor:pointer'

      function box(title, html) {
        return `<fieldset style="border:1px solid #444;border-radius:4px;padding:7px 8px;margin:0;min-width:0;box-sizing:border-box;overflow:hidden">
          <legend style="color:#888;font-size:11px;padding:0 5px;font-family:monospace">${title}</legend>
          ${html}
        </fieldset>`
      }

      function selOpt(files, cur) {
        return `<option value="">— none —</option>` +
          files.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('')
      }

      function selOptImg(files, cur) {
        return `<option value="">— no image —</option>` +
          files.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('')
      }

      function selOptAudio(files, cur) {
        return `<option value="">— no audio —</option>` +
          files.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('')
      }

      function isGgufFilename(name) { return /\.gguf$/i.test(name || '') }

      function unetRow(label, selectId, checkboxId, files, curName) {
        const curGguf = isGgufFilename(curName)
        return `<div style="${rw}">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <label style="${lbl};margin-bottom:2px">${label}</label>
            <span style="color:#888;font-size:10px">gguf</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <select id="${selectId}" style="flex:1;min-width:0;${fs}">${selOpt(files, curName)}</select>
            <input type="checkbox" id="${checkboxId}"${curGguf ? ' checked' : ''} disabled
              style="width:13px;height:13px;cursor:not-allowed;accent-color:#54af7b;flex-shrink:0">
          </div>
        </div>`
      }

      // Quick-set button looks. The selected one tracks the duration field, so
      // typing 10 lights the "10" button and typing 10.5 puts them all out.
      // The height matches the seconds input so the two sit on the same line.
      const durBtn    = 'font-family:monospace;font-size:10px;padding:0;width:26px;height:20px;' +
                        'box-sizing:border-box;border-radius:3px;cursor:pointer;flex-shrink:0;'
      const durBtnOff = `${durBtn}background:#111;color:#bbb;border:1px solid #444`
      const durBtnOn  = `${durBtn}background:#2d5c43;color:#e8f5ee;border:1px solid #54af7b`

      // Every class renders duration * fps frames plus the first one.
      const DURATION_FRAME_OFFSET = 1

      // Duration row for the Dimensions box — a seconds field plus quick-set
      // buttons. Duration is a UI-only convenience: it is never saved. It is
      // seeded from the panel's frames/fps and it drives #daz-total-frames
      // through the handlers wired in wireDurationSync().
      function durationRow(presets) {
        return `<div style="display:flex;align-items:flex-end;gap:4px;margin-bottom:4px">
          <div style="flex-shrink:0"><label style="${lbl}">Duration (s)</label>
            <input id="daz-duration" type="number" step="0.01" min="0" value=""
              style="width:62px;height:20px;box-sizing:border-box;${ns}"></div>
          <div style="display:flex;gap:3px">
            ${presets.map(p => `<button type="button" class="daz-duration-preset" data-seconds="${p}"
              style="${durBtnOff}">${p}</button>`).join('')}
          </div>
          <div id="daz-duration-err"
            style="flex:1;min-width:0;color:#e06c6c;font-size:10px;line-height:20px;
                   white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
        </div>`
      }

      // Width and Height for the Dimensions box, shared by every class. The two
      // boxes are only as wide as a four-digit size needs, which leaves the rest
      // of the row for the Sizing button.
      function sizeRow(data) {
        const num = `width:62px;height:20px;box-sizing:border-box;${ns}`
        return `<div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:4px">
          <div style="flex-shrink:0"><label style="${lbl}">Width</label>
            <input id="daz-width" type="number" value="${fValue(data.width) || 0}" style="${num}"></div>
          <div style="flex-shrink:0"><label style="${lbl}">Height</label>
            <input id="daz-height" type="number" value="${fValue(data.height) || 0}" style="${num}"></div>
          <button type="button" id="daz-sizing-btn" style="${cb};height:20px">sizing</button>
        </div>`
      }

      // ── Sizing dialog ─────────────────────────────────────────────────────
      // Curated width x height pairs, five per aspect ratio per divisor. This is
      // a fixed table rather than something computed: rounding an aspect ratio to
      // a divisor has several defensible answers, and these are the chosen ones.
      // Ordered the way the dialog lays the panels out, three to a row.
      const SIZING_RATIOS = [
        ['1:1',   1,  1],
        ['16:9', 16,  9],
        ['9:16',  9, 16],
        ['3:2',   3,  2],
        ['2:3',   2,  3],
        ['4:3',   4,  3],
        ['3:4',   3,  4],
      ]
      const SIZING_DIVISORS  = [8, 16, 32, 64]
      const SIZING_DEF_RATIO = '9:16'
      const SIZING_DEF_DIV   = 32

      const SIZING_TABLE = {
        '1:1': {
           8: [[576, 576], [624, 624], [832, 832], [960, 960], [1280, 1280]],
          16: [[576, 576], [624, 624], [832, 832], [960, 960], [1280, 1280]],
          32: [[576, 576], [608, 608], [832, 832], [960, 960], [1280, 1280]],
          64: [[576, 576], [640, 640], [832, 832], [960, 960], [1280, 1280]],
        },
        '16:9': {
           8: [[608, 352], [704, 400], [832, 480], [1024, 576], [1280, 720]],
          16: [[608, 352], [704, 400], [832, 480], [1024, 576], [1280, 720]],
          32: [[608, 352], [704, 384], [832, 480], [1024, 576], [1280, 704]],
          64: [[640, 384], [704, 384], [832, 512], [1024, 576], [1280, 704]],
        },
        '9:16': {
           8: [[352, 608], [400, 704], [480, 832], [576, 1024], [720, 1280]],
          16: [[352, 608], [400, 704], [480, 832], [576, 1024], [720, 1280]],
          32: [[352, 608], [384, 704], [480, 832], [576, 1024], [704, 1280]],
          64: [[384, 640], [384, 704], [512, 832], [576, 1024], [704, 1280]],
        },
        '3:2': {
           8: [[576, 384], [768, 512], [960, 640], [1248, 832], [1536, 1024]],
          16: [[576, 384], [768, 512], [960, 640], [1248, 832], [1536, 1024]],
          32: [[576, 384], [768, 512], [960, 640], [1248, 832], [1536, 1024]],
          64: [[576, 384], [768, 512], [960, 640], [1152, 768], [1536, 1024]],
        },
        '2:3': {
           8: [[384, 576], [512, 768], [640, 960], [832, 1248], [1024, 1536]],
          16: [[384, 576], [512, 768], [640, 960], [832, 1248], [1024, 1536]],
          32: [[384, 576], [512, 768], [640, 960], [832, 1248], [1024, 1536]],
          64: [[384, 576], [512, 768], [640, 960], [768, 1152], [1024, 1536]],
        },
        // The /64 second entry differs from the source list, which repeated the
        // first entry there and so offered only four distinct sizes.
        '4:3': {
           8: [[512, 384], [608, 456], [800, 600], [1024, 768], [1216, 912]],
          16: [[512, 384], [576, 432], [768, 576], [1024, 768], [1216, 912]],
          32: [[512, 384], [608, 448], [768, 576], [1024, 768], [1216, 896]],
          64: [[512, 384], [704, 512], [768, 576], [1024, 768], [1280, 960]],
        },
        // The same correction as 4:3, mirrored.
        '3:4': {
           8: [[384, 512], [456, 608], [600, 800], [768, 1024], [912, 1216]],
          16: [[384, 512], [432, 576], [576, 768], [768, 1024], [912, 1216]],
          32: [[384, 512], [448, 608], [576, 768], [768, 1024], [896, 1216]],
          64: [[384, 512], [512, 704], [576, 768], [768, 1024], [960, 1280]],
        },
      }

      // Which ratio / divisor / set a width x height came from, or null. The
      // default divisor is tried first because several sets repeat across
      // divisors, and 32 is the one the dialog would otherwise open on.
      function sizingLookup(w, h) {
        if (!(w > 0 && h > 0)) return null
        const divs = [SIZING_DEF_DIV, ...SIZING_DIVISORS.filter(d => d !== SIZING_DEF_DIV)]
        for (const [key] of SIZING_RATIOS) {
          for (const d of divs) {
            const idx = SIZING_TABLE[key][d].findIndex(([pw, ph]) => pw === w && ph === h)
            if (idx >= 0) return { ratio: key, div: d, idx }
          }
        }
        return null
      }

      // A filled rectangle in the ratio's own proportions, fitted into a fixed
      // box so the panels stay aligned however tall or wide the ratio is.
      function sizingSwatch(rw, rh) {
        const w = rw >= rh ? 20 : Math.round(20 * rw / rh)
        const h = rh >= rw ? 20 : Math.round(20 * rh / rw)
        return `<span style="display:inline-flex;width:22px;height:22px;flex-shrink:0;
                             align-items:center;justify-content:center">
          <span style="width:${w}px;height:${h}px;background:#2a5080;border:1px solid #4a7ab0;
                       border-radius:2px"></span></span>`
      }

      // The Sizing dialog behind the button on the Width/Height row. It opens on
      // whatever the panel's current size matches, or on the defaults when it
      // matches nothing, and only OK and Cancel close it.
      function openSizingModal(panel) {
        const widthEl  = panel.querySelector('#daz-width')
        const heightEl = panel.querySelector('#daz-height')
        const found    = sizingLookup(parseInt(widthEl?.value, 10), parseInt(heightEl?.value, 10))
        const sel      = found ?? { ratio: SIZING_DEF_RATIO, div: SIZING_DEF_DIV, idx: 0 }

        const secLbl = 'color:#888;font-size:10px;display:block;margin-bottom:5px'
        const rule   = 'border:0;border-top:1px solid #444;margin:11px 0'
        const bGray  = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                       'background:#444;color:#ccc;border:1px solid #666;cursor:pointer'
        const bGreen = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                       'background:#1a5c35;color:#cde;border:1px solid #2a8050;cursor:pointer'

        const mo = document.createElement('div')
        mo.style.cssText =
          'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10001;' +
          'display:flex;align-items:center;justify-content:center'
        const mb = document.createElement('div')
        mb.style.cssText =
          'background:#2a2a2a;border:1px solid #555;border-radius:6px;' +
          'padding:16px 18px;width:326px;font-family:monospace'
        mo.appendChild(mb)
        document.body.appendChild(mo)
        // No backdrop-click and no Escape handler on purpose: OK and Cancel are
        // the only ways out. Keys are swallowed so none reach the graph canvas.
        mo.addEventListener('keydown', e => e.stopPropagation())

        mb.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 11px;font-weight:bold">Sizing</p>
          <hr style="${rule}">
          <label style="${secLbl}">Aspect ratio:</label>
          <div id="daz-sz-ratios" style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px"></div>
          <hr style="${rule}">
          <div style="display:flex;align-items:center;gap:6px">
            <label style="color:#888;font-size:10px;flex-shrink:0">Divisible by:</label>
            <div id="daz-sz-divs" style="display:flex;gap:4px"></div>
          </div>
          <hr style="${rule}">
          <div id="daz-sz-list" style="display:flex;flex-direction:column;gap:3px"></div>
          <hr style="${rule}">
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" id="daz-sz-cancel" style="${bGray}">Cancel</button>
            <button type="button" id="daz-sz-ok" style="${bGreen}">OK</button>
          </div>`

        const ratiosEl = mb.querySelector('#daz-sz-ratios')
        const divsEl   = mb.querySelector('#daz-sz-divs')
        const listEl   = mb.querySelector('#daz-sz-list')

        const pairs = () => SIZING_TABLE[sel.ratio][sel.div]

        function renderRatios() {
          ratiosEl.innerHTML = SIZING_RATIOS.map(([key, rw, rh]) => {
            const on = key === sel.ratio
            return `<button type="button" class="daz-sz-ratio" data-ratio="${key}"
              style="display:flex;align-items:center;gap:5px;padding:4px 5px;cursor:pointer;
                     border-radius:4px;font-family:monospace;font-size:11px;
                     border:1px solid ${on ? '#54af7b' : '#444'};
                     background:${on ? '#1e3527' : '#111'};color:${on ? '#cde' : '#999'}">
              ${sizingSwatch(rw, rh)}<span>${key}</span></button>`
          }).join('')
        }

        function renderDivs() {
          divsEl.innerHTML = SIZING_DIVISORS.map(d => {
            const on = d === sel.div
            return `<button type="button" class="daz-sz-div" data-div="${d}"
              style="font-family:monospace;font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;
                     border:1px solid ${on ? '#54af7b' : '#444'};
                     background:${on ? '#1e3527' : '#111'};color:${on ? '#cde' : '#888'}">${d}</button>`
          }).join('')
        }

        function renderList() {
          listEl.innerHTML = pairs().map(([w, h], i) => {
            const on = i === sel.idx
            return `<button type="button" class="daz-sz-pair" data-idx="${i}"
              style="font-family:monospace;font-size:12px;padding:3px 0;cursor:pointer;
                     border-radius:3px;text-align:center;
                     border:1px solid ${on ? '#54af7b' : 'transparent'};
                     background:${on ? '#1e3527' : 'transparent'};color:${on ? '#cde' : '#aaa'}">
              ${w} x ${h}</button>`
          }).join('')
        }

        ratiosEl.addEventListener('click', e => {
          const b = e.target.closest('.daz-sz-ratio'); if (!b) return
          // The sets are ratio- and divisor-specific, so the choice of pair does
          // not carry over — fall back to the first, as on a fresh open.
          sel.ratio = b.dataset.ratio
          sel.idx   = 0
          renderRatios(); renderList()
        })
        divsEl.addEventListener('click', e => {
          const b = e.target.closest('.daz-sz-div'); if (!b) return
          sel.div = parseInt(b.dataset.div, 10)
          sel.idx = 0
          renderDivs(); renderList()
        })
        listEl.addEventListener('click', e => {
          const b = e.target.closest('.daz-sz-pair'); if (!b) return
          sel.idx = parseInt(b.dataset.idx, 10)
          renderList()
        })

        mb.querySelector('#daz-sz-cancel')?.addEventListener('click', () => mo.remove())
        mb.querySelector('#daz-sz-ok')?.addEventListener('click', () => {
          const [w, h] = pairs()[sel.idx] ?? []
          if (w && h) {
            if (widthEl) {
              widthEl.value = String(w)
              widthEl.dispatchEvent(new Event('input', { bubbles: true }))
            }
            if (heightEl) {
              heightEl.value = String(h)
              heightEl.dispatchEvent(new Event('input', { bubbles: true }))
            }
          }
          mo.remove()
        })

        renderRatios(); renderDivs(); renderList()
      }

      // Keeps the Duration (s) field and the Frames field in step. Editing
      // duration recomputes frames; editing frames or fps recomputes duration;
      // opening the panel seeds duration from the config that was just loaded.
      // Returns a function that resets the row (error line and button states),
      // for the Dimensions "clear" button; classes with no duration row get a
      // no-op.
      function wireDurationSync(panel) {
        const durEl    = panel.querySelector('#daz-duration')
        const framesEl = panel.querySelector('#daz-total-frames')
        const fpsEl    = panel.querySelector('#daz-fps')
        const errEl    = panel.querySelector('#daz-duration-err')
        const setErr   = (msg) => { if (errEl) errEl.textContent = msg }
        if (!durEl || !framesEl || !fpsEl) return () => {}

        const btns = Array.from(panel.querySelectorAll('.daz-duration-preset'))
        // Raised by whichever side is writing. Assigning .value does not fire an
        // input event, so this cannot currently loop, but it keeps the rule —
        // a recalculated field must not trigger the opposite recalculation —
        // true even if these fields later start dispatching their own events.
        let syncing  = false

        // frames -> seconds, capped at two decimals. A whole-second clip does
        // not always divide back cleanly: the first frame comes back as a
        // spurious xx.0y, and a fractional fps loses a part-frame to rounding —
        // 5s at 23.976 returns 5.01, 20s at 29.97 returns 19.99. All of it sits
        // within a tenth of a whole second, so a fraction that small snaps to
        // the whole second either side of it; anything a tenth or further in is
        // a duration the user chose and is left alone. Counted in hundredths to
        // keep the comparison off binary floats.
        function framesToSeconds(frames, fps) {
          const hundredths = Math.round((frames / fps) * 100)
          const frac       = hundredths % 100
          if (frac < 10) return Math.floor(hundredths / 100)
          if (frac > 90) return Math.floor(hundredths / 100) + 1
          return hundredths / 100
        }

        function currentFps() {
          const fps = parseFloat(fpsEl.value)
          if (!isFinite(fps) || fps <= 0) { setErr('FPS is not defined'); return null }
          setErr('')
          return fps
        }

        function syncButtons() {
          const secs = parseFloat(durEl.value)
          btns.forEach(btn => {
            btn.style.cssText =
              (isFinite(secs) && secs === parseFloat(btn.dataset.seconds)) ? durBtnOn : durBtnOff
          })
        }

        // Cap what can be typed at two decimals. Only rewrites when a third
        // digit shows up, and a half-typed "5." reads back as '' from a number
        // input, so nothing here can eat a decimal point mid-entry.
        function capDuration() {
          const m = /^(-?\d*\.\d{2})\d+$/.exec(durEl.value)
          if (m) durEl.value = m[1]
        }

        function durationToFrames() {
          if (syncing) return
          const fps = currentFps()
          if (fps === null) return
          const secs = parseFloat(durEl.value)
          if (!isFinite(secs)) return
          syncing = true
          framesEl.value = String(Math.round(secs * fps) + DURATION_FRAME_OFFSET)
          syncing = false
        }

        function framesToDuration() {
          if (syncing) return
          const fps = currentFps()
          if (fps === null) return
          const frames = parseFloat(framesEl.value)
          if (!isFinite(frames)) return
          syncing = true
          durEl.value = String(framesToSeconds(frames, fps))
          syncing = false
          syncButtons()
        }

        durEl.addEventListener('input', () => {
          capDuration()
          durationToFrames()
          syncButtons()
        })
        framesEl.addEventListener('input', framesToDuration)
        fpsEl.addEventListener('input', framesToDuration)

        btns.forEach(btn => {
          btn.addEventListener('click', () => {
            durEl.value = btn.dataset.seconds
            // Re-dispatch as a real input event so the panel's delegated
            // listener marks it dirty, the same as typing the value would.
            durEl.dispatchEvent(new Event('input', { bubbles: true }))
          })
        })

        // Seed from the config that was just loaded. Silent: the panel opens on
        // whatever was saved, so a missing FPS is not an error to report yet.
        const seedFps    = parseFloat(fpsEl.value)
        const seedFrames = parseFloat(framesEl.value)
        if (isFinite(seedFps) && seedFps > 0 && isFinite(seedFrames) && seedFrames > 0) {
          durEl.value = String(framesToSeconds(seedFrames, seedFps))
        }
        syncButtons()

        return () => { setErr(''); syncButtons() }
      }

      // ── Dimensions: "Use image" + the Scale box ────────────────────────────
      // Offered in the order the dropdown shows them. 'longest' and 'fit' both
      // need a size that does not come from the image, so they are withheld
      // while "Use image" is on — the same pair the server accepts there.
      const DIM_SCALE_MODES = [
        ['none',    'None'],
        ['factor',  'Factor'],
        ['longest', 'Longest dimension'],
        ['fit',     'Fit'],
      ]
      const DIM_USE_IMAGE_MODES = ['none', 'factor']

      function fDimensions(val) {
        const src   = (val && typeof val === 'object') ? val : {}
        const scale = (src.scale && typeof src.scale === 'object') ? src.scale : {}
        const mode  = DIM_SCALE_MODES.some(([m]) => m === scale.mode) ? scale.mode : 'none'
        const value = parseFloat(scale.value)
        return { use_image: src.use_image === true, mode, value: isFinite(value) ? value : 1 }
      }

      // Rendered at the top of the Dimensions box by the classes that take a
      // reference image. The Image class has none, so it does not call this.
      function dimensionsRows(data) {
        const d = fDimensions(data.dimensions)
        return `
          <label style="display:flex;align-items:center;gap:5px;color:#ccc;font-size:11px;
                        cursor:pointer;margin-bottom:5px">
            <input type="checkbox" id="daz-dim-use-image"${d.use_image ? ' checked' : ''}
              style="width:13px;height:13px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
            Use image
            <span id="daz-dim-use-image-hint" style="color:#666;font-size:10px"></span>
          </label>
          <div style="margin-bottom:5px">${box('Scale', `
            <div style="${rw}"><label style="${lbl}">Scale mode</label>
              <select id="daz-dim-scale-mode" style="${fs}">
                ${DIM_SCALE_MODES.map(([m, label]) =>
                  `<option value="${m}"${m === d.mode ? ' selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
            <div><label id="daz-dim-scale-value-label" style="${lbl}">Scale by</label>
              <input id="daz-dim-scale-value" type="number" step="0.01" min="0"
                value="${d.value}" style="${fs}">
            </div>
          `)}</div>`
      }

      // Keeps the dimensions controls consistent with each other and with the
      // reference image: "Use image" is only offered when there is an image to
      // take a size from, and it narrows the mode list to the two modes that
      // still mean something. Whenever the node computes the size from the image
      // rather than reading what was typed — "Use image", or 'longest' with an
      // image loaded — the width and height show that computed size, read-only,
      // and the typed values are put back when it stops being computed.
      //
      // Returns { reset, refresh }: reset for the Dimensions "clear" button,
      // refresh for the places that change the image or the controls without
      // firing an event this can hear (clearing the image, applying a preset).
      // Classes with no dimensions rows get inert stubs.
      function wireDimensions(panel) {
        const useEl    = panel.querySelector('#daz-dim-use-image')
        const modeEl   = panel.querySelector('#daz-dim-scale-mode')
        const valEl    = panel.querySelector('#daz-dim-scale-value')
        const valLbl   = panel.querySelector('#daz-dim-scale-value-label')
        const hintEl   = panel.querySelector('#daz-dim-use-image-hint')
        const widthEl  = panel.querySelector('#daz-width')
        const heightEl = panel.querySelector('#daz-height')
        const imgSel   = panel.querySelector('#daz-image-path')
        const prevEl   = panel.querySelector('#daz-img-preview-el')
        if (!useEl || !modeEl || !valEl) {
          return { reset: () => {}, refresh: () => {}, adopt: () => {} }
        }

        // What the user last typed, so the fields come back as they left them
        // once the size stops being derived from the image. Captured on the way
        // in, restored on the way out, so repeated syncs do not overwrite it.
        const typed = { width: '', height: '', saved: false }

        function enterDerived() {
          if (typed.saved) return
          typed.width  = widthEl?.value  ?? ''
          typed.height = heightEl?.value ?? ''
          typed.saved  = true
        }

        function leaveDerived() {
          if (!typed.saved) return
          if (widthEl)  widthEl.value  = typed.width
          if (heightEl) heightEl.value = typed.height
          typed.saved = false
        }

        function setSizeEditable(editable, why) {
          ;[widthEl, heightEl].forEach(el => {
            if (!el) return
            el.readOnly    = !editable
            el.style.color = editable ? '' : '#888'
            el.title       = editable ? '' : why
          })
          // A size picked from the dialog would be overwritten on the next sync
          // and ignored at execution, so the button goes with the fields.
          const szBtn = panel.querySelector('#daz-sizing-btn')
          if (szBtn) {
            szBtn.disabled      = !editable
            szBtn.style.opacity = editable ? '' : '0.4'
            szBtn.style.cursor  = editable ? 'pointer' : 'not-allowed'
            szBtn.title         = editable ? '' : why
          }
        }

        // Whether the width/height are the node's to compute rather than the
        // user's to type. "Use image" takes the size from the image; so does
        // 'longest', which ignores what is typed whenever there is an image to
        // measure. With no image 'longest' falls back to scaling the typed size,
        // so that stays the user's input and is left alone.
        function derivedFrom() {
          if (!imgSel?.value) return null
          if (useEl.checked)               return 'use_image'
          if (modeEl.value === 'longest')  return 'longest'
          return null
        }

        // The preview <img> is the only place the panel knows the image's size.
        // Before it has loaded both naturals read 0, and the 'load' listener
        // below runs this again. Mirrors resolve_dimensions in the backend, so
        // the boxes show the size the node will actually output.
        function applyImageSize() {
          const src = derivedFrom()
          if (!src) return
          const iw = prevEl?.naturalWidth  || 0
          const ih = prevEl?.naturalHeight || 0
          if (!iw || !ih) return

          let k
          if (src === 'longest') {
            // The backend reads the integer part of the value.
            const target = Math.trunc(parseFloat(valEl.value))
            if (!isFinite(target) || target <= 0) return
            k = target / Math.max(iw, ih)
          } else {
            const f = modeEl.value === 'factor' ? parseFloat(valEl.value) : 1
            k = (isFinite(f) && f > 0) ? f : 1
          }
          if (widthEl)  widthEl.value  = String(Math.max(1, Math.round(iw * k)))
          if (heightEl) heightEl.value = String(Math.max(1, Math.round(ih * k)))
        }

        function syncValueField() {
          const mode = modeEl.value
          const on   = mode === 'factor' || mode === 'longest'
          valEl.disabled      = !on
          valEl.style.opacity = on ? '1' : '0.4'
          valEl.step          = mode === 'longest' ? '1' : '0.01'
          if (valLbl) valLbl.textContent =
            mode === 'factor' ? 'Scale by' : mode === 'longest' ? 'Longest dimension' : 'Value'
        }

        function syncModeOptions() {
          const restrict = useEl.checked
          Array.from(modeEl.options).forEach(opt => {
            const allowed = !restrict || DIM_USE_IMAGE_MODES.includes(opt.value)
            opt.hidden   = !allowed
            opt.disabled = !allowed
          })
          if (restrict && !DIM_USE_IMAGE_MODES.includes(modeEl.value)) modeEl.value = 'none'
        }

        function syncAll() {
          const hasImage = !!imgSel?.value
          if (!hasImage) useEl.checked = false
          useEl.disabled     = !hasImage
          useEl.style.cursor = hasImage ? 'pointer' : 'not-allowed'
          if (hintEl) hintEl.textContent = hasImage ? '' : '(no reference image)'
          syncModeOptions()
          syncValueField()
          // After syncModeOptions, which can drop an illegal mode back to 'none'.
          const src = derivedFrom()
          if (src) enterDerived(); else leaveDerived()
          setSizeEditable(!src, src === 'longest'
            ? "Derived from the image's longest dimension"
            : 'Taken from the reference image')
          applyImageSize()
        }

        useEl.addEventListener('change', syncAll)
        modeEl.addEventListener('change', syncAll)
        valEl.addEventListener('input', applyImageSize)
        imgSel?.addEventListener('change', syncAll)
        // The naturals only become readable once the preview has loaded.
        prevEl?.addEventListener('load', syncAll)

        syncAll()

        const ctl = {
          reset: () => {
            useEl.checked = false
            modeEl.value  = 'none'
            valEl.value   = '1'
            typed.width   = ''
            typed.height  = ''
            typed.saved   = false
            syncAll()
          },
          refresh: syncAll,
          // The width/height were just written from outside — by a preset — so
          // whatever size was remembered before is stale. Dropping it stops the
          // next refresh restoring it over what was just written; if the panel
          // is still deriving, that refresh re-captures the new values instead.
          adopt: () => { typed.saved = false },
        }
        // Stashed so applyPresetToPanel can re-run the wiring after it writes
        // the controls, without having to be handed the panel's closure.
        panel._dazDimsCtl = ctl
        return ctl
      }

      // Helpers object passed to per-class config functions
      const h = {
        esc, fName, fValue, fText, fPath, fFile, fType, fRandomize,
        fFlagLabel, fFlagValue, fCustomValue, fNote, loraEnabled,
        row, rowPair, rowNote, rowPairLora, rowDiv, disp, trunc,
        box, selOpt, selOptImg, selOptAudio, unetRow, durationRow, dimensionsRows, sizeRow,
        fs, ns, tas, lbl, rw, cb,
      }

      // ── Convenience wrappers for per-class functions ───────────────────────

      function renderDetailHtml(data, extra) { return renderDetailHtmlFn(data, h, extra) }
      function updateOutputLabels(node, data) { return updateOutputLabelsFn(node, data, h) }
      function buildModelsHtml(folderMap, data) { return buildModelsHtmlFn(folderMap, data, h) }
      function buildDimsHtml(data) { return buildDimsHtmlFn(data, h) }
      function buildPayload(wrap) { return buildPayloadFn(wrap) }

      // Shared lora rows builder — uses normalized daz-lora-N IDs (hyphen)
      function buildLorasHtml(loraFiles, data) {
        const loras = data.loras ?? {}
        const rows  = loraLabels.map((label, i) => {
          const n    = i + 1
          const key  = `lora_${n}`
          const lora = loras[key]
          return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
            <span style="color:#888;font-size:10px;width:${loraLabelWidth};flex-shrink:0">${label}</span>
            <select id="daz-lora-${n}" style="flex:1;background:#111;color:#ddd;border:1px solid #555;
              border-radius:4px;font-size:11px;font-family:monospace;padding:1px 3px;min-width:0">
              ${selOpt(loraFiles, fName(lora))}
            </select>
            <input type="number" id="daz-lora-${n}-strength" step="0.01" min="0"
              value="${lora?.strength ?? 1.0}"
              style="width:44px;flex-shrink:0;${ns};padding:1px 3px">
            <input type="checkbox" id="daz-lora-${n}-enabled"${loraEnabled(lora) ? ' checked' : ''}
              style="flex-shrink:0;width:13px;height:13px;cursor:pointer;accent-color:#54af7b">
          </div>`
        }).join('')
        return rows + `
          <div style="display:flex;justify-content:flex-end;margin-top:3px">
            <button id="daz-loras-clear" style="${cb}">clear</button>
          </div>`
      }

      // ── Use mode ──────────────────────────────────────────────────────────

      function renderUseMode(node, data) {
        node[keys.editMode] = false
        const wrap = node[keys.wrap]
        if (!wrap) return
        wrap.style.height = PANEL_H + 'px'

        if (!(node._dazAllConfigs || []).length) {
          wrap.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                        height:100%;gap:14px;font-family:monospace">
              <p style="font-size:13px;color:#888;margin:0;text-align:center">
                No configuration available.<br>Create one.
              </p>
              <button id="daz-create-first-btn"
                style="font-size:12px;padding:4px 18px;background:#000;color:#cde;
                       border:1px solid #2a8050;border-radius:3px;cursor:pointer">Create</button>
            </div>`
          wrap.querySelector('#daz-create-first-btn')?.addEventListener('click', () => enterEditForm(node, true))
          node.setDirtyCanvas(true, true)
          return
        }

        wrap.innerHTML = `
          <div style="display:flex;justify-content:space-between;padding:0 6px 4px">
            <button id="daz-new-btn"
              style="font-family:monospace;font-size:12px;padding:2px 10px;
                     background:#000000;color:#ffffff;border:1px solid #54af7b;
                     border-radius:3px;cursor:pointer">New Take</button>
            <button id="daz-edit-btn"
              style="font-family:monospace;font-size:12px;padding:2px 10px;
                     background:#000000;color:#ffffff;border:1px solid #666;
                     border-radius:3px;cursor:pointer">Edit Take</button>
          </div>
          ${renderDetailHtml(data, {
            showMovie:  _configFiles.length > 1,
            movieLabel: fileLabelName(node._dazConfigFileWidget?.value),
            sceneLabel: node.widgets?.find(w => w.name === 'scene')?.value || '',
            takeLabel:  node._dazVersionWidget?.value || '',
          })}
          <div style="padding:4px 8px 6px">
            <button id="daz-prompt-editor-btn"
              style="font-family:monospace;font-size:11px;padding:3px 10px;width:100%;
                     background:#000000;color:#ddd;border:1px solid #54af7b;
                     border-radius:3px;cursor:pointer">Prompt Editor</button>
          </div>
        `
        wrap.querySelector('#daz-new-btn')?.addEventListener('click', () => enterEditForm(node, true))
        wrap.querySelector('#daz-edit-btn')?.addEventListener('click', () => enterEditForm(node, false))
        wrap.querySelector('#daz-prompt-editor-btn')?.addEventListener('click', () => openPromptEditorFromUse(node))
        wrap.querySelector('#daz-use-preview-btn')?.addEventListener('click', () => {
          const filename = fPath(data.image_path).split(/[\\/]/).pop()
          if (filename) showImagePreview(filename)
        })
        wrap.querySelector('#daz-use-audio-play-btn')?.addEventListener('click', () => {
          const filename = fPath(data.audio_path).split(/[\\/]/).pop()
          if (filename) playAudio(filename)
        })

        // Lora enabled toggles
        const loraKeys = Array.from({length: useModeLoraCount}, (_, i) => `lora_${i + 1}`)
        loraKeys.forEach((key, i) => {
          wrap.querySelector(`#daz-use-lora-${i + 1}`)?.addEventListener('change', async (e) => {
            const detail = node[keys.detail]
            if (!detail) return
            if (!detail.loras) detail.loras = {}
            const val    = detail.loras[key]
            const oldVal = val && typeof val === 'object' ? { ...val } : val
            if (val && typeof val === 'object') {
              val.enabled = e.target.checked
            } else {
              detail.loras[key] = { name: fName(val), enabled: e.target.checked, strength: 1.0 }
            }
            const span = e.target.nextElementSibling
            if (span) span.style.color = e.target.checked ? '#ddd' : '#666'
            updateOutputLabels(node, detail)
            node.setDirtyCanvas(true, true)
            const cw = node.widgets?.find(w => w.name === 'scene')
            const label = cw?.value
            if (!label || label === '(no configs)') return
            try {
              const r = await fetch('/daz/workflow-config-save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                  version: node._dazCurrentVersion || '1', save_mode: 'current',
                  loras: { [key]: detail.loras[key] },
                }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
              await reloadNodeConfigs(node)
              syncWidget(node)
              if (cw) cw.value = result.label
            } catch (err) {
              detail.loras[key] = oldVal
              e.target.checked = loraEnabled(oldVal)
              if (span) span.style.color = loraEnabled(oldVal) ? '#ddd' : '#666'
              updateOutputLabels(node, detail)
              node.setDirtyCanvas(true, true)
              console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not save lora enabled state`, err)
            }
          })
        })

        // Seed randomize toggle
        wrap.querySelector('#daz-use-seed-randomize')?.addEventListener('change', async (e) => {
          const detail = node[keys.detail]
          if (!detail) return
          const oldDetailSeed = detail.seed
          const seed = oldDetailSeed && typeof oldDetailSeed === 'object' ? oldDetailSeed : { value: 0 }
          detail.seed = { ...seed, randomize: e.target.checked }
          updateOutputLabels(node, detail)
          node.setDirtyCanvas(true, true)
          const cw = node.widgets?.find(w => w.name === 'scene')
          const label = cw?.value
          if (!label || label === '(no configs)') return
          try {
            const r = await fetch('/daz/workflow-config-save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                version: node._dazCurrentVersion || '1', save_mode: 'current',
                seed: detail.seed,
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            await reloadNodeConfigs(node)
            syncWidget(node)
            if (cw) cw.value = result.label
          } catch (err) {
            detail.seed = oldDetailSeed
            e.target.checked = fRandomize(oldDetailSeed)
            updateOutputLabels(node, detail)
            node.setDirtyCanvas(true, true)
            console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not save seed randomize`, err)
          }
        })

        // Flag toggles
        ;[['flag_1', 'daz-use-flag-1'], ['flag_2', 'daz-use-flag-2']].forEach(([flagKey, id]) => {
          wrap.querySelector(`#${id}`)?.addEventListener('change', async (e) => {
            const detail = node[keys.detail]
            if (!detail) return
            if (!detail.flags) detail.flags = {}
            const oldFlagEntry = detail.flags[flagKey] ? { ...detail.flags[flagKey] } : null
            if (!detail.flags[flagKey]) detail.flags[flagKey] = { label: flagKey.replace('_', ' '), value: false }
            detail.flags[flagKey].value = e.target.checked
            updateOutputLabels(node, detail)
            node.setDirtyCanvas(true, true)
            const cw = node.widgets?.find(w => w.name === 'scene')
            const label = cw?.value
            if (!label || label === '(no configs)') return
            try {
              const r = await fetch('/daz/workflow-config-save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                  version: node._dazCurrentVersion || '1', save_mode: 'current',
                  flags: { [flagKey]: detail.flags[flagKey] },
                }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
              await reloadNodeConfigs(node)
              syncWidget(node)
              if (cw) cw.value = result.label
            } catch (err) {
              if (oldFlagEntry !== null) detail.flags[flagKey] = oldFlagEntry
              else delete detail.flags[flagKey]
              e.target.checked = oldFlagEntry !== null ? oldFlagEntry.value : false
              updateOutputLabels(node, detail)
              node.setDirtyCanvas(true, true)
              console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not save flag`, err)
            }
          })
        })

        updateOutputLabels(node, data)
        node.setDirtyCanvas(true, true)
      }

      async function loadDetail(node, label, version = null) {
        if (!node[keys.wrap]) return
        if (node[keys.editMode]) return
        if (!label || label === '(no configs)') {
          node[keys.wrap].innerHTML =
            '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Select a config to preview.</p>'
          return
        }
        node[keys.wrap].innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:8px">Loading…</p>'
        try {
          const ver = rawVersion(version ?? node._dazCurrentVersion ?? node._dazVersionWidget?.value ?? '1')
          const url = configsUrl(node,
            `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(label)}&version=${encodeURIComponent(ver)}`)
          const resp = await fetch(url)
          if (!resp.ok) throw new Error(resp.statusText)
          const data = await resp.json()
          if ('_source_file' in data) {
            const correctFile = data._source_file || null
            node._dazConfigFile = correctFile
            if (node._dazConfigFileWidget) {
              const cf = _configFiles.find(f => f.file === correctFile)
              node._dazConfigFileWidget.value = cf ? fileLabel(cf) : '(default)'
            }
            delete data._source_file
            await reloadNodeConfigs(node)
            syncWidget(node)
          }
          if (data.version && node._dazVersionWidget) {
            const rawVer     = String(data.version)
            const matchDisp  = node._dazVersionWidget.options.values.find(d => rawVersion(d) === rawVer)
            const displayVal = matchDisp ?? rawVer
            if (!matchDisp) {
              node._dazVersionWidget.options.values = [...node._dazVersionWidget.options.values, displayVal]
            }
            node._dazVersionWidget.value = displayVal
            node._dazCurrentVersion = rawVer
          }
          node[keys.detail] = data
          renderUseMode(node, data)
        } catch (e) {
          node[keys.wrap].innerHTML =
            `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">Error: ${esc(e.message)}</p>`
        }
        node.setDirtyCanvas(true, true)
      }

      // ── Floating edit panel ───────────────────────────────────────────────

      async function enterEditForm(node, isNew = false) {
        if (node[keys.editMode]) return
        node[keys.editMode] = true

        let folderResults
        try {
          folderResults = await Promise.all(folderNames.map(getFolderFiles))
        } catch (e) {
          node[keys.editMode] = false
          console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not load folder files for edit panel`, e)
          return
        }
        const folderMap  = Object.fromEntries(folderNames.map((name, i) => [name, folderResults[i]]))
        const inputFiles = folderMap.input || []
        const loraFiles  = folderMap.loras  || []

        node._dazEditPanelDirty = false

        const data      = isNew ? {} : (node[keys.detail] || {})
        const imageName = fPath(data.image_path).split(/[\\/]/).pop() || ''
        const audioName = fPath(data.audio_path).split(/[\\/]/).pop() || ''
        const posType   = fType(data.positive_prompt)
        const masterPos = fPosition(data.master_prompt)
        const curVer    = isNew ? '1' : (node._dazCurrentVersion || data.version || '1')
        const uid       = `${uidPrefix}${node.id || Math.random().toString(36).slice(2, 7)}`

        // Initial Default-button disabled state, before the user can touch the
        // Type dropdown — recomputed live by updateDefaultButtonsState() below.
        const initialWorkflowType   = data.type || ''
        const masterDefaultDisabled = !resolveTypedDefault(cfg.defaultMasterPrompt, initialWorkflowType)
        const trailDefaultDisabled  = !resolveTypedDefault(cfg.defaultTrailPrompt,  initialWorkflowType)
        const negDefaultDisabled    = !cfg.defaultNegativePrompt

        function defaultBtnHtml(id, disabled) {
          return `<button id="${id}"${disabled ? ' disabled' : ''}
            style="${cb};opacity:${disabled ? 0.4 : 1};cursor:${disabled ? 'default' : 'pointer'}">default</button>`
        }

        // DOM skeleton
        const overlay = document.createElement('div')
        overlay.style.cssText =
          'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;' +
          'display:flex;align-items:flex-start;justify-content:center;padding:16px 8px;overflow-y:auto'

        const panel = document.createElement('div')
        panel.style.cssText =
          'background:#1a1a1a;border:1px solid #444;border-radius:6px;display:flex;' +
          'flex-direction:column;width:1275px;min-width:600px;font-family:monospace;' +
          'flex-shrink:0;max-height:calc(100vh - 32px)'

        const panelHeader = document.createElement('div')
        panelHeader.style.cssText =
          'padding:7px 14px;border-bottom:1px solid #333;color:#aaa;font-size:12px;flex-shrink:0'
        panelHeader.textContent = isNew ? 'New Configuration' : `Edit Configuration — version ${curVer}`

        const panelBody = document.createElement('div')
        panelBody.setAttribute('data-daz-panel-body', '1')
        panelBody.style.cssText =
          'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px;overflow-y:auto;overflow-x:hidden;flex:1'

        const panelFooter = document.createElement('div')
        panelFooter.style.cssText =
          'display:flex;align-items:center;gap:4px;padding:7px 12px;border-top:1px solid #333;' +
          'flex-shrink:0;flex-wrap:wrap'

        panel.appendChild(panelHeader)
        panel.appendChild(panelBody)
        panel.appendChild(panelFooter)
        overlay.appendChild(panel)
        document.body.appendChild(overlay)
        node[keys.editOverlay] = overlay

        // ── Left column ───────────────────────────────────────────────────
        const colLeft = `
          ${box('Name and Filters', `
            <div style="${rw}"><label style="${lbl}">Name</label>
              <input id="daz-config-name" type="text"
                value="${esc(isNew ? '' : (data.name || ''))}"
                placeholder="Config name…" style="${fs}">
            </div>
            <div style="${rw}"><label style="${lbl}">Group</label>
              <input id="daz-group" type="text" value="${esc(fName(data.group))}"
                placeholder="Optional group…" style="${fs}">
            </div>
            ${hideType
              ? `<input type="hidden" id="daz-type" value="${esc(data.type || '')}">`
              : `<div style="${rw}"><label style="${lbl}">Type</label>
              <select id="daz-type" style="${fs}">
                <option value=""${!data.type ? ' selected' : ''}>— no type —</option>
                <option value="I2V"${data.type === 'I2V' ? ' selected' : ''}>I2V</option>
                <option value="T2V"${data.type === 'T2V' ? ' selected' : ''}>T2V</option>
                <option value="MULTI"${data.type === 'MULTI' ? ' selected' : ''}>MULTI</option>
              </select>
            </div>`}
            <div style="${rw}"><label style="${lbl}">Note</label>
              <textarea id="daz-note" maxlength="900"
                style="${tas};height:60px;resize:none">${esc(fNote(data.note))}</textarea>
            </div>
            <div style="${rw}"><label style="${lbl}">Take Label</label>
              <input id="daz-version-label" type="text" value="${esc(data.label || '')}"
                data-original="${esc(data.label || '')}"
                placeholder="Optional version label…" style="${fs}">
            </div>
            <div style="display:flex;justify-content:flex-end">
              <button id="daz-name-clear" style="${cb}">clear</button>
            </div>
          `)}
          ${box('Reference Image and Audio', `
            <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px">
              <select id="daz-image-path" style="flex:1;background:#111;color:#ddd;border:1px solid #555;
                border-radius:4px;font-size:11px;font-family:monospace;padding:1px 3px;min-width:0">
                ${selOptImg(inputFiles, imageName)}
              </select>
              <button id="daz-upload-btn"
                style="font-family:monospace;font-size:11px;padding:2px 6px;background:#111;color:#ccc;
                       border:1px solid #555;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Upload…</button>
              <input id="daz-upload-input" type="file" accept="image/*" style="display:none">
              <button id="daz-img-clear" style="${cb}">clear</button>
            </div>
            <div id="daz-img-preview-box"
              style="width:100%;height:170px;background:#2a2a2a;border:1px solid #444;border-radius:3px;
                     display:flex;align-items:center;justify-content:center;overflow:hidden">
              <img id="daz-img-preview-el"
                style="${imageName ? '' : 'display:none;'}width:100%;height:100%;object-fit:contain">
              <span id="daz-img-preview-ph"
                style="color:#555;font-size:11px${imageName ? ';display:none' : ''}">Image preview here</span>
            </div>
            ${hideAudioPath ? '' : `<div style="display:flex;gap:4px;align-items:center;margin-top:6px">
              <select id="daz-audio-path" style="flex:1;background:#111;color:#ddd;border:1px solid #555;
                border-radius:4px;font-size:11px;font-family:monospace;padding:1px 3px;min-width:0">
                ${selOptAudio(inputFiles, audioName)}
              </select>
              <button id="daz-audio-upload-btn"
                style="font-family:monospace;font-size:11px;padding:2px 6px;background:#111;color:#ccc;
                       border:1px solid #555;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Upload…</button>
              <input id="daz-audio-upload-input" type="file" accept="audio/*" style="display:none">
              <button id="daz-audio-clear" style="${cb}">clear</button>
              <button id="daz-audio-play-btn"
                style="font-family:monospace;font-size:11px;padding:2px 6px;background:#111;color:#ccc;
                       border:1px solid #555;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">play</button>
            </div>`}
          `)}
          ${box('Dimensions and More', buildDimsHtml(data))}
        `

        // ── Center column ─────────────────────────────────────────────────
        const colCenter = `
          ${box('Prompt', `
            <div style="display:flex;gap:16px;margin-bottom:4px">
              <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
                <input type="radio" name="daz-pos-type-${uid}" value="smart"
                  ${posType === 'smart' ? 'checked' : ''}>Smart
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
                <input type="radio" name="daz-pos-type-${uid}" value="beats"
                  ${posType === 'beats' ? 'checked' : ''}>Beat
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
                <input type="radio" name="daz-pos-type-${uid}" value="simple"
                  ${posType === 'simple' ? 'checked' : ''}>Simple
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
                <input type="radio" name="daz-pos-type-${uid}" value="timecode"
                  ${posType === 'timecode' ? 'checked' : ''}>Timecode
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:#ccc;font-size:11px;cursor:pointer">
                <input type="radio" name="daz-pos-type-${uid}" value="h3"
                  ${posType === 'h3' ? 'checked' : ''}>H3
              </label>
            </div>
            <div id="daz-pos-type-hint" style="min-height:16px;margin-bottom:6px;font-size:10px;font-family:monospace;color:#c8922a">${
              posType === 'smart' ? 'Warning! Prompt Relays work better with CFG 1.0' :
              posType === 'beats' ? 'Beats will coerce frame count into full seconds' :
              posType === 'timecode' ? 'Timecode marks each segment\'s start time as [MM:SS]' :
              posType === 'h3' ? 'H3 marks each segment\'s start time as "At X.Ys," and merges the master prompt in' : 'Simple prompt will remove all segments'
            }</div>
            <input type="hidden" id="daz-positive-prompt-type" value="${esc(posType)}">
            <label style="${lbl}">Master</label>
            <textarea id="daz-master-prompt"
              style="${tas};height:100px;margin-bottom:2px">${esc(fText(data.master_prompt))}</textarea>
            <div id="daz-master-ctrl-row" style="display:flex;align-items:center;
                 justify-content:${posType !== 'smart' ? 'space-between' : 'flex-end'};margin-bottom:6px">
              <label id="daz-master-position-wrap" style="display:${posType !== 'smart' ? 'flex' : 'none'};
                     align-items:center;gap:5px;cursor:pointer;color:#ccc;font-size:11px">
                <input type="checkbox" id="daz-master-position"${masterPos === 'after' ? ' checked' : ''}
                  style="cursor:pointer;accent-color:#54af7b;margin:0">
                Append (master after positive)
              </label>
              <div style="display:flex;gap:6px">
                ${defaultBtnHtml('daz-master-default', masterDefaultDisabled)}
                <button id="daz-master-clear" style="${cb}">clear</button>
              </div>
            </div>
            <label style="${lbl}">Positive</label>
            <textarea id="daz-positive-prompt"
              style="${tas};height:180px;margin-bottom:2px">${esc(fText(data.positive_prompt))}</textarea>
            <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
              <button id="daz-positive-clear" style="${cb}">clear</button>
            </div>
            <label style="${lbl}">Qualifiers</label>
            <textarea id="daz-trail-prompt"
              style="${tas};height:70px;margin-bottom:2px">${esc(fText(data.trail_prompt))}</textarea>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
              ${defaultBtnHtml('daz-trail-default', trailDefaultDisabled)}
              <button id="daz-trail-clear" style="${cb}">clear</button>
            </div>
            <label style="${lbl}">Negative<span id="daz-neg-cfg-warn" style="color:#f88;font-size:10px;margin-left:6px"></span></label>
            <textarea id="daz-negative-prompt"
              style="${tas};height:100px;margin-bottom:2px">${esc(isNew ? (cfg.defaultNegativePrompt || '') : fText(data.negative_prompt))}</textarea>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              ${defaultBtnHtml('daz-negative-default', negDefaultDisabled)}
              <button id="daz-negative-clear" style="${cb}">clear</button>
            </div>
            <button id="daz-prompt-editor-btn"
              style="font-family:monospace;font-size:11px;padding:4px 10px;width:100%;
                     background:#1a3a1a;color:#9dc;border:1px solid #54af7b;
                     border-radius:3px;cursor:pointer">Prompt Editor</button>
          `)}
        `

        // ── Right column ──────────────────────────────────────────────────
        const colRight = `
          ${box('Models', buildModelsHtml(folderMap, data))}
          ${hideLorasBox ? '' : box('LoRAs', buildLorasHtml(loraFiles, data))}
          ${box('Other', `
            <div style="${rw}">
              <div style="display:flex;align-items:flex-end;gap:4px">
                <div style="flex:1"><label style="${lbl}">Filename</label>
                  <input id="daz-filename" type="text" value="${esc(fFile(data.filename))}"
                    placeholder="subdir/output_name" style="${fs}"></div>
                <button id="daz-filename-clear" style="${cb};margin-bottom:1px">clear</button>
              </div>
            </div>
            <div style="margin-bottom:4px"><label style="${lbl}">Flag 1</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="daz-flag-1-label" type="text"
                  value="${esc(fFlagLabel(data.flags?.flag_1, 'flag 1'))}"
                  placeholder="flag 1" style="flex:1;${fs}">
                <input type="checkbox" id="daz-flag-1-value"${fFlagValue(data.flags?.flag_1) ? ' checked' : ''}
                  style="width:14px;height:14px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
              </div>
            </div>
            <div style="margin-bottom:5px"><label style="${lbl}">Flag 2</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="daz-flag-2-label" type="text"
                  value="${esc(fFlagLabel(data.flags?.flag_2, 'flag 2'))}"
                  placeholder="flag 2" style="flex:1;${fs}">
                <input type="checkbox" id="daz-flag-2-value"${fFlagValue(data.flags?.flag_2) ? ' checked' : ''}
                  style="width:14px;height:14px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
              </div>
            </div>
            <div style="margin-bottom:5px"><label style="${lbl}">Flag 3</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="daz-flag-3-label" type="text"
                  value="${esc(fFlagLabel(data.flags?.flag_3, 'flag 3'))}"
                  placeholder="flag 3" style="flex:1;${fs}">
                <input type="checkbox" id="daz-flag-3-value"${fFlagValue(data.flags?.flag_3) ? ' checked' : ''}
                  style="width:14px;height:14px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
              </div>
            </div>
            <div style="margin-bottom:4px"><label style="${lbl}">Custom 1</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="daz-custom-1-label" type="text"
                  value="${esc(fFlagLabel(data.custom?.param_1, 'param 1'))}"
                  placeholder="param 1" style="flex:1;${fs}">
                <input id="daz-custom-1-value" type="text"
                  value="${esc(fCustomValue(data.custom?.param_1))}"
                  placeholder="" style="flex:2;${fs}">
              </div>
            </div>
            <div style="margin-bottom:5px"><label style="${lbl}">Custom 2</label>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="daz-custom-2-label" type="text"
                  value="${esc(fFlagLabel(data.custom?.param_2, 'param 2'))}"
                  placeholder="param 2" style="flex:1;${fs}">
                <input id="daz-custom-2-value" type="text"
                  value="${esc(fCustomValue(data.custom?.param_2))}"
                  placeholder="" style="flex:2;${fs}">
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end">
              <button id="daz-other-clear" style="${cb}">clear</button>
            </div>
          `)}
        `

        panelBody.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden">${colLeft}</div>
          <div style="display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden">${colCenter}</div>
          <div style="display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden">${colRight}</div>
        `

        // Mark panel dirty on any input/change inside the body
        panelBody.addEventListener('input',  () => { node._dazEditPanelDirty = true })
        panelBody.addEventListener('change', () => { node._dazEditPanelDirty = true })

        // Footer
        const btnBase = 'font-family:monospace;font-size:12px;padding:3px 12px;border-radius:3px;cursor:pointer;border:1px solid'
        const sep     = '<div style="width:1px;height:16px;background:#444;flex-shrink:0;margin:0 8px"></div>'
        const errSpan = '<span id="daz-save-error" style="flex:1;color:#f88;font-size:11px;font-family:monospace;padding:0 4px;min-width:0"></span>'
        const presetBtns = `<div style="display:flex;gap:4px;align-items:center">
               <button id="daz-apply-preset-btn"   style="${btnBase} #2a8050;background:#1a5c35;color:#9dc">Apply Preset</button>
               <button id="daz-save-preset-btn"    style="${btnBase} #2a5080;background:#1a3a5c;color:#9cd">Save/Update Preset</button>
               <button id="daz-manage-presets-btn" style="${btnBase} #555;background:#333;color:#ddd">Manage Presets</button>
             </div>`

        panelFooter.innerHTML = isNew
          ? `<div style="display:flex;gap:4px;align-items:center;flex:1;min-width:0">${errSpan}</div>
             ${sep}${presetBtns}${sep}
             <div style="display:flex;gap:4px;align-items:center;flex:1;min-width:0;justify-content:flex-end">
               <button id="daz-cancel-btn" style="${btnBase} #666;background:#444;color:#ccc">Cancel</button>
               <button id="daz-create-btn" style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Create</button>
             </div>`
          : `<div style="display:flex;gap:4px;align-items:center;flex:1;min-width:0">
               <button id="daz-duplicate-btn" style="${btnBase} #555;background:#333;color:#ddd">Duplicate</button>
               <button id="daz-duplicate-other-btn" style="${btnBase} #555;background:#333;color:#ddd">Duplicate In Another Movie File</button>
               <button id="daz-del-config-btn" style="${btnBase} #cc2222;background:#3d0f0f;color:#f99">Del All</button>
               ${errSpan}
             </div>
             ${sep}${presetBtns}${sep}
             <div style="display:flex;gap:4px;align-items:center;flex:1;min-width:0;justify-content:flex-end">
               <button id="daz-cancel-btn"      style="${btnBase} #666;background:#444;color:#ccc">Cancel</button>
               <button id="daz-del-version-btn" style="${btnBase} #803030;background:#5c1a1a;color:#f99">Delete Take</button>
               <button id="daz-new-version-btn" style="${btnBase} #2a5080;background:#1a3a5c;color:#9cd">+ Take</button>
               <button id="daz-save-btn"        style="${btnBase} #2a8050;background:#1a5c35;color:#cde">Save</button>
             </div>`

        // Initial image preview
        if (imageName) {
          const el = panel.querySelector('#daz-img-preview-el')
          if (el) el.src = `/view?filename=${encodeURIComponent(imageName)}&type=input`
        }

        // ── Event handlers ────────────────────────────────────────────────

        // Enter-key navigation
        if (node._dazEditKeydownPanel && node._dazEditKeydownHandler) {
          node._dazEditKeydownPanel.removeEventListener('keydown', node._dazEditKeydownHandler)
        }
        node._dazEditKeydownHandler = (e) => {
          if (e.key !== 'Enter') return
          if (e.target.tagName !== 'INPUT') return
          if (['file','hidden','checkbox','radio'].includes(e.target.type)) return
          e.preventDefault()
          const els = Array.from(panel.querySelectorAll(
            'input:not([type=file]):not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea'
          ))
          const idx = els.indexOf(e.target)
          if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus()
        }
        node._dazEditKeydownPanel = panel
        panel.addEventListener('keydown', node._dazEditKeydownHandler)

        // Radio → hidden type sync + hint
        const POS_TYPE_HINTS = {
          smart:    'Warning! Prompt Relays work better with CFG 1.0',
          beats:    'Beats will coerce frame count into full seconds',
          simple:   'Simple prompt will remove all segments',
          timecode: 'Timecode marks each segment\'s start time as [MM:SS]',
          h3:       'H3 marks each segment\'s start time as "At X.Ys," and merges the master prompt in',
        }
        panel.querySelectorAll(`input[name="daz-pos-type-${uid}"]`).forEach(r => {
          r.addEventListener('change', () => {
            const h = panel.querySelector('#daz-positive-prompt-type')
            if (h) h.value = r.value
            const hint = panel.querySelector('#daz-pos-type-hint')
            if (hint) hint.textContent = POS_TYPE_HINTS[r.value] ?? ''
            const showPos = r.value !== 'smart'
            const posRow  = panel.querySelector('#daz-master-ctrl-row')
            if (posRow) posRow.style.justifyContent = showPos ? 'space-between' : 'flex-end'
            const posWrap = panel.querySelector('#daz-master-position-wrap')
            if (posWrap) posWrap.style.display = showPos ? 'flex' : 'none'
          })
        })

        // Live image preview
        const imgSel = panel.querySelector('#daz-image-path')
        const prevEl = panel.querySelector('#daz-img-preview-el')
        const prevPH = panel.querySelector('#daz-img-preview-ph')
        function updatePreview(filename) {
          if (!prevEl || !prevPH) return
          if (filename) {
            prevEl.src = `/view?filename=${encodeURIComponent(filename)}&type=input`
            prevEl.style.display = 'block'
            prevPH.style.display = 'none'
          } else {
            prevEl.src = ''
            prevEl.style.display = 'none'
            prevPH.style.display = ''
          }
        }
        imgSel?.addEventListener('change', e => updatePreview(e.target.value))

        // Wired here rather than next to the other Dimensions handlers below,
        // because the image clear and upload handlers need the controller.
        const dimsCtl = wireDimensions(panel)

        // Sizing
        panel.querySelector('#daz-sizing-btn')?.addEventListener('click', () => openSizingModal(panel))

        // Upload
        panel.querySelector('#daz-upload-btn')?.addEventListener('click', () => {
          panel.querySelector('#daz-upload-input')?.click()
        })
        panel.querySelector('#daz-upload-input')?.addEventListener('change', async (e) => {
          const file   = e.target.files?.[0]
          if (!file) return
          const btn    = panel.querySelector('#daz-upload-btn')
          const errDiv = panel.querySelector('#daz-save-error')
          if (!btn) return
          btn.textContent = 'Uploading…'
          btn.disabled    = true
          if (errDiv) errDiv.textContent = ''
          try {
            const fd = new FormData()
            fd.append('image', file)
            fd.append('type', 'input')
            const r = await fetch('/upload/image', { method: 'POST', body: fd })
            if (!r.ok) throw new Error(r.statusText)
            const result = await r.json()
            delete folderFiles['input']
            const fresh = await getFolderFiles('input')
            const sel = panel.querySelector('#daz-image-path')
            if (sel) sel.innerHTML = selOptImg(fresh, result.name)
            updatePreview(result.name)
            dimsCtl.refresh()
          } catch (err) {
            if (errDiv) errDiv.textContent = `Upload failed: ${esc(err.message)}`
          }
          btn.textContent = 'Upload…'
          btn.disabled    = false
        })

        // Audio upload
        panel.querySelector('#daz-audio-upload-btn')?.addEventListener('click', () => {
          panel.querySelector('#daz-audio-upload-input')?.click()
        })
        panel.querySelector('#daz-audio-upload-input')?.addEventListener('change', async (e) => {
          const file   = e.target.files?.[0]
          if (!file) return
          const btn    = panel.querySelector('#daz-audio-upload-btn')
          const errDiv = panel.querySelector('#daz-save-error')
          if (!btn) return
          btn.textContent = 'Uploading…'
          btn.disabled    = true
          if (errDiv) errDiv.textContent = ''
          try {
            const fd = new FormData()
            fd.append('image', file)
            fd.append('type', 'input')
            const r = await fetch('/upload/image', { method: 'POST', body: fd })
            if (!r.ok) throw new Error(r.statusText)
            const result = await r.json()
            delete folderFiles['input']
            const fresh = await getFolderFiles('input')
            const sel = panel.querySelector('#daz-audio-path')
            if (sel) sel.innerHTML = selOptAudio(fresh, result.name)
          } catch (err) {
            if (errDiv) errDiv.textContent = `Upload failed: ${esc(err.message)}`
          }
          btn.textContent = 'Upload…'
          btn.disabled    = false
        })
        panel.querySelector('#daz-audio-clear')?.addEventListener('click', () => {
          const sel = panel.querySelector('#daz-audio-path')
          if (sel) sel.value = ''
        })
        panel.querySelector('#daz-audio-play-btn')?.addEventListener('click', () => {
          const sel = panel.querySelector('#daz-audio-path')
          const filename = sel?.value
          if (filename) playAudio(filename)
        })

        // Seed randomize (immediate save in edit mode)
        panel.querySelector('#daz-seed-randomize')?.addEventListener('change', async (e) => {
          if (isNew) return
          const cw    = node.widgets?.find(w => w.name === 'scene')
          const label = cw?.value
          if (!label || label === '(no configs)') return
          const detail  = node[keys.detail] || {}
          const seedVal = parseInt(panel.querySelector('#daz-seed')?.value ?? '0', 10)
          const newSeed = { value: seedVal, randomize: e.target.checked }
          try {
            const r = await fetch('/daz/workflow-config-save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                version: node._dazCurrentVersion || '1', save_mode: 'current', seed: newSeed,
              }),
            })
            const result = await r.json()
            if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            if (node[keys.detail]) node[keys.detail].seed = newSeed
            await reloadNodeConfigs(node)
            syncWidget(node)
            if (cw) cw.value = result.label
          } catch (err) {
            console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not save seed randomize`, err)
          }
        })

        // Clear buttons
        panel.querySelector('#daz-name-clear')?.addEventListener('click', () => {
          ;['#daz-config-name','#daz-group','#daz-version-label'].forEach(id => {
            const el = panel.querySelector(id); if (el) el.value = ''
          })
          const t = panel.querySelector('#daz-type'); if (t) t.value = ''
          const n = panel.querySelector('#daz-note'); if (n) n.value = ''
          updateDefaultButtonsState(panel)
        })
        panel.querySelector('#daz-img-clear')?.addEventListener('click', () => {
          const sel = panel.querySelector('#daz-image-path')
          if (sel) sel.value = ''
          updatePreview('')
          dimsCtl.refresh()
        })
        const _cfgWarnEl = panel.querySelector('#daz-neg-cfg-warn')
        const _cfgIds    = cfg.cfgInputIds ?? []
        const checkCfgWarn = () => {
          if (!_cfgWarnEl) return
          const atOne = _cfgIds.some(id => parseFloat(panel.querySelector(id)?.value) === 1)
          _cfgWarnEl.textContent = atOne ? '(Negative prompt is ineffective at CFG 1.0 - use NAG)' : ''
        }
        _cfgIds.forEach(id => panel.querySelector(id)?.addEventListener('input', checkCfgWarn))
        checkCfgWarn()
        const resetDurationRow = wireDurationSync(panel)
        panel.querySelector('#daz-dims-clear')?.addEventListener('click', () => {
          dimsClearIds.forEach(id => {
            const el = panel.querySelector(id); if (el) el.value = '0'
          })
          checkCfgWarn()
          resetDurationRow()
          dimsCtl.reset()
          const r = panel.querySelector('#daz-seed-randomize'); if (r) r.checked = false
        })
        panel.querySelector('#daz-master-default')?.addEventListener('click', () => {
          const ta = panel.querySelector('#daz-master-prompt')
          const workflowType = panel.querySelector('#daz-type')?.value || ''
          if (ta) ta.value = resolveTypedDefault(cfg.defaultMasterPrompt, workflowType)
        })
        panel.querySelector('#daz-master-clear')?.addEventListener('click', () => {
          const ta = panel.querySelector('#daz-master-prompt'); if (ta) ta.value = ''
        })
        panel.querySelector('#daz-positive-clear')?.addEventListener('click', () => {
          const ta = panel.querySelector('#daz-positive-prompt'); if (ta) ta.value = ''
        })
        panel.querySelector('#daz-trail-default')?.addEventListener('click', () => {
          const ta = panel.querySelector('#daz-trail-prompt')
          const workflowType = panel.querySelector('#daz-type')?.value || ''
          if (ta) ta.value = resolveTypedDefault(cfg.defaultTrailPrompt, workflowType)
        })
        panel.querySelector('#daz-trail-clear')?.addEventListener('click', () => {
          const ta = panel.querySelector('#daz-trail-prompt'); if (ta) ta.value = ''
        })
        panel.querySelector('#daz-negative-default')?.addEventListener('click', () => {
          const ta = panel.querySelector('#daz-negative-prompt'); if (ta) ta.value = cfg.defaultNegativePrompt ?? ''
        })
        panel.querySelector('#daz-negative-clear')?.addEventListener('click', () => {
          const ta = panel.querySelector('#daz-negative-prompt'); if (ta) ta.value = ''
        })
        panel.querySelector('#daz-type')?.addEventListener('change', () => updateDefaultButtonsState(panel))
        function syncGgufCheckbox(select, checkbox) {
          const sel = panel.querySelector(select)
          const chk = panel.querySelector(checkbox)
          if (!sel || !chk) return
          chk.checked = isGgufFilename(sel.value)
        }
        unetGgufFields.forEach(({ select, checkbox }) => {
          panel.querySelector(select)?.addEventListener('change', () => syncGgufCheckbox(select, checkbox))
        })
        panel.querySelector('#daz-models-clear')?.addEventListener('click', () => {
          modelsClearIds.forEach(id => {
            const el = panel.querySelector(id); if (!el) return
            if (el.type === 'checkbox') el.checked = false
            else el.value = ''
          })
          unetGgufFields.forEach(({ select, checkbox }) => syncGgufCheckbox(select, checkbox))
        })
        panel.querySelector('#daz-loras-clear')?.addEventListener('click', () => {
          for (let n = 1; n <= loraLabels.length; n++) {
            const s = panel.querySelector(`#daz-lora-${n}`);          if (s) s.value = ''
            const w = panel.querySelector(`#daz-lora-${n}-strength`); if (w) w.value = '1'
            const c = panel.querySelector(`#daz-lora-${n}-enabled`);  if (c) c.checked = true
          }
        })
        panel.querySelector('#daz-filename-clear')?.addEventListener('click', () => {
          const el = panel.querySelector('#daz-filename'); if (el) el.value = ''
        })
        panel.querySelector('#daz-other-clear')?.addEventListener('click', () => {
          const fn = panel.querySelector('#daz-filename');     if (fn) fn.value = ''
          const l1 = panel.querySelector('#daz-flag-1-label'); if (l1) l1.value = 'flag 1'
          const v1 = panel.querySelector('#daz-flag-1-value'); if (v1) v1.checked = false
          const l2 = panel.querySelector('#daz-flag-2-label'); if (l2) l2.value = 'flag 2'
          const v2 = panel.querySelector('#daz-flag-2-value'); if (v2) v2.checked = false
          const l3 = panel.querySelector('#daz-flag-3-label'); if (l3) l3.value = 'flag 3'
          const v3 = panel.querySelector('#daz-flag-3-value'); if (v3) v3.checked = false
          const cl1 = panel.querySelector('#daz-custom-1-label'); if (cl1) cl1.value = 'param 1'
          const cv1 = panel.querySelector('#daz-custom-1-value'); if (cv1) cv1.value = ''
          const cl2 = panel.querySelector('#daz-custom-2-label'); if (cl2) cl2.value = 'param 2'
          const cv2 = panel.querySelector('#daz-custom-2-value'); if (cv2) cv2.value = ''
        })

        // Close panel helper
        function closePanel() {
          if (node[keys.editOverlay]) {
            node[keys.editOverlay].remove()
            node[keys.editOverlay] = null
          }
          node[keys.editMode] = false
          node._dazEditPanelDirty = false
        }

        function doCancel() {
          closePanel()
          renderUseMode(node, node[keys.detail] || {})
        }

        function showUnsavedChangesConfirm() {
          const mo = document.createElement('div')
          mo.style.cssText = [
            'position:fixed;top:0;left:0;right:0;bottom:0',
            'background:rgba(0,0,0,0.75);z-index:10000',
            'display:flex;align-items:center;justify-content:center',
          ].join(';')
          const mb = document.createElement('div')
          mb.style.cssText = [
            'background:#2a2a2a;border:1px solid #555;border-radius:6px',
            'padding:20px 24px;width:380px;font-family:monospace',
          ].join(';')
          mb.innerHTML = `
            <p style="font-size:13px;color:#ddd;margin:0 0 8px">Unsaved changes</p>
            <p style="font-size:11px;color:#888;margin:0 0 20px">
              The prompt editor has changes that haven't been saved yet.
            </p>
            <div style="display:flex;justify-content:flex-end;gap:8px">
              <button id="usc-back"
                style="font-family:monospace;font-size:11px;padding:4px 14px;
                       background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">
                Get back to editor
              </button>
              <button id="usc-discard"
                style="font-family:monospace;font-size:11px;padding:4px 14px;
                       background:#5c1a1a;color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer">
                Discard changes and exit
              </button>
            </div>
          `
          mo.appendChild(mb)
          document.body.appendChild(mo)
          mo.addEventListener('click', e => { if (e.target === mo) mo.remove() })
          mb.querySelector('#usc-back')?.addEventListener('click', () => mo.remove())
          mb.querySelector('#usc-discard')?.addEventListener('click', () => { mo.remove(); doCancel() })
        }

        // Cancel
        panel.querySelector('#daz-cancel-btn')?.addEventListener('click', () => {
          if (node._dazEditPanelDirty) showUnsavedChangesConfirm()
          else doCancel()
        })

        // Action buttons
        if (isNew) {
          panel.querySelector('#daz-create-btn')?.addEventListener('click', () => createConfig(node, panel))
        } else {
          panel.querySelector('#daz-duplicate-btn')?.addEventListener('click', () => {
            if (node._dazEditPanelDirty) showPreDuplicateModal(node, panel)
            else showDuplicateModal(node, panel)
          })
          panel.querySelector('#daz-duplicate-other-btn')?.addEventListener('click', () => {
            const openPicker = () => showMovieFilePickerModal(node, panel)
            if (node._dazEditPanelDirty) showPreDuplicateModal(node, panel, openPicker)
            else openPicker()
          })
          panel.querySelector('#daz-del-version-btn')?.addEventListener('click', () => showDeleteVersionConfirm(node, panel))
          panel.querySelector('#daz-del-config-btn')?.addEventListener('click', () => showDeleteConfigConfirm(node, panel))
          panel.querySelector('#daz-save-btn')?.addEventListener('click', () => saveConfig(node, panel, 'current'))
          panel.querySelector('#daz-new-version-btn')?.addEventListener('click', () => saveConfig(node, panel, 'new_version'))
        }

        panel.querySelector('#daz-prompt-editor-btn')?.addEventListener('click', () => {
          openPromptEditorFromEdit(node, panel, isNew)
        })

        // Preset buttons (handlers implemented individually)
        panel.querySelector('#daz-apply-preset-btn')?.addEventListener('click', () => openApplyPresetModal(node, panel, isNew))
        panel.querySelector('#daz-save-preset-btn')?.addEventListener('click', () => openSavePresetModal(node, panel, isNew))
        panel.querySelector('#daz-manage-presets-btn')?.addEventListener('click', () => openManagePresetsModal(node, panel))

        node.setDirtyCanvas(true, true)

        if (isNew) {
          try {
            const r = await fetch(`/daz/presets?class=${encodeURIComponent(CLASS)}`)
            if (r.ok) {
              const ps = await r.json()
              if (ps.length) openApplyPresetModal(node, panel, isNew)
            }
          } catch (e) {}
        }
      }

      // ── Preset field writer ───────────────────────────────────────────────────

      const PRESET_FIELD_MAP = {
        unet_high:  { sel: '#daz-unet-high',              kind: 'name', checkbox: '#daz-unet-high-gguf' },
        unet_low:   { sel: '#daz-unet-low',               kind: 'name', checkbox: '#daz-unet-low-gguf'  },
        vae:        { sel: '#daz-vae',                    kind: 'name'  },
        clip:       { sel: '#daz-clip',                   kind: 'name'  },
        clip_2:     { sel: '#daz-clip-2',                 kind: 'name'  },
        audio_vae:  { sel: '#daz-audio-vae',              kind: 'name'  },
        checkpoint: { sel: '#daz-checkpoint',             kind: 'name'  },
        latent_upscale: { sel: '#daz-latent-upscale',     kind: 'name'  },
        clip_type:  { sel: '#daz-clip-type',              kind: 'raw'   },
        type:       { sel: '#daz-type',                   kind: 'raw'   },
        note:       { sel: '#daz-note',                   kind: 'note'  },
        width:      { sel: '#daz-width',                  kind: 'int'   },
        height:     { sel: '#daz-height',                 kind: 'int'   },
        steps:      { sel: '#daz-steps',                  kind: 'int'   },
        split_step: { sel: '#daz-split-step',             kind: 'int'   },
        total_frames: { sel: '#daz-total-frames',         kind: 'int'   },
        cfg_high:   { sel: ['#daz-cfg-high', '#daz-cfg'], kind: 'float' },
        cfg_low:    { sel: '#daz-cfg-low',                kind: 'float' },
        shift_high: { sel: '#daz-shift-high',             kind: 'float' },
        shift_low:  { sel: '#daz-shift-low',              kind: 'float' },
        fps:        { sel: '#daz-fps',                    kind: 'float' },
      }

      function applyPresetToPanel(panel, preset, profile) {
        for (const field of profile) {
          if (field === 'master_prompt' || field === 'negative_prompt' || field === 'trail_prompt') {
            if (!(field in preset)) continue
            const val = preset[field]
            const sel = field === 'master_prompt' ? '#daz-master-prompt'
                      : field === 'negative_prompt' ? '#daz-negative-prompt' : '#daz-trail-prompt'
            const el = panel.querySelector(sel)
            if (el) el.value = String((val && typeof val === 'object') ? (val.text ?? '') : (val ?? ''))
            continue
          }
          if (field === 'positive_prompt') {
            if (!(field in preset)) continue
            const val = preset.positive_prompt
            const v   = (val && typeof val === 'object') ? val : {}
            const posTA = panel.querySelector('#daz-positive-prompt')
            if (posTA) posTA.value = String(v.text ?? val ?? '')
            const newType = v.type ?? 'smart'
            const posTypeInput = panel.querySelector('#daz-positive-prompt-type')
            if (posTypeInput) posTypeInput.value = newType
            panel.querySelectorAll('input[name^="daz-pos-type-"]').forEach(r => { r.checked = r.value === newType })
            const showPos = newType !== 'smart'
            const posRow  = panel.querySelector('#daz-master-ctrl-row')
            if (posRow) posRow.style.justifyContent = showPos ? 'space-between' : 'flex-end'
            const posWrap = panel.querySelector('#daz-master-position-wrap')
            if (posWrap) posWrap.style.display = showPos ? 'flex' : 'none'
            const posHint = panel.querySelector('#daz-pos-type-hint')
            if (posHint) posHint.textContent = newType === 'smart'
              ? 'Warning! Prompt Relays work better with CFG 1.0'
              : newType === 'beats' ? 'Beats will coerce frame count into full seconds'
              : newType === 'timecode' ? 'Timecode marks each segment\'s start time as [MM:SS]'
              : newType === 'h3' ? 'H3 marks each segment\'s start time as "At X.Ys," and merges the master prompt in' : 'Simple prompt will remove all segments'
            continue
          }
          if (field === 'dimensions') {
            if (!(field in preset)) continue
            const d      = fDimensions(preset.dimensions)
            const useEl  = panel.querySelector('#daz-dim-use-image')
            const modeEl = panel.querySelector('#daz-dim-scale-mode')
            const valEl  = panel.querySelector('#daz-dim-scale-value')
            if (useEl)  useEl.checked = d.use_image
            if (modeEl) modeEl.value  = d.mode
            if (valEl)  valEl.value   = String(d.value)
            continue
          }
          if (field === 'loras') {
            if (!(field in preset)) continue
            const loras = (preset.loras && typeof preset.loras === 'object') ? preset.loras : {}
            for (let n = 1; n <= 8; n++) {
              const lora   = loras[`lora_${n}`] ?? {}
              const nameEl = panel.querySelector(`#daz-lora-${n}`)
              const strEl  = panel.querySelector(`#daz-lora-${n}-strength`)
              const enEl   = panel.querySelector(`#daz-lora-${n}-enabled`)
              if (nameEl) nameEl.value   = String(lora.name ?? '')
              if (strEl)  strEl.value    = String(lora.strength ?? 1.0)
              if (enEl)   enEl.checked   = lora.enabled ?? true
            }
            continue
          }
          if (field === 'flags') {
            if (!(field in preset)) continue
            const flags = (preset.flags && typeof preset.flags === 'object') ? preset.flags : {}
            for (let n = 1; n <= 3; n++) {
              const flag    = flags[`flag_${n}`] ?? {}
              const labelEl = panel.querySelector(`#daz-flag-${n}-label`)
              const valEl   = panel.querySelector(`#daz-flag-${n}-value`)
              if (labelEl) labelEl.value = String(flag.label ?? `flag ${n}`)
              if (valEl)   valEl.checked = flag.value ?? false
            }
            continue
          }
          if (field === 'custom') {
            if (!(field in preset)) continue
            const custom = (preset.custom && typeof preset.custom === 'object') ? preset.custom : {}
            for (let n = 1; n <= 2; n++) {
              const param   = custom[`param_${n}`] ?? {}
              const labelEl = panel.querySelector(`#daz-custom-${n}-label`)
              const valEl   = panel.querySelector(`#daz-custom-${n}-value`)
              if (labelEl) labelEl.value = String(param.label ?? `param ${n}`)
              if (valEl)   valEl.value   = String(param.value ?? '')
            }
            continue
          }
          const map = PRESET_FIELD_MAP[field]
          if (!map || !(field in preset)) continue
          const val  = preset[field]
          const sels = Array.isArray(map.sel) ? map.sel : [map.sel]
          let el = null
          for (const s of sels) { el = panel.querySelector(s); if (el) break }
          if (!el) continue
          const v = (val && typeof val === 'object') ? val : {}
          switch (map.kind) {
            case 'name':
              el.value = String(v.name ?? val ?? '')
              if (map.checkbox) {
                const chk = panel.querySelector(map.checkbox)
                if (chk) chk.checked = isGgufFilename(el.value)
              }
              break
            case 'raw':   el.value = String(val ?? '');             break
            case 'note':  el.value = String(v.value ?? val ?? ''); break
            case 'int':   el.value = String(v.value ?? val ?? 0);  break
            case 'float': el.value = String(v.value ?? val ?? 0);  break
          }
        }
        // A preset can carry fps, so re-derive Duration (s) from the frame count
        panel.querySelector('#daz-total-frames')
          ?.dispatchEvent(new Event('input', { bubbles: true }))
        // The dimensions controls constrain each other and the width/height, and
        // a preset writes them straight rather than through their handlers — so
        // re-run the wiring: it drops "Use image" if this panel has no reference
        // image, narrows the mode list, and re-derives the size from the image.
        // adopt() first, so the width/height the preset just wrote are taken as
        // the new baseline rather than reverted to what the panel had before.
        panel._dazDimsCtl?.adopt()
        panel._dazDimsCtl?.refresh()
      }

      // ── Shared preset modal base ──────────────────────────────────────────────

      async function openPresetModal({ title, subtitle, renderActions }) {
        let presets = []
        try {
          const r = await fetch(`/daz/presets?class=${encodeURIComponent(CLASS)}`)
          if (r.ok) presets = await r.json()
        } catch (e) {}

        const mo = document.createElement('div')
        mo.style.cssText =
          'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10001;' +
          'display:flex;align-items:center;justify-content:center'
        const mb = document.createElement('div')
        mb.style.cssText =
          'background:#2a2a2a;border:1px solid #555;border-radius:6px;' +
          'padding:20px 24px;width:460px;font-family:monospace'
        mo.appendChild(mb)
        document.body.appendChild(mo)
        mo.addEventListener('click', e => { if (e.target === mo) mo.remove() })

        const noPresets = !presets.length
        const types     = ['All', ...Array.from(new Set(presets.map(p => p.type).filter(Boolean))).sort()]

        function presetLabel(p) {
          const vl = (p.version_label || '').trim()
          return vl
            ? `${p.name} (version ${p.version} - ${vl})`
            : `${p.name} (version ${p.version})`
        }

        function makeOptions(typeFilter = 'All') {
          const visible = typeFilter === 'All' ? presets
            : presets.filter(p => (p.type || '') === typeFilter)
          if (!visible.length)
            return `<option value="" disabled selected>— no presets for this type —</option>`
          return visible.map(p =>
            `<option value="${presets.indexOf(p)}">${esc(presetLabel(p))}</option>`
          ).join('')
        }

        mb.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 ${subtitle ? '6px' : '16px'};font-weight:bold">${title}</p>
          ${subtitle ? `<p style="color:#888;font-size:11px;margin:0 0 14px">${subtitle}</p>` : ''}
          ${!hideType ? `
          <div style="margin-bottom:10px">
            <label style="color:#888;font-size:10px;display:block;margin-bottom:3px">Type</label>
            <select id="daz-pm-type" style="${fs}" ${noPresets ? 'disabled' : ''}>
              ${types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
            </select>
          </div>` : ''}
          <div style="margin-bottom:10px">
            <label style="color:#888;font-size:10px;display:block;margin-bottom:3px">Preset</label>
            <select id="daz-pm-sel" style="${fs}" ${noPresets ? 'disabled' : ''}>${makeOptions()}</select>
          </div>
          <div style="margin-bottom:16px">
            <label style="color:#888;font-size:10px;display:block;margin-bottom:3px">Note</label>
            <textarea id="daz-pm-note" readonly
              style="${fs};resize:none;height:54px;color:#aaa;cursor:default"></textarea>
          </div>
          <div id="daz-pm-error" style="color:#f88;font-size:11px;min-height:16px;margin-bottom:8px"></div>
          <div id="daz-pm-actions"></div>`

        const typeSel   = mb.querySelector('#daz-pm-type')
        const presetSel = mb.querySelector('#daz-pm-sel')
        const noteEl    = mb.querySelector('#daz-pm-note')
        const errorEl   = mb.querySelector('#daz-pm-error')
        const actionsEl = mb.querySelector('#daz-pm-actions')

        function getSelected() {
          const idx = parseInt(presetSel?.value, 10)
          return isNaN(idx) ? null : (presets[idx] ?? null)
        }

        function updateNote() {
          if (noteEl) noteEl.value = getSelected()?.note || ''
        }

        typeSel?.addEventListener('change', () => {
          presetSel.innerHTML = makeOptions(typeSel.value)
          presetSel.dispatchEvent(new Event('change'))
        })
        presetSel?.addEventListener('change', updateNote)
        updateNote()

        renderActions({ mo, mb, actionsEl, presets, noPresets, getSelected, errorEl, presetSel })
      }

      // ── Apply Preset modal ────────────────────────────────────────────────────

      async function openApplyPresetModal(node, panel, isNew) {
        const bGray  = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                       'background:#444;color:#ccc;border:1px solid #666;cursor:pointer'
        const bGreen = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                       'background:#1a5c35;color:#cde;border:1px solid #2a8050;cursor:pointer'

        await openPresetModal({
          title: 'Apply Preset',
          renderActions({ mo, actionsEl, getSelected, presetSel }) {
            actionsEl.innerHTML = `
              <div style="display:flex;justify-content:flex-end;gap:8px">
                <button id="daz-pa-cancel" style="${bGray}">Cancel</button>
                <button id="daz-pa-apply" style="${bGreen}">Apply</button>
              </div>`

            const applyBtn = actionsEl.querySelector('#daz-pa-apply')

            function syncBtn() {
              const has = !!getSelected()
              applyBtn.disabled      = !has
              applyBtn.style.opacity = has ? '1' : '0.4'
              applyBtn.style.cursor  = has ? 'pointer' : 'default'
            }
            presetSel?.addEventListener('change', syncBtn)
            syncBtn()

            actionsEl.querySelector('#daz-pa-cancel').addEventListener('click', () => mo.remove())
            applyBtn.addEventListener('click', async () => {
              const p = getSelected()
              if (!p) return
              applyPresetToPanel(panel, p, p._profile ?? [])
              updateDefaultButtonsState(panel)
              node._dazEditPanelDirty = true
              mo.remove()
              if (!isNew) await saveConfig(node, panel, 'current', true, false, true)
            })
          },
        })
      }

      // ── Save / Update Preset modal ────────────────────────────────────────────

      async function openSavePresetModal(node, panel, isNew) {
        const cw          = node.widgets?.find(w => w.name === 'scene')
        const configLabel = cw?.value

        const bBlue = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                      'background:#1a3a5c;color:#9cd;border:1px solid #2a5080;cursor:pointer'
        const bGray = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                      'background:#444;color:#ccc;border:1px solid #666;cursor:pointer'

        if (isNew || !configLabel || configLabel === '(no configs)') {
          const mo = document.createElement('div')
          mo.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10001;' +
            'display:flex;align-items:center;justify-content:center'
          const mb = document.createElement('div')
          mb.style.cssText =
            'background:#2a2a2a;border:1px solid #555;border-radius:6px;' +
            'padding:20px 24px;width:440px;font-family:monospace'
          mo.appendChild(mb)
          document.body.appendChild(mo)
          mo.addEventListener('click', e => { if (e.target === mo) mo.remove() })
          mb.innerHTML = `
            <p style="font-size:13px;color:#ddd;margin:0 0 12px;font-weight:bold">Save / Update Preset</p>
            <p style="color:#888;font-size:12px;margin:0 0 20px">
              Save the config first before saving it as a preset.
            </p>
            <div style="display:flex;justify-content:flex-end">
              <button id="daz-sp-close" style="${bGray}">Close</button>
            </div>`
          mb.querySelector('#daz-sp-close').addEventListener('click', () => mo.remove())
          return
        }

        await openPresetModal({
          title: 'Save / Update Preset',
          subtitle: 'Find a preset to save or update, or click "Save as New Preset" for a new one.',
          renderActions({ mo, actionsEl, presets, noPresets, getSelected, errorEl, presetSel }) {
            actionsEl.innerHTML = `
              <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;gap:6px">
                  <button id="daz-sp-update" style="${bBlue};flex:1" ${noPresets ? 'disabled' : ''}>Update the Version</button>
                  <button id="daz-sp-newver" style="${bBlue};flex:1" ${noPresets ? 'disabled' : ''}>Save as new Version</button>
                  <button id="daz-sp-new"    style="${bBlue};flex:1">Save as New Preset</button>
                </div>
                <div style="display:flex;justify-content:flex-end">
                  <button id="daz-sp-cancel" style="${bGray}">Cancel</button>
                </div>
              </div>`

            const updateBtn = actionsEl.querySelector('#daz-sp-update')
            const newVerBtn = actionsEl.querySelector('#daz-sp-newver')
            const newBtn    = actionsEl.querySelector('#daz-sp-new')

            function syncBtns() {
              const has = !!getSelected()
              ;[updateBtn, newVerBtn].forEach(btn => {
                if (!btn) return
                btn.disabled      = !has
                btn.style.opacity = has ? '1' : '0.4'
                btn.style.cursor  = has ? 'pointer' : 'default'
              })
            }
            presetSel?.addEventListener('change', syncBtns)
            syncBtns()

            actionsEl.querySelector('#daz-sp-cancel').addEventListener('click', () => mo.remove())

            async function doSave(btn, presetName, presetVersion) {
              const orig = btn.textContent
              btn.textContent = 'Saving…'
              btn.disabled    = true
              if (errorEl) errorEl.textContent = ''
              try {
                const r = await fetch('/daz/preset-save', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    class:          CLASS,
                    preset_name:    presetName,
                    preset_version: presetVersion,
                    config_file:    currentFile(node),
                    config_label:   configLabel,
                    config_version: node._dazCurrentVersion || '1',
                  }),
                })
                const result = await r.json()
                if (!r.ok || result.error) throw new Error(result.error || r.statusText)
                mo.remove()
              } catch (e) {
                if (errorEl) errorEl.textContent = `Error: ${e.message}`
                btn.textContent = orig
                btn.disabled    = false
                syncBtns()
              }
            }

            updateBtn?.addEventListener('click', async () => {
              const p = getSelected()
              if (!p) return
              await doSave(updateBtn, p.name, String(p.version))
            })

            newVerBtn?.addEventListener('click', async () => {
              const p = getSelected()
              if (!p) return
              const maxVer = Math.max(0, ...presets
                .filter(q => q.name === p.name)
                .map(q => parseInt(q.version, 10) || 0))
              await doSave(newVerBtn, p.name, String(maxVer + 1))
            })

            newBtn?.addEventListener('click', async () => {
              const subMo = document.createElement('div')
              subMo.style.cssText =
                'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10002;' +
                'display:flex;align-items:center;justify-content:center'
              const subMb = document.createElement('div')
              subMb.style.cssText =
                'background:#2a2a2a;border:1px solid #555;border-radius:6px;' +
                'padding:20px 24px;width:400px;font-family:monospace'
              subMo.appendChild(subMb)
              document.body.appendChild(subMo)
              subMo.addEventListener('click', e => { if (e.target === subMo) subMo.remove() })

              subMb.innerHTML = `
                <p style="font-size:13px;color:#ddd;margin:0 0 16px;font-weight:bold">Save as New Preset</p>
                ${!hideType ? `
                <div style="margin-bottom:10px">
                  <label style="color:#888;font-size:10px;display:block;margin-bottom:3px">Type</label>
                  <select id="daz-spnew-type" style="${fs}">
                    <option value="">— no type —</option>
                    <option value="I2V">I2V</option>
                    <option value="T2V">T2V</option>
                    <option value="MULTI">MULTI</option>
                  </select>
                </div>` : ''}
                <div style="margin-bottom:10px">
                  <label style="color:#888;font-size:10px;display:block;margin-bottom:3px">Preset Name</label>
                  <input id="daz-spnew-name" type="text" placeholder="Preset name…"
                    style="${fs}" autocomplete="off">
                </div>
                <div style="margin-bottom:10px">
                  <label style="color:#888;font-size:10px;display:block;margin-bottom:3px">Version Label</label>
                  <input id="daz-spnew-label" type="text" placeholder="Optional label…"
                    style="${fs}" autocomplete="off">
                </div>
                <div style="margin-bottom:16px">
                  <label style="color:#888;font-size:10px;display:block;margin-bottom:3px">Note</label>
                  <textarea id="daz-spnew-note" placeholder="Optional note…"
                    style="${fs};resize:none;height:60px"></textarea>
                </div>
                <div id="daz-spnew-error"
                  style="color:#f88;font-size:11px;min-height:16px;margin-bottom:8px"></div>
                <div style="display:flex;justify-content:flex-end;gap:8px">
                  <button id="daz-spnew-cancel" style="${bGray}">Cancel</button>
                  <button id="daz-spnew-save"   style="${bBlue}">Save</button>
                </div>`

              subMb.querySelector('#daz-spnew-cancel').addEventListener('click', () => subMo.remove())

              const typeInput  = subMb.querySelector('#daz-spnew-type')
              if (typeInput) {
                const panelType = panel.querySelector('#daz-type')?.value || ''
                if (['I2V', 'T2V', 'MULTI'].includes(panelType)) typeInput.value = panelType
              }
              const nameInput  = subMb.querySelector('#daz-spnew-name')
              const labelInput = subMb.querySelector('#daz-spnew-label')
              const noteInput  = subMb.querySelector('#daz-spnew-note')
              const saveSubBtn = subMb.querySelector('#daz-spnew-save')
              const errSubEl   = subMb.querySelector('#daz-spnew-error')

              nameInput?.focus()

              saveSubBtn?.addEventListener('click', async () => {
                const name = (nameInput?.value ?? '').trim()
                if (!name) {
                  if (errSubEl) errSubEl.textContent = 'Preset name is required.'
                  nameInput?.focus()
                  return
                }
                const clash = presets.some(
                  p => p.class === CLASS && p.name === name && String(p.version) === '1'
                )
                if (clash) {
                  if (errSubEl) errSubEl.textContent = `A preset named "${name}" (version 1) already exists.`
                  nameInput?.focus()
                  return
                }
                const orig = saveSubBtn.textContent
                saveSubBtn.textContent = 'Saving…'
                saveSubBtn.disabled    = true
                if (errSubEl) errSubEl.textContent = ''
                try {
                  const body = {
                    class:                CLASS,
                    preset_name:          name,
                    preset_version:       '1',
                    preset_version_label: (labelInput?.value ?? '').trim(),
                    preset_note:          (noteInput?.value  ?? '').trim(),
                    config_file:          currentFile(node),
                    config_label:         configLabel,
                    config_version:       node._dazCurrentVersion || '1',
                  }
                  if (typeInput) body.preset_type = typeInput.value
                  const r = await fetch('/daz/preset-save', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  })
                  const result = await r.json()
                  if (!r.ok || result.error) throw new Error(result.error || r.statusText)
                  subMo.remove()
                  mo.remove()
                } catch (e) {
                  if (errSubEl) errSubEl.textContent = `Error: ${e.message}`
                  saveSubBtn.textContent = orig
                  saveSubBtn.disabled    = false
                }
              })
            })
          },
        })
      }

      // ── Manage Presets modal ──────────────────────────────────────────────────

      async function openManagePresetsModal(node, panel) {
        const bRed  = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                      'background:#5c1a1a;color:#f99;border:1px solid #8a2020;cursor:pointer'
        const bGray = 'font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;' +
                      'background:#444;color:#ccc;border:1px solid #666;cursor:pointer'

        await openPresetModal({
          title: 'Manage Presets',
          renderActions({ mo, actionsEl, noPresets, getSelected, errorEl, presetSel }) {
            actionsEl.innerHTML = `
              <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;gap:6px">
                  <button id="daz-mp-delpreset" style="${bRed};flex:1" ${noPresets ? 'disabled' : ''}>Delete Preset</button>
                  <button id="daz-mp-delver"    style="${bRed};flex:1" ${noPresets ? 'disabled' : ''}>Delete Version</button>
                </div>
                <div style="display:flex;justify-content:flex-end">
                  <button id="daz-mp-cancel" style="${bGray}">Cancel</button>
                </div>
              </div>`

            const delPresetBtn = actionsEl.querySelector('#daz-mp-delpreset')
            const delVerBtn    = actionsEl.querySelector('#daz-mp-delver')

            function syncBtns() {
              const has = !!getSelected()
              ;[delPresetBtn, delVerBtn].forEach(btn => {
                if (!btn) return
                btn.disabled      = !has
                btn.style.opacity = has ? '1' : '0.4'
                btn.style.cursor  = has ? 'pointer' : 'default'
              })
            }
            presetSel?.addEventListener('change', syncBtns)
            syncBtns()

            actionsEl.querySelector('#daz-mp-cancel').addEventListener('click', () => mo.remove())

            async function doDelete(btn, presetName, presetVersion) {
              const orig = btn.textContent
              btn.textContent = 'Deleting…'
              btn.disabled    = true
              if (errorEl) errorEl.textContent = ''
              try {
                const body = { class: CLASS, preset_name: presetName }
                if (presetVersion !== undefined) body.preset_version = presetVersion
                const r = await fetch('/daz/preset-delete', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                })
                const result = await r.json()
                if (!r.ok || result.error) throw new Error(result.error || r.statusText)
                mo.remove()
              } catch (e) {
                if (errorEl) errorEl.textContent = `Error: ${e.message}`
                btn.textContent = orig
                btn.disabled    = false
                syncBtns()
              }
            }

            delPresetBtn?.addEventListener('click', async () => {
              const p = getSelected()
              if (!p) return
              await doDelete(delPresetBtn, p.name)
            })

            delVerBtn?.addEventListener('click', async () => {
              const p = getSelected()
              if (!p) return
              await doDelete(delVerBtn, p.name, String(p.version))
            })
          },
        })
      }

      // ── Prompt editor integration ─────────────────────────────────────────

      function openPromptEditorFromUse(node) {
        if (!window.DazPromptEditor) return
        window.DazPromptEditor.open({
          detail: node[keys.detail] || {},
          defaultNegativePrompt: cfg.defaultNegativePrompt ?? '',
          defaultMasterPrompt:   cfg.defaultMasterPrompt ?? '',
          defaultTrailPrompt:    cfg.defaultTrailPrompt ?? '',
          workflowType:          node[keys.detail]?.type || '',
          onSave: async (updates) => {
            const cw    = node.widgets?.find(w => w.name === 'scene')
            const label = cw?.value
            if (!label || label === '(no configs)') return
            const detail = node[keys.detail] || {}
            try {
              const r = await fetch('/daz/workflow-config-save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  label, class: CLASS, file: currentFile(node), new_name: detail.name || '',
                  version: node._dazCurrentVersion || '1', save_mode: 'current',
                  master_prompt:   updates.master_prompt,
                  positive_prompt: updates.positive_prompt,
                  negative_prompt: updates.negative_prompt,
                  trail_prompt:    updates.trail_prompt,
                  total_frames:    updates.total_frames,
                  fps:             updates.fps,
                }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
              await reloadNodeConfigs(node)
              if (cw) cw.value = result.label
              syncWidget(node)
              const detailUrl = configsUrl(node,
                `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(node._dazCurrentVersion || '1')}`)
              const detailResp = await fetch(detailUrl)
              if (detailResp.ok) node[keys.detail] = await detailResp.json()
              renderUseMode(node, node[keys.detail])
            } catch (err) {
              console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: prompt editor save failed`, err)
            }
          },
        })
      }

      function openPromptEditorFromEdit(node, wrap, isNewConfig = false) {
        if (!window.DazPromptEditor) return
        const posType     = wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart'
        const masterPosEl = wrap.querySelector('#daz-master-position')
        const masterPos    = masterPosEl?.checked ? 'after' : 'before'
        window.DazPromptEditor.open({
          defaultNegativePrompt: cfg.defaultNegativePrompt ?? '',
          defaultMasterPrompt:   cfg.defaultMasterPrompt ?? '',
          defaultTrailPrompt:    cfg.defaultTrailPrompt ?? '',
          workflowType:          wrap.querySelector('#daz-type')?.value || '',
          detail: {
            master_prompt:   { text: wrap.querySelector('#daz-master-prompt')?.value   ?? '', position: masterPos },
            positive_prompt: { text: wrap.querySelector('#daz-positive-prompt')?.value ?? '', type: posType },
            negative_prompt: { text: wrap.querySelector('#daz-negative-prompt')?.value ?? '' },
            trail_prompt:    { text: wrap.querySelector('#daz-trail-prompt')?.value ?? '' },
            total_frames:    { value: parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) },
            fps:             { value: parseFloat(wrap.querySelector('#daz-fps')?.value ?? '0') },
          },
          onSave: (updates) => {
            const masterTA = wrap.querySelector('#daz-master-prompt')
            if (masterTA) masterTA.value = updates.master_prompt.text
            if (masterPosEl) masterPosEl.checked = updates.master_prompt.position === 'after'
            const posTA = wrap.querySelector('#daz-positive-prompt')
            if (posTA) posTA.value = updates.positive_prompt.text
            const newType = updates.positive_prompt.type
            const posTypeInput = wrap.querySelector('#daz-positive-prompt-type')
            if (posTypeInput) posTypeInput.value = newType
            wrap.querySelectorAll('input[name^="daz-pos-type-"]').forEach(r => { r.checked = r.value === newType })
            const showPos = newType !== 'smart'
            const posRow  = wrap.querySelector('#daz-master-ctrl-row')
            if (posRow) posRow.style.justifyContent = showPos ? 'space-between' : 'flex-end'
            const posWrap = wrap.querySelector('#daz-master-position-wrap')
            if (posWrap) posWrap.style.display = showPos ? 'flex' : 'none'
            const posHint = wrap.querySelector('#daz-pos-type-hint')
            if (posHint) posHint.textContent = newType === 'smart'
              ? 'Warning! Prompt Relays work better with CFG 1.0'
              : newType === 'beats' ? 'Beats will coerce frame count into full seconds'
              : newType === 'timecode' ? 'Timecode marks each segment\'s start time as [MM:SS]'
              : newType === 'h3' ? 'H3 marks each segment\'s start time as "At X.Ys," and merges the master prompt in' : 'Simple prompt will remove all segments'
            const negTA = wrap.querySelector('#daz-negative-prompt')
            if (negTA) negTA.value = updates.negative_prompt.text
            const trailInput = wrap.querySelector('#daz-trail-prompt')
            if (trailInput) trailInput.value = updates.trail_prompt.text
            const framesInput = wrap.querySelector('#daz-total-frames')
            if (framesInput) framesInput.value = updates.total_frames.value
            const fpsInput = wrap.querySelector('#daz-fps')
            if (fpsInput) fpsInput.value = updates.fps.value
            // Announce the new frame count so the Duration (s) field follows it
            framesInput?.dispatchEvent(new Event('input', { bubbles: true }))
            // Do not save immediately — let the user decide via Save / +Version
            node._dazEditPanelDirty = true
          },
        })
      }

      // ── Create new config ─────────────────────────────────────────────────

      async function createConfig(node, wrap) {
        const nameInput = wrap.querySelector('#daz-config-name')
        const name      = nameInput?.value.trim() ?? ''
        const errDiv    = wrap.querySelector('#daz-save-error')
        if (!name) {
          if (errDiv) errDiv.textContent = 'Config name is required.'
          nameInput?.focus()
          return
        }
        const createBtn = wrap.querySelector('#daz-create-btn')
        if (!createBtn || !errDiv) return
        createBtn.textContent = 'Creating…'
        createBtn.disabled    = true
        errDiv.textContent    = ''

        const payload = {
          name, class: CLASS, file: currentFile(node),
          version_label: wrap.querySelector('#daz-version-label')?.value ?? '',
          group: { name: wrap.querySelector('#daz-group')?.value ?? '' },
          type:  wrap.querySelector('#daz-type')?.value ?? '',
          ...buildPayload(wrap),
        }

        try {
          const r = await fetch('/daz/workflow-config-create', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (r.status === 409) {
            createBtn.textContent = 'Create'
            createBtn.disabled    = false
            showNameClashModal(wrap.querySelector('#daz-config-name'), () => createConfig(node, wrap))
            return
          }
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)

          const newType  = (!payload.type || payload.type === 'all') ? 'All' : payload.type
          const newGroup = payload.group?.name || 'All'

          if (node[keys.editOverlay]) { node[keys.editOverlay].remove(); node[keys.editOverlay] = null }
          node[keys.editMode] = false

          await reloadNodeConfigs(node)
          if (node._dazTypeFilter !== 'All') {
            if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = newType
            node._dazTypeFilter = newType
          }
          updateGroupFilterWidget(node)
          if (node._dazGroupFilter !== 'All') {
            if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = newGroup
            node._dazGroupFilter = newGroup
          }
          syncWidget(node)
          const configWidget = node.widgets?.find(w => w.name === 'scene')
          if (configWidget) configWidget.value = result.label

          await reloadVersionWidget(node, result.label, result.version || '1')

          const detailUrl = configsUrl(node,
            `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(result.version || '1')}`)
          const detailResp = await fetch(detailUrl)
          if (detailResp.ok) node[keys.detail] = await detailResp.json()

          renderUseMode(node, node[keys.detail] || {})
        } catch (e) {
          createBtn.textContent = 'Create'
          createBtn.disabled    = false
          errDiv.textContent    = `Error: ${e.message}`
        }
      }

      // ── Save existing config ──────────────────────────────────────────────

      async function saveConfig(node, wrap, saveMode = 'current', skipRescale = false, nameChangeConfirmed = false, keepPanelOpen = false, thenFn = null) {
        const cw    = node.widgets?.find(w => w.name === 'scene')
        const label = cw?.value
        if (!label || label === '(no configs)') return

        const saveBtn   = wrap.querySelector('#daz-save-btn')
        const nvBtn     = wrap.querySelector('#daz-new-version-btn')
        const errorDiv  = wrap.querySelector('#daz-save-error')
        const activeBtn = saveMode === 'new_version' ? nvBtn : saveBtn
        if (!activeBtn || !errorDiv) return

        const newName = wrap.querySelector('#daz-config-name')?.value.trim() ?? ''
        if (!newName) {
          errorDiv.textContent = 'Config name is required.'
          wrap.querySelector('#daz-config-name')?.focus()
          return
        }

        if (!nameChangeConfirmed && newName !== (node[keys.detail]?.name || '')) {
          showNameChangeConfirm(node, wrap, saveMode, skipRescale, keepPanelOpen, thenFn)
          return
        }

        activeBtn.textContent = saveMode === 'new_version' ? 'Adding…' : 'Saving…'
        activeBtn.disabled    = true
        errorDiv.textContent  = ''

        if (!skipRescale && window.DazPromptEditor?.rescalePrompt) {
          const oldTotal = fValue((node[keys.detail] || {}).total_frames)
          const newTotal = parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) || 0
          if (oldTotal > 0 && newTotal > 0 && oldTotal !== newTotal) {
            const posTA   = wrap.querySelector('#daz-positive-prompt')
            const posType = wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart'
            const oldFps  = fValue((node[keys.detail] || {}).fps)
            if (posTA) posTA.value = window.DazPromptEditor.rescalePrompt(posTA.value, posType, oldTotal, newTotal, oldFps)
          }
        }

        const versionLabelEl = wrap.querySelector('#daz-version-label')
        const versionLabel   = versionLabelEl?.value ?? ''
        const originalLabel  = versionLabelEl?.dataset.original ?? ''
        const payload = {
          label, class: CLASS, file: currentFile(node), new_name: newName,
          version: node._dazCurrentVersion || '1', save_mode: saveMode,
          version_label: saveMode === 'new_version'
            ? (versionLabel === originalLabel ? (versionLabel ? 'alt ' + versionLabel : '') : versionLabel)
            : versionLabel,
          group: { name: wrap.querySelector('#daz-group')?.value ?? '' },
          type:  wrap.querySelector('#daz-type')?.value ?? '',
          ...buildPayload(wrap),
        }

        try {
          const r = await fetch('/daz/workflow-config-save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (r.status === 409) {
            activeBtn.textContent = saveMode === 'new_version' ? '+ Take' : 'Save'
            activeBtn.disabled    = false
            showNameClashModal(wrap.querySelector('#daz-config-name'), () => saveConfig(node, wrap, saveMode, true, true, keepPanelOpen, thenFn))
            return
          }
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)

          if (!keepPanelOpen) {
            if (node[keys.editOverlay]) { node[keys.editOverlay].remove(); node[keys.editOverlay] = null }
            node[keys.editMode] = false
          } else {
            activeBtn.textContent = saveMode === 'new_version' ? '+ Take' : 'Save'
            activeBtn.disabled    = false
          }

          await reloadNodeConfigs(node)
          const saveType  = (!payload.type || payload.type === 'all') ? 'All' : payload.type
          const saveGroup = payload.group?.name || 'All'
          if (node._dazTypeFilter !== 'All') {
            if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = saveType
            node._dazTypeFilter = saveType
          }
          updateGroupFilterWidget(node)
          if (node._dazGroupFilter !== 'All') {
            if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = saveGroup
            node._dazGroupFilter = saveGroup
          }
          syncWidget(node)
          const configWidget = node.widgets?.find(w => w.name === 'scene')
          if (configWidget) configWidget.value = result.label

          await reloadVersionWidget(node, result.label, result.version)
          node._dazCurrentVersion = result.version

          const detailUrl = configsUrl(node,
            `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(result.version)}`)
          const detailResp = await fetch(detailUrl)
          if (detailResp.ok) node[keys.detail] = await detailResp.json()

          node._dazEditPanelDirty = false
          if (!keepPanelOpen) renderUseMode(node, node[keys.detail] || {})
          thenFn?.()
          return true
        } catch (e) {
          activeBtn.textContent = saveMode === 'new_version' ? '+ Take' : 'Save'
          activeBtn.disabled    = false
          errorDiv.textContent  = `Error: ${e.message}`
        }
      }

      // ── Pre-duplicate: handle unsaved changes ─────────────────────────────

      function showPreDuplicateModal(node, wrap, nextFn = () => showDuplicateModal(node, wrap)) {
        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:440px;font-family:monospace',
        ].join(';')
        const rowBtn = 'font-family:monospace;font-size:11px;padding:8px 12px;border-radius:3px;' +
          'cursor:pointer;border:1px solid #555;width:100%;text-align:left;margin-bottom:6px;' +
          'background:#1a1a1a;color:#ddd;display:block'
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 10px">Duplicate — unsaved changes</p>
          <p style="font-size:11px;color:#888;margin:0 0 14px">
            The edit panel may have unsaved changes. What would you like to do?
          </p>
          <button id="pdm-save-first" style="${rowBtn}">
            Save current version first<br>
            <span style="color:#666;font-size:10px">Saves edits, then shows duplicate options</span>
          </button>
          <button id="pdm-discard" style="${rowBtn}">
            Discard changes, then duplicate<br>
            <span style="color:#666;font-size:10px">Reverts unsaved prompt edits, then shows duplicate options</span>
          </button>
          <button id="pdm-save-only" style="${rowBtn}">
            Save and go ahead<br>
            <span style="color:#666;font-size:10px">Saves edits and returns to use mode (no duplicate)</span>
          </button>
          <div style="display:flex;justify-content:flex-end;margin-top:10px">
            <button id="pdm-cancel"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">
              Cancel
            </button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

        box.querySelector('#pdm-cancel')?.addEventListener('click', () => overlay.remove())

        // Save current version, then show duplicate options (panel stays open).
        // thenFn ensures nextFn fires even if a name-change or name-clash
        // sub-dialog intercepts the save flow.
        box.querySelector('#pdm-save-first')?.addEventListener('click', () => {
          overlay.remove()
          saveConfig(node, wrap, 'current', false, false, true, nextFn)
        })

        // Discard prompt-editor changes, then show duplicate options
        box.querySelector('#pdm-discard')?.addEventListener('click', () => {
          overlay.remove()
          const detail = node[keys.detail] || {}
          const posType = fType(detail.positive_prompt)
          const masterTA = wrap.querySelector('#daz-master-prompt')
          if (masterTA) masterTA.value = fText(detail.master_prompt)
          const masterPosEl = wrap.querySelector('#daz-master-position')
          if (masterPosEl) masterPosEl.checked = fPosition(detail.master_prompt) === 'after'
          const posTA = wrap.querySelector('#daz-positive-prompt')
          if (posTA) posTA.value = fText(detail.positive_prompt)
          const posTypeInput = wrap.querySelector('#daz-positive-prompt-type')
          if (posTypeInput) posTypeInput.value = posType
          wrap.querySelectorAll('input[name^="daz-pos-type-"]').forEach(r => { r.checked = r.value === posType })
          const showPos = posType !== 'smart'
          const posRow  = wrap.querySelector('#daz-master-ctrl-row')
          if (posRow) posRow.style.justifyContent = showPos ? 'space-between' : 'flex-end'
          const posWrap = wrap.querySelector('#daz-master-position-wrap')
          if (posWrap) posWrap.style.display = showPos ? 'flex' : 'none'
          const posHint = wrap.querySelector('#daz-pos-type-hint')
          if (posHint) posHint.textContent = posType === 'smart'
            ? 'Warning! Prompt Relays work better with CFG 1.0'
            : posType === 'beats' ? 'Beats will coerce frame count into full seconds'
            : posType === 'timecode' ? 'Timecode marks each segment\'s start time as [MM:SS]'
            : posType === 'h3' ? 'H3 marks each segment\'s start time as "At X.Ys," and merges the master prompt in' : 'Simple prompt will remove all segments'
          const negTA = wrap.querySelector('#daz-negative-prompt')
          if (negTA) negTA.value = fText(detail.negative_prompt)
          const trailTA = wrap.querySelector('#daz-trail-prompt')
          if (trailTA) trailTA.value = fText(detail.trail_prompt)
          const framesInput = wrap.querySelector('#daz-total-frames')
          if (framesInput) framesInput.value = fValue(detail.total_frames)
          const fpsInput = wrap.querySelector('#daz-fps')
          if (fpsInput) fpsInput.value = fValue(detail.fps)
          // Announce the new frame count so the Duration (s) field follows it
          framesInput?.dispatchEvent(new Event('input', { bubbles: true }))
          node._dazEditPanelDirty = false
          nextFn()
        })

        // Save normally and return to use mode (no duplicate)
        box.querySelector('#pdm-save-only')?.addEventListener('click', () => {
          overlay.remove()
          saveConfig(node, wrap, 'current')
        })
      }

      // ── Duplicate config ──────────────────────────────────────────────────

      function showDuplicateModal(node, wrap, targetFile = null) {
        const data         = node[keys.detail] || {}
        const originalName = data.name || ''
        if (!originalName) return

        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:400px;font-family:monospace',
        ].join(';')
        const fieldStyle = 'width:100%;background:#000;color:#ddd;border:1px solid #555;border-radius:4px;font-size:11px;font-family:monospace;padding:4px 8px;box-sizing:border-box'
        const btnStyle   = 'font-family:monospace;font-size:11px;padding:7px 12px;border-radius:3px;cursor:pointer;border:1px solid #555;width:100%;text-align:left;margin-bottom:6px;background:#1a1a1a;color:#ddd'
        const newVerBtnHtml = targetFile ? '' :
          `<button id="dup-new-ver"  style="${btnStyle};border-color:#2a5080;color:#9cd">Duplicate as a new take in this scene</button>`
        const nameHint = targetFile ? 'New scene name:' : 'New scene name (options 1 &amp; 2):'
        const destHtml = targetFile
          ? `<p style="font-size:11px;color:#888;margin:0 0 12px">Destination movie file: <span style="color:#9cd">${esc(targetFile.replace(/\.json$/, ''))}</span></p>`
          : ''
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 12px">Duplicate &ldquo;${esc(originalName)}&rdquo;</p>
          ${destHtml}
          <p style="font-size:11px;color:#888;margin:0 0 4px">${nameHint}</p>
          <input id="dup-name" type="text" value="${esc('Copy of ' + originalName)}"
            style="${fieldStyle};margin-bottom:14px">
          <button id="dup-all-sets" style="${btnStyle}">Duplicate as a new scene with all takes</button>
          <button id="dup-cur-set"  style="${btnStyle}">Duplicate as a new scene with the current take</button>
          ${newVerBtnHtml}
          <div style="display:flex;justify-content:flex-end;margin-top:10px">
            <button id="dup-cancel" style="font-family:monospace;font-size:11px;padding:4px 14px;background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
        box.querySelector('#dup-cancel')?.addEventListener('click', () => overlay.remove())
        box.querySelector('#dup-all-sets')?.addEventListener('click', () => {
          const n = box.querySelector('#dup-name')?.value.trim() || `Copy of ${originalName}`
          overlay.remove()
          duplicateConfigToNew(node, wrap, n, 'all_sets', targetFile)
        })
        box.querySelector('#dup-cur-set')?.addEventListener('click', () => {
          const n = box.querySelector('#dup-name')?.value.trim() || `Copy of ${originalName}`
          overlay.remove()
          duplicateConfigToNew(node, wrap, n, 'current_set', targetFile)
        })
        box.querySelector('#dup-new-ver')?.addEventListener('click', () => {
          overlay.remove()
          saveConfig(node, wrap, 'new_version')
        })
      }

      // ── Duplicate into another movie file ─────────────────────────────────

      async function showMovieFilePickerModal(node, wrap) {
        let files = []
        try {
          const r = await fetch('/daz/config-files')
          if (r.ok) files = await r.json()
        } catch (e) {
          console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not load movie files`, e)
        }
        const curFile = currentFile(node) || 'dx_workflow_configs.json'
        files = files.filter(f => f.file !== curFile)

        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:380px;font-family:monospace',
        ].join(';')
        const itemStyle = 'padding:6px 8px;border-radius:3px;cursor:pointer;color:#ddd;font-size:11px'
        const listHtml = files.length
          ? files.map((f, i) => `
              <div class="daz-mf-item" data-file="${esc(f.file)}"
                style="${itemStyle}${i === 0 ? ';background:#1a3a5c' : ''}">
                ${esc(fileLabel(f))}
              </div>`).join('')
          : `<div style="color:#888;font-size:11px;padding:6px 2px">No other movie files available.</div>`
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 12px">Available Movie Files</p>
          <div id="daz-mf-list" style="max-height:220px;overflow-y:auto;border:1px solid #444;border-radius:4px;margin-bottom:14px;background:#1a1a1a;padding:4px">
            ${listHtml}
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="daz-mf-cancel" style="font-family:monospace;font-size:11px;padding:4px 14px;background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
            <button id="daz-mf-duplicate" style="font-family:monospace;font-size:11px;padding:4px 14px;border-radius:3px;cursor:pointer;${
              files.length
                ? 'background:#1a5c35;color:#cde;border:1px solid #2a8050'
                : 'background:#333;color:#777;border:1px solid #555;cursor:default'
            }" ${files.length ? '' : 'disabled'}>Duplicate</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
        box.querySelector('#daz-mf-cancel')?.addEventListener('click', () => overlay.remove())

        let selectedFile = files[0]?.file ?? null
        box.querySelectorAll('.daz-mf-item').forEach(el => {
          el.addEventListener('click', () => {
            box.querySelectorAll('.daz-mf-item').forEach(o => { o.style.background = '' })
            el.style.background = '#1a3a5c'
            selectedFile = el.dataset.file
          })
        })

        box.querySelector('#daz-mf-duplicate')?.addEventListener('click', () => {
          if (!selectedFile) return
          overlay.remove()
          showDuplicateModal(node, wrap, selectedFile)
        })
      }

      async function duplicateConfigToNew(node, wrap, newName, duplicateMode, targetFile = null) {
        const cw    = node.widgets?.find(w => w.name === 'scene')
        const label = cw?.value
        if (!label || label === '(no configs)') return
        const errDiv = wrap.querySelector('#daz-save-error')
        const dupBtn = wrap.querySelector(targetFile ? '#daz-duplicate-other-btn' : '#daz-duplicate-btn')
        const dupBtnText = dupBtn?.textContent
        if (dupBtn) { dupBtn.textContent = 'Duplicating…'; dupBtn.disabled = true }
        if (errDiv) errDiv.textContent = ''

        const srcType  = (!node[keys.detail]?.type || node[keys.detail]?.type === 'all') ? 'All' : node[keys.detail].type
        const srcGroup = fName(node[keys.detail]?.group) || 'All'

        try {
          const r = await fetch('/daz/workflow-config-duplicate-config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label, class: CLASS, file: currentFile(node), new_name: newName,
              version: node._dazCurrentVersion || '1', duplicate_mode: duplicateMode,
              target_file: targetFile,
            }),
          })
          if (r.status === 409) {
            if (dupBtn) { dupBtn.textContent = dupBtnText; dupBtn.disabled = false }
            const fakeInput = { value: newName }
            showNameClashModal(fakeInput, () => duplicateConfigToNew(node, wrap, fakeInput.value, duplicateMode, targetFile))
            return
          }
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)

          if (node[keys.editOverlay]) { node[keys.editOverlay].remove(); node[keys.editOverlay] = null }
          node[keys.editMode] = false

          if (targetFile) {
            node._dazConfigFile = targetFile
            try {
              const fr = await fetch(`/daz/config-files?class=${encodeURIComponent(CLASS)}`)
              if (fr.ok) {
                _configFiles = await fr.json()
                if (node._dazConfigFileWidget) {
                  node._dazConfigFileWidget.options.values = _configFiles.length > 0
                    ? _configFiles.map(f => fileLabel(f))
                    : ['(default)']
                  node._dazConfigFileWidget.hidden = _configFiles.length <= 1
                  const match = _configFiles.find(f => f.file === targetFile)
                  if (match) node._dazConfigFileWidget.value = fileLabel(match)
                }
              }
            } catch (e) {
              console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not refresh movie files after duplicate`, e)
            }
          }

          await reloadNodeConfigs(node)
          if (node._dazTypeFilter !== 'All') {
            if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = srcType
            node._dazTypeFilter = srcType
          }
          updateGroupFilterWidget(node)
          if (node._dazGroupFilter !== 'All') {
            if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = srcGroup
            node._dazGroupFilter = srcGroup
          }
          syncWidget(node)
          if (cw) cw.value = result.label

          await reloadVersionWidget(node, result.label, result.version || '1')
          node._dazCurrentVersion = result.version || '1'

          const detailUrl = configsUrl(node,
            `/daz/workflow-config-detail?class=${encodeURIComponent(CLASS)}&label=${encodeURIComponent(result.label)}&version=${encodeURIComponent(result.version || '1')}`)
          const detailResp = await fetch(detailUrl)
          if (detailResp.ok) node[keys.detail] = await detailResp.json()

          renderUseMode(node, node[keys.detail] || {})
        } catch (e) {
          if (dupBtn) { dupBtn.textContent = dupBtnText; dupBtn.disabled = false }
          if (errDiv) errDiv.textContent = `Duplicate failed: ${e.message}`
        }
      }

      // ── Movie Manager ──────────────────────────────────────────────────────

      async function applyManagerSelectionToNode(node, file, sceneLabel, version, { classMismatch = false, fileName = '' } = {}) {
        node._dazConfigFile = file
        try {
          const fr = await fetch(`/daz/config-files?class=${encodeURIComponent(CLASS)}`)
          if (fr.ok) {
            _configFiles = await fr.json()
            if (!_configFiles.find(f => f.file === file)) {
              _configFiles = [{ file, name: fileName || file }, ..._configFiles]
            }
            if (node._dazConfigFileWidget) {
              node._dazConfigFileWidget.options.values = _configFiles.length > 0
                ? _configFiles.map(f => fileLabel(f))
                : ['(default)']
              node._dazConfigFileWidget.hidden = _configFiles.length <= 1
              const match = _configFiles.find(f => f.file === file)
              if (match) node._dazConfigFileWidget.value = fileLabel(match)
            }
          }
        } catch (e) {
          console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: could not refresh movie files`, e)
        }

        await reloadNodeConfigs(node)
        node._dazTypeFilter  = 'All'
        node._dazGroupFilter = 'All'
        if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
        updateGroupFilterWidget(node)
        if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
        syncWidget(node)

        const cw = node.widgets?.find(w => w.name === 'scene')

        if (classMismatch) {
          await reloadVersionWidget(node, cw?.value ?? null)
          renderUseMode(node, {})
          return
        }

        if (cw) cw.value = sceneLabel

        await reloadVersionWidget(node, sceneLabel, version)
        node._dazCurrentVersion = rawVersion(version)

        await loadDetail(node, sceneLabel, version)
        await enterEditForm(node, false)
      }

      async function reloadClassFilteredState(node) {
        try {
          const fr = await fetch(`/daz/config-files?class=${encodeURIComponent(CLASS)}`)
          if (fr.ok) {
            _configFiles = await fr.json()
            const cfWidget = node._dazConfigFileWidget
            if (cfWidget) {
              cfWidget.options.values = _configFiles.length > 0
                ? _configFiles.map(f => fileLabel(f))
                : ['(default)']
              cfWidget.hidden = _configFiles.length <= 1
              if (_configFiles.length > 0 && !_configFiles.find(f => fileLabel(f) === cfWidget.value)) {
                cfWidget.value      = fileLabel(_configFiles[0])
                node._dazConfigFile = _configFiles[0].file
              }
            }
          }
          await reloadNodeConfigs(node)
          updateGroupFilterWidget(node)
          syncWidget(node)
          if (node[keys.editMode]) return
          const labels = filteredLabels(node._dazAllConfigs || [], node._dazTypeFilter || 'All', node._dazGroupFilter || 'All')
          if (!labels.length) { renderUseMode(node, {}); return }
          const cw = node.widgets?.find(w => w.name === 'scene')
          if (cw) {
            await reloadVersionWidget(node, cw.value)
            loadDetail(node, cw.value, node._dazVersionWidget?.value)
          }
        } catch (e) {
          console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: reload failed`, e)
        }
      }

      async function reconcileNodeState(node) {
        await reloadClassFilteredState(node)
        if ((node._dazAllConfigs || []).length > 0) return

        try {
          const fr       = await fetch('/daz/config-files')
          const allFiles = fr.ok ? await fr.json() : []
          if (!allFiles.length) return // nothing anywhere — keep existing (default) virtual-file behavior

          const match = allFiles.find(f => f.file === node._dazConfigFile) || allFiles[0]
          node._dazConfigFile = match.file
          if (node._dazConfigFileWidget) {
            node._dazConfigFileWidget.options.values = allFiles.map(f => fileLabel(f))
            node._dazConfigFileWidget.hidden          = allFiles.length <= 1
            node._dazConfigFileWidget.value           = fileLabel(match)
          }
          await reloadNodeConfigs(node)
          updateGroupFilterWidget(node)
          syncWidget(node)
          renderUseMode(node, {})
        } catch (e) {
          console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: reconcile fallback failed`, e)
        }
      }

      function fmtManagerDate(iso) {
        if (!iso) return '—'
        const d = new Date(iso)
        if (isNaN(d.getTime())) return '—'
        const pad = n => String(n).padStart(2, '0')
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      }

      const MGR_CLASS_DISPLAY_NAMES = { 'Wan2.2': 'WAN2.2', 'ltx2.3': 'LTX2.3', 'ltx2.5': 'LTX2.5', 'ImageInference': 'Image', 'm_h3': 'MiniMax H3' }
      const MGR_CLASS_ORDER = ['Wan2.2', 'ltx2.3', 'ltx2.5', 'ImageInference', 'm_h3']

      function mgrClassDisplayName(cls) {
        return MGR_CLASS_DISPLAY_NAMES[cls] || cls
      }

      function mgrFormatSceneCounts(f) {
        const counts  = f.scene_counts || {}
        const classes = Object.keys(counts)
        if (!classes.length) return `Scenes: ${f.total_scenes}`
        const ordered = classes.sort((a, b) => {
          const ia = MGR_CLASS_ORDER.indexOf(a), ib = MGR_CLASS_ORDER.indexOf(b)
          if (ia === -1 && ib === -1) return a.localeCompare(b)
          if (ia === -1) return 1
          if (ib === -1) return -1
          return ia - ib
        })
        if (ordered.length === 1) return `Scenes: ${f.total_scenes} (${mgrClassDisplayName(ordered[0])})`
        return `Scenes: ${f.total_scenes} (${ordered.map(c => `${counts[c]} ${mgrClassDisplayName(c)}`).join(', ')})`
      }

      function showManagerConfirm(message, confirmLabel, onConfirm) {
        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10001',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:360px;font-family:monospace',
        ].join(';')
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 18px">${esc(message)}</p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="daz-mgr-confirm-cancel"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
            <button id="daz-mgr-confirm-ok"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#5c1a1a;color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer">${esc(confirmLabel)}</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
        box.querySelector('#daz-mgr-confirm-cancel')?.addEventListener('click', () => overlay.remove())
        box.querySelector('#daz-mgr-confirm-ok')?.addEventListener('click', () => { overlay.remove(); onConfirm() })
      }

      function showMovieFormModal({ title, defaultName, submitLabel, onSubmit }) {
        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10001',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:380px;font-family:monospace',
        ].join(';')
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 12px">${esc(title)}</p>
          <label style="font-size:11px;color:#999;display:block;margin-bottom:3px">Filename</label>
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
            <span style="color:#888;font-size:12px">dx_</span>
            <input id="daz-mgr-filename" type="text" style="flex:1;min-width:0;box-sizing:border-box;
              font-family:monospace;font-size:12px;padding:3px 6px;background:#1a1a1a;color:#ddd;
              border:1px solid #555;border-radius:3px">
            <span style="color:#888;font-size:12px">.json</span>
          </div>
          <p style="font-size:10px;color:#777;margin:0 0 12px">Letters, numbers, _ and - only.</p>
          <label style="font-size:11px;color:#999;display:block;margin-bottom:3px">Movie name</label>
          <input id="daz-mgr-moviename" type="text" value="${esc(defaultName)}" style="width:100%;box-sizing:border-box;
            font-family:monospace;font-size:12px;padding:3px 6px;background:#1a1a1a;color:#ddd;
            border:1px solid #555;border-radius:3px;margin-bottom:8px">
          <p id="daz-mgr-form-error" style="font-size:11px;color:#f88;margin:0 0 8px;min-height:14px"></p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="daz-mgr-form-cancel"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
            <button id="daz-mgr-form-ok"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#1a5c35;color:#cfe;border:1px solid #2a8050;border-radius:3px;cursor:pointer">${esc(submitLabel)}</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
        box.querySelector('#daz-mgr-form-cancel')?.addEventListener('click', () => overlay.remove())
        box.querySelector('#daz-mgr-form-ok')?.addEventListener('click', async () => {
          const filename = box.querySelector('#daz-mgr-filename')?.value.trim() || ''
          const name     = box.querySelector('#daz-mgr-moviename')?.value.trim() || ''
          const errDiv   = box.querySelector('#daz-mgr-form-error')
          const okBtn    = box.querySelector('#daz-mgr-form-ok')
          if (!filename) { if (errDiv) errDiv.textContent = 'Filename is required.'; return }
          okBtn.disabled = true
          const err = await onSubmit(filename, name)
          if (err) {
            okBtn.disabled = false
            if (errDiv) errDiv.textContent = err
            return
          }
          overlay.remove()
        })
      }

      async function openMovieManager(node) {
        if (node._dazMovieManagerOverlay) return

        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'width:780px;max-width:95vw;height:640px;max-height:88vh;overflow:hidden',
          'display:flex;flex-direction:column;font-family:monospace',
        ].join(';')
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        node._dazMovieManagerOverlay = overlay

        const smallBtn = 'flex:1;font-family:monospace;font-size:11px;padding:4px 6px;background:#333;' +
          'color:#ddd;border:1px solid #555;border-radius:3px;cursor:pointer'
        const smallBtnRed = 'flex:1;font-family:monospace;font-size:11px;padding:4px 6px;background:#5c1a1a;' +
          'color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer'
        const smallBtnBlue = 'flex:1;font-family:monospace;font-size:11px;padding:4px 6px;background:#1a3a5c;' +
          'color:#9cd;border:1px solid #2a5080;border-radius:3px;cursor:pointer'
        const smallBtnDisabled = 'flex:1;font-family:monospace;font-size:11px;padding:4px 6px;background:#2a2a2a;' +
          'color:#666;border:1px solid #444;border-radius:3px;cursor:not-allowed'
        const cancelBtn = 'font-family:monospace;font-size:12px;padding:5px 16px;background:#444;' +
          'color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer'
        const loadBtnActive = 'font-family:monospace;font-size:12px;padding:5px 16px;background:#1a5c35;' +
          'color:#cfe;border:1px solid #2a8050;border-radius:3px;cursor:pointer'
        const loadBtnDisabled = 'font-family:monospace;font-size:12px;padding:5px 16px;background:#333;' +
          'color:#777;border:1px solid #555;border-radius:3px;cursor:not-allowed'
        const mgrFieldset = 'border:1px solid #444;border-radius:4px;padding:7px 8px;margin:0;' +
          'min-width:0;box-sizing:border-box;overflow:hidden'
        const mgrLegend = 'color:#888;font-size:11px;padding:0 5px;font-family:monospace'

        let folderName        = ''
        let filesData         = []
        let scenesData        = []
        let selectedFile       = null
        let selectedSceneName  = null
        let selectedVersion    = null
        let lastError          = ''

        function close() {
          overlay.remove()
          node._dazMovieManagerOverlay = null
        }
        overlay.addEventListener('click', e => {
          if (e.target !== overlay) return
          close()
          reconcileNodeState(node)
        })

        function currentScene() {
          return scenesData.find(s => s.name === selectedSceneName) || null
        }

        async function fetchFiles() {
          try {
            const r    = await fetch('/daz/movie-manager/files')
            const data = r.ok ? await r.json() : { folder: '', files: [] }
            folderName = data.folder || ''
            filesData  = data.files || []
          } catch (e) {
            console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: movie manager could not load files`, e)
            filesData = []
          }
        }

        async function fetchScenes(file) {
          if (!file) { scenesData = []; return }
          try {
            const r   = await fetch(`/daz/movie-manager/scenes?file=${encodeURIComponent(file)}`)
            scenesData = r.ok ? await r.json() : []
          } catch (e) {
            console.warn(`[DAZ TOOLS] ${cfg.nodeDataName}: movie manager could not load scenes`, e)
            scenesData = []
          }
        }

        async function selectFile(file) {
          selectedFile = file
          await fetchScenes(file)
          selectedSceneName = scenesData[0]?.name ?? null
          const takes = selectedSceneName ? (currentScene()?.takes || []) : []
          selectedVersion = takes[0]?.version ?? null
          render()
        }

        function selectScene(name) {
          selectedSceneName = name
          const takes = currentScene()?.takes || []
          selectedVersion = takes[0]?.version ?? null
          render()
        }

        function selectTake(version) {
          selectedVersion = version
          render()
        }

        async function reloadFilesAndSelectFile(fileToSelect) {
          await fetchFiles()
          const match = filesData.find(f => f.file === fileToSelect)
          await selectFile(match ? match.file : (filesData[0]?.file ?? null))
        }

        async function reloadScenesAndSelectFirst(preferredScene = null) {
          await fetchFiles()
          await fetchScenes(selectedFile)
          const match = preferredScene && scenesData.find(s => s.name === preferredScene)
          selectedSceneName = match ? match.name : (scenesData[0]?.name ?? null)
          const takes = selectedSceneName ? (currentScene()?.takes || []) : []
          selectedVersion = takes[0]?.version ?? null
          render()
        }

        async function reloadTakesKeepScene(preferredVersion = null) {
          await fetchFiles()
          await fetchScenes(selectedFile)
          const stillExists = scenesData.find(s => s.name === selectedSceneName)
          if (stillExists) {
            const takes = stillExists.takes || []
            const match = preferredVersion && takes.find(t => t.version === preferredVersion)
            selectedVersion = match ? match.version : (takes[0]?.version ?? null)
          } else {
            selectedSceneName = scenesData[0]?.name ?? null
            const takes = selectedSceneName ? (currentScene()?.takes || []) : []
            selectedVersion = takes[0]?.version ?? null
          }
          render()
        }

        function doDeleteFile(file) {
          showManagerConfirm(`Delete movie file "${file}"? This cannot be undone.`, 'Delete', async () => {
            lastError = ''
            try {
              const r      = await fetch('/daz/movie-manager/file-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            } catch (e) {
              lastError = `Delete failed: ${e.message}`
            }
            await reloadFilesAndSelectFile(file)
          })
        }

        function doDuplicateFile(file, currentName) {
          showMovieFormModal({
            title:       'Duplicate Movie',
            defaultName: `Copy of ${currentName}`,
            submitLabel: 'Duplicate',
            onSubmit: async (filename, name) => {
              try {
                const r      = await fetch('/daz/movie-manager/file-duplicate', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ source_file: file, filename, name }),
                })
                const result = await r.json()
                if (!r.ok || result.error) return result.error || r.statusText
                lastError = ''
                await reloadFilesAndSelectFile(result.file)
                return null
              } catch (e) {
                return e.message
              }
            },
          })
        }

        function doNewMovie() {
          showMovieFormModal({
            title:       'New Movie',
            defaultName: 'New Movie',
            submitLabel: 'Create',
            onSubmit: async (filename, name) => {
              try {
                const r      = await fetch('/daz/movie-manager/file-create', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filename, name }),
                })
                const result = await r.json()
                if (!r.ok || result.error) return result.error || r.statusText
                lastError = ''
                await reloadFilesAndSelectFile(result.file)
                return null
              } catch (e) {
                return e.message
              }
            },
          })
        }

        function doDeleteAllScenes() {
          if (!selectedFile) return
          showManagerConfirm('Delete ALL scenes in this movie? The file itself will remain, empty.', 'Delete All', async () => {
            lastError = ''
            try {
              const r      = await fetch('/daz/movie-manager/scenes-delete-all', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: selectedFile }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            } catch (e) {
              lastError = `Delete failed: ${e.message}`
            }
            await reloadFilesAndSelectFile(selectedFile)
          })
        }

        function doDeleteScene() {
          if (!selectedFile || !selectedSceneName) return
          showManagerConfirm(`Delete scene "${selectedSceneName}" and all its takes?`, 'Delete Scene', async () => {
            const sceneName = selectedSceneName
            lastError = ''
            try {
              const r      = await fetch('/daz/movie-manager/scene-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: selectedFile, scene_name: sceneName }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            } catch (e) {
              lastError = `Delete failed: ${e.message}`
            }
            await reloadScenesAndSelectFirst(sceneName)
          })
        }

        function doDeleteAllTakes() {
          if (!selectedFile || !selectedSceneName) return
          showManagerConfirm(`Delete ALL takes of scene "${selectedSceneName}"? The scene itself will also be removed.`, 'Delete All', async () => {
            const sceneName = selectedSceneName
            lastError = ''
            try {
              const r      = await fetch('/daz/movie-manager/scene-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: selectedFile, scene_name: sceneName }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
            } catch (e) {
              lastError = `Delete failed: ${e.message}`
            }
            await reloadScenesAndSelectFirst(sceneName)
          })
        }

        function doDeleteTake() {
          if (!selectedFile || !selectedSceneName || !selectedVersion) return
          showManagerConfirm(`Delete take "${selectedVersion}"?`, 'Delete Take', async () => {
            const version = selectedVersion
            lastError  = ''
            let cascaded = false
            try {
              const r      = await fetch('/daz/movie-manager/take-delete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: selectedFile, scene_name: selectedSceneName, version }),
              })
              const result = await r.json()
              if (!r.ok || result.error) throw new Error(result.error || r.statusText)
              cascaded = !!result.scene_deleted
            } catch (e) {
              lastError = `Delete failed: ${e.message}`
            }
            if (cascaded) await reloadScenesAndSelectFirst()
            else await reloadTakesKeepScene(version)
          })
        }

        function render() {
          const prevScroll = {
            files:  box.querySelector('#daz-mgr-files')?.scrollTop  ?? 0,
            scenes: box.querySelector('#daz-mgr-scenes')?.scrollTop ?? 0,
            takes:  box.querySelector('#daz-mgr-takes')?.scrollTop  ?? 0,
          }

          const selectedFileObj = filesData.find(f => f.file === selectedFile) || null
          const scene           = currentScene()
          const takes            = scene?.takes || []
          const canLoad          = !!(selectedVersion && scene)
          const classMismatch    = canLoad && scene.class !== CLASS

          const clamp2 = 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden'

          const filesListHtml = filesData.length
            ? filesData.map(f => `
                <div class="daz-mgr-file-item" data-file="${esc(f.file)}"
                  style="padding:8px;border-radius:3px;cursor:pointer;margin-bottom:4px;
                         background:${f.file === selectedFile ? '#1a3a5c' : '#1a1a1a'};border:1px solid #444">
                  <div style="color:#ddd;font-size:12px;word-break:break-word;${clamp2}">${esc(f.name)}</div>
                  <div style="color:#888;font-size:10px">${esc(f.file)}</div>
                  <div style="color:#888;font-size:10px">Added: ${esc(fmtManagerDate(f.created_at))}</div>
                  <div style="color:#888;font-size:10px">${esc(mgrFormatSceneCounts(f))}</div>
                </div>`).join('')
            : `<div style="color:#777;font-size:11px;padding:8px">No movie files.</div>`

          const scenesListHtml = scenesData.length
            ? scenesData.map(s => `
                <div class="daz-mgr-scene-item" data-scene="${esc(s.name)}"
                  style="padding:6px 8px;border-radius:3px;cursor:pointer;margin-bottom:4px;
                         background:${s.name === selectedSceneName ? '#1a3a5c' : '#1a1a1a'};border:1px solid #444">
                  <div style="color:#ddd;font-size:12px;word-break:break-word;${clamp2}">${esc(s.name)} (${s.take_count} take${s.take_count === 1 ? '' : 's'})</div>
                  <div style="color:#888;font-size:10px">${esc(s.class || '—')}</div>
                </div>`).join('')
            : `<div style="color:#777;font-size:11px;padding:6px">No scenes.</div>`

          const takesListHtml = takes.length
            ? takes.map(t => `
                <div class="daz-mgr-take-item" data-version="${esc(t.version)}"
                  style="padding:5px 8px;border-radius:3px;cursor:pointer;margin-bottom:3px;
                         background:${t.version === selectedVersion ? '#1a3a5c' : '#1a1a1a'};border:1px solid #444;
                         color:#ddd;font-size:12px">
                  <div style="word-break:break-word;${clamp2}">${esc(t.label ? `${t.version} - ${t.label}` : String(t.version))}</div>
                  ${(t.type || t.group) ? `<div style="font-weight:normal;font-size:10px;color:#ddd;margin-top:2px;word-break:break-word;${clamp2}">${esc([t.type, t.group].filter(Boolean).join(' - '))}</div>` : ''}
                  ${t.note ? `<div style="font-style:italic;font-size:10px;color:#999;margin-top:2px;word-break:break-word;${clamp2}">${esc(t.note)}</div>` : ''}
                </div>`).join('')
            : `<div style="color:#777;font-size:11px;padding:6px">No takes.</div>`

          const listBoxStyle = 'border:1px solid #444;border-radius:3px;padding:4px;box-sizing:border-box;background:#1f1f1f'

          box.innerHTML = `
            <div style="padding:10px 16px;border-bottom:1px solid #444;font-size:13px;color:#ddd">
              Manage Movies — Current folder: <span style="color:#9cd">${esc(folderName)}</span>
            </div>
            <div style="flex:1;display:flex;overflow:hidden;min-height:0;padding:10px;gap:10px">
              <fieldset style="${mgrFieldset};flex:0 0 290px;display:flex;flex-direction:column;min-height:0">
                <legend style="${mgrLegend}">Current Movie</legend>
                <div id="daz-mgr-files" style="${listBoxStyle};flex:1;min-height:0;overflow-y:auto;margin-bottom:8px">${filesListHtml}</div>
                <div style="display:flex;gap:6px">
                  <button id="daz-mgr-file-delete" style="${selectedFile ? smallBtnRed : smallBtnDisabled}" ${selectedFile ? '' : 'disabled'}>Delete</button>
                  <button id="daz-mgr-file-duplicate" style="${selectedFile ? smallBtn : smallBtnDisabled}" ${selectedFile ? '' : 'disabled'}>Duplicate</button>
                  <button id="daz-mgr-file-new" style="${smallBtnBlue}">New Movie</button>
                </div>
              </fieldset>
              <fieldset style="${mgrFieldset};flex:1;display:flex;flex-direction:column;min-height:0">
                <legend style="${mgrLegend}">Selected Movie</legend>
                ${selectedFileObj ? `
                  <div style="font-size:11px;color:#ddd;margin-bottom:8px">
                    <div>Name: ${esc(selectedFileObj.name)}</div>
                    <div style="color:#888">Added: ${esc(fmtManagerDate(selectedFileObj.created_at))}</div>
                    <div style="color:#888">Edited: ${esc(fmtManagerDate(selectedFileObj.updated_at))}</div>
                  </div>` : `<div style="font-size:11px;color:#777;margin-bottom:8px">No movie selected.</div>`}
                <fieldset style="${mgrFieldset};margin-bottom:8px">
                  <legend style="${mgrLegend}">Scenes</legend>
                  <div id="daz-mgr-scenes" style="${listBoxStyle};height:130px;overflow-y:auto;margin-bottom:6px">${scenesListHtml}</div>
                  <div style="display:flex;gap:6px">
                    <button id="daz-mgr-scenes-delete-all" style="${selectedFile ? smallBtnRed : smallBtnDisabled}" ${selectedFile ? '' : 'disabled'}>Delete All</button>
                    <button id="daz-mgr-scene-delete" style="${selectedSceneName ? smallBtnRed : smallBtnDisabled}" ${selectedSceneName ? '' : 'disabled'}>Delete Scene</button>
                  </div>
                </fieldset>
                <fieldset style="${mgrFieldset};flex:1;display:flex;flex-direction:column;min-height:0">
                  <legend style="${mgrLegend}">Takes</legend>
                  <div id="daz-mgr-takes" style="${listBoxStyle};flex:1;min-height:0;overflow-y:auto;margin-bottom:6px">${takesListHtml}</div>
                  <div style="display:flex;gap:6px">
                    <button id="daz-mgr-takes-delete-all" style="${selectedSceneName ? smallBtnRed : smallBtnDisabled}" ${selectedSceneName ? '' : 'disabled'}>Delete All</button>
                    <button id="daz-mgr-take-delete" style="${selectedVersion ? smallBtnRed : smallBtnDisabled}" ${selectedVersion ? '' : 'disabled'}>Delete Take</button>
                  </div>
                </fieldset>
              </fieldset>
            </div>
            ${lastError ? `<div style="color:#f88;font-size:11px;padding:0 16px 8px">${esc(lastError)}</div>` : ''}
            <div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid #444">
              <button id="daz-mgr-load" style="${canLoad ? loadBtnActive : loadBtnDisabled}" ${canLoad ? '' : 'disabled'}>Load and open in Editor</button>
              <button id="daz-mgr-back" style="${cancelBtn}">Back</button>
            </div>
          `

          const filesEl  = box.querySelector('#daz-mgr-files')
          const scenesEl = box.querySelector('#daz-mgr-scenes')
          const takesEl  = box.querySelector('#daz-mgr-takes')
          if (filesEl)  filesEl.scrollTop  = prevScroll.files
          if (scenesEl) scenesEl.scrollTop = prevScroll.scenes
          if (takesEl)  takesEl.scrollTop  = prevScroll.takes

          box.querySelectorAll('.daz-mgr-file-item').forEach(el => {
            el.addEventListener('click', () => selectFile(el.dataset.file))
          })
          box.querySelectorAll('.daz-mgr-scene-item').forEach(el => {
            el.addEventListener('click', () => selectScene(el.dataset.scene))
          })
          box.querySelectorAll('.daz-mgr-take-item').forEach(el => {
            el.addEventListener('click', () => selectTake(el.dataset.version))
          })
          box.querySelector('#daz-mgr-file-delete')?.addEventListener('click', () => selectedFile && doDeleteFile(selectedFile))
          box.querySelector('#daz-mgr-file-duplicate')?.addEventListener('click', () => {
            if (selectedFileObj) doDuplicateFile(selectedFile, selectedFileObj.name)
          })
          box.querySelector('#daz-mgr-file-new')?.addEventListener('click', () => doNewMovie())
          box.querySelector('#daz-mgr-scenes-delete-all')?.addEventListener('click', () => doDeleteAllScenes())
          box.querySelector('#daz-mgr-scene-delete')?.addEventListener('click', () => doDeleteScene())
          box.querySelector('#daz-mgr-takes-delete-all')?.addEventListener('click', () => doDeleteAllTakes())
          box.querySelector('#daz-mgr-take-delete')?.addEventListener('click', () => doDeleteTake())
          box.querySelector('#daz-mgr-load')?.addEventListener('click', () => {
            if (!canLoad) return
            const file = selectedFile, sceneLabel = scene.label, version = selectedVersion
            const doLoad = () => {
              close()
              applyManagerSelectionToNode(node, file, sceneLabel, version, {
                classMismatch,
                fileName: selectedFileObj?.name,
              })
            }
            if (classMismatch) {
              showManagerConfirm(
                `This take belongs to a "${scene.class}" scene, not "${CLASS}". ` +
                `The node will not be able to load it entirely. Continue anyway?`,
                'Continue',
                doLoad,
              )
            } else {
              doLoad()
            }
          })
          box.querySelector('#daz-mgr-back')?.addEventListener('click', () => {
            close()
            reconcileNodeState(node)
          })
        }

        await fetchFiles()
        await selectFile(filesData[0]?.file ?? null)
      }

      // ── Name change confirm ───────────────────────────────────────────────

      function showNameChangeConfirm(node, wrap, saveMode, skipRescale, keepPanelOpen = false, thenFn = null) {
        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:380px;font-family:monospace',
        ].join(';')
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 8px">Rename all versions?</p>
          <p style="font-size:11px;color:#888;margin:0 0 20px">
            Changing the name will affect all versions of this config, not just the one being saved.
          </p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="ncc-cancel"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
            <button id="ncc-continue"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#1a5c35;color:#cde;border:1px solid #2a8050;border-radius:3px;cursor:pointer">Continue</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        box.querySelector('#ncc-cancel')?.addEventListener('click', () => overlay.remove())
        box.querySelector('#ncc-continue')?.addEventListener('click', () => {
          overlay.remove()
          saveConfig(node, wrap, saveMode, skipRescale, true, keepPanelOpen, thenFn)
        })
      }

      // ── Name clash modal ──────────────────────────────────────────────────

      function showNameClashModal(nameInput, onRetry) {
        const name = nameInput?.value.trim() ?? ''
        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:360px;font-family:monospace',
        ].join(';')
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 6px">
            A config named &ldquo;${esc(name)}&rdquo; already exists.
          </p>
          <p style="font-size:11px;color:#888;margin:0 0 18px">Cancel to go back, or auto-generate a unique name.</p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="nc-cancel"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Cancel</button>
            <button id="nc-autoname"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#1a5c35;color:#cde;border:1px solid #2a8050;border-radius:3px;cursor:pointer">Auto name</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        box.querySelector('#nc-cancel')?.addEventListener('click', () => overlay.remove())
        box.querySelector('#nc-autoname')?.addEventListener('click', () => {
          overlay.remove()
          const suffix = '_alt' + (Math.floor(Math.random() * 9000) + 1000)
          if (nameInput) nameInput.value = name + suffix
          onRetry()
        })
      }

      // ── Delete version confirm ────────────────────────────────────────────

      function showDeleteVersionConfirm(node, wrap) {
        const name    = node[keys.detail]?.name || '?'
        const version = node._dazCurrentVersion || '1'
        const cw      = node.widgets?.find(w => w.name === 'scene')
        const label   = cw?.value || ''

        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:360px;font-family:monospace',
        ].join(';')
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 6px">
            Delete take <strong>${esc(version)}</strong> of &ldquo;${esc(name)}&rdquo;?
          </p>
          <p style="font-size:11px;color:#888;margin:0 0 18px">This cannot be undone. If this is the last take, the entire scene will be removed.</p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="dv-keep"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Keep</button>
            <button id="dv-confirm"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#5c1a1a;color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer">Delete Take</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
        box.querySelector('#dv-keep')?.addEventListener('click', () => overlay.remove())
        box.querySelector('#dv-confirm')?.addEventListener('click', () => {
          overlay.remove()
          deleteVersion(node, label, version)
        })
      }

      async function deleteVersion(node, label, version) {
        const editOverlay = node[keys.editOverlay]
        const panelBody   = editOverlay?.querySelector('[data-daz-panel-body]')
        if (panelBody) panelBody.innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:16px">Deleting…</p>'

        try {
          const r = await fetch('/daz/workflow-config-delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, class: CLASS, file: currentFile(node), version, delete_mode: 'version' }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)

          if (node[keys.editOverlay]) { node[keys.editOverlay].remove(); node[keys.editOverlay] = null }
          node[keys.editMode] = false

          await reloadNodeConfigs(node)
          updateGroupFilterWidget(node)

          if (result.config_deleted) {
            if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
            node._dazTypeFilter = 'All'
            if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
            node._dazGroupFilter = 'All'
            syncWidget(node)
            const configWidget    = node.widgets?.find(w => w.name === 'scene')
            const remainingLabels = filteredLabels(node._dazAllConfigs || [], 'All', 'All')
            if (remainingLabels.length > 0) {
              if (configWidget) configWidget.value = remainingLabels[0]
              await reloadVersionWidget(node, remainingLabels[0])
              loadDetail(node, remainingLabels[0], node._dazVersionWidget?.value)
            } else {
              if (configWidget) { configWidget.options.values = ['(no configs)']; configWidget.value = '(no configs)' }
              node[keys.detail] = {}
              renderUseMode(node, {})
            }
          } else {
            syncWidget(node)
            const configWidget = node.widgets?.find(w => w.name === 'scene')
            if (configWidget && configWidget.value !== '(no configs)') {
              await reloadVersionWidget(node, configWidget.value)
              loadDetail(node, configWidget.value, node._dazVersionWidget?.value)
            }
          }
        } catch (e) {
          if (panelBody) {
            panelBody.innerHTML = `
              <p style="font-family:monospace;font-size:12px;color:#f88;padding:12px">Delete failed: ${esc(e.message)}</p>
              <div style="padding:0 12px 12px;display:flex;justify-content:flex-end">
                <button id="daz-back-edit"
                  style="font-family:monospace;font-size:11px;padding:3px 10px;background:#444;
                         color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Back</button>
              </div>`
            panelBody.querySelector('#daz-back-edit')?.addEventListener('click', () => {
              if (node[keys.editOverlay]) { node[keys.editOverlay].remove(); node[keys.editOverlay] = null }
              node[keys.editMode] = false
              enterEditForm(node, false)
            })
          }
        }
      }

      // ── Delete config confirm ─────────────────────────────────────────────

      function showDeleteConfigConfirm(node, wrap) {
        const name  = node[keys.detail]?.name || '?'
        const cw    = node.widgets?.find(w => w.name === 'scene')
        const label = cw?.value || ''

        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.75);z-index:10000',
          'display:flex;align-items:center;justify-content:center',
        ].join(';')
        const box = document.createElement('div')
        box.style.cssText = [
          'background:#2a2a2a;border:1px solid #555;border-radius:6px',
          'padding:20px 24px;width:360px;font-family:monospace',
        ].join(';')
        box.innerHTML = `
          <p style="font-size:13px;color:#ddd;margin:0 0 6px">
            Delete all versions of &ldquo;${esc(name)}&rdquo;?
          </p>
          <p style="font-size:11px;color:#888;margin:0 0 18px">This cannot be undone.</p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button id="dc-keep"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#444;color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Keep</button>
            <button id="dc-confirm"
              style="font-family:monospace;font-size:11px;padding:4px 14px;
                     background:#5c1a1a;color:#f99;border:1px solid #803030;border-radius:3px;cursor:pointer">Delete All</button>
          </div>
        `
        overlay.appendChild(box)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
        box.querySelector('#dc-keep')?.addEventListener('click', () => overlay.remove())
        box.querySelector('#dc-confirm')?.addEventListener('click', () => {
          overlay.remove()
          deleteConfig(node, label)
        })
      }

      async function deleteConfig(node, label) {
        const editOverlay = node[keys.editOverlay]
        const panelBody   = editOverlay?.querySelector('[data-daz-panel-body]')
        if (panelBody) panelBody.innerHTML =
          '<p style="font-family:monospace;font-size:12px;color:#555;padding:16px">Deleting…</p>'

        try {
          const r = await fetch('/daz/workflow-config-delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, class: CLASS, file: currentFile(node), delete_mode: 'config' }),
          })
          const result = await r.json()
          if (!r.ok || result.error) throw new Error(result.error || r.statusText)

          if (node[keys.editOverlay]) { node[keys.editOverlay].remove(); node[keys.editOverlay] = null }
          node[keys.editMode] = false

          await reloadNodeConfigs(node)
          if (node._dazTypeFilterWidget) node._dazTypeFilterWidget.value = 'All'
          node._dazTypeFilter = 'All'
          updateGroupFilterWidget(node)
          if (node._dazGroupFilterWidget) node._dazGroupFilterWidget.value = 'All'
          node._dazGroupFilter = 'All'
          syncWidget(node)
          const configWidget    = node.widgets?.find(w => w.name === 'scene')
          const remainingLabels = filteredLabels(node._dazAllConfigs || [], 'All', 'All')

          if (remainingLabels.length > 0) {
            if (configWidget) configWidget.value = remainingLabels[0]
            await reloadVersionWidget(node, remainingLabels[0])
            loadDetail(node, remainingLabels[0], node._dazVersionWidget?.value)
          } else {
            if (configWidget) { configWidget.options.values = ['(no configs)']; configWidget.value = '(no configs)' }
            node[keys.detail] = {}
            renderUseMode(node, {})
          }
        } catch (e) {
          if (panelBody) {
            panelBody.innerHTML = `
              <p style="font-family:monospace;font-size:12px;color:#f88;padding:12px">Delete failed: ${esc(e.message)}</p>
              <div style="padding:0 12px 12px;display:flex;justify-content:flex-end">
                <button id="daz-back-edit"
                  style="font-family:monospace;font-size:11px;padding:3px 10px;background:#444;
                         color:#ccc;border:1px solid #666;border-radius:3px;cursor:pointer">Back</button>
              </div>`
            panelBody.querySelector('#daz-back-edit')?.addEventListener('click', () => {
              if (node[keys.editOverlay]) { node[keys.editOverlay].remove(); node[keys.editOverlay] = null }
              node[keys.editMode] = false
              enterEditForm(node, false)
            })
          }
        }
      }

      // ── Image preview modal ───────────────────────────────────────────────

      function showImagePreview(filename) {
        const overlay = document.createElement('div')
        overlay.style.cssText = [
          'position:fixed;top:0;left:0;right:0;bottom:0',
          'background:rgba(0,0,0,0.88);z-index:10000',
          'display:flex;align-items:center;justify-content:center;cursor:pointer',
        ].join(';')
        const img = document.createElement('img')
        img.src = `/view?filename=${encodeURIComponent(filename)}&type=input`
        img.style.cssText =
          'max-width:90vw;max-height:90vh;border-radius:4px;box-shadow:0 4px 32px rgba(0,0,0,0.9);cursor:default'
        img.addEventListener('click', e => e.stopPropagation())
        overlay.appendChild(img)
        document.body.appendChild(overlay)
        overlay.addEventListener('click', () => overlay.remove())
      }

      function playAudio(filename) {
        const url = `/view?filename=${encodeURIComponent(filename)}&type=input`
        const audio = new Audio(url)
        audio.play().catch(err => console.warn('[DAZ TOOLS] audio playback failed', err))
      }

      // ── Lifecycle hooks ───────────────────────────────────────────────────

      const onNodeCreated = nodeType.prototype.onNodeCreated
      nodeType.prototype.onNodeCreated = function () {
        onNodeCreated?.apply(this, arguments)

        this._dazAllConfigs     = _initialConfigs.slice()
        this._dazConfigFile     = _configFiles[0]?.file ?? null
        this._dazTypeFilter     = 'All'
        this._dazGroupFilter    = 'All'
        this._dazCurrentVersion = '1'

        const cfWidget = this.widgets?.find(w => w.name === 'movie')
        if (cfWidget) {
          if (_configFiles.length > 0) {
            cfWidget.options.values = _configFiles.map(f => fileLabel(f))
            cfWidget.value          = fileLabel(_configFiles[0])
          }
          cfWidget.hidden = _configFiles.length <= 1
          this._dazConfigFileWidget = cfWidget
          const origCfCb = cfWidget.callback
          cfWidget.callback = async (value) => {
            origCfCb?.call(this, value)
            this._dazConfigFile = labelToFile(value)
            await reloadNodeConfigs(this)
            this._dazTypeFilter  = 'All'
            this._dazGroupFilter = 'All'
            if (this._dazTypeFilterWidget)  this._dazTypeFilterWidget.value  = 'All'
            if (this._dazGroupFilterWidget) this._dazGroupFilterWidget.value = 'All'
            updateGroupFilterWidget(this)
            syncWidget(this)
            if (!this[keys.editMode]) {
              const cw = this.widgets?.find(w => w.name === 'scene')
              if (cw) {
                await reloadVersionWidget(this, cw.value)
                loadDetail(this, cw.value, this._dazVersionWidget?.value)
              }
            }
          }
        }

        const versionWidget = this.widgets?.find(w => w.name === 'take')
        if (versionWidget) {
          this._dazVersionWidget = versionWidget
          const origVwCb = versionWidget.callback
          versionWidget.callback = (value) => {
            origVwCb?.call(this, value)
            this._dazCurrentVersion = rawVersion(value)
            if (!this[keys.editMode]) {
              const cw = this.widgets?.find(w => w.name === 'scene')
              if (cw && cw.value !== '(no configs)') loadDetail(this, cw.value, rawVersion(value))
            }
          }
        }

        const typeFilterWidget = this.addWidget('combo', 'Type', 'All', async (value) => {
          this._dazTypeFilter = value
          updateGroupFilterWidget(this)
          syncWidget(this)
          if (!this[keys.editMode]) {
            const cw = this.widgets?.find(w => w.name === 'scene')
            if (cw && cw.value !== '(no configs)') {
              const myGen = (this._dazVersionReloadGen || 0) + 1
              await reloadVersionWidget(this, cw.value)
              if (this._dazVersionReloadGen === myGen)
                loadDetail(this, cw.value, this._dazVersionWidget?.value)
            }
          }
        }, { values: ['All', 'I2V', 'T2V', 'MULTI'] })
        this._dazTypeFilterWidget = typeFilterWidget

        const initialGroups = ['All', ...Array.from(new Set(_initialConfigs.map(c => c.group).filter(Boolean))).sort()]
        const groupFilterWidget = this.addWidget('combo', 'Group', 'All', async (value) => {
          this._dazGroupFilter = value
          syncWidget(this)
          if (!this[keys.editMode]) {
            const cw = this.widgets?.find(w => w.name === 'scene')
            if (cw && cw.value !== '(no configs)') {
              const myGen = (this._dazVersionReloadGen || 0) + 1
              await reloadVersionWidget(this, cw.value)
              if (this._dazVersionReloadGen === myGen)
                loadDetail(this, cw.value, this._dazVersionWidget?.value)
            }
          }
        }, { values: initialGroups })
        this._dazGroupFilterWidget = groupFilterWidget

        const ci = this.widgets.findIndex(w => w.name === 'scene')
        if (ci >= 0) {
          ;[typeFilterWidget, groupFilterWidget].forEach(fw => {
            const fi = this.widgets.indexOf(fw)
            const currentCi = this.widgets.findIndex(w => w.name === 'scene')
            if (fi > currentCi) {
              this.widgets.splice(fi, 1)
              this.widgets.splice(currentCi, 0, fw)
            }
          })
        }

        syncWidget(this)

        this.addWidget('button', '↺  Reload Configs', null, async () => {
          await reloadClassFilteredState(this)
        })

        this.addWidget('button', 'Movie Manager', null, () => {
          openMovieManager(this)
        })

        const wrap = document.createElement('div')
        wrap.style.cssText =
          `box-sizing:border-box;padding:6px 0;overflow-y:auto;overflow-x:hidden;width:100%;height:${PANEL_H}px`
        this[keys.wrap]     = wrap
        this[keys.editMode] = false

        this.addDOMWidget(keys.domWidget, 'html', wrap, {
          getValue:     () => '',
          setValue:     () => {},
          getMinHeight: () => PANEL_H,
          hideOnZoom:   false,
        })

        this.size    = [NODE_W, NODE_H]
        this.minSize = [NODE_W, NODE_H]

        const w = this.widgets?.find(w => w.name === 'scene')
        if (w) {
          const origCb = w.callback
          w.callback = async (value) => {
            origCb?.call(this, value)
            if (!this[keys.editMode]) {
              await reloadVersionWidget(this, value)
              loadDetail(this, value, this._dazVersionWidget?.value)
            }
          }
          if ((this._dazAllConfigs || []).length === 0) {
            renderUseMode(this, {})
          } else {
            reloadVersionWidget(this, w.value).then(() => {
              loadDetail(this, w.value, this._dazVersionWidget?.value)
            })
          }
        }

        const executedHandler = ({ detail }) => {
          if (String(detail.node) !== String(this.id)) return
          if (this[keys.editMode]) return
          const cw = this.widgets?.find(w => w.name === 'scene')
          if (cw && cw.value && cw.value !== '(no configs)') loadDetail(this, cw.value, this._dazCurrentVersion)
        }
        api.addEventListener('executed', executedHandler)
        this[keys.executedHandler] = executedHandler
      }

      const onRemoved = nodeType.prototype.onRemoved
      nodeType.prototype.onRemoved = function () {
        onRemoved?.apply(this, arguments)
        if (this[keys.executedHandler]) {
          api.removeEventListener('executed', this[keys.executedHandler])
        }
        if (this[keys.editOverlay]) {
          this[keys.editOverlay].remove()
          this[keys.editOverlay] = null
        }
      }

      const onConfigure = nodeType.prototype.onConfigure
      nodeType.prototype.onConfigure = function (config) {
        onConfigure?.apply(this, arguments)
        const savedVersion = this._dazVersionWidget?.value || '1'
        const self = this
        queueMicrotask(async () => {
          if (self._dazConfigFileWidget) {
            const savedFile = labelToFile(self._dazConfigFileWidget.value)
            self._dazConfigFile = savedFile
            if (!savedFile) self._dazConfigFileWidget.value = '(default)'
            if (self._dazConfigFile !== null) await reloadNodeConfigs(self)
          }
          if (self._dazTypeFilterWidget)  self._dazTypeFilter  = self._dazTypeFilterWidget.value  || 'All'
          if (self._dazGroupFilterWidget) self._dazGroupFilter = self._dazGroupFilterWidget.value || 'All'
          updateGroupFilterWidget(self)
          if (!(self._dazAllConfigs || []).length) {
            if (!self[keys.editMode]) renderUseMode(self, {})
            return
          }
          const w = self.widgets?.find(w => w.name === 'scene')
          const configBefore = w?.value
          syncWidget(self)
          await reloadVersionWidget(self, w?.value, w?.value === configBefore ? savedVersion : null)
          self._dazCurrentVersion = rawVersion(self._dazVersionWidget?.value || '1')
          if (!self[keys.editMode]) loadDetail(self, w?.value, self._dazCurrentVersion)
        })
      }
    },
  }
}
