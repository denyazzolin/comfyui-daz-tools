import { app } from '../../scripts/app.js'
import { buildWorkflowConfigExtension } from './daz_workflow_config_shared.js'

// ── Image — use-mode detail table ─────────────────────────────────────────────

function renderDetailHtml(data, h) {
  const { esc, fName, fValue, fText, fPath, fFile, fType, fRandomize, fFlagLabel, fFlagValue, fCustomValue, fNote,
          row, rowNote, rowDiv, disp, trunc } = h

  if (data.error) {
    return `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">${esc(data.error)}</p>`
  }
  const imagePath = fPath(data.image_path)
  const imageCell = imagePath
    ? `<div style="display:flex;align-items:flex-start;gap:6px">
         <span style="color:#ddd;word-break:break-all;flex:1">${esc(imagePath)}</span>
         <button id="daz-use-preview-btn"
           style="font-family:monospace;font-size:12px;padding:2px 6px;background:#000000;color:#ffffff;
                  border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Preview</button>
       </div>`
    : `<span style="color:#555">—</span>`

  return `<table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
    ${row('Group',      fName(data.group))}
    ${rowNote(fNote(data.note))}
    ${rowDiv()}
    ${row('Checkpoint', disp(fName(data.checkpoint)))}
    ${row('Diffuser',   disp(fName(data.unet_high)))}
    ${row('VAE',        disp(fName(data.vae)))}
    ${row('CLIP',       disp(fName(data.clip)))}
    <tr>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Image</td>
      <td colspan="3" style="color:#ddd;padding:3px 10px">${imageCell}</td>
    </tr>
    ${rowDiv()}
    ${row('Resolution', fValue(data.width) && fValue(data.height) ? `${fValue(data.width)} × ${fValue(data.height)}` : '')}
    <tr>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Steps</td>
      <td style="color:#ddd;padding:3px 10px;width:30%">${fValue(data.steps) ? esc(String(fValue(data.steps))) : '<span style="color:#555">—</span>'}</td>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Seed</td>
      <td style="padding:3px 10px;width:30%">
        <div style="display:flex;align-items:center;gap:6px">
          ${fValue(data.seed) ? `<span style="color:#ddd">${esc(String(fValue(data.seed)))}</span>` : '<span style="color:#555">—</span>'}
          <input type="checkbox" id="daz-use-seed-randomize"${fRandomize(data.seed) ? ' checked' : ''}
            style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
          <span style="color:#999;font-size:11px;font-family:monospace">rnd</span>
        </div>
      </td>
    </tr>
    ${row('CFG',        fValue(data.cfg_high))}
    ${rowDiv()}
    ${row('Master',     trunc(fText(data.master_prompt)))}
    ${row('Positive',   trunc(fText(data.positive_prompt)))}
    ${row('Negative',   trunc(fText(data.negative_prompt)))}
    ${row('Prompt Type', ({ smart: 'Smart', beats: 'Beats', simple: 'Simple' })[fType(data.positive_prompt)] || 'Smart')}
    ${rowDiv()}
    ${row('Filename',   fFile(data.filename))}
    <tr>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:middle">Flags</td>
      <td colspan="3" style="padding:3px 10px">
        <div style="display:flex;align-items:center;gap:16px">
          <div style="display:flex;align-items:center;gap:4px">
            <input type="checkbox" id="daz-use-flag-1"${fFlagValue(data.flags?.flag_1) ? ' checked' : ''}
              style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
            <span style="color:#999;font-size:11px;font-family:monospace">${esc(fFlagLabel(data.flags?.flag_1, 'flag 1'))}</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="checkbox" id="daz-use-flag-2"${fFlagValue(data.flags?.flag_2) ? ' checked' : ''}
              style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
            <span style="color:#999;font-size:11px;font-family:monospace">${esc(fFlagLabel(data.flags?.flag_2, 'flag 2'))}</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="checkbox" id="daz-use-flag-3"${fFlagValue(data.flags?.flag_3) ? ' checked' : ''}
              style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
            <span style="color:#999;font-size:11px;font-family:monospace">${esc(fFlagLabel(data.flags?.flag_3, 'flag 3'))}</span>
          </div>
        </div>
      </td>
    </tr>
    <tr>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Custom</td>
      <td colspan="3" style="padding:3px 10px">
        <div style="display:flex;flex-direction:column;gap:2px;font-size:11px;font-family:monospace;overflow:hidden">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            <span style="color:#999">${esc(fFlagLabel(data.custom?.param_1, 'param 1'))}:</span>
            <span style="color:#ddd">${esc(trunc(fCustomValue(data.custom?.param_1) || '—', 28))}</span>
          </div>
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            <span style="color:#999">${esc(fFlagLabel(data.custom?.param_2, 'param 2'))}:</span>
            <span style="color:#ddd">${esc(trunc(fCustomValue(data.custom?.param_2) || '—', 28))}</span>
          </div>
        </div>
      </td>
    </tr>
  </table>`
}

// ── Image — output labels ──────────────────────────────────────────────────────

function updateOutputLabels(node, data, h) {
  if (!node.outputs) return
  const { fName, fValue, fText, fPath, fFile, fType, fRandomize, fFlagLabel, fFlagValue, fCustomValue, disp, trunc } = h
  const ckpt   = fName(data.checkpoint)
  const values = [
    fName(data.unet_high),
    ckpt, ckpt, ckpt,
    fName(data.vae),
    fName(data.clip),
    fValue(data.width), fValue(data.height), fValue(data.steps),
    fRandomize(data.seed) ? 'rnd' : fValue(data.seed),
    fValue(data.cfg_high),
    trunc(fText(data.master_prompt), 20), trunc(fText(data.positive_prompt), 20), trunc(fText(data.negative_prompt), 20),
    fType(data.positive_prompt),
    fFile(data.filename),
    fFlagLabel(data.flags?.flag_1, 'flag 1') + ': ' + fFlagValue(data.flags?.flag_1),
    fFlagLabel(data.flags?.flag_2, 'flag 2') + ': ' + fFlagValue(data.flags?.flag_2),
    fFlagLabel(data.flags?.flag_3, 'flag 3') + ': ' + fFlagValue(data.flags?.flag_3),
    fFlagLabel(data.custom?.param_1, 'param 1') + ': ' + fCustomValue(data.custom?.param_1),
    fFlagLabel(data.custom?.param_2, 'param 2') + ': ' + fCustomValue(data.custom?.param_2),
  ]
  values.forEach((val, i) => {
    if (!node.outputs[i]) return
    const orig = node.outputs[i].name
    const d = (val !== undefined && val !== null && val !== '' && val !== 0) ? disp(String(val), 20) : 'none'
    node.outputs[i].label = `(${d}) ${orig}`
  })
}

// ── Image — edit panel: Models box ────────────────────────────────────────────

function buildModelsHtml(folderMap, data, h) {
  const { fName, selOpt, fs, lbl, rw, cb } = h
  const checkpointFiles = folderMap.checkpoints      || []
  const unetFiles       = folderMap.diffusion_models || []
  const vaeFiles        = folderMap.vae              || []
  const clipFiles       = folderMap.text_encoders    || []
  return `
    <div style="${rw}"><label style="${lbl}">Checkpoint</label>
      <select id="daz-checkpoint" style="${fs}">${selOpt(checkpointFiles, fName(data.checkpoint))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">Diffuser</label>
      <select id="daz-unet-high" style="${fs}">${selOpt(unetFiles, fName(data.unet_high))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">VAE</label>
      <select id="daz-vae" style="${fs}">${selOpt(vaeFiles, fName(data.vae))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">CLIP</label>
      <select id="daz-clip" style="${fs}">${selOpt(clipFiles, fName(data.clip))}</select>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button id="daz-models-clear" style="${cb}">clear</button>
    </div>`
}

// ── Image — edit panel: Dimensions box ────────────────────────────────────────

function buildDimsHtml(data, h) {
  const { fValue, fRandomize, ns, lbl, cb } = h
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
      <div><label style="${lbl}">Width</label>
        <input id="daz-width" type="number" value="${fValue(data.width) || 0}" style="width:100%;${ns}"></div>
      <div><label style="${lbl}">Height</label>
        <input id="daz-height" type="number" value="${fValue(data.height) || 0}" style="width:100%;${ns}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
      <div><label style="${lbl}">Steps</label>
        <input id="daz-steps" type="number" value="${fValue(data.steps) || 0}" style="width:100%;${ns}"></div>
      <div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:100%">
          <div style="flex:1"><label style="${lbl}">Seed</label>
            <input id="daz-seed" type="number" value="${fValue(data.seed) ?? 0}" style="width:100%;${ns}"></div>
          <div style="display:flex;align-items:center;gap:3px;padding-bottom:3px">
            <input type="checkbox" id="daz-seed-randomize"${fRandomize(data.seed) ? ' checked' : ''}
              title="Randomize seed"
              style="width:13px;height:13px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
            <span style="color:#888;font-size:10px">Rnd</span>
          </div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
      <div><label style="${lbl}">CFG</label>
        <input id="daz-cfg" type="number" step="0.1" value="${fValue(data.cfg_high) || 0}" style="width:100%;${ns}"></div>
      <div></div>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button id="daz-dims-clear" style="${cb}">clear</button>
    </div>`
}

// ── Image — edit panel: payload builder ───────────────────────────────────────

function buildPayload(wrap) {
  return {
    type:            'all',
    checkpoint:      { name:  wrap.querySelector('#daz-checkpoint')?.value    ?? '' },
    unet_high:       { name:  wrap.querySelector('#daz-unet-high')?.value     ?? '' },
    vae:             { name:  wrap.querySelector('#daz-vae')?.value           ?? '' },
    clip:            { name:  wrap.querySelector('#daz-clip')?.value          ?? '' },
    image_path:      { path:  wrap.querySelector('#daz-image-path')?.value    ?? '' },
    master_prompt:   { text:  wrap.querySelector('#daz-master-prompt')?.value ?? '' },
    positive_prompt: {
      text: wrap.querySelector('#daz-positive-prompt')?.value ?? '',
      type: wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart',
    },
    negative_prompt: { text:  wrap.querySelector('#daz-negative-prompt')?.value ?? '' },
    filename:        { file:  wrap.querySelector('#daz-filename')?.value       ?? '' },
    width:           { value: parseInt(wrap.querySelector('#daz-width')?.value  ?? '0', 10) },
    height:          { value: parseInt(wrap.querySelector('#daz-height')?.value ?? '0', 10) },
    steps:           { value: parseInt(wrap.querySelector('#daz-steps')?.value  ?? '0', 10) },
    seed:            { value: parseInt(wrap.querySelector('#daz-seed')?.value   ?? '0', 10),
                       randomize: wrap.querySelector('#daz-seed-randomize')?.checked ?? false },
    cfg_high:        { value: parseFloat(wrap.querySelector('#daz-cfg')?.value  ?? '0') },
    flags: {
      flag_1: { label: wrap.querySelector('#daz-flag-1-label')?.value ?? 'flag 1', value: wrap.querySelector('#daz-flag-1-value')?.checked ?? false },
      flag_2: { label: wrap.querySelector('#daz-flag-2-label')?.value ?? 'flag 2', value: wrap.querySelector('#daz-flag-2-value')?.checked ?? false },
      flag_3: { label: wrap.querySelector('#daz-flag-3-label')?.value ?? 'flag 3', value: wrap.querySelector('#daz-flag-3-value')?.checked ?? false },
    },
    custom: {
      param_1: { label: wrap.querySelector('#daz-custom-1-label')?.value ?? 'param 1', value: wrap.querySelector('#daz-custom-1-value')?.value ?? '' },
      param_2: { label: wrap.querySelector('#daz-custom-2-label')?.value ?? 'param 2', value: wrap.querySelector('#daz-custom-2-value')?.value ?? '' },
    },
    note: { value: (wrap.querySelector('#daz-note')?.value ?? '').substring(0, 900) },
  }
}

// ── Registration ───────────────────────────────────────────────────────────────

app.registerExtension(buildWorkflowConfigExtension({
  extName:      'daz.workflowConfigImage',
  nodeDataName: 'WorkflowConfigImage',
  CLASS:        'ImageInference',
  PANEL_H: 560, NODE_W: 460, NODE_H: 775,

  keys: {
    detail:          '_dazImageDetail',
    editMode:        '_dazImageEditMode',
    editOverlay:     '_dazImageEditOverlay',
    wrap:            '_dazImageWrap',
    executedHandler: '_dazImageExecutedHandler',
    domWidget:       'daz_image_detail',
  },

  uidPrefix:        'i',
  folderNames:      ['checkpoints', 'diffusion_models', 'vae', 'text_encoders', 'input'],
  loraLabels:       [],
  loraLabelWidth:   '44px',
  useModeLoraCount: 0,

  cfgInputIds:    ['#daz-cfg'],
  dimsClearIds:   ['#daz-width', '#daz-height', '#daz-steps', '#daz-seed', '#daz-cfg'],
  modelsClearIds: ['#daz-checkpoint', '#daz-unet-high', '#daz-vae', '#daz-clip'],
  defaultNegativePrompt: '',

  hideType:      true,
  hideAudioPath: true,
  hideLorasBox:  true,

  renderDetailHtml,
  updateOutputLabels,
  buildModelsHtml,
  buildDimsHtml,
  buildPayload,
}))
