/* VIMECO S.A. — Personal: configuración (categorías, feriados y padrón) — solo Admin */

const $ = id => document.getElementById(id);

function showToast(msg, type = 'success') {
  const icons = { success: icSvg('checkSm'), error: icSvg('x'), warning: icSvg('alert'), info: icSvg('info') };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || icons.info}</span><span>${msg}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function showConfirm(title, msg) {
  return new Promise(resolve => {
    $('modal-confirm-title').textContent = title;
    $('modal-confirm-msg').textContent   = msg;
    const modal = $('modal-confirm');
    modal.classList.remove('hidden');
    $('modal-confirm-no').onclick  = () => { modal.classList.add('hidden'); resolve(false); };
    $('modal-confirm-yes').onclick = () => { modal.classList.add('hidden'); resolve(true); };
  });
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Texto compuesto de categoría: "Oficial + Horas Extras", "Ayudante + 20%", etc.
function categoriaLabel(p) {
  const parts = [];
  if (p.categoria) parts.push(p.categoria);
  if (p.horasExtra) parts.push('Horas Extras');
  const pct = Number(p.porcentajeExtra) || 0;
  if (pct > 0) parts.push(pct + '%');
  return parts.join(' + ');
}

// ───────────── Categorías ─────────────
let categorias = [];

function renderCategorias() {
  const cont = $('cat-list');
  if (!categorias.length) {
    cont.innerHTML = '<span style="color:var(--gray-500);font-size:.85rem;">Sin categorías. Agregá la primera.</span>';
    return;
  }
  cont.innerHTML = categorias.map((c, i) => `
    <span class="chip">
      <button class="chip-move" data-i="${i}" data-d="-1" title="Subir en la jerarquía" ${i === 0 ? 'disabled' : ''}>‹</button>
      ${esc(c)}
      <button class="chip-move" data-i="${i}" data-d="1" title="Bajar en la jerarquía" ${i === categorias.length - 1 ? 'disabled' : ''}>›</button>
      <button class="chip-del" data-i="${i}" title="Quitar">×</button>
    </span>
  `).join('');
  cont.querySelectorAll('.chip-del').forEach(btn => {
    btn.addEventListener('click', () => removeCategoria(parseInt(btn.dataset.i, 10)));
  });
  cont.querySelectorAll('.chip-move').forEach(btn => {
    btn.addEventListener('click', () => moveCategoria(parseInt(btn.dataset.i, 10), parseInt(btn.dataset.d, 10)));
  });
}

// Mueve una categoría dentro de la jerarquía (d = -1 sube, +1 baja)
async function moveCategoria(i, d) {
  const j = i + d;
  if (j < 0 || j >= categorias.length) return;
  [categorias[i], categorias[j]] = [categorias[j], categorias[i]];
  renderCategorias();
  renderValores();
  try { await saveCategoriasPersonal(categorias); }
  catch (_) { showToast('Error al guardar el orden.', 'error'); }
}

async function addCategoria() {
  const val = $('cat-input').value.trim();
  if (!val) return;
  if (categorias.some(c => c.toLowerCase() === val.toLowerCase())) {
    showToast('Esa categoría ya existe.', 'warning');
    return;
  }
  categorias.push(val);
  $('cat-input').value = '';
  renderCategorias();
  renderValores();
  try { await saveCategoriasPersonal(categorias); showToast('Categoría agregada.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

async function removeCategoria(i) {
  const nombre = categorias[i];
  const ok = await showConfirm('Quitar categoría', `¿Quitar la categoría "${nombre}"?`);
  if (!ok) return;
  categorias.splice(i, 1);
  renderCategorias();
  renderValores();
  try { await saveCategoriasPersonal(categorias); showToast('Categoría quitada.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

// ───────────── Valores por categoría ($/hora, por mes) ─────────────
let valoresMes = {};   // { catKey: valorHora } del mes seleccionado

function mesIsoActual() { return new Date().toISOString().substring(0, 7); }

function mesIsoAnterior(mes) {
  const [y, m] = mes.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function renderValores() {
  const cont = $('val-list');
  if (!categorias.length) {
    cont.innerHTML = '<span style="color:var(--gray-500);font-size:.85rem;">Primero cargá las categorías.</span>';
    return;
  }
  cont.innerHTML = categorias.map(c => {
    const k = sanitizeCatKey(c);
    const v = valoresMes[k];
    return `
      <div class="fer-item">
        <span class="fer-fecha" style="min-width:170px">${esc(c)}</span>
        <span style="color:var(--gray-500);font-size:.85rem;">$/hora</span>
        <input type="number" class="form-control val-input" data-k="${esc(k)}" min="0" step="0.01"
               value="${(v ?? '') === '' ? '' : v}" placeholder="0" style="max-width:140px">
      </div>`;
  }).join('');
}

async function loadValores() {
  const mes = $('val-mes').value || mesIsoActual();
  try { valoresMes = (await getValoresCategorias(mes)) || {}; }
  catch (_) { valoresMes = {}; showToast('Error al cargar los valores.', 'error'); }
  renderValores();
}

async function saveValores() {
  const mes = $('val-mes').value;
  if (!mes) { showToast('Elegí un mes.', 'warning'); return; }
  const out = {};
  $('val-list').querySelectorAll('.val-input').forEach(inp => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) out[inp.dataset.k] = v;
  });
  const btn = $('val-save');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await saveValoresCategorias(mes, out);
    valoresMes = out;
    showToast('Valores guardados.');
  } catch (_) {
    showToast('Error al guardar los valores.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar valores';
  }
}

async function copiarValoresMesAnterior() {
  const mes = $('val-mes').value;
  if (!mes) { showToast('Elegí un mes.', 'warning'); return; }
  const prev = mesIsoAnterior(mes);
  try {
    const vals = (await getValoresCategorias(prev)) || {};
    if (!Object.keys(vals).length) { showToast(`No hay valores cargados en ${prev}.`, 'warning'); return; }
    valoresMes = vals;
    renderValores();
    showToast('Valores copiados. Ajustalos si hace falta y guardá.');
  } catch (_) {
    showToast('Error al copiar los valores.', 'error');
  }
}

// ───────────── Feriados ─────────────
let feriados = {};  // { "YYYY-MM-DD": "Nombre" }

function fmtFecha(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderFeriados() {
  const cont = $('fer-list');
  const fechas = Object.keys(feriados).sort();
  if (!fechas.length) {
    cont.innerHTML = '<span style="color:var(--gray-500);font-size:.85rem;">Sin feriados cargados.</span>';
    return;
  }
  cont.innerHTML = fechas.map(f => `
    <div class="fer-item">
      <span class="fer-fecha">${fmtFecha(f)}</span>
      <span class="fer-nombre">${esc(feriados[f])}</span>
      <button class="btn btn-sm btn-danger" data-f="${f}">Quitar</button>
    </div>
  `).join('');
  cont.querySelectorAll('button[data-f]').forEach(btn => {
    btn.addEventListener('click', () => removeFeriado(btn.dataset.f));
  });
}

async function addFeriado() {
  const fecha  = $('fer-fecha').value;
  const nombre = $('fer-nombre').value.trim();
  if (!fecha)  { showToast('Elegí una fecha.', 'warning'); return; }
  if (!nombre) { showToast('Ingresá el nombre del feriado.', 'warning'); return; }
  feriados[fecha] = nombre;
  $('fer-fecha').value = '';
  $('fer-nombre').value = '';
  renderFeriados();
  try { await saveFeriados(feriados); showToast('Feriado agregado.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

async function removeFeriado(fecha) {
  const ok = await showConfirm('Quitar feriado', `¿Quitar el feriado del ${fmtFecha(fecha)}?`);
  if (!ok) return;
  delete feriados[fecha];
  renderFeriados();
  try { await saveFeriados(feriados); showToast('Feriado quitado.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

// ───────────── Padrón ─────────────
let allPersonal = [];
let obrasMap    = {};   // { obraKey: nombre }
let editingId   = null;
let fotoFrente  = null;
let fotoDorso   = null;

function dniFrente(p) { return p.fotoDniFrente || p.fotoDniUrl || ''; }

function obrasDe(p) {
  const keys = Object.keys(p.obras || {}).filter(k => p.obras[k]);
  const nombres = keys.map(k => obrasMap[k] || k);
  return nombres;
}

function renderPadron() {
  const q = ($('pad-search').value || '').trim().toLowerCase();
  const list = allPersonal.filter(p => {
    if (!q) return true;
    return (`${p.apellido} ${p.nombre}`.toLowerCase().includes(q)) ||
           String(p.dni || '').includes(q);
  });
  $('pad-count').textContent = allPersonal.length ? `(${allPersonal.length})` : '';

  const cont = $('pad-list');
  if (!allPersonal.length) {
    cont.innerHTML = '<div class="hist-empty">El padrón está vacío. Agregá personal acá o desde una obra.</div>';
    return;
  }
  if (!list.length) {
    cont.innerHTML = '<div class="hist-empty">Sin resultados para la búsqueda.</div>';
    return;
  }

  cont.innerHTML = list.map(p => {
    const ini   = (((p.apellido || '')[0] || '') + ((p.nombre || '')[0] || '')).toUpperCase();
    const front = dniFrente(p);
    const av = front
      ? `<div class="pad-avatar"><a href="${esc(front)}" target="_blank" rel="noopener"><img src="${esc(front)}" alt="DNI" onerror="this.parentNode.textContent='${esc(ini)}'"></a></div>`
      : `<div class="pad-avatar">${esc(ini) || icSvg('user')}</div>`;
    const obras = obrasDe(p);
    const obrasTxt = obras.length ? obras.join(', ') : 'sin obra';
    return `
      <div class="pad-item ${p.activo === false ? 'inactivo' : ''}" data-id="${esc(p.id)}">
        ${av}
        <div class="pad-info">
          <div class="pad-name">${esc(p.apellido)}, ${esc(p.nombre)}
            ${p.dniFolderUrl ? `<a href="${esc(p.dniFolderUrl)}" target="_blank" rel="noopener" class="dni-folder" title="Carpeta DNI en Drive">${icSvg('folder')}</a>` : ''}
            ${p.activo === false ? '<span style="font-size:.72rem;color:#b91c1c">(inactivo)</span>' : ''}</div>
          <div class="pad-meta">
            ${categoriaLabel(p) ? `<span class="pad-cat">${esc(categoriaLabel(p))}</span> ` : ''}
            ${p.dni ? `DNI ${esc(p.dni)}` : 'sin DNI'} · Obras: ${esc(obrasTxt)}
          </div>
        </div>
        <div class="pad-actions">
          <button class="btn btn-sm btn-outline btn-edit-p">Editar</button>
          <button class="btn btn-sm ${p.activo === false ? 'btn-success' : 'btn-danger'} btn-toggle-p">${p.activo === false ? 'Activar' : 'Desactivar'}</button>
        </div>
      </div>`;
  }).join('');

  cont.querySelectorAll('.pad-item').forEach(item => {
    const id = item.dataset.id;
    item.querySelector('.btn-edit-p').addEventListener('click',   () => openEditPersonal(id));
    item.querySelector('.btn-toggle-p').addEventListener('click', () => toggleActivo(id));
  });
}

async function loadPadron() {
  try {
    const [personal, obras] = await Promise.all([getPersonal(), getAllObras()]);
    allPersonal = personal;
    obrasMap = {};
    obras.forEach(o => { obrasMap[o.key] = o.nombre; });
    renderPadron();
  } catch (_) {
    $('pad-list').innerHTML = '<div class="hist-empty">Error al cargar el padrón.</div>';
  }
}

function fillCategorias(selected) {
  const sel = $('p-categoria');
  const opts = ['<option value="">— Sin categoría —</option>'];
  const cats = categorias.slice();
  if (selected && !cats.includes(selected)) cats.push(selected);
  cats.forEach(c => opts.push(`<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`));
  sel.innerHTML = opts.join('');
}

function setPreview(elId, url) {
  $(elId).innerHTML = url ? `<img src="${esc(url)}" alt="DNI">` : '';
}

function openAddPersonal() {
  editingId = null; fotoFrente = null; fotoDorso = null;
  $('modal-personal-title').textContent = 'Agregar al padrón';
  $('modal-personal-error').classList.add('hidden');
  $('p-nombre').value = ''; $('p-apellido').value = ''; $('p-dni').value = '';
  $('p-telefono').value = ''; $('p-domicilio').value = '';
  $('p-foto-frente').value = ''; $('p-foto-dorso').value = '';
  fillCategorias('');
  $('p-horas-extra').checked = false;
  $('p-pct-extra').value = '';
  setPreview('p-foto-frente-preview', '');
  setPreview('p-foto-dorso-preview', '');
  $('modal-personal').classList.remove('hidden');
  setTimeout(() => $('p-nombre').focus(), 50);
}

function openEditPersonal(id) {
  const p = allPersonal.find(x => x.id === id);
  if (!p) return;
  editingId = id; fotoFrente = null; fotoDorso = null;
  $('modal-personal-title').textContent = 'Editar personal';
  $('modal-personal-error').classList.add('hidden');
  $('p-nombre').value = p.nombre || ''; $('p-apellido').value = p.apellido || ''; $('p-dni').value = p.dni || '';
  $('p-telefono').value = p.telefono || ''; $('p-domicilio').value = p.domicilio || '';
  $('p-foto-frente').value = ''; $('p-foto-dorso').value = '';
  fillCategorias(p.categoria || '');
  $('p-horas-extra').checked = !!p.horasExtra;
  $('p-pct-extra').value = p.porcentajeExtra || '';
  setPreview('p-foto-frente-preview', dniFrente(p));
  setPreview('p-foto-dorso-preview', p.fotoDniDorso || '');
  $('modal-personal').classList.remove('hidden');
  setTimeout(() => $('p-nombre').focus(), 50);
}

async function savePersonalModal() {
  const nombre   = $('p-nombre').value.trim();
  const apellido = $('p-apellido').value.trim();
  const dni      = $('p-dni').value.trim();
  const telefono  = $('p-telefono').value.trim();
  const domicilio = $('p-domicilio').value.trim();
  const categoria = $('p-categoria').value;
  const horasExtra = $('p-horas-extra').checked;
  const porcentajeExtra = parseFloat($('p-pct-extra').value) || 0;
  const errEl    = $('modal-personal-error');

  if (!nombre || !apellido) {
    errEl.textContent = 'Nombre y apellido son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-personal-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Guardando…';

  try {
    let id = editingId;
    if (editingId) {
      await patchPersonal(editingId, { nombre, apellido, dni, telefono, domicilio, categoria, horasExtra, porcentajeExtra });
    } else {
      id = await savePersonal({ nombre, apellido, dni, telefono, domicilio, categoria, horasExtra, porcentajeExtra, activo: true, fotoDniFrente: '', fotoDniDorso: '', obras: {} });
    }

    if (fotoFrente || fotoDorso) {
      saveBtn.textContent = 'Subiendo fotos…';
      const label = `${apellido} ${nombre} - ${dni || 'sin dni'}`.substring(0, 100);
      const patch = {};
      try {
        if (fotoFrente) { const { url, folderUrl } = await uploadDniToDrive(fotoFrente, { label, lado: 'frente' }); patch.fotoDniFrente = url; patch.fotoDniUrl = url; if (folderUrl) patch.dniFolderUrl = folderUrl; }
        if (fotoDorso)  { const { url, folderUrl } = await uploadDniToDrive(fotoDorso,  { label, lado: 'dorso'  }); patch.fotoDniDorso = url; if (folderUrl && !patch.dniFolderUrl) patch.dniFolderUrl = folderUrl; }
        if (Object.keys(patch).length) await patchPersonal(id, patch);
      } catch (_) {
        if (Object.keys(patch).length) { try { await patchPersonal(id, patch); } catch (_) {} }
        showToast('Se guardó, pero alguna foto del DNI no se pudo subir.', 'warning');
      }
    }

    $('modal-personal').classList.add('hidden');
    showToast(editingId ? 'Personal actualizado.' : 'Personal agregado.');
    await loadPadron();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
  }
}

async function toggleActivo(id) {
  const p = allPersonal.find(x => x.id === id);
  if (!p) return;
  const activar = p.activo === false;
  const ok = await showConfirm(
    activar ? 'Activar personal' : 'Desactivar personal',
    activar ? `¿Activar a ${p.apellido}, ${p.nombre}?`
            : `¿Desactivar a ${p.apellido}, ${p.nombre}? Quedará en el padrón pero marcado como inactivo.`
  );
  if (!ok) return;
  try {
    await patchPersonal(id, { activo: activar });
    showToast(activar ? 'Personal activado.' : 'Personal desactivado.');
    await loadPadron();
  } catch (_) {
    showToast('Error al actualizar.', 'error');
  }
}

// ───────────── Init ─────────────
document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }
  if (_s.codigo !== '0000') { window.location.href = 'menu.html'; return; }

  $('hdr-name').textContent = _s.nombre;
  $('btn-back').addEventListener('click', () => { window.location.href = 'administracion.html'; });
  // Colapsar/expandir secciones
  document.querySelectorAll('.sec-head').forEach(head => {
    head.addEventListener('click', () => head.closest('.sec-card').classList.toggle('collapsed'));
  });

  // Categorías / Feriados
  $('cat-add').addEventListener('click', addCategoria);
  $('cat-input').addEventListener('keydown', e => { if (e.key === 'Enter') addCategoria(); });
  $('fer-add').addEventListener('click', addFeriado);
  $('fer-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') addFeriado(); });

  // Valores por categoría
  $('val-mes').value = mesIsoActual();
  $('val-mes').addEventListener('change', loadValores);
  $('val-save').addEventListener('click', saveValores);
  $('val-copiar').addEventListener('click', copiarValoresMesAnterior);

  // Padrón
  $('pad-search').addEventListener('input', renderPadron);
  $('pad-add').addEventListener('click', openAddPersonal);
  $('modal-personal-close').addEventListener('click',  () => $('modal-personal').classList.add('hidden'));
  $('modal-personal-cancel').addEventListener('click', () => $('modal-personal').classList.add('hidden'));
  $('modal-personal-save').addEventListener('click', savePersonalModal);
  $('p-foto-frente').addEventListener('change', e => {
    fotoFrente = e.target.files[0] || null;
    if (fotoFrente) setPreview('p-foto-frente-preview', URL.createObjectURL(fotoFrente));
  });
  $('p-foto-dorso').addEventListener('change', e => {
    fotoDorso = e.target.files[0] || null;
    if (fotoDorso) setPreview('p-foto-dorso-preview', URL.createObjectURL(fotoDorso));
  });

  try {
    [categorias, feriados] = await Promise.all([getCategoriasPersonal(), getFeriados()]);
  } catch (_) {
    categorias = []; feriados = {};
    showToast('Error al cargar la configuración.', 'error');
  }
  renderCategorias();
  renderFeriados();
  loadValores();
  loadPadron();
});
