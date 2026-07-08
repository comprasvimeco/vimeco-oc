/* VIMECO S.A. — Personal de obra: cuadrilla (Capa 1) */

const $ = id => document.getElementById(id);

function showToast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
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

// ───────── Estado ─────────
const params     = new URLSearchParams(location.search);
const obraKey    = params.get('obra')   || '';
const obraNombre = params.get('nombre') || 'Obra';

let categorias  = [];
let cuadrilla   = [];   // personal asignado a esta obra (objetos completos)
let editingId   = null;
let fotoFrente  = null; // archivo DNI frente elegido en el modal
let fotoDorso   = null; // archivo DNI dorso elegido en el modal

let feriados        = {};   // { "YYYY-MM-DD": "Nombre" }
let partesMeta      = {};   // { "YYYY-MM-DD": { validado, ... } }
let currentQuincena = null; // { year, month(1-12), half(1|2) }
let cierres         = {};   // cache { quincenaId: cierreObj|null }
let constantes      = { jornadaHoras: 8, valorComida: 0 };
let esAdmin         = false;
let sessionCodigo   = '';

let parteFecha    = null;   // "YYYY-MM-DD" abierto en el modal
let parteReadonly = false;  // true si la quincena está cerrada
let parteDiaCond  = '';     // condición general del día abierto: '' | 'F' | 'CC'
let parteAdjuntos = {};     // { personalId: [{ name, url }] } del día abierto
let parteViaticos = {};     // { personalId: [{ monto, motivo, adjunto:{name,url}|null }] }
let viaticoTarget = null;   // personalId al que se le está agregando un viático (modal)
let viaticoFile   = null;   // archivo elegido en el modal de viático

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DOW   = ['L','M','M','J','V','S','D'];
// Estados por persona (parte del día): '' = Presente (según condición del día: '', F o CC),
// AU = Ausente, AC = Accidente, CM = Carpeta Médica. AU/AC/CM ponen horas en 0 y sacan comida.
const CC_HORAS = 2.5;   // horas automáticas para Causas Climáticas
// Jornada legal (UOCRA): lo que exceda de 8 hs/día se paga ×1,5. Es fija:
// la jornada configurada en la obra (p.ej. 10 hs) solo precarga el parte.
const JORNADA_LEGAL = 8;

// Texto compuesto de categoría: "Oficial + Horas Extras", "Ayudante + 20%", etc.
function categoriaLabel(p) {
  const parts = [];
  if (p.categoria) parts.push(p.categoria);
  if (p.horasExtra) parts.push('Horas Extras');
  const pct = Number(p.porcentajeExtra) || 0;
  if (pct > 0) parts.push(pct + '%');
  return parts.join(' + ');
}

// Formatea horas con coma decimal (2.5 → "2,5")
function fmtHoras(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}

// ───────── Cuadrilla ─────────
function dniFrente(p) { return p.fotoDniFrente || p.fotoDniUrl || ''; }

function avatar(p) {
  const ini = ((p.apellido || '')[0] || '') + ((p.nombre || '')[0] || '');
  const front = dniFrente(p);
  if (front) {
    return `<div class="crew-avatar"><a href="${esc(front)}" target="_blank" rel="noopener" title="Ver DNI (frente)"><img src="${esc(front)}" alt="DNI" onerror="this.parentNode.textContent='${esc(ini)}'"></a></div>`;
  }
  return `<div class="crew-avatar">${esc(ini.toUpperCase()) || '👷'}</div>`;
}

// Links a frente/dorso del DNI para la fila
function dniLinks(p) {
  const front = dniFrente(p);
  const back  = p.fotoDniDorso || '';
  const parts = [];
  if (front) parts.push(`<a href="${esc(front)}" target="_blank" rel="noopener">frente</a>`);
  if (back)  parts.push(`<a href="${esc(back)}"  target="_blank" rel="noopener">dorso</a>`);
  return parts.length ? ` · DNI: ${parts.join(' / ')}` : '';
}

function renderCuadrilla() {
  $('crew-count').textContent = cuadrilla.length ? `(${cuadrilla.length})` : '';
  const cont = $('crew-list');
  if (!cuadrilla.length) {
    cont.innerHTML = '<div class="hist-empty">Sin personal en esta obra. Agregá o traé del padrón.</div>';
    return;
  }
  cont.innerHTML = cuadrilla.map(p => `
    <div class="crew-item" data-id="${esc(p.id)}">
      ${avatar(p)}
      <div class="crew-info">
        <div class="crew-name">${esc(p.apellido)}, ${esc(p.nombre)}
          ${p.dniFolderUrl ? `<a href="${esc(p.dniFolderUrl)}" target="_blank" rel="noopener" class="dni-folder" title="Carpeta DNI en Drive">📁</a>` : ''}
        </div>
        <div class="crew-meta">
          ${categoriaLabel(p) ? `<span class="crew-cat">${esc(categoriaLabel(p))}</span> ` : ''}
          ${p.dni ? `DNI ${esc(p.dni)}` : '<span style="color:var(--gray-400)">sin DNI</span>'}
          ${dniLinks(p)}
        </div>
      </div>
      <div class="crew-actions">
        <button class="btn btn-sm btn-outline btn-edit-p">Editar</button>
        <button class="btn btn-sm btn-danger btn-quitar-p">Quitar</button>
      </div>
    </div>
  `).join('');

  cont.querySelectorAll('.crew-item').forEach(item => {
    const id = item.dataset.id;
    item.querySelector('.btn-edit-p').addEventListener('click',   () => openEditPersonal(id));
    item.querySelector('.btn-quitar-p').addEventListener('click', () => quitarDeObra(id));
  });
}

// Orden por jerarquía: posición de la categoría en la lista de config
// (de mayor a menor); sin categoría al final. A igual jerarquía, alfabético.
function ordenJerarquia(list) {
  const rango = p => {
    const i = p.categoria ? categorias.indexOf(p.categoria) : -1;
    return i === -1 ? categorias.length : i;
  };
  return list.slice().sort((a, b) =>
    rango(a) - rango(b) ||
    (a.apellido + a.nombre).localeCompare(b.apellido + b.nombre));
}

async function loadCuadrilla() {
  try {
    cuadrilla = ordenJerarquia(await getPersonalDeObra(obraKey));
    renderCuadrilla();
  } catch (_) {
    $('crew-list').innerHTML = '<div class="hist-empty">Error al cargar la cuadrilla.</div>';
  }
}

// ───────── Modal personal ─────────
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
  editingId  = null;
  fotoFrente = null;
  fotoDorso  = null;
  $('modal-personal-title').textContent = 'Agregar personal';
  $('modal-personal-error').classList.add('hidden');
  $('p-nombre').value = '';
  $('p-apellido').value = '';
  $('p-dni').value = '';
  $('p-telefono').value = '';
  $('p-domicilio').value = '';
  $('p-foto-frente').value = '';
  $('p-foto-dorso').value = '';
  fillCategorias('');
  $('p-horas-extra').checked = false;
  $('p-pct-extra').value = '';
  setPreview('p-foto-frente-preview', '');
  setPreview('p-foto-dorso-preview', '');
  $('modal-personal').classList.remove('hidden');
  setTimeout(() => $('p-nombre').focus(), 50);
}

function openEditPersonal(id) {
  const p = cuadrilla.find(x => x.id === id);
  if (!p) return;
  editingId  = id;
  fotoFrente = null;
  fotoDorso  = null;
  $('modal-personal-title').textContent = 'Editar personal';
  $('modal-personal-error').classList.add('hidden');
  $('p-nombre').value   = p.nombre || '';
  $('p-apellido').value = p.apellido || '';
  $('p-dni').value      = p.dni || '';
  $('p-telefono').value  = p.telefono || '';
  $('p-domicilio').value = p.domicilio || '';
  $('p-foto-frente').value = '';
  $('p-foto-dorso').value = '';
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
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    let id = editingId;
    if (editingId) {
      await patchPersonal(editingId, { nombre, apellido, dni, telefono, domicilio, categoria, horasExtra, porcentajeExtra });
    } else {
      id = await savePersonal({
        nombre, apellido, dni, telefono, domicilio, categoria, horasExtra, porcentajeExtra,
        activo: true,
        fotoDniFrente: '', fotoDniDorso: '',
        obras: { [obraKey]: true }
      });
    }

    // Subir fotos DNI (frente/dorso, opcionales). Si falla, se guarda igual y avisamos.
    if (fotoFrente || fotoDorso) {
      saveBtn.textContent = 'Subiendo fotos…';
      const label = `${apellido} ${nombre} - ${dni || 'sin dni'}`.substring(0, 100);
      const patch = {};
      try {
        if (fotoFrente) {
          const { url, folderUrl } = await uploadDniToDrive(fotoFrente, { label, lado: 'frente' });
          patch.fotoDniFrente = url;
          patch.fotoDniUrl    = url;   // compat con lector viejo
          if (folderUrl) patch.dniFolderUrl = folderUrl;
        }
        if (fotoDorso) {
          const { url, folderUrl } = await uploadDniToDrive(fotoDorso, { label, lado: 'dorso' });
          patch.fotoDniDorso = url;
          if (folderUrl && !patch.dniFolderUrl) patch.dniFolderUrl = folderUrl;
        }
        if (Object.keys(patch).length) await patchPersonal(id, patch);
      } catch (_) {
        if (Object.keys(patch).length) { try { await patchPersonal(id, patch); } catch (_) {} }
        showToast('Se guardó, pero alguna foto del DNI no se pudo subir.', 'warning');
      }
    }

    $('modal-personal').classList.add('hidden');
    showToast(editingId ? 'Personal actualizado.' : 'Personal agregado.');
    await loadCuadrilla();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function quitarDeObra(id) {
  const p = cuadrilla.find(x => x.id === id);
  if (!p) return;
  const ok = await showConfirm(
    'Quitar de la obra',
    `¿Quitar a ${p.apellido}, ${p.nombre} de esta obra? Seguirá en el padrón y podés volver a traerlo.`
  );
  if (!ok) return;
  const nuevasObras = { ...(p.obras || {}) };
  delete nuevasObras[obraKey];
  try {
    await patchPersonal(id, { obras: nuevasObras });
    showToast('Quitado de la obra.');
    await loadCuadrilla();
  } catch (_) {
    showToast('Error al quitar de la obra.', 'error');
  }
}

// ───────── Traer del padrón ─────────
async function openPadron() {
  $('modal-padron').classList.remove('hidden');
  const cont = $('padron-list');
  cont.innerHTML = '<div class="hist-loading">Cargando padrón…</div>';
  try {
    const all = await getPersonal();
    const disponibles = all.filter(p => !(p.obras && p.obras[obraKey]));
    if (!disponibles.length) {
      cont.innerHTML = '<div class="hist-empty">No hay personal disponible en el padrón.</div>';
      return;
    }
    cont.innerHTML = disponibles.map(p => `
      <div class="crew-item" data-id="${esc(p.id)}">
        <div class="crew-info">
          <div class="crew-name">${esc(p.apellido)}, ${esc(p.nombre)}</div>
          <div class="crew-meta">${p.categoria ? esc(p.categoria) + ' · ' : ''}${p.dni ? 'DNI ' + esc(p.dni) : ''}</div>
        </div>
        <button class="btn btn-sm btn-success btn-asignar">Asignar</button>
      </div>
    `).join('');
    cont.querySelectorAll('.crew-item').forEach(item => {
      const id = item.dataset.id;
      const p  = disponibles.find(x => x.id === id);
      item.querySelector('.btn-asignar').addEventListener('click', () => asignarDelPadron(p, item));
    });
  } catch (_) {
    cont.innerHTML = '<div class="hist-empty">Error al cargar el padrón.</div>';
  }
}

async function asignarDelPadron(p, item) {
  const btn = item.querySelector('.btn-asignar');
  btn.disabled = true; btn.textContent = 'Asignando…';
  const nuevasObras = { ...(p.obras || {}), [obraKey]: true };
  try {
    await patchPersonal(p.id, { obras: nuevasObras });
    item.remove();
    showToast(`${p.apellido}, ${p.nombre} asignado.`);
    await loadCuadrilla();
  } catch (_) {
    btn.disabled = false; btn.textContent = 'Asignar';
    showToast('Error al asignar.', 'error');
  }
}

// ───────── Calendario de quincena ─────────
function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(year, month, day) { return `${year}-${pad2(month)}-${pad2(day)}`; }

function getQuincena(date) {
  return { year: date.getFullYear(), month: date.getMonth() + 1, half: date.getDate() <= 15 ? 1 : 2 };
}
function ultimoDiaMes(year, month) { return new Date(year, month, 0).getDate(); }
function quincenaRange(q) {
  return {
    startDay: q.half === 1 ? 1 : 16,
    endDay:   q.half === 1 ? 15 : ultimoDiaMes(q.year, q.month)
  };
}
function quincenaId(q) { return `${q.year}-${pad2(q.month)}-Q${q.half}`; }
function quincenaLabel(q) {
  const r = quincenaRange(q);
  return `${r.startDay}–${r.endDay} ${MESES[q.month - 1]} ${q.year}`;
}
function prevQuincena(q) {
  if (q.half === 2) return { year: q.year, month: q.month, half: 1 };
  const m = q.month === 1 ? 12 : q.month - 1;
  const y = q.month === 1 ? q.year - 1 : q.year;
  return { year: y, month: m, half: 2 };
}
function nextQuincena(q) {
  if (q.half === 1) return { year: q.year, month: q.month, half: 2 };
  const m = q.month === 12 ? 1 : q.month + 1;
  const y = q.month === 12 ? q.year + 1 : q.year;
  return { year: y, month: m, half: 1 };
}

function renderCalendar() {
  const q     = currentQuincena;
  const range = quincenaRange(q);
  const hoyIso = (() => { const d = new Date(); return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate()); })();

  // Alineación: lunes primero (getDay: 0=Dom..6=Sáb → (getDay+6)%7 → 0=Lun)
  const primerDow = (new Date(q.year, q.month - 1, range.startDay).getDay() + 6) % 7;

  let celdas = '';
  for (let i = 0; i < primerDow; i++) celdas += '<div class="cal-day empty"></div>';

  for (let d = range.startDay; d <= range.endDay; d++) {
    const iso   = isoDate(q.year, q.month, d);
    const dow   = (new Date(q.year, q.month - 1, d).getDay() + 6) % 7; // 5=Sáb,6=Dom
    const finde = dow >= 5;
    const ferNombre = feriados[iso];
    const validado  = partesMeta[iso] && partesMeta[iso].validado;

    const clases = ['cal-day'];
    if (finde || ferNombre) clases.push('nolab');
    if (ferNombre)          clases.push('feriado');
    if (validado)           clases.push('validado');
    if (iso === hoyIso)     clases.push('today');

    const badge = validado
      ? '<span class="cal-badge ok">✓</span>'
      : (finde || ferNombre ? '' : '<span class="cal-badge pend">•</span>');
    const fmark = ferNombre ? `<span class="cal-fmark" title="${esc(ferNombre)}">F</span>` : '';

    celdas += `<div class="${clases.join(' ')}" data-iso="${iso}" title="${ferNombre ? esc(ferNombre) : ''}">
      ${fmark}<span class="cal-daynum">${d}</span>${badge}
    </div>`;
  }

  // Estado de cierre y días laborables pendientes de validar
  const qid     = quincenaId(q);
  const cerrada = !!(cierres[qid] && cierres[qid].cerrado);
  const laborables = diasLaborables(q);
  const faltantes  = laborables.filter(iso => !(partesMeta[iso] && partesMeta[iso].validado)).length;

  // "Ver planilla" (preview) siempre disponible; "Excel RRHH" solo con la quincena cerrada.
  const btnPreview = '<button class="btn btn-sm btn-outline" id="btn-excel-preview">👁 Ver planilla</button>';
  const btnExcel   = '<button class="btn btn-sm btn-outline" id="btn-excel-rrhh">📊 Excel RRHH</button>';
  let cierreHtml;
  if (cerrada) {
    cierreHtml = `
      <span class="cierre-msg">✓ Quincena cerrada. Solo lectura.</span>
      ${btnPreview}${btnExcel}
      ${esAdmin ? '<button class="btn btn-sm btn-warning" id="btn-reabrir">Reabrir quincena</button>' : ''}`;
  } else if (faltantes > 0) {
    cierreHtml = `
      <span class="cierre-msg">Faltan validar ${faltantes} día(s) laborable(s) para poder cerrar.</span>
      ${btnPreview}
      <button class="btn btn-sm btn-primary" id="btn-cerrar" disabled>Cerrar quincena</button>`;
  } else {
    cierreHtml = `
      <span class="cierre-msg">Todos los días laborables están validados. Cerrá la quincena para enviar el Excel a RRHH.</span>
      ${btnPreview}
      <button class="btn btn-sm btn-primary" id="btn-cerrar">Cerrar quincena</button>`;
  }

  $('cal-container').innerHTML = `
    <div class="cal-nav">
      <button class="btn btn-sm btn-outline" id="cal-prev"><svg class="icon" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
      <span class="cal-label">${quincenaLabel(q)}</span>
      <button class="btn btn-sm btn-outline" id="cal-next"><svg class="icon" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
    </div>
    <div class="cal-grid">
      ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      ${celdas}
    </div>
    <div class="cal-legend">
      <span><span class="cal-swatch" style="background:#fff"></span> Laborable</span>
      <span><span class="cal-swatch" style="background:var(--gray-100)"></span> No laborable</span>
      <span><span class="cal-swatch" style="background:#fdf1e7"></span> Feriado (F)</span>
      <span><span class="cal-badge ok">✓</span> Validado</span>
      <span><span class="cal-badge pend">•</span> Pendiente</span>
    </div>
    <div class="cierre-bar">${cierreHtml}</div>
  `;

  $('cal-prev').addEventListener('click', () => { currentQuincena = prevQuincena(q); showQuincena(); });
  $('cal-next').addEventListener('click', () => { currentQuincena = nextQuincena(q); showQuincena(); });
  $('cal-container').querySelectorAll('.cal-day[data-iso]').forEach(cell => {
    cell.addEventListener('click', () => onDayClick(cell.dataset.iso));
  });
  $('btn-cerrar')?.addEventListener('click', cerrarQuincenaActual);
  $('btn-reabrir')?.addEventListener('click', reabrirQuincenaActual);
  $('btn-excel-rrhh')?.addEventListener('click', onExcelRRHH);
  $('btn-excel-preview')?.addEventListener('click', onExcelPreview);
}

// Días laborables (lun-vie no feriados) de la quincena
function diasLaborables(q) {
  const range = quincenaRange(q);
  const out = [];
  for (let d = range.startDay; d <= range.endDay; d++) {
    const iso = isoDate(q.year, q.month, d);
    const dow = (new Date(q.year, q.month - 1, d).getDay() + 6) % 7;
    if (dow < 5 && !feriados[iso]) out.push(iso);
  }
  return out;
}

// Carga (cacheada) el cierre de la quincena actual y re-renderiza
async function showQuincena() {
  const qid = quincenaId(currentQuincena);
  if (cierres[qid] === undefined) {
    try { cierres[qid] = await getCierre(obraKey, qid); }
    catch (_) { cierres[qid] = null; }
  }
  renderCalendar();
}

async function cerrarQuincenaActual() {
  const q   = currentQuincena;
  const qid = quincenaId(q);
  const ok  = await showConfirm(
    'Cerrar quincena',
    `¿Cerrar la quincena ${quincenaLabel(q)}? Quedará en solo lectura. ${esAdmin ? 'Podés reabrirla luego.' : 'Solo un administrador podrá reabrirla.'}`
  );
  if (!ok) return;
  try {
    await cerrarQuincena(obraKey, qid, sessionCodigo);
    cierres[qid] = { cerrado: true, cerradoPor: sessionCodigo, cerradoEn: Date.now() };
    showToast('Quincena cerrada. Generando Excel de RRHH…');
    renderCalendar();
    // Generar y subir el reporte a Drive en segundo plano (no bloquea el cierre)
    generarReporte(q, { silencioso: false }).catch(() => {});
  } catch (_) {
    showToast('Error al cerrar la quincena.', 'error');
  }
}

async function reabrirQuincenaActual() {
  const q   = currentQuincena;
  const qid = quincenaId(q);
  const ok  = await showConfirm('Reabrir quincena', `¿Reabrir la quincena ${quincenaLabel(q)} para poder editarla?`);
  if (!ok) return;
  try {
    await reabrirQuincena(obraKey, qid);
    cierres[qid] = null;
    showToast('Quincena reabierta.');
    renderCalendar();
  } catch (_) {
    showToast('Error al reabrir la quincena.', 'error');
  }
}

async function loadCalendarData() {
  try {
    [feriados, partesMeta] = await Promise.all([getFeriados(), getPartesMeta(obraKey)]);
  } catch (_) {
    feriados = {}; partesMeta = {};
  }
  currentQuincena = getQuincena(new Date());
  await showQuincena();
}

// ───────── Parte del día ─────────
function fmtFechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const dow  = new Date(y, m - 1, d).getDay();
  return `${dias[dow]} ${d}/${pad2(m)}/${y}`;
}

function esFinde(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) >= 5;  // 5=Sáb, 6=Dom
}

async function onDayClick(iso) {
  parteFecha = iso;
  const q       = currentQuincena;
  const cerrada = !!(cierres[quincenaId(q)] && cierres[quincenaId(q)].cerrado);
  parteReadonly = cerrada;
  const finde   = esFinde(iso);
  const ferNom  = feriados[iso];
  const noLab   = finde || !!ferNom;

  if (!cuadrilla.length) {
    showToast('Primero agregá personal a la cuadrilla.', 'warning');
    return;
  }

  // Nota informativa
  let nota = `Jornada de la obra: <strong>${constantes.jornadaHoras} h</strong>.`;
  if (ferNom)      nota += ` Feriado: <strong>${esc(ferNom)}</strong> (no laborable salvo que se carguen horas).`;
  else if (finde)  nota += ' Fin de semana (no laborable salvo que se carguen horas).';
  if (cerrada)     nota += ' <span class="parte-cerrada">Quincena cerrada — solo lectura.</span>';
  $('parte-info').innerHTML = nota;
  $('parte-title').textContent = 'Parte — ' + fmtFechaLarga(iso);

  // Cargar parte existente o precargar por defecto
  let parte;
  try { parte = await getParte(obraKey, iso); }
  catch (_) { parte = { items: {}, _meta: { validado: false } }; }
  const items = parte.items || {};

  // Reiniciar adjuntos y viáticos del día con lo guardado
  parteAdjuntos = {};
  parteViaticos = {};
  cuadrilla.forEach(p => {
    const g = items[p.id];
    parteAdjuntos[p.id] = (g && Array.isArray(g.adjuntos)) ? g.adjuntos.slice() : [];
    // Compat: dato viejo guardaba un único viatico numérico → lo migramos a un evento
    if (g && Array.isArray(g.viaticos)) {
      parteViaticos[p.id] = g.viaticos.map(v => ({ ...v }));
    } else if (g && (Number(g.viatico) || 0) > 0) {
      parteViaticos[p.id] = [{ monto: Number(g.viatico), motivo: '', adjunto: null }];
    } else {
      parteViaticos[p.id] = [];
    }
  });

  // Condición del día para presentes ('', F o CC): feriado del calendario o CC guardado.
  parteDiaCond = ferNom ? 'F' : '';
  cuadrilla.forEach(p => {
    const g = items[p.id];
    if (g && (g.estado === 'CC' || g.estado === 'F')) parteDiaCond = g.estado;
  });
  // El selector general puede mostrar "Ausente (todos)" si toda la cuadrilla está ausente.
  const savedAll      = cuadrilla.length > 0 && cuadrilla.every(p => items[p.id]);
  const todosAusentes = savedAll && cuadrilla.every(p => (items[p.id].estado || '') === 'AU');
  const initCond      = todosAusentes ? 'AU' : parteDiaCond;

  const genHorasInit  = initCond === 'CC' ? CC_HORAS : (initCond === '' && !noLab ? constantes.jornadaHoras : 0);
  const genComidaInit = initCond === '' && !noLab;

  // Sección general (aplica a toda la cuadrilla)
  $('parte-general').innerHTML = `
    <div class="pg-title">⚙️ General · toda la cuadrilla</div>
    <div class="pg-fields">
      <div class="pf">
        <label>Condición del día</label>
        <select class="form-control" id="pg-cond">
          <option value="">Normal</option>
          <option value="F">Feriado</option>
          <option value="CC">CC · Causas climáticas</option>
          <option value="AU">Ausente (todos)</option>
        </select>
      </div>
      <div class="pf">
        <label>Horas (todos)</label>
        <input type="number" class="form-control" id="pg-horas" min="0" max="24" step="0.5" value="${genHorasInit}">
      </div>
      <div class="pf pf-comida">
        <input type="checkbox" id="pg-comida" ${genComidaInit ? 'checked' : ''}>
        <label style="margin:0">Comida (todos)</label>
      </div>
    </div>
    <div class="pg-note">Un cambio acá se aplica a toda la cuadrilla. Abajo marcá las excepciones por persona.</div>`;
  $('pg-cond').value = initCond;

  // Estado por persona → botón activo:
  //   Presente = '', 'F' o 'CC' (según la condición del día) · Ausente 'AU' · Accidente 'AC' · Carpeta Médica 'CM'
  const esPresente = e => e === '' || e === 'F' || e === 'CC';

  $('parte-list').innerHTML = cuadrilla.map(p => {
    const guardado = items[p.id];
    const estado  = guardado ? (guardado.estado || '') : parteDiaCond;
    const horas   = guardado ? (guardado.horas ?? 0) : genHorasInit;
    const comida  = guardado ? !!guardado.comida  : genComidaInit;
    const catTxt  = categoriaLabel(p);
    const act = e => (e === 'presente' ? (esPresente(estado) ? 'active' : '') : (estado === e ? 'active' : ''));
    return `
      <div class="parte-row" data-id="${esc(p.id)}" data-estado="${esc(estado)}">
        <div class="parte-row-head">${esc(p.apellido)}, ${esc(p.nombre)}
          ${catTxt ? `<span class="crew-cat">${esc(catTxt)}</span>` : ''}</div>
        <div class="estado-btns">
          <button type="button" class="eb ${act('presente')}" data-e="presente">Presente</button>
          <button type="button" class="eb ${act('AU')}" data-e="AU">Ausente</button>
          <button type="button" class="eb ${act('AC')}" data-e="AC">Accidente</button>
          <button type="button" class="eb ${act('CM')}" data-e="CM">Carpeta Médica</button>
        </div>
        <div class="parte-fields">
          <div class="pf">
            <label>Horas</label>
            <input type="number" class="form-control pf-horas" min="0" max="24" step="0.5" value="${horas}">
          </div>
          <div class="pf pf-comida">
            <input type="checkbox" class="pf-comidachk" ${comida ? 'checked' : ''}>
            <label style="margin:0">Comida</label>
          </div>
          <div class="pf pf-viaticos">
            <label>Viáticos</label>
            <div class="viat-list" data-id="${esc(p.id)}"></div>
            <button type="button" class="btn btn-sm btn-outline viat-add" style="align-self:flex-start">+ Viático</button>
          </div>
          <div class="pf pf-adjuntos">
            <label>Adjuntos (certificados médicos, pasajes…)</label>
            <div class="adj-list" data-id="${esc(p.id)}"></div>
            <input type="file" class="adj-input" accept="image/*,application/pdf" style="display:none">
            <button type="button" class="btn btn-sm btn-outline adj-btn" style="align-self:flex-start">📎 Adjuntar</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Adjuntos + viáticos: render inicial + wiring por fila
  $('parte-list').querySelectorAll('.parte-row').forEach(row => {
    const id    = row.dataset.id;
    const input = row.querySelector('.adj-input');
    const btn   = row.querySelector('.adj-btn');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) subirAdjunto(id, f, btn);
      input.value = '';
    });
    row.querySelector('.viat-add').addEventListener('click', () => openViatico(id));
    renderAdjuntos(id);
    renderViaticos(id);
  });

  // Botones de estado por persona
  $('parte-list').querySelectorAll('.parte-row').forEach(row => {
    row.querySelectorAll('.eb').forEach(btn => {
      btn.addEventListener('click', () => setRowEstado(row, btn.dataset.e));
    });
  });

  // Controles generales.
  // Cambiar la CONDICIÓN del día es una acción masiva (aplica a toda la cuadrilla);
  // tocar solo horas/comida afecta únicamente a los presentes.
  $('pg-cond').addEventListener('change', () => {
    const c = $('pg-cond').value;
    if (c === 'CC')      { $('pg-horas').value = CC_HORAS; $('pg-comida').checked = false; }
    else if (c === 'F')  { $('pg-horas').value = 0;        $('pg-comida').checked = false; }
    else if (c === 'AU') { $('pg-horas').value = 0;        $('pg-comida').checked = false; }
    else                 { $('pg-horas').value = constantes.jornadaHoras ?? 8; $('pg-comida').checked = true; }
    applyCondToAll();
  });
  $('pg-horas').addEventListener('input', applyHorasComidaPresentes);
  $('pg-comida').addEventListener('change', applyHorasComidaPresentes);

  // Modo lectura si la quincena está cerrada
  const inputs = $('parte-list').querySelectorAll('input, select, .eb');
  inputs.forEach(el => { el.disabled = cerrada; });
  $('parte-general').querySelectorAll('input, select').forEach(el => { el.disabled = cerrada; });
  $('parte-list').querySelectorAll('.adj-btn, .viat-add').forEach(b => { b.style.display = cerrada ? 'none' : ''; });
  $('parte-footer').style.display = cerrada ? 'none' : '';

  // Botón validar: refleja estado actual del día
  const validado = partesMeta[iso] && partesMeta[iso].validado;
  const btnVal = $('parte-validar');
  btnVal.textContent = validado ? '↺ Quitar validación' : '✓ Validar día';
  btnVal.className   = validado ? 'btn btn-warning' : 'btn btn-success';

  $('modal-parte').classList.remove('hidden');
}

// Cambia el estado de una fila (persona) desde los botones.
//   'presente' → toma la condición del día ('', F o CC) + horas/comida generales
//   'AU' | 'AC' | 'CM' → pone horas en 0 y saca la comida
function setRowEstado(row, kind) {
  const horasInp  = row.querySelector('.pf-horas');
  const comidaChk = row.querySelector('.pf-comidachk');
  let estado;
  if (kind === 'presente') {
    estado = parteDiaCond;                       // '', F o CC
    horasInp.value    = parseFloat($('pg-horas').value) || 0;
    comidaChk.checked = $('pg-comida').checked;
  } else {
    estado = kind;                               // AU, AC o CM
    horasInp.value    = 0;
    comidaChk.checked = false;
  }
  row.dataset.estado = estado;
  const presente = estado === '' || estado === 'F' || estado === 'CC';
  row.querySelectorAll('.eb').forEach(b => {
    const active = (b.dataset.e === 'presente') ? presente : (b.dataset.e === estado);
    b.classList.toggle('active', active);
  });
}

// Cambio de CONDICIÓN del día (acción masiva sobre toda la cuadrilla).
//   Ausente (todos): marca AU a todos (incluye accidente/carpeta médica).
//   Normal/Feriado/CC: pone a todos como Presente con esa condición,
//   preservando Accidente y Carpeta Médica (excepciones médicas reales).
function applyCondToAll() {
  const cond = $('pg-cond').value;
  const rows = $('parte-list').querySelectorAll('.parte-row');
  if (cond === 'AU') {
    parteDiaCond = '';   // si luego marcan Presente a alguien, queda normal
    rows.forEach(row => setRowEstado(row, 'AU'));
    return;
  }
  parteDiaCond = cond;   // '', F o CC
  rows.forEach(row => {
    const e = row.dataset.estado;
    if (e === 'AC' || e === 'CM') return;   // preservar accidente / carpeta médica
    setRowEstado(row, 'presente');          // presentes y ausentes → presente con la condición
  });
}

// Cambio de HORAS/COMIDA generales: solo afecta a los presentes.
function applyHorasComidaPresentes() {
  const genHoras  = parseFloat($('pg-horas').value) || 0;
  const genComida = $('pg-comida').checked;
  $('parte-list').querySelectorAll('.parte-row').forEach(row => {
    const e = row.dataset.estado;
    if (e === 'AU' || e === 'AC' || e === 'CM') return;   // excepción por persona
    row.querySelector('.pf-horas').value       = genHoras;
    row.querySelector('.pf-comidachk').checked = genComida;
  });
}

function recolectarItems() {
  const items = {};
  $('parte-list').querySelectorAll('.parte-row').forEach(row => {
    const id = row.dataset.id;
    const adjuntos = parteAdjuntos[id] || [];
    items[id] = {
      horas:    parseFloat(row.querySelector('.pf-horas').value) || 0,
      comida:   row.querySelector('.pf-comidachk').checked,
      estado:   row.dataset.estado || '',
      viaticos: parteViaticos[id] || [],
      adjuntos
    };
  });
  return items;
}

async function guardarParte(silencioso) {
  const items = recolectarItems();
  await saveParteDia(obraKey, parteFecha, items);
  if (!silencioso) showToast('Parte guardado.');
}

async function onGuardarParte() {
  const btn = $('parte-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await guardarParte(false);
    $('modal-parte').classList.add('hidden');
  } catch (_) {
    showToast('Error al guardar el parte.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

async function onValidarDia() {
  const iso = parteFecha;
  const yaValidado = partesMeta[iso] && partesMeta[iso].validado;
  const btn = $('parte-validar');
  btn.disabled = true;
  try {
    if (yaValidado) {
      await setValidadoDia(obraKey, iso, false, sessionCodigo);
      partesMeta[iso] = { validado: false };
      showToast('Validación quitada.');
    } else {
      await guardarParte(true);                       // persistir lo cargado
      await setValidadoDia(obraKey, iso, true, sessionCodigo);
      partesMeta[iso] = { validado: true, validadoPor: sessionCodigo, validadoEn: Date.now() };
      showToast('Día validado.');
    }
    $('modal-parte').classList.add('hidden');
    renderCalendar();
  } catch (_) {
    showToast('Error al actualizar la validación.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ───────── Configuración de la obra ─────────
function updateCfgBar() {
  $('cfg-jornada').textContent = constantes.jornadaHoras ?? 0;
  $('cfg-comida').textContent  = constantes.valorComida ?? 0;
}

function openConfigObra() {
  $('modal-config-error').classList.add('hidden');
  $('cfg-jornada-input').value = constantes.jornadaHoras ?? 8;
  $('cfg-comida-input').value  = constantes.valorComida ?? 0;
  $('modal-config-obra').classList.remove('hidden');
}

async function saveConfigObra() {
  const jornadaHoras = parseFloat($('cfg-jornada-input').value);
  const valorComida  = parseFloat($('cfg-comida-input').value) || 0;
  const errEl = $('modal-config-error');
  if (isNaN(jornadaHoras) || jornadaHoras < 0) {
    errEl.textContent = 'Ingresá una jornada válida.';
    errEl.classList.remove('hidden');
    return;
  }
  const btn = $('modal-config-save');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await patchConstantesObra(obraKey, { jornadaHoras, valorComida });
    constantes = { ...constantes, jornadaHoras, valorComida };
    updateCfgBar();
    $('modal-config-obra').classList.add('hidden');
    showToast('Configuración guardada.');
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

// ───────── Adjuntos del parte ─────────
function renderAdjuntos(id) {
  const cont = $('parte-list').querySelector(`.adj-list[data-id="${id}"]`);
  if (!cont) return;
  const list = parteAdjuntos[id] || [];
  cont.innerHTML = list.map((a, i) => `
    <span class="adj-chip">
      <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>
      ${parteReadonly ? '' : `<button data-id="${esc(id)}" data-i="${i}" title="Quitar">×</button>`}
    </span>`).join('');
  cont.querySelectorAll('button[data-i]').forEach(b =>
    b.addEventListener('click', () => {
      (parteAdjuntos[id] || []).splice(parseInt(b.dataset.i, 10), 1);
      renderAdjuntos(id);
    }));
}

async function subirAdjunto(id, file, btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Subiendo…';
  try {
    const p = cuadrilla.find(x => x.id === id);
    const persona = p ? `${p.apellido} ${p.nombre}` : id;
    const { url, name } = await uploadComprobantePersonal(file, { obra: obraNombre, fecha: parteFecha, persona });
    parteAdjuntos[id] = parteAdjuntos[id] || [];
    parteAdjuntos[id].push({ name, url });
    renderAdjuntos(id);
    showToast('Archivo adjuntado.');
  } catch (_) {
    showToast('No se pudo subir el archivo.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

// ───────── Viáticos del parte ─────────
function renderViaticos(id) {
  const cont = $('parte-list').querySelector(`.viat-list[data-id="${id}"]`);
  if (!cont) return;
  const list = parteViaticos[id] || [];
  if (!list.length) { cont.innerHTML = '<span class="viat-empty">Sin viáticos.</span>'; return; }
  cont.innerHTML = list.map((v, i) => `
    <span class="viat-chip">
      <span class="viat-monto">$${Number(v.monto || 0).toLocaleString('es-AR')}</span>
      <span class="viat-motivo">${esc(v.motivo || 'Sin motivo')}</span>
      ${v.adjunto && v.adjunto.url ? `<a href="${esc(v.adjunto.url)}" target="_blank" rel="noopener" title="Ver adjunto">📎</a>` : ''}
      ${parteReadonly ? '' : `<button data-id="${esc(id)}" data-i="${i}" title="Quitar">×</button>`}
    </span>`).join('');
  cont.querySelectorAll('button[data-i]').forEach(b =>
    b.addEventListener('click', () => {
      (parteViaticos[id] || []).splice(parseInt(b.dataset.i, 10), 1);
      renderViaticos(id);
    }));
}

function openViatico(id) {
  viaticoTarget = id;
  viaticoFile   = null;
  const p = cuadrilla.find(x => x.id === id);
  $('modal-viatico-title').textContent = p ? `Viático — ${p.apellido}, ${p.nombre}` : 'Viático';
  $('modal-viatico-error').classList.add('hidden');
  $('v-monto').value = '';
  $('v-motivo').value = '';
  $('v-file').value = '';
  $('v-file-name').textContent = '';
  $('modal-viatico').classList.remove('hidden');
  setTimeout(() => $('v-monto').focus(), 50);
}

async function saveViatico() {
  const monto  = parseFloat($('v-monto').value);
  const motivo = $('v-motivo').value.trim();
  const errEl  = $('modal-viatico-error');
  if (isNaN(monto) || monto <= 0) { errEl.textContent = 'Ingresá un monto válido.'; errEl.classList.remove('hidden'); return; }
  if (!motivo)                    { errEl.textContent = 'Ingresá el motivo del viático.'; errEl.classList.remove('hidden'); return; }

  const btn = $('modal-viatico-save');
  btn.disabled = true; btn.textContent = 'Guardando…';
  let adjunto = null;
  try {
    if (viaticoFile) {
      btn.textContent = 'Subiendo…';
      const p = cuadrilla.find(x => x.id === viaticoTarget);
      const persona = p ? `${p.apellido} ${p.nombre}` : viaticoTarget;
      const { url, name } = await uploadComprobantePersonal(viaticoFile, { obra: obraNombre, fecha: parteFecha, persona });
      adjunto = { name, url };
    }
    parteViaticos[viaticoTarget] = parteViaticos[viaticoTarget] || [];
    parteViaticos[viaticoTarget].push({ monto, motivo, adjunto });
    renderViaticos(viaticoTarget);
    $('modal-viatico').classList.add('hidden');
    showToast('Viático agregado.');
  } catch (_) {
    errEl.textContent = 'No se pudo subir el adjunto. Probá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Agregar';
  }
}

// ───────── Reporte de quincena (Excel para RRHH) ─────────
const DOW_ABBR = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

async function ensureXLSX() {
  if (window.XLSX) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // xlsx-js-style: fork de SheetJS que sí escribe estilos (fills/fonts/borders) al exportar .xlsx
    s.src     = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Construye el libro de la quincena q → { wb, ws, fname } (sin serializar)
async function buildReporteWorkbook(q) {
  await ensureXLSX();

  const range = quincenaRange(q);
  const dias  = [];
  for (let d = range.startDay; d <= range.endDay; d++) {
    const iso = isoDate(q.year, q.month, d);
    const dow = new Date(q.year, q.month - 1, d).getDay(); // 0=Dom..6=Sáb
    dias.push({ d, iso, dow, finde: dow === 0 || dow === 6, feriado: !!feriados[iso] });
  }
  const N = dias.length;

  let partes = {};
  try { partes = await getPartesRango(obraKey, dias[0].iso, dias[N - 1].iso); } catch (_) {}

  const crew = cuadrilla.slice();
  const precioComida = Number(constantes.valorComida) || 0;

  // Columnas
  const C_NRO = 0, C_NAME = 1, C_DAY0 = 2;
  const C_AFTER  = C_DAY0 + N;     // TOTAL DE HORAS · CANTIDAD (comidas)
  const C_AFTER2 = C_AFTER + 1;    // IMPORTE (comidas)
  const NCOLS    = C_AFTER2 + 1;

  const blank = () => new Array(NCOLS).fill('');
  const rows  = [];
  const merges = [];
  const stmap = {};
  const linkmap = {};
  const S = (r, c, s) => { stmap[r + ',' + c] = s; };
  const L = (r, c, url) => { linkmap[r + ',' + c] = url; };

  // ── Paleta / estilos ──
  const A = h => 'FF' + h;
  const NAVY = A('1A3A5C'), MBLUE = A('2D5F8A'), TEAL = A('3A78B5'), LBLUE = A('D6E4F0');
  const WHITE = A('FFFFFF'), LGRAY = A('F5F7FA'), GRAY = A('E4E9EF'), ORANGE = A('ED7D31');
  const LORANGE = A('FCE4D6'), YELW = A('FFF7E0'), DARK = '333333', BORDC = A('B0BEC5');
  const bord = { style: 'thin', color: { rgb: BORDC } };
  const allb = () => ({ top: bord, bottom: bord, left: bord, right: bord });
  const solid = rgb => ({ patternType: 'solid', fgColor: { rgb }, bgColor: { indexed: 64 } });
  const MONEY = '"$"#,##0';

  const stTitle   = { font: { bold: true, sz: 14, color: { rgb: WHITE } }, fill: solid(NAVY),  alignment: { horizontal: 'center', vertical: 'center' } };
  const stSub     = { font: { bold: true, sz: 12, color: { rgb: WHITE } }, fill: solid(MBLUE), alignment: { horizontal: 'center', vertical: 'center' } };
  const stInfo    = { font: { italic: true, sz: 9, color: { rgb: WHITE } }, fill: solid(MBLUE), alignment: { horizontal: 'center', vertical: 'center' } };
  const stSection = { font: { bold: true, sz: 11, color: { rgb: WHITE } }, fill: solid(MBLUE), alignment: { vertical: 'center' } };
  const stTh      = a => ({ font: { bold: true, sz: 9, color: { rgb: WHITE } }, fill: solid(TEAL), border: allb(), alignment: { horizontal: a || 'center', vertical: 'center', wrapText: true } });
  const stNro     = bg => ({ font: { sz: 9, color: { rgb: DARK } }, fill: solid(bg), border: allb(), alignment: { horizontal: 'center', vertical: 'center' } });
  const stName    = bg => ({ font: { sz: 10, color: { rgb: DARK } }, fill: solid(bg), border: allb(), alignment: { horizontal: 'left', vertical: 'center' } });
  const stDay     = bg => ({ font: { sz: 9, color: { rgb: DARK } }, fill: solid(bg), border: allb(), alignment: { horizontal: 'center', vertical: 'center' } });
  const stTot     = bg => ({ font: { bold: true, sz: 10, color: { rgb: DARK } }, fill: solid(bg), border: allb(), alignment: { horizontal: 'center', vertical: 'center' } });
  const stMoney   = (bg, bold) => ({ font: { bold: !!bold, sz: 10, color: { rgb: DARK } }, fill: solid(bg), border: allb(), numFmt: MONEY, alignment: { horizontal: 'right', vertical: 'center' } });
  const stCat     = bg => ({ font: { sz: 10, color: { rgb: DARK } }, fill: solid(bg), border: allb(), alignment: { horizontal: 'left', vertical: 'center' } });
  const bgAlt = i => (i % 2 === 0 ? WHITE : LGRAY);
  const dayBg = (dia, i) => dia.feriado ? LORANGE : (dia.finde ? GRAY : bgAlt(i));

  // ── Encabezado ──
  const mergeFull = r => merges.push({ s: { r, c: 0 }, e: { r, c: NCOLS - 1 } });
  let r;

  r = rows.push(blank()) - 1; rows[r][0] = 'VIMECO S.A.';                                          S(r, 0, stTitle); mergeFull(r);
  r = rows.push(blank()) - 1; rows[r][0] = `${q.half === 1 ? '1ª' : '2ª'} QUINCENA DE ${MESES[q.month - 1].toUpperCase()} ${q.year}`; S(r, 0, stSub); mergeFull(r);
  r = rows.push(blank()) - 1; rows[r][0] = `Obra: ${obraNombre}  ·  Jornada: ${constantes.jornadaHoras} hs de lunes a viernes`; S(r, 0, stInfo); mergeFull(r);
  rows.push(blank());

  // ── PLANILLA DE CATEGORÍAS ──
  r = rows.push(blank()) - 1; rows[r][0] = 'PLANILLA DE CATEGORÍAS'; S(r, 0, stSection); mergeFull(r);
  // Estila y combina un tramo de columnas [c0..c1] en la fila rr
  const spanCols = (rr2, st, c0, c1) => {
    for (let c = c0; c <= c1; c++) S(rr2, c, st);
    if (c1 > c0) merges.push({ s: { r: rr2, c: c0 }, e: { r: rr2, c: c1 } });
  };
  // Tramos: DNI (1 col) | CATEGORÍA | TELÉFONO | DOMICILIO (hasta el final)
  const C_CAT0 = C_DAY0 + 1, C_CAT1 = C_DAY0 + 4;
  const C_TEL0 = C_DAY0 + 5, C_TEL1 = C_DAY0 + 7;
  const C_DOM0 = C_DAY0 + 8, C_DOM1 = NCOLS - 1;
  // Encabezado: Nro | APELLIDO Y NOMBRES | DNI | CATEGORÍA | TELÉFONO | DOMICILIO
  {
    const h = blank();
    h[C_NRO] = 'Nro'; h[C_NAME] = 'APELLIDO Y NOMBRES'; h[C_DAY0] = 'DNI';
    h[C_CAT0] = 'CATEGORÍA'; h[C_TEL0] = 'TELÉFONO'; h[C_DOM0] = 'DOMICILIO';
    const rh = rows.push(h) - 1;
    S(rh, C_NRO, stTh('center'));
    S(rh, C_NAME, stTh('left'));
    S(rh, C_DAY0, stTh('center'));
    spanCols(rh, stTh('left'), C_CAT0, C_CAT1);
    spanCols(rh, stTh('left'), C_TEL0, C_TEL1);
    spanCols(rh, stTh('left'), C_DOM0, C_DOM1);
  }
  crew.forEach((p, i) => {
    const row = blank();
    row[C_NRO]  = i + 1;
    row[C_NAME] = `${p.apellido}, ${p.nombre}`;
    const dniUrl = p.dniFolderUrl || dniFrente(p) || '';   // link a la carpeta de documentos (o al frente)
    row[C_DAY0]  = dniUrl ? 'Ver' : '—';
    row[C_CAT0]  = categoriaLabel(p) || '—';
    row[C_TEL0]  = p.telefono || '—';
    row[C_DOM0]  = p.domicilio || '—';
    const rr = rows.push(row) - 1;
    const bg = bgAlt(i);
    S(rr, C_NRO, stNro(bg));
    S(rr, C_NAME, stName(bg));
    S(rr, C_DAY0, { ...stDay(bg), font: { sz: 9, color: { rgb: dniUrl ? A('1155CC') : DARK }, underline: !!dniUrl } });
    if (dniUrl) L(rr, C_DAY0, dniUrl);
    spanCols(rr, stCat(bg), C_CAT0, C_CAT1);
    spanCols(rr, stCat(bg), C_TEL0, C_TEL1);
    spanCols(rr, stCat(bg), C_DOM0, C_DOM1);
  });
  rows.push(blank());

  // Helper para las dos filas de encabezado de una tabla con días
  const pushDayHeader = (trailingA, trailingB) => {
    const hA = blank(), hB = blank();
    hA[C_NRO] = 'Nro'; hA[C_NAME] = 'APELLIDO Y NOMBRES';
    dias.forEach((dia, i) => { hA[C_DAY0 + i] = DOW_ABBR[dia.dow]; hB[C_DAY0 + i] = dia.d; });
    trailingA.forEach(([c, txt]) => { hA[c] = txt; });
    const rA = rows.push(hA) - 1;
    const rB = rows.push(hB) - 1;
    // Nro y Nombre: merge vertical de las dos filas
    S(rA, C_NRO, stTh('center'));  merges.push({ s: { r: rA, c: C_NRO }, e: { r: rB, c: C_NRO } });
    S(rA, C_NAME, stTh('left'));   merges.push({ s: { r: rA, c: C_NAME }, e: { r: rB, c: C_NAME } });
    dias.forEach((dia, i) => {
      const bg = dia.feriado ? A('C86A2A') : (dia.finde ? A('2C5B85') : TEAL);
      S(rA, C_DAY0 + i, { ...stTh('center'), fill: solid(bg) });
      S(rB, C_DAY0 + i, { ...stTh('center'), fill: solid(bg) });
    });
    trailingA.forEach(([c]) => { S(rA, c, stTh('center')); merges.push({ s: { r: rA, c }, e: { r: rB, c } }); });
    return { rA, rB };
  };

  // ── PLANILLA DE HORAS ──
  r = rows.push(blank()) - 1; rows[r][0] = 'PLANILLA DE HORAS'; S(r, 0, stSection); mergeFull(r);
  pushDayHeader([[C_AFTER, 'TOTAL DE HORAS']]);
  const dayTotals = new Array(N).fill(0);
  let granTotal = 0;
  crew.forEach((p, i) => {
    const row = blank();
    row[C_NRO]  = i + 1;
    row[C_NAME] = `${p.apellido}, ${p.nombre}`;
    let totalP = 0;
    dias.forEach((dia, k) => {
      const it     = ((partes[dia.iso] && partes[dia.iso].items) || {})[p.id];
      const horas  = it ? (Number(it.horas) || 0) : 0;
      const estado = it ? (it.estado || '') : '';
      const code   = estado || (dia.feriado ? 'F' : '');
      const disp   = code === 'AU' ? 'X' : code;   // Ausente se muestra como "X"
      let val = '';
      if (disp && horas > 0) val = `${disp} ${fmtHoras(horas)}`;   // ej "CC 2,5", "F 10"
      else if (disp)         val = disp;                            // ej "X", "CM", "AC", "F"
      else if (horas > 0)    val = horas;
      row[C_DAY0 + k] = val;
      if (horas > 0) { totalP += horas; dayTotals[k] += horas; }
    });
    row[C_AFTER] = totalP;
    granTotal += totalP;
    const rr = rows.push(row) - 1;
    const bg = bgAlt(i);
    S(rr, C_NRO, stNro(bg));
    S(rr, C_NAME, stName(bg));
    dias.forEach((dia, k) => S(rr, C_DAY0 + k, stDay(dayBg(dia, i))));
    S(rr, C_AFTER, stTot(LBLUE));
  });
  // Fila TOTALES de horas
  {
    const row = blank();
    row[C_NAME] = 'TOTALES';
    dias.forEach((dia, k) => { row[C_DAY0 + k] = dayTotals[k] || ''; });
    row[C_AFTER] = granTotal;
    const rr = rows.push(row) - 1;
    S(rr, C_NRO, stTot(YELW));
    S(rr, C_NAME, { ...stName(YELW), font: { bold: true, sz: 10, color: { rgb: DARK } } });
    dias.forEach((dia, k) => S(rr, C_DAY0 + k, stTot(YELW)));
    S(rr, C_AFTER, stTot(YELW));
  }
  rows.push(blank());

  // ── PLANILLA DE COMIDAS (resumen en cantidades + importe) ──
  r = rows.push(blank()) - 1; rows[r][0] = 'PLANILLA DE COMIDAS'; S(r, 0, stSection); mergeFull(r);
  {
    const h = blank();
    h[C_NRO] = 'Nro'; h[C_NAME] = 'APELLIDO Y NOMBRES'; h[C_AFTER] = 'CANTIDAD'; h[C_AFTER2] = 'IMPORTE';
    const rh = rows.push(h) - 1;
    S(rh, C_NRO, stTh('center'));
    for (let c = C_NAME; c < C_AFTER; c++) S(rh, c, stTh('left'));
    merges.push({ s: { r: rh, c: C_NAME }, e: { r: rh, c: C_AFTER - 1 } });
    S(rh, C_AFTER, stTh('center'));
    S(rh, C_AFTER2, stTh('center'));
  }
  let totCant = 0, totImp = 0;
  crew.forEach((p, i) => {
    let cant = 0;
    dias.forEach(dia => {
      const it = ((partes[dia.iso] && partes[dia.iso].items) || {})[p.id];
      if (it && it.comida) cant++;
    });
    const imp = cant * precioComida;
    totCant += cant; totImp += imp;
    const row = blank();
    row[C_NRO] = i + 1;
    row[C_NAME] = `${p.apellido}, ${p.nombre}`;
    row[C_AFTER] = cant;
    row[C_AFTER2] = imp;
    const rr = rows.push(row) - 1;
    const bg = bgAlt(i);
    S(rr, C_NRO, stNro(bg));
    for (let c = C_NAME; c < C_AFTER; c++) S(rr, c, stName(bg));
    merges.push({ s: { r: rr, c: C_NAME }, e: { r: rr, c: C_AFTER - 1 } });
    S(rr, C_AFTER, stTot(LBLUE));
    S(rr, C_AFTER2, stMoney(LBLUE));
  });
  // Fila PRECIO X DÍA + totales (sin deliverys)
  {
    const row = blank();
    row[C_NAME]   = `PRECIO X DÍA: $${precioComida.toLocaleString('es-AR')}`;
    row[C_AFTER]  = totCant;
    row[C_AFTER2] = totImp;
    const rr = rows.push(row) - 1;
    const lbl = { ...stName(YELW), font: { bold: true, sz: 10, color: { rgb: DARK } }, alignment: { horizontal: 'right', vertical: 'center' } };
    S(rr, C_NRO, stTot(YELW));
    for (let c = C_NAME; c < C_AFTER; c++) S(rr, c, lbl);
    merges.push({ s: { r: rr, c: C_NAME }, e: { r: rr, c: C_AFTER - 1 } });
    S(rr, C_AFTER, stTot(YELW));
    S(rr, C_AFTER2, stMoney(YELW, true));
  }
  rows.push(blank());

  // ── PLANILLA DE VIÁTICOS (tabla de eventos, solo si hay) ──
  const viatEvents = [];
  crew.forEach(p => {
    dias.forEach(dia => {
      const it = ((partes[dia.iso] && partes[dia.iso].items) || {})[p.id];
      if (!it) return;
      let list = [];
      if (Array.isArray(it.viaticos)) list = it.viaticos;
      else if ((Number(it.viatico) || 0) > 0) list = [{ monto: Number(it.viatico), motivo: '', adjunto: null }];
      list.forEach(v => {
        const monto = Number(v.monto) || 0;
        if (monto <= 0) return;
        viatEvents.push({
          persona: `${p.apellido}, ${p.nombre}`,
          fecha:   `${String(dia.d).padStart(2, '0')}/${String(q.month).padStart(2, '0')}`,
          iso:     dia.iso,
          motivo:  v.motivo || '',
          monto,
          url:     (v.adjunto && v.adjunto.url) || ''
        });
      });
    });
  });
  viatEvents.sort((a, b) => a.persona.localeCompare(b.persona) || a.iso.localeCompare(b.iso));

  if (viatEvents.length) {
    r = rows.push(blank()) - 1; rows[r][0] = 'PLANILLA DE VIÁTICOS'; S(r, 0, stSection); mergeFull(r);
    // Persona(0..1) | Fecha(2..3) | Descripción(4..C_AFTER-1) | Monto(C_AFTER) | Adjunto(C_AFTER2)
    const P_PER = 0, P_FEC = 2, P_DES = 4, P_MON = C_AFTER, P_LNK = C_AFTER2;
    const span = (rr2, s, a2, b2) => { for (let c = a2; c <= b2; c++) S(rr2, c, s); merges.push({ s: { r: rr2, c: a2 }, e: { r: rr2, c: b2 } }); };
    {
      const h = blank();
      h[P_PER] = 'PERSONA'; h[P_FEC] = 'FECHA'; h[P_DES] = 'DESCRIPCIÓN'; h[P_MON] = 'MONTO'; h[P_LNK] = 'ADJUNTO';
      const rh = rows.push(h) - 1;
      span(rh, stTh('left'),   P_PER, P_FEC - 1);
      span(rh, stTh('center'), P_FEC, P_DES - 1);
      span(rh, stTh('left'),   P_DES, P_MON - 1);
      S(rh, P_MON, stTh('center'));
      S(rh, P_LNK, stTh('center'));
    }
    let granViat = 0;
    viatEvents.forEach((ev, i) => {
      granViat += ev.monto;
      const row = blank();
      row[P_PER] = ev.persona; row[P_FEC] = ev.fecha; row[P_DES] = ev.motivo || '—';
      row[P_MON] = ev.monto;   row[P_LNK] = ev.url ? 'Ver' : '—';
      const rr = rows.push(row) - 1;
      const bg = bgAlt(i);
      span(rr, stName(bg), P_PER, P_FEC - 1);
      span(rr, stDay(bg),  P_FEC, P_DES - 1);
      span(rr, stName(bg), P_DES, P_MON - 1);
      S(rr, P_MON, stMoney(bg));
      S(rr, P_LNK, { ...stDay(bg), font: { sz: 9, color: { rgb: ev.url ? A('1155CC') : DARK }, underline: !!ev.url } });
      if (ev.url) L(rr, P_LNK, ev.url);
    });
    {
      const row = blank();
      row[P_PER] = 'TOTAL VIÁTICOS';
      row[P_MON] = granViat;
      const rr = rows.push(row) - 1;
      const lbl = { ...stName(YELW), font: { bold: true, sz: 10, color: { rgb: DARK } }, alignment: { horizontal: 'right', vertical: 'center' } };
      span(rr, lbl, P_PER, P_MON - 1);
      S(rr, P_MON, stMoney(YELW, true));
      S(rr, P_LNK, stDay(YELW));
    }
  }

  // ── PLANILLA DE MONTOS A PAGAR (por horas, con valores de categoría del mes) ──
  // Reglas: horas que exceden la jornada legal (8 hs/día) ×1,5 · horas en
  // feriado ×2 · plus porcentual de la persona sobre el valor hora de su categoría.
  {
    const mesQ = `${q.year}-${pad2(q.month)}`;
    let valores = {}, origenValores = null;
    try {
      const todos = await getValoresCategoriasTodos();
      if (todos[mesQ] && Object.keys(todos[mesQ]).length) {
        valores = todos[mesQ]; origenValores = mesQ;
      } else {
        // Sin valores del mes: usar el mes más reciente anterior que tenga carga
        const prev = Object.keys(todos)
          .filter(m => m < mesQ && Object.keys(todos[m] || {}).length)
          .sort().pop();
        if (prev) { valores = todos[prev]; origenValores = prev; }
      }
    } catch (_) {}
    const catKey = c => (typeof sanitizeCatKey === 'function' ? sanitizeCatKey(c) : String(c || ''));

    r = rows.push(blank()) - 1; rows[r][0] = 'PLANILLA DE MONTOS A PAGAR (HORAS)'; S(r, 0, stSection); mergeFull(r);

    // Tramos de columnas
    const M_CAT0 = C_DAY0,      M_CAT1 = C_DAY0 + 3;
    const M_HN0  = C_DAY0 + 4,  M_HN1  = C_DAY0 + 5;
    const M_HX0  = C_DAY0 + 6,  M_HX1  = C_DAY0 + 7;
    const M_HF0  = C_DAY0 + 8,  M_HF1  = C_DAY0 + 9;
    const M_VH0  = C_DAY0 + 10, M_VH1  = C_DAY0 + 11;
    const M_PCT  = C_DAY0 + 12;
    const M_TOT0 = C_DAY0 + 13, M_TOT1 = NCOLS - 1;
    {
      const h = blank();
      h[C_NRO] = 'Nro'; h[C_NAME] = 'APELLIDO Y NOMBRES';
      h[M_CAT0] = 'CATEGORÍA'; h[M_HN0] = 'HS NORMALES'; h[M_HX0] = 'HS EXTRAS ×1,5';
      h[M_HF0] = 'HS FERIADO ×2'; h[M_VH0] = 'VALOR HORA'; h[M_PCT] = 'PLUS %'; h[M_TOT0] = 'MONTO A PAGAR';
      const rh = rows.push(h) - 1;
      S(rh, C_NRO, stTh('center'));
      S(rh, C_NAME, stTh('left'));
      spanCols(rh, stTh('left'),   M_CAT0, M_CAT1);
      spanCols(rh, stTh('center'), M_HN0, M_HN1);
      spanCols(rh, stTh('center'), M_HX0, M_HX1);
      spanCols(rh, stTh('center'), M_HF0, M_HF1);
      spanCols(rh, stTh('center'), M_VH0, M_VH1);
      S(rh, M_PCT, stTh('center'));
      spanCols(rh, stTh('center'), M_TOT0, M_TOT1);
    }

    let granMonto = 0, sinValor = false;
    crew.forEach((p, i) => {
      let hNorm = 0, hExtra = 0, hFer = 0;
      dias.forEach(dia => {
        const it = ((partes[dia.iso] && partes[dia.iso].items) || {})[p.id];
        if (!it) return;
        const horas = Number(it.horas) || 0;
        if (horas <= 0) return;
        if (dia.feriado || it.estado === 'F') {
          hFer += horas;
        } else {
          hNorm  += Math.min(horas, JORNADA_LEGAL);
          hExtra += Math.max(0, horas - JORNADA_LEGAL);
        }
      });
      const base = Number(valores[catKey(p.categoria)]) || 0;
      if (!base && (hNorm + hExtra + hFer) > 0) sinValor = true;
      const pct   = Number(p.porcentajeExtra) || 0;
      const vh    = base * (1 + pct / 100);
      const monto = vh * (hNorm + 1.5 * hExtra + 2 * hFer);
      granMonto  += monto;

      const row = blank();
      row[C_NRO]  = i + 1;
      row[C_NAME] = `${p.apellido}, ${p.nombre}`;
      row[M_CAT0] = p.categoria || '—';
      row[M_HN0]  = hNorm  || 0;
      row[M_HX0]  = hExtra || 0;
      row[M_HF0]  = hFer   || 0;
      row[M_VH0]  = base ? vh : '—';
      row[M_PCT]  = pct ? pct + '%' : '—';
      row[M_TOT0] = base ? monto : '—';
      const rr = rows.push(row) - 1;
      const bg = bgAlt(i);
      S(rr, C_NRO, stNro(bg));
      S(rr, C_NAME, stName(bg));
      spanCols(rr, stCat(bg), M_CAT0, M_CAT1);
      spanCols(rr, stTot(bg), M_HN0, M_HN1);
      spanCols(rr, stTot(bg), M_HX0, M_HX1);
      spanCols(rr, stTot(bg), M_HF0, M_HF1);
      spanCols(rr, base ? stMoney(bg) : stDay(bg), M_VH0, M_VH1);
      S(rr, M_PCT, stDay(bg));
      spanCols(rr, base ? stMoney(LBLUE, true) : stDay(LBLUE), M_TOT0, M_TOT1);
    });

    // Fila TOTAL general
    {
      const row = blank();
      row[C_NAME]  = 'TOTAL';
      row[M_TOT0]  = granMonto;
      const rr = rows.push(row) - 1;
      const lbl = { ...stName(YELW), font: { bold: true, sz: 10, color: { rgb: DARK } }, alignment: { horizontal: 'right', vertical: 'center' } };
      S(rr, C_NRO, stTot(YELW));
      spanCols(rr, lbl, C_NAME, M_TOT0 - 1);
      spanCols(rr, stMoney(YELW, true), M_TOT0, M_TOT1);
    }

    // Nota sobre el origen de los valores usados
    let notaValores = '';
    if (!origenValores)          notaValores = '⚠ Sin valores de categoría cargados. Cargalos en Administración → Personal (configuración) → Valores por categoría.';
    else if (origenValores !== mesQ) notaValores = `⚠ Valores de categoría de ${origenValores} (no hay cargados para ${mesQ}).`;
    else if (sinValor)           notaValores = `⚠ Hay categorías sin valor cargado en ${mesQ}: esas filas no se pudieron calcular.`;
    if (notaValores) {
      r = rows.push(blank()) - 1;
      rows[r][0] = notaValores;
      S(r, 0, { font: { italic: true, sz: 9, color: { rgb: A('B45309') } }, alignment: { horizontal: 'left', vertical: 'center' } });
      mergeFull(r);
    }
  }

  // ── Construir hoja ──
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [];
  ws['!cols'][C_NRO]  = { wch: 5 };
  ws['!cols'][C_NAME] = { wch: 26 };
  for (let c = C_DAY0; c < C_AFTER; c++) ws['!cols'][c] = { wch: 4.5 };
  ws['!cols'][C_AFTER]  = { wch: 10 };
  ws['!cols'][C_AFTER2] = { wch: 12 };

  ws['!merges'] = merges;

  Object.entries(stmap).forEach(([k, s]) => {
    const [rr, cc] = k.split(',').map(Number);
    const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
    ws[addr].s = s;
  });

  Object.entries(linkmap).forEach(([k, url]) => {
    const [rr, cc] = k.split(',').map(Number);
    const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
    if (!ws[addr]) ws[addr] = { t: 's', v: 'Ver' };
    ws[addr].l = { Target: url, Tooltip: 'Abrir adjunto' };
  });

  XLSX.utils.book_append_sheet(wb, ws, `${q.half === 1 ? '1ra' : '2da'} Q ${MESES[q.month - 1].substring(0, 3)} ${q.year}`.substring(0, 31));

  const safe  = (obraNombre || 'Obra').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const fname = `Personal_${safe}_${quincenaId(q)}.xlsx`;

  // HTML formateado (vista previa read-only) — reusa rows/merges/stmap/linkmap.
  // Traduce los estilos de celda del Excel a CSS inline para que la preview
  // se vea igual (colores, negritas, alineación, celdas combinadas).
  const html = buildReporteHtml({ rows, merges, stmap, linkmap, cols: ws['!cols'], NCOLS });

  return { wb, ws, fname, html };
}

// Convierte un color ARGB del Excel (ej 'FF1A3A5C' o '333333') a '#RRGGBB'.
function argbToHex(x) {
  if (!x) return null;
  const s = String(x);
  return '#' + (s.length >= 8 ? s.slice(2) : s);
}

// Traduce un objeto de estilo de celda (xlsx-js-style) a CSS inline.
function cellStyleToCss(s) {
  if (!s) return 'border:none';
  const css = [];
  const bg = s.fill && s.fill.fgColor && argbToHex(s.fill.fgColor.rgb);
  if (bg) css.push('background:' + bg);
  if (s.font) {
    const c = s.font.color && argbToHex(s.font.color.rgb);
    if (c) css.push('color:' + c);
    if (s.font.bold)      css.push('font-weight:700');
    if (s.font.italic)    css.push('font-style:italic');
    if (s.font.underline) css.push('text-decoration:underline');
    if (s.font.sz)        css.push('font-size:' + s.font.sz + 'px');
  }
  if (s.alignment) {
    if (s.alignment.horizontal) css.push('text-align:' + s.alignment.horizontal);
    if (s.alignment.vertical)   css.push('vertical-align:' + (s.alignment.vertical === 'center' ? 'middle' : s.alignment.vertical));
  }
  css.push(s.border ? 'border:1px solid #b0bec5' : 'border:none');
  return css.join(';');
}

// Formatea el texto de una celda (aplica formato moneda si corresponde).
function cellDisplay(v, s) {
  if (v === '' || v == null) return '';
  if (s && s.numFmt && /"\$"/.test(s.numFmt) && typeof v === 'number') {
    return '$' + v.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }
  return esc(v);
}

// Arma la tabla HTML respetando celdas combinadas (rowspan/colspan) y estilos.
function buildReporteHtml({ rows, merges, stmap, linkmap, cols, NCOLS }) {
  const spanTL  = {};          // "r,c" → { rs, cs } de la celda superior-izquierda
  const covered = new Set();   // celdas tapadas por una combinación
  (merges || []).forEach(m => {
    spanTL[m.s.r + ',' + m.s.c] = { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 };
    for (let r = m.s.r; r <= m.e.r; r++)
      for (let c = m.s.c; c <= m.e.c; c++)
        if (!(r === m.s.r && c === m.s.c)) covered.add(r + ',' + c);
  });

  let out = '<table><colgroup>';
  for (let c = 0; c < NCOLS; c++) {
    const wch = cols && cols[c] && cols[c].wch;
    out += `<col style="width:${wch ? Math.round(wch * 7) : 40}px">`;
  }
  out += '</colgroup><tbody>';

  for (let r = 0; r < rows.length; r++) {
    out += '<tr>';
    for (let c = 0; c < NCOLS; c++) {
      const key = r + ',' + c;
      if (covered.has(key)) continue;
      const s   = stmap[key];
      let txt   = cellDisplay(rows[r][c], s);
      if (linkmap[key] && txt) txt = `<a href="${esc(linkmap[key])}" target="_blank" rel="noopener">${txt}</a>`;
      const sp  = spanTL[key];
      const at  = [];
      if (sp && sp.cs > 1) at.push(`colspan="${sp.cs}"`);
      if (sp && sp.rs > 1) at.push(`rowspan="${sp.rs}"`);
      at.push(`style="${cellStyleToCss(s)}"`);
      out += `<td ${at.join(' ')}>${txt}</td>`;
    }
    out += '</tr>';
  }
  return out + '</tbody></table>';
}

// Serializa el libro a un .xlsx → { blob, fname }
async function buildReporteBlob(q) {
  const { wb, fname } = await buildReporteWorkbook(q);
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { blob, fname };
}

// Vista previa read-only: renderiza la misma hoja como tabla HTML formateada (no editable).
async function previewReporte(q) {
  let html;
  try {
    ({ html } = await buildReporteWorkbook(q));
  } catch (_) {
    showToast('No se pudo generar la vista previa.', 'error');
    return;
  }
  $('excel-preview').innerHTML = html || '<div class="hist-empty">Sin datos para mostrar.</div>';
  $('excel-preview-title').textContent = `Planilla — ${quincenaLabel(q)}`;
  $('modal-excel-preview').classList.remove('hidden');
}

// Imprimir / PDF: abre la planilla ya renderizada en una ventana de impresión.
// Desde el diálogo del navegador se imprime o se elige "Guardar como PDF".
function onExcelPrint() {
  const html = $('excel-preview').innerHTML;
  if (!html) return;
  const w = window.open('', '_blank');
  if (!w) { showToast('El navegador bloqueó la ventana. Permití pop-ups para imprimir.', 'warning'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Planilla — ${esc(obraNombre)} — ${esc(quincenaLabel(currentQuincena))}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; }
  table { border-collapse: collapse; table-layout: fixed; }
  td { padding: 2px 4px; overflow: hidden; }
  a { color: #1155cc; text-decoration: none; }
</style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
}

// Genera el Excel, lo sube a Drive y (opcional) lo descarga
async function generarReporte(q, { silencioso = false, download = false } = {}) {
  let blob, fname;
  try {
    ({ blob, fname } = await buildReporteBlob(q));
  } catch (_) {
    if (!silencioso) showToast('No se pudo generar el Excel de RRHH.', 'error');
    return null;
  }
  let url = null;
  try {
    if (typeof uploadReporteQuincena === 'function') {
      const res = await uploadReporteQuincena(new File([blob], fname, { type: blob.type }), { obra: obraNombre });
      url = res.url;
    }
  } catch (_) {
    if (!silencioso) showToast('Excel generado, pero no se pudo subir a Drive.', 'warning');
  }
  if (download) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  if (!silencioso) showToast(url ? 'Excel de RRHH generado y subido a Drive.' : 'Excel de RRHH generado.', 'success');
  return url;
}

async function onExcelRRHH() {
  const btn = $('btn-excel-rrhh');
  if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
  try { await generarReporte(currentQuincena, { download: true }); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '📊 Excel RRHH'; } }
}

async function onExcelPreview() {
  const btn = $('btn-excel-preview');
  if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
  try { await previewReporte(currentQuincena); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '👁 Ver planilla'; } }
}

// ───────── Init ─────────
document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }
  if (!obraKey)    { window.location.href = 'personal.html'; return; }
  sessionCodigo = _s.codigo;

  $('hdr-name').textContent = _s.nombre;
  $('hdr-obra').textContent = obraNombre;
  $('btn-back').addEventListener('click', () => { window.location.href = 'personal.html'; });
  $('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('vimeco_session');
    sessionStorage.clear();
    window.location.href = 'index.html';
  });

  // Acordeón de secciones
  document.querySelectorAll('.sec-head').forEach(head => {
    head.addEventListener('click', () => head.closest('.sec-card').classList.toggle('collapsed'));
  });

  // Modal personal
  $('btn-add-personal').addEventListener('click', openAddPersonal);
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

  // Modal padrón
  $('btn-padron').addEventListener('click', openPadron);
  $('modal-padron-close').addEventListener('click',  () => $('modal-padron').classList.add('hidden'));
  $('modal-padron-cancel').addEventListener('click', () => $('modal-padron').classList.add('hidden'));

  // Modal parte del día
  $('modal-parte-close').addEventListener('click', () => $('modal-parte').classList.add('hidden'));
  $('parte-guardar').addEventListener('click', onGuardarParte);
  $('parte-validar').addEventListener('click', onValidarDia);

  // Modal viático
  $('modal-viatico-close').addEventListener('click',  () => $('modal-viatico').classList.add('hidden'));
  $('modal-viatico-cancel').addEventListener('click', () => $('modal-viatico').classList.add('hidden'));
  $('modal-viatico-save').addEventListener('click', saveViatico);
  $('v-file').addEventListener('change', e => {
    viaticoFile = e.target.files[0] || null;
    $('v-file-name').textContent = viaticoFile ? viaticoFile.name : '';
  });

  // Vista previa del Excel (read-only)
  $('modal-excel-preview-close').addEventListener('click',  () => $('modal-excel-preview').classList.add('hidden'));
  $('modal-excel-preview-close2').addEventListener('click', () => $('modal-excel-preview').classList.add('hidden'));
  $('btn-excel-download').addEventListener('click', () => {
    $('modal-excel-preview').classList.add('hidden');
    onExcelRRHH();
  });
  $('btn-excel-print').addEventListener('click', onExcelPrint);

  // Config de la obra (jornada + valor comida)
  $('btn-config-obra').addEventListener('click', openConfigObra);
  $('modal-config-close').addEventListener('click',  () => $('modal-config-obra').classList.add('hidden'));
  $('modal-config-cancel').addEventListener('click', () => $('modal-config-obra').classList.add('hidden'));
  $('modal-config-save').addEventListener('click', saveConfigObra);

  // Rol admin (para reabrir quincenas) y constantes de la obra
  esAdmin = sessionCodigo === '0000';
  if (!esAdmin) {
    try { const u = await getUsuario(sessionCodigo); esAdmin = !!(u && u.admin); } catch (_) {}
  }
  try { constantes = await getConstantesObra(obraKey); } catch (_) {}
  updateCfgBar();

  try { categorias = await getCategoriasPersonal(); } catch (_) { categorias = []; }
  await loadCuadrilla();
  await loadCalendarData();
});
