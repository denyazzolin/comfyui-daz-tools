import { app } from '../../scripts/app.js'
import { buildWorkflowConfigExtension } from './daz_workflow_config_shared.js'

// ── WAN2.2 — use-mode detail table ────────────────────────────────────────────

function renderDetailHtml(data, h) {
  const { esc, fName, fValue, fText, fPath, fFile, fType, fRandomize, fFlagLabel, fFlagValue, fNote,
          row, rowPair, rowNote, rowPairLora, rowDiv, disp, trunc, loraEnabled } = h
  if (data.error) {
    return `<p style="font-family:monospace;font-size:12px;color:#f88;padding:8px">${esc(data.error)}</p>`
  }
  const loras     = data.loras ?? {}
  const imagePath = fPath(data.image_path)
  const imageCell = imagePath
    ? `<div style="display:flex;align-items:flex-start;gap:6px">
         <span style="color:#ddd;word-break:break-all;flex:1">${esc(imagePath)}</span>
         <button id="daz-use-preview-btn"
           style="font-family:monospace;font-size:12px;padding:2px 6px;background:#000000;color:#ffffff;
                  border:1px solid #666;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0">Preview</button>
       </div>`
    : `<span style="color:#555">—</span>`
  const typeLabel = data.type === 'I2V' ? 'I2V' : data.type === 'T2V' ? 'T2V' : data.type === 'MULTI' ? 'MULTI' : 'No type'
  return `<table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
    ${row('Group',      fName(data.group))}
    ${row('Type',       typeLabel)}
    ${rowNote(fNote(data.note))}
    ${rowDiv()}
    ${row('UNet High',  disp(fName(data.unet_high)))}
    ${row('UNet Low',   disp(fName(data.unet_low)))}
    ${row('VAE',        disp(fName(data.vae)))}
    ${row('CLIP',       disp(fName(data.clip)))}
    ${rowPair('Shift Hi', data.shift_high != null ? fValue(data.shift_high) : 5.0, 'Shift Lo', data.shift_low != null ? fValue(data.shift_low) : 5.0)}
    <tr>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Image</td>
      <td colspan="3" style="color:#ddd;padding:3px 10px">${imageCell}</td>
    </tr>
    ${rowDiv()}
    ${rowPairLora('LoRA 1 High', loras.lora_1, 'LoRA 1 Low', loras.lora_2, 'daz-use-lora-1', 'daz-use-lora-2')}
    ${rowPairLora('LoRA 2 High', loras.lora_3, 'LoRA 2 Low', loras.lora_4, 'daz-use-lora-3', 'daz-use-lora-4')}
    ${rowPairLora('LoRA 3 High', loras.lora_5, 'LoRA 3 Low', loras.lora_6, 'daz-use-lora-5', 'daz-use-lora-6')}
    ${rowPairLora('LoRA 4 High', loras.lora_7, 'LoRA 4 Low', loras.lora_8, 'daz-use-lora-7', 'daz-use-lora-8')}
    ${rowDiv()}
    ${row('Resolution',  fValue(data.width) && fValue(data.height) ? `${fValue(data.width)} × ${fValue(data.height)}` : '')}
    ${rowPair('Steps',    fValue(data.steps),       'Split Step', fValue(data.split_step))}
    <tr>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Seed</td>
      <td colspan="3" style="padding:3px 10px">
        <div style="display:flex;align-items:center;gap:6px">
          ${fValue(data.seed) ? `<span style="color:#ddd">${esc(String(fValue(data.seed)))}</span>` : '<span style="color:#555">—</span>'}
          <input type="checkbox" id="daz-use-seed-randomize"${fRandomize(data.seed) ? ' checked' : ''}
            style="cursor:pointer;accent-color:#54af7b;width:13px;height:13px;flex-shrink:0">
          <span style="color:#999;font-size:11px;font-family:monospace">rnd</span>
        </div>
      </td>
    </tr>
    ${rowPair('CFG High', fValue(data.cfg_high),    'CFG Low',    fValue(data.cfg_low))}
    ${rowPair('Frames',   fValue(data.total_frames), 'FPS',       fValue(data.fps))}
    ${rowDiv()}
    ${row('Master',      trunc(fText(data.master_prompt)))}
    ${row('Positive',    trunc(fText(data.positive_prompt)))}
    ${row('Negative',    trunc(fText(data.negative_prompt)))}
    ${row('Prompt Type', ({ smart: 'Smart', beats: 'Beats', simple: 'Simple' })[fType(data.positive_prompt)] || 'Smart')}
    ${rowDiv()}
    ${row('Filename',    fFile(data.filename))}
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
  </table>`
}

// ── WAN2.2 — output labels ────────────────────────────────────────────────────

function updateOutputLabels(node, data, h) {
  if (!node.outputs) return
  const { fName, fValue, fText, fPath, fFile, fType, fRandomize, fFlagLabel, fFlagValue, disp, trunc, loraEnabled } = h
  const loras  = data.loras ?? {}
  const values = [
    fName(data.unet_high), fName(data.unet_low),
    fName(data.vae), fName(data.clip),
    fPath(data.image_path),
    fValue(data.width), fValue(data.height),
    fValue(data.steps), fValue(data.split_step),
    fRandomize(data.seed) ? 'rnd' : fValue(data.seed),
    trunc(fText(data.master_prompt), 20),
    trunc(fText(data.positive_prompt), 20),
    trunc(fText(data.negative_prompt), 20),
    fType(data.positive_prompt),
    fValue(data.cfg_high), fValue(data.cfg_low),
    fValue(data.total_frames), fValue(data.fps),
    loraEnabled(loras.lora_1) ? fName(loras.lora_1) : '',
    loraEnabled(loras.lora_2) ? fName(loras.lora_2) : '',
    loraEnabled(loras.lora_3) ? fName(loras.lora_3) : '',
    loraEnabled(loras.lora_4) ? fName(loras.lora_4) : '',
    loraEnabled(loras.lora_5) ? fName(loras.lora_5) : '',
    loraEnabled(loras.lora_6) ? fName(loras.lora_6) : '',
    loraEnabled(loras.lora_7) ? fName(loras.lora_7) : '',
    loraEnabled(loras.lora_8) ? fName(loras.lora_8) : '',
    fFile(data.filename),
    fName(data.unet_high),
    fName(data.unet_low),
    data.shift_high != null ? fValue(data.shift_high) : 5.0,
    data.shift_low  != null ? fValue(data.shift_low)  : 5.0,
    data.type === 'T2V',
    fFlagLabel(data.flags?.flag_1, 'flag 1') + ': ' + fFlagValue(data.flags?.flag_1),
    fFlagLabel(data.flags?.flag_2, 'flag 2') + ': ' + fFlagValue(data.flags?.flag_2),
    fFlagLabel(data.flags?.flag_3, 'flag 3') + ': ' + fFlagValue(data.flags?.flag_3),
  ]
  values.forEach((val, i) => {
    if (!node.outputs[i]) return
    const orig = node.outputs[i].name
    const d = (val !== undefined && val !== null && val !== '' && val !== 0) ? disp(String(val), 20) : 'none'
    node.outputs[i].label = `(${d}) ${orig}`
  })
}

// ── WAN2.2 — edit panel: Models box ──────────────────────────────────────────

function buildModelsHtml(folderMap, data, h) {
  const { fName, fValue, selOpt, fs, ns, lbl, rw, cb } = h
  const unetFiles = folderMap.diffusion_models || []
  const vaeFiles  = folderMap.vae              || []
  const clipFiles = folderMap.text_encoders    || []
  return `
    <div style="${rw}"><label style="${lbl}">Unet High</label>
      <select id="daz-unet-high" style="${fs}">${selOpt(unetFiles, fName(data.unet_high))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">Unet Low</label>
      <select id="daz-unet-low" style="${fs}">${selOpt(unetFiles, fName(data.unet_low))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">VAE</label>
      <select id="daz-vae" style="${fs}">${selOpt(vaeFiles, fName(data.vae))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">Clip</label>
      <select id="daz-clip" style="${fs}">${selOpt(clipFiles, fName(data.clip))}</select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px">
      <div><label style="${lbl}">Shift Hi</label>
        <input id="daz-shift-high" type="number" step="0.01" value="${data.shift_high != null ? fValue(data.shift_high) : 5.0}" style="width:100%;${ns}"></div>
      <div><label style="${lbl}">Shift Lo</label>
        <input id="daz-shift-low" type="number" step="0.01" value="${data.shift_low != null ? fValue(data.shift_low) : 5.0}" style="width:100%;${ns}"></div>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button id="daz-models-clear" style="${cb}">clear</button>
    </div>`
}

// ── WAN2.2 — edit panel: Dimensions box ──────────────────────────────────────

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
      <div><label style="${lbl}">Split Step</label>
        <input id="daz-split-step" type="number" value="${fValue(data.split_step) || 0}" style="width:100%;${ns}"></div>
    </div>
    <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:4px">
      <div style="flex:1"><label style="${lbl}">Seed</label>
        <input id="daz-seed" type="number" value="${fValue(data.seed) ?? 0}" style="width:100%;${ns}"></div>
      <div style="display:flex;align-items:center;gap:4px;padding-bottom:3px">
        <input type="checkbox" id="daz-seed-randomize"${fRandomize(data.seed) ? ' checked' : ''}
          title="Randomize seed" style="width:13px;height:13px;cursor:pointer;accent-color:#54af7b;flex-shrink:0">
        <span style="color:#888;font-size:10px">Rnd</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
      <div><label style="${lbl}">CFG Hi</label>
        <input id="daz-cfg-high" type="number" step="0.1" value="${fValue(data.cfg_high) || 0}" style="width:100%;${ns}"></div>
      <div><label style="${lbl}">CFG Lo</label>
        <input id="daz-cfg-low" type="number" step="0.1" value="${fValue(data.cfg_low) || 0}" style="width:100%;${ns}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px">
      <div><label style="${lbl}">Frames</label>
        <input id="daz-total-frames" type="number" value="${fValue(data.total_frames) || 0}" style="width:100%;${ns}"></div>
      <div><label style="${lbl}">FPS</label>
        <input id="daz-fps" type="number" step="0.01" value="${fValue(data.fps) || 0}" style="width:100%;${ns}"></div>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button id="daz-dims-clear" style="${cb}">clear</button>
    </div>`
}

// ── WAN2.2 — edit panel: payload builder ─────────────────────────────────────

function buildPayload(wrap) {
  const loras = {}
  for (let n = 1; n <= 8; n++) {
    loras[`lora_${n}`] = {
      name:     wrap.querySelector(`#daz-lora-${n}`)?.value             ?? '',
      enabled:  wrap.querySelector(`#daz-lora-${n}-enabled`)?.checked   ?? true,
      strength: parseFloat(wrap.querySelector(`#daz-lora-${n}-strength`)?.value ?? '1') || 1.0,
    }
  }
  return {
    unet_high:       { name: wrap.querySelector('#daz-unet-high')?.value       ?? '' },
    unet_low:        { name: wrap.querySelector('#daz-unet-low')?.value        ?? '' },
    vae:             { name: wrap.querySelector('#daz-vae')?.value             ?? '' },
    clip:            { name: wrap.querySelector('#daz-clip')?.value            ?? '' },
    shift_high:      { value: parseFloat(wrap.querySelector('#daz-shift-high')?.value ?? '5') || 5.0 },
    shift_low:       { value: parseFloat(wrap.querySelector('#daz-shift-low')?.value  ?? '5') || 5.0 },
    image_path:      { path: wrap.querySelector('#daz-image-path')?.value      ?? '' },
    loras,
    master_prompt:   { text: wrap.querySelector('#daz-master-prompt')?.value   ?? '' },
    positive_prompt: {
      text: wrap.querySelector('#daz-positive-prompt')?.value ?? '',
      type: wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart',
    },
    negative_prompt: { text: wrap.querySelector('#daz-negative-prompt')?.value ?? '' },
    filename:        { file: wrap.querySelector('#daz-filename')?.value         ?? '' },
    width:        { value: parseInt(wrap.querySelector('#daz-width')?.value        ?? '0', 10) },
    height:       { value: parseInt(wrap.querySelector('#daz-height')?.value       ?? '0', 10) },
    steps:        { value: parseInt(wrap.querySelector('#daz-steps')?.value        ?? '0', 10) },
    split_step:   { value: parseInt(wrap.querySelector('#daz-split-step')?.value   ?? '0', 10) },
    seed:         { value: parseInt(wrap.querySelector('#daz-seed')?.value         ?? '0', 10),
                    randomize: wrap.querySelector('#daz-seed-randomize')?.checked  ?? false },
    cfg_high:     { value: parseFloat(wrap.querySelector('#daz-cfg-high')?.value   ?? '0') },
    cfg_low:      { value: parseFloat(wrap.querySelector('#daz-cfg-low')?.value    ?? '0') },
    total_frames: { value: parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) },
    fps:          { value: parseFloat(wrap.querySelector('#daz-fps')?.value        ?? '0') },
    flags: {
      flag_1: { label: wrap.querySelector('#daz-flag-1-label')?.value ?? 'flag 1', value: wrap.querySelector('#daz-flag-1-value')?.checked ?? false },
      flag_2: { label: wrap.querySelector('#daz-flag-2-label')?.value ?? 'flag 2', value: wrap.querySelector('#daz-flag-2-value')?.checked ?? false },
      flag_3: { label: wrap.querySelector('#daz-flag-3-label')?.value ?? 'flag 3', value: wrap.querySelector('#daz-flag-3-value')?.checked ?? false },
    },
    note: { value: (wrap.querySelector('#daz-note')?.value ?? '').substring(0, 900) },
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

app.registerExtension(buildWorkflowConfigExtension({
  extName:      'daz.workflowConfigWan22',
  nodeDataName: 'WorkflowConfigWan22',
  CLASS:        'Wan2.2',
  PANEL_H: 628, NODE_W: 460, NODE_H: 840,

  keys: {
    detail:          '_dazWan22Detail',
    editMode:        '_dazWan22EditMode',
    editOverlay:     '_dazWan22EditOverlay',
    wrap:            '_dazWan22Wrap',
    executedHandler: '_dazWan22ExecutedHandler',
    domWidget:       'daz_wan22_detail',
  },

  uidPrefix:       'w',
  folderNames:     ['diffusion_models', 'vae', 'text_encoders', 'input', 'loras'],
  loraLabels:      ['Lora 1 Hi','Lora 1 Lo','Lora 2 Hi','Lora 2 Lo','Lora 3 Hi','Lora 3 Lo','Lora 4 Hi','Lora 4 Lo'],
  loraLabelWidth:  '62px',
  useModeLoraCount: 8,

  dimsClearIds:   ['#daz-width','#daz-height','#daz-steps','#daz-split-step','#daz-seed',
                   '#daz-cfg-high','#daz-cfg-low','#daz-total-frames','#daz-fps'],
  modelsClearIds: ['#daz-unet-high','#daz-unet-low','#daz-vae','#daz-clip','#daz-shift-high','#daz-shift-low'],

  renderDetailHtml,
  updateOutputLabels,
  buildModelsHtml,
  buildDimsHtml,
  buildPayload,
}))
