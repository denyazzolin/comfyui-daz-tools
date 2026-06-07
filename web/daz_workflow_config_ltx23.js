import { app } from '../../scripts/app.js'
import { buildWorkflowConfigExtension } from './daz_workflow_config_shared.js'

// ── LTX2.3 — use-mode detail table ───────────────────────────────────────────

function renderDetailHtml(data, h) {
  const { esc, fName, fValue, fText, fPath, fFile, fType, fRandomize, fFlagLabel, fFlagValue, fNote,
          row, rowPair, rowNote, rowPairLora, rowDiv, disp, trunc, loraEnabled } = h

  function dualClipDisp(n1, n2) {
    const a = disp(n1, 9), b = disp(n2, 9)
    if (a && b) return `${a}/${b}`
    return a || b || ''
  }

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
  const typeLabel = data.type === 'I2V' ? 'I2V' : data.type === 'T2V' ? 'T2V' : data.type === 'MULTI' ? 'MULTI' : 'No type'
  const loras = data.loras ?? {}
  return `<table style="font-family:monospace;font-size:12px;border-collapse:collapse;width:100%">
    ${row('Group',       fName(data.group))}
    ${row('Type',        typeLabel)}
    ${rowNote(fNote(data.note))}
    ${rowDiv()}
    ${row('Checkpoint',  disp(fName(data.checkpoint)))}
    ${row('Transformer', disp(fName(data.unet_high)))}
    ${row('Video VAE',   disp(fName(data.vae)))}
    ${row('Audio VAE',   disp(fName(data.audio_vae)))}
    ${row('CLIP',        disp(fName(data.clip_2)))}
    ${row('CLIP 2',      disp(fName(data.clip)))}
    <tr>
      <td style="color:#999;padding:3px 10px;white-space:nowrap;vertical-align:top">Image</td>
      <td colspan="3" style="color:#ddd;padding:3px 10px">${imageCell}</td>
    </tr>
    ${rowDiv()}
    ${rowPairLora('LoRA 1', loras.lora_1, 'LoRA 2', loras.lora_2, 'daz-use-lora-1', 'daz-use-lora-2')}
    ${rowPairLora('LoRA 3', loras.lora_3, 'LoRA 4', loras.lora_4, 'daz-use-lora-3', 'daz-use-lora-4')}
    ${rowPairLora('LoRA 5', loras.lora_5, 'LoRA 6', loras.lora_6, 'daz-use-lora-5', 'daz-use-lora-6')}
    ${rowDiv()}
    ${row('Resolution',  fValue(data.width) && fValue(data.height) ? `${fValue(data.width)} × ${fValue(data.height)}` : '')}
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
    ${row('CFG',         fValue(data.cfg_high))}
    ${rowPair('Frames',  fValue(data.total_frames), 'FPS', fValue(data.fps))}
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

// ── LTX2.3 — output labels ────────────────────────────────────────────────────

function updateOutputLabels(node, data, h) {
  if (!node.outputs) return
  const { fName, fValue, fText, fPath, fFile, fType, fRandomize, fFlagLabel, fFlagValue, disp, trunc, loraEnabled } = h
  function dualClipDisp(n1, n2) {
    const a = disp(n1, 9), b = disp(n2, 9)
    if (a && b) return `${a}/${b}`
    return a || b || ''
  }
  const ckpt  = fName(data.checkpoint)
  const loras = data.loras ?? {}
  const values = [
    ckpt, ckpt, ckpt,
    fName(data.unet_high),
    fName(data.vae), fName(data.audio_vae),
    dualClipDisp(fName(data.clip_2), fName(data.clip)),
    fPath(data.image_path),
    fValue(data.width), fValue(data.height), fValue(data.steps),
    fRandomize(data.seed) ? 'rnd' : fValue(data.seed),
    trunc(fText(data.master_prompt), 20), trunc(fText(data.positive_prompt), 20), trunc(fText(data.negative_prompt), 20),
    fType(data.positive_prompt),
    fValue(data.cfg_high),
    fValue(data.total_frames), fValue(data.fps),
    loraEnabled(loras.lora_1) ? fName(loras.lora_1) : '',
    loraEnabled(loras.lora_2) ? fName(loras.lora_2) : '',
    loraEnabled(loras.lora_3) ? fName(loras.lora_3) : '',
    loraEnabled(loras.lora_4) ? fName(loras.lora_4) : '',
    loraEnabled(loras.lora_5) ? fName(loras.lora_5) : '',
    loraEnabled(loras.lora_6) ? fName(loras.lora_6) : '',
    fFile(data.filename),
    fName(data.unet_high),
    ckpt,
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

// ── LTX2.3 — edit panel: Models box ──────────────────────────────────────────

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
    <div style="${rw}"><label style="${lbl}">Transformer</label>
      <select id="daz-unet-high" style="${fs}">${selOpt(unetFiles, fName(data.unet_high))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">Video VAE</label>
      <select id="daz-vae" style="${fs}">${selOpt(vaeFiles, fName(data.vae))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">Audio VAE</label>
      <select id="daz-audio-vae" style="${fs}">${selOpt(vaeFiles, fName(data.audio_vae))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">CLIP</label>
      <select id="daz-clip-2" style="${fs}">${selOpt(clipFiles, fName(data.clip_2))}</select>
    </div>
    <div style="${rw}"><label style="${lbl}">CLIP 2</label>
      <select id="daz-clip" style="${fs}">${selOpt(clipFiles, fName(data.clip))}</select>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button id="daz-models-clear" style="${cb}">clear</button>
    </div>`
}

// ── LTX2.3 — edit panel: Dimensions box ──────────────────────────────────────

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

// ── LTX2.3 — edit panel: payload builder ─────────────────────────────────────

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
    checkpoint:      { name:  wrap.querySelector('#daz-checkpoint')?.value       ?? '' },
    unet_high:       { name:  wrap.querySelector('#daz-unet-high')?.value        ?? '' },
    vae:             { name:  wrap.querySelector('#daz-vae')?.value              ?? '' },
    audio_vae:       { name:  wrap.querySelector('#daz-audio-vae')?.value        ?? '' },
    clip_2:          { name:  wrap.querySelector('#daz-clip-2')?.value           ?? '' },
    clip:            { name:  wrap.querySelector('#daz-clip')?.value             ?? '' },
    image_path:      { path:  wrap.querySelector('#daz-image-path')?.value       ?? '' },
    loras,
    master_prompt:   { text:  wrap.querySelector('#daz-master-prompt')?.value    ?? '' },
    positive_prompt: {
      text: wrap.querySelector('#daz-positive-prompt')?.value  ?? '',
      type: wrap.querySelector('#daz-positive-prompt-type')?.value || 'smart',
    },
    negative_prompt: { text:  wrap.querySelector('#daz-negative-prompt')?.value  ?? '' },
    filename:        { file:  wrap.querySelector('#daz-filename')?.value         ?? '' },
    width:           { value: parseInt(wrap.querySelector('#daz-width')?.value        ?? '0', 10) },
    height:          { value: parseInt(wrap.querySelector('#daz-height')?.value       ?? '0', 10) },
    steps:           { value: parseInt(wrap.querySelector('#daz-steps')?.value        ?? '0', 10) },
    seed:            { value: parseInt(wrap.querySelector('#daz-seed')?.value         ?? '0', 10),
                       randomize: wrap.querySelector('#daz-seed-randomize')?.checked ?? false },
    cfg_high:        { value: parseFloat(wrap.querySelector('#daz-cfg')?.value        ?? '0') },
    total_frames:    { value: parseInt(wrap.querySelector('#daz-total-frames')?.value ?? '0', 10) },
    fps:             { value: parseFloat(wrap.querySelector('#daz-fps')?.value        ?? '0') },
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
  extName:      'daz.workflowConfigLtx23',
  nodeDataName: 'WorkflowConfigLtx23',
  CLASS:        'ltx2.3',
  PANEL_H: 650, NODE_W: 460, NODE_H: 862,

  keys: {
    detail:          '_dazLtx23Detail',
    editMode:        '_dazLtx23EditMode',
    editOverlay:     '_dazLtx23EditOverlay',
    wrap:            '_dazLtx23Wrap',
    executedHandler: '_dazLtx23ExecutedHandler',
    domWidget:       'daz_ltx23_detail',
  },

  uidPrefix:        'l',
  folderNames:      ['checkpoints', 'diffusion_models', 'vae', 'text_encoders', 'input', 'loras'],
  loraLabels:       ['Lora 1','Lora 2','Lora 3','Lora 4','Lora 5','Lora 6','Lora 7','Lora 8'],
  loraLabelWidth:   '44px',
  useModeLoraCount: 6,

  dimsClearIds:   ['#daz-width','#daz-height','#daz-steps','#daz-seed',
                   '#daz-cfg','#daz-total-frames','#daz-fps'],
  modelsClearIds: ['#daz-checkpoint','#daz-unet-high','#daz-vae','#daz-audio-vae','#daz-clip','#daz-clip-2'],

  renderDetailHtml,
  updateOutputLabels,
  buildModelsHtml,
  buildDimsHtml,
  buildPayload,
}))
