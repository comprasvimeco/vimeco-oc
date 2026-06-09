/* VIMECO S.A. — Adjuntar archivo a OC existente */

let currentFile = null;
let allOCs      = [];

const $ = id => document.getElementById(id);

function toast(msg, type = 'info') {
  const c  = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity    = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function displayToISODate(d) {
  const p = (d || '').split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (d || '');
}

// ---- Archivo ----

function setFile(file) {
  currentFile = file;
  $('import-zone').classList.add('hidden');
  $('file-ready-msg').innerHTML = `${icSvg('check')} ${esc(file.name)} &nbsp;(${(file.size / 1024).toFixed(0)} KB)`;
  $('file-info').classList.remove('hidden');
  $('step1-actions').classList.remove('hidden');
}

function resetZone() {
  currentFile = null;
  $('import-zone').classList.remove('hidden');
  $('file-info').classList.add('hidden');
  $('step1-actions').classList.add('hidden');
  $('file-input').value    = '';
  $('camera-input').value  = '';
}

async function checkShareFile() {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open('share-target');
    const match = await cache.match('shared-file');
    if (!match) return null;
    const blob     = await match.blob();
    const filename = match.headers.get('X-File-Name') || 'archivo';
    const filetype = match.headers.get('Content-Type') || blob.type;
    return new File([blob], filename, { type: filetype });
  } catch (_) { return null; }
}

async function clearShareFile() {
  try {
    const cache = await caches.open('share-target');
    await cache.delete('shared-file');
  } catch (_) {}
}

// ---- Scoring ----

function normalizeProvName(s) {
  return (s || '').toLowerCase()
    .replace(/\b(s\.a\.|s\.r\.l\.|s\.a\.s\.|s\.a|s\.r\.l|sa|srl|sas)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function provSimilarity(a, b) {
  const na = normalizeProvName(a);
  const nb = normalizeProvName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (!wa.length || !wb.length) return 0;
  const overlap = wa.filter(w => wb.some(x => x.includes(w) || w.includes(x)));
  return overlap.length / Math.max(wa.length, wb.length);
}

function scoreMatch(extracted, oc) {
  let score = 0;

  // Total: factor principal
  if (extracted.total_documento && oc.total && oc.total > 0) {
    const ratio = Math.abs(extracted.total_documento - oc.total) / oc.total;
    if (ratio <= 0.01)      score += 6;
    else if (ratio <= 0.05) score += 4;
    else if (ratio <= 0.15) score += 2;
    else if (ratio <= 0.30) score += 1;
  }

  // Proveedor
  const sim = provSimilarity(extracted.proveedor, oc.proveedor?.nombre);
  if (sim >= 0.65)      score += 2;
  else if (sim >= 0.3)  score += 1;

  // Fecha reciente
  if (oc.timestamp) {
    const diffDays = Math.abs(Date.now() - oc.timestamp) / 86400000;
    if (diffDays <= 45) score += 1;
  }

  return score;
}

function getTopMatches(extracted, ocs) {
  return ocs
    .map(oc => ({ oc, score: scoreMatch(extracted, oc) }))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// ---- Render ----

function renderMatchCards(matches) {
  return matches.map(({ oc, score }) => {
    const stars = score >= 7 ? '●●●' : score >= 4 ? '●●○' : '●○○';
    return `<div class="adj-oc-card">
      <div class="adj-oc-top">
        <span class="hist-nro">${esc(oc.nroOC)}</span>
        <span class="adj-match-score" title="Nivel de coincidencia">${stars}</span>
        <span class="hist-fecha">${esc(oc.fecha || '')}</span>
      </div>
      <div class="hist-proveedor">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="hist-obra">${esc(oc.obra || '—')}</div>
      <div class="adj-oc-bottom">
        <span class="hist-total">${oc.total != null ? '$ ' + fmtMoney(oc.total) : '—'}</span>
        <button class="btn btn-sm btn-primary btn-adj-attach" data-nro="${esc(oc.nroOC)}">Adjuntar aquí</button>
      </div>
    </div>`;
  }).join('');
}

function renderOCListItems(ocs) {
  if (!ocs.length) return '<div class="hist-empty">No hay OC en el historial.</div>';
  return ocs.map(oc => `<div class="adj-oc-card">
    <div class="adj-oc-top">
      <span class="hist-nro">${esc(oc.nroOC)}</span>
      <span class="hist-fecha">${esc(oc.fecha || '')}</span>
    </div>
    <div class="hist-proveedor">${esc(oc.proveedor?.nombre || '—')}</div>
    <div class="hist-obra">${esc(oc.obra || '—')}</div>
    <div class="adj-oc-bottom">
      <span class="hist-total">${oc.total != null ? '$ ' + fmtMoney(oc.total) : '—'}</span>
      <button class="btn btn-sm btn-primary btn-adj-attach" data-nro="${esc(oc.nroOC)}">Adjuntar aquí</button>
    </div>
  </div>`).join('');
}

function renderManualListHTML(ocs) {
  return `<input type="search" class="hist-search" id="adj-search"
    placeholder="Buscar por proveedor, obra o N° OC…"
    style="margin-bottom:.75rem;width:100%;">
  <div id="adj-oc-list">${renderOCListItems(ocs)}</div>`;
}

function bindButtons() {
  document.querySelectorAll('.btn-adj-attach').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nro = btn.dataset.nro;
      const oc  = allOCs.find(o => o.nroOC === nro);
      if (oc) await doAttach(currentFile, oc, btn);
    });
  });

  const search = $('adj-search');
  if (search) {
    search.addEventListener('input', () => {
      const q      = search.value.toLowerCase().trim();
      const list   = $('adj-oc-list');
      const result = q
        ? allOCs.filter(oc =>
            (oc.proveedor?.nombre || '').toLowerCase().includes(q) ||
            (oc.obra || '').toLowerCase().includes(q) ||
            (oc.nroOC || '').toLowerCase().includes(q))
        : allOCs;
      list.innerHTML = renderOCListItems(result);
      bindButtons();
    });
  }
}

function showAIResults(extracted, matches) {
  $('result-title').textContent = 'Resultados del análisis';

  let html = '<div class="adj-extracted">';
  if (extracted.proveedor)       html += `<span class="adj-tag">${icSvg('building')} ${esc(extracted.proveedor)}</span>`;
  if (extracted.total_documento) html += `<span class="adj-tag">${icSvg('dollar')} $${fmtMoney(extracted.total_documento)}</span>`;
  html += '</div>';

  if (matches.length === 0) {
    html += '<p class="adj-no-match">No se encontraron coincidencias. Elegí una OC manualmente:</p>';
    html += renderManualListHTML(allOCs);
  } else {
    html += '<p class="adj-section-label">OC recomendadas:</p>';
    html += renderMatchCards(matches);
    html += `<div class="adj-manual-fallback">
      <button class="btn btn-outline btn-sm" id="btn-show-manual">Ver todas las OC</button>
    </div>`;
  }

  $('result-body').innerHTML = html;
  bindButtons();

  $('btn-show-manual')?.addEventListener('click', () => {
    $('result-title').textContent = 'Elegir OC';
    $('result-body').innerHTML = renderManualListHTML(allOCs);
    bindButtons();
  });
}

function showManualMode() {
  $('result-title').textContent = 'Elegir OC para adjuntar';
  $('result-body').innerHTML = renderManualListHTML(allOCs);
  bindButtons();
}

// ---- Attach ----

async function doAttach(file, oc, btn) {
  btn.disabled    = true;
  btn.textContent = '⏳ Subiendo…';
  try {
    await attachToDriveOC(file, {
      drive_folder_obras_id:       oc.drive_folder_obras_id       || null,
      drive_folder_proveedores_id: oc.drive_folder_proveedores_id || null,
      drive_folder_id:             oc.drive_folder_id             || null,
      obra:      oc.obra              || '',
      fecha:     displayToISODate(oc.fecha),
      proveedor: oc.proveedor?.nombre || '',
      nroOC:     oc.nroOC
    });
    await clearShareFile();
    $('card-result').classList.add('hidden');
    $('success-detail').textContent = `${file.name} → OC ${oc.nroOC} (${oc.proveedor?.nombre || ''})`;
    $('card-success').classList.remove('hidden');
  } catch (e) {
    toast('Error al subir el archivo a Drive.', 'error');
    console.error('doAttach:', e);
    btn.disabled    = false;
    btn.textContent = 'Adjuntar aquí';
  }
}

// ---- Reset ----

function resetToStart() {
  resetZone();
  $('card-file').classList.remove('hidden');
  $('card-result').classList.add('hidden');
  $('card-success').classList.add('hidden');
}

// ---- Init ----

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  $('hdr-name').textContent = name;
  $('btn-back').addEventListener('click', () => { window.location.href = 'app.html'; });
  $('btn-restart').addEventListener('click', resetToStart);
  $('btn-another').addEventListener('click', resetToStart);

  // Cargar historial en segundo plano
  getHistorial(code)
    .then(ocs => { allOCs = ocs; })
    .catch(() => {
      const cached = typeof getHistorialCached === 'function' ? getHistorialCached(code) : null;
      if (cached) allOCs = cached;
    });

  // Archivo compartido por share target
  const sharedFile = await checkShareFile();
  if (sharedFile) setFile(sharedFile);

  // Botones de selección
  const fileInput   = $('file-input');
  const cameraInput = $('camera-input');

  if ('ontouchstart' in window || window.innerWidth <= 768) {
    $('btn-camera').classList.remove('hidden');
  }

  $('btn-select-file').addEventListener('click', () => fileInput.click());
  $('btn-camera').addEventListener('click', () => cameraInput.click());

  fileInput.addEventListener('change',   () => { if (fileInput.files[0])   setFile(fileInput.files[0]); });
  cameraInput.addEventListener('change', () => { if (cameraInput.files[0]) setFile(cameraInput.files[0]); });

  // Drag & drop (desktop)
  const importZone = $('import-zone');
  importZone.addEventListener('dragover', e => { e.preventDefault(); importZone.classList.add('drag-over'); });
  importZone.addEventListener('dragleave', () => importZone.classList.remove('drag-over'));
  importZone.addEventListener('drop', e => {
    e.preventDefault();
    importZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  $('btn-change-file').addEventListener('click', resetZone);

  $('btn-use-ai').addEventListener('click', async () => {
    if (!currentFile) return;
    $('card-file').classList.add('hidden');
    $('card-result').classList.remove('hidden');
    $('result-title').textContent = 'Analizando con IA…';
    $('result-body').innerHTML    = `<div class="extract-status loading"><div class="spinner"></div> Analizando el documento…</div>`;
    try {
      const extracted = await extractBasicFromFile(currentFile);
      showAIResults(extracted, getTopMatches(extracted, allOCs));
    } catch (e) {
      $('result-title').textContent = 'No se pudo analizar';
      $('result-body').innerHTML    =
        `<div class="extract-status error" style="margin-bottom:1rem;">${esc(e.message)}</div>` +
        renderManualListHTML(allOCs);
      bindButtons();
    }
  });

  $('btn-use-manual').addEventListener('click', () => {
    if (!currentFile) return;
    $('card-file').classList.add('hidden');
    $('card-result').classList.remove('hidden');
    showManualMode();
  });
});
