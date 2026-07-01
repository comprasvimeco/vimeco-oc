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
let fotoFile    = null; // archivo de DNI elegido en el modal

let feriados        = {};   // { "YYYY-MM-DD": "Nombre" }
let partesMeta      = {};   // { "YYYY-MM-DD": { validado, ... } }
let currentQuincena = null; // { year, month(1-12), half(1|2) }
let cierres         = {};   // cache { quincenaId: cierreObj|null }
let constantes      = { jornadaHoras: 8, valorComida: 0 };
let esAdmin         = false;
let sessionCodigo   = '';

let parteFecha    = null;   // "YYYY-MM-DD" abierto en el modal
let parteReadonly = false;  // true si la quincena está cerrada
let parteAdjuntos = {};     // { personalId: [{ name, url }] } del día abierto

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DOW   = ['L','M','M','J','V','S','D'];
const ESTADOS = [
  { code: '',    label: 'Normal / Presente' },
  { code: 'F',   label: 'F · Feriado trabajado' },
  { code: 'A',   label: 'A · Ausencia con aviso' },
  { code: 'ART', label: 'ART · Carpeta médica' },
  { code: 'CC',  label: 'CC · Causas climáticas (lluvia)' },
  { code: 'V',   label: 'V · Viaje a obra' },
  { code: 'ACC', label: 'ACC · Accidente en obra' }
];

// ───────── Cuadrilla ─────────
function avatar(p) {
  const ini = ((p.apellido || '')[0] || '') + ((p.nombre || '')[0] || '');
  if (p.fotoDniUrl) {
    return `<div class="crew-avatar"><a href="${esc(p.fotoDniUrl)}" target="_blank" rel="noopener" title="Ver DNI"><img src="${esc(p.fotoDniUrl)}" alt="DNI" onerror="this.parentNode.textContent='${esc(ini)}'"></a></div>`;
  }
  return `<div class="crew-avatar">${esc(ini.toUpperCase()) || '👷'}</div>`;
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
        <div class="crew-name">${esc(p.apellido)}, ${esc(p.nombre)}</div>
        <div class="crew-meta">
          ${p.categoria ? `<span class="crew-cat">${esc(p.categoria)}</span> ` : ''}
          ${p.dni ? `DNI ${esc(p.dni)}` : '<span style="color:var(--gray-400)">sin DNI</span>'}
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

async function loadCuadrilla() {
  try {
    cuadrilla = await getPersonalDeObra(obraKey);
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

function setFotoPreview(url) {
  $('p-foto-preview').innerHTML = url
    ? `<img src="${esc(url)}" alt="DNI">`
    : '';
}

function openAddPersonal() {
  editingId = null;
  fotoFile  = null;
  $('modal-personal-title').textContent = 'Agregar personal';
  $('modal-personal-error').classList.add('hidden');
  $('p-nombre').value = '';
  $('p-apellido').value = '';
  $('p-dni').value = '';
  $('p-foto').value = '';
  fillCategorias('');
  setFotoPreview('');
  $('modal-personal').classList.remove('hidden');
  setTimeout(() => $('p-nombre').focus(), 50);
}

function openEditPersonal(id) {
  const p = cuadrilla.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  fotoFile  = null;
  $('modal-personal-title').textContent = 'Editar personal';
  $('modal-personal-error').classList.add('hidden');
  $('p-nombre').value   = p.nombre || '';
  $('p-apellido').value = p.apellido || '';
  $('p-dni').value      = p.dni || '';
  $('p-foto').value = '';
  fillCategorias(p.categoria || '');
  setFotoPreview(p.fotoDniUrl || '');
  $('modal-personal').classList.remove('hidden');
  setTimeout(() => $('p-nombre').focus(), 50);
}

async function savePersonalModal() {
  const nombre   = $('p-nombre').value.trim();
  const apellido = $('p-apellido').value.trim();
  const dni      = $('p-dni').value.trim();
  const categoria = $('p-categoria').value;
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
      await patchPersonal(editingId, { nombre, apellido, dni, categoria });
    } else {
      id = await savePersonal({
        nombre, apellido, dni, categoria,
        activo: true,
        fotoDniUrl: '',
        obras: { [obraKey]: true }
      });
    }

    // Subir foto DNI (opcional). Si falla, se guarda igual y avisamos.
    if (fotoFile) {
      saveBtn.textContent = 'Subiendo foto…';
      try {
        const label = `${apellido} ${nombre} - ${dni || 'sin dni'}`.substring(0, 100);
        const { url } = await uploadDniToDrive(fotoFile, { label });
        await patchPersonal(id, { fotoDniUrl: url });
      } catch (_) {
        showToast('Se guardó, pero la foto del DNI no se pudo subir.', 'warning');
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

  let cierreHtml;
  if (cerrada) {
    cierreHtml = `
      <span class="cierre-msg">✓ Quincena cerrada. Solo lectura.</span>
      ${esAdmin ? '<button class="btn btn-sm btn-warning" id="btn-reabrir">Reabrir quincena</button>' : ''}`;
  } else if (faltantes > 0) {
    cierreHtml = `
      <span class="cierre-msg">Faltan validar ${faltantes} día(s) laborable(s) para poder cerrar.</span>
      <button class="btn btn-sm btn-primary" id="btn-cerrar" disabled>Cerrar quincena</button>`;
  } else {
    cierreHtml = `
      <span class="cierre-msg">Todos los días laborables están validados.</span>
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
    showToast('Quincena cerrada.');
    renderCalendar();
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

  // Reiniciar adjuntos del día con lo guardado
  parteAdjuntos = {};
  cuadrilla.forEach(p => {
    const g = items[p.id];
    parteAdjuntos[p.id] = (g && Array.isArray(g.adjuntos)) ? g.adjuntos.slice() : [];
  });

  $('parte-list').innerHTML = cuadrilla.map(p => {
    const guardado = items[p.id];
    const horas   = guardado ? (guardado.horas ?? 0) : (noLab ? 0 : constantes.jornadaHoras);
    const comida  = guardado ? !!guardado.comida  : (noLab ? false : true);
    const viatico = guardado ? (guardado.viatico ?? 0) : 0;
    const estado  = guardado ? (guardado.estado || '') : '';
    return `
      <div class="parte-row" data-id="${esc(p.id)}">
        <div class="parte-row-head">${esc(p.apellido)}, ${esc(p.nombre)}
          ${p.categoria ? `<span class="crew-cat">${esc(p.categoria)}</span>` : ''}</div>
        <div class="parte-fields">
          <div class="pf">
            <label>Horas</label>
            <input type="number" class="form-control pf-horas" min="0" max="24" step="0.5" value="${horas}">
          </div>
          <div class="pf pf-comida">
            <input type="checkbox" class="pf-comidachk" ${comida ? 'checked' : ''}>
            <label style="margin:0">Comida</label>
          </div>
          <div class="pf">
            <label>Viático ($)</label>
            <input type="number" class="form-control pf-viatico" min="0" step="0.01" value="${viatico}">
          </div>
          <div class="pf pf-estado">
            <label>Estado</label>
            <select class="form-control pf-estadosel">
              ${ESTADOS.map(e => `<option value="${e.code}" ${e.code === estado ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}
            </select>
          </div>
          <div class="pf pf-adjuntos">
            <label>Adjuntos (certificados, pasajes…)</label>
            <div class="adj-list" data-id="${esc(p.id)}"></div>
            <input type="file" class="adj-input" accept="image/*,application/pdf" style="display:none">
            <button type="button" class="btn btn-sm btn-outline adj-btn" style="align-self:flex-start">📎 Adjuntar</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Adjuntos: render inicial + wiring por fila
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
    renderAdjuntos(id);
  });

  // Auto-ajuste al cambiar estado
  $('parte-list').querySelectorAll('.parte-row').forEach(row => {
    const sel = row.querySelector('.pf-estadosel');
    sel.addEventListener('change', () => {
      const code = sel.value;
      const horasInp = row.querySelector('.pf-horas');
      const comidaChk = row.querySelector('.pf-comidachk');
      if (['A', 'ART', 'CC'].includes(code)) {
        horasInp.value = 0;
        comidaChk.checked = false;
      } else if (code === 'V') {
        row.querySelector('.pf-viatico').focus();
      }
    });
  });

  // Modo lectura si la quincena está cerrada
  const inputs = $('parte-list').querySelectorAll('input, select');
  inputs.forEach(el => { el.disabled = cerrada; });
  $('parte-list').querySelectorAll('.adj-btn').forEach(b => { b.style.display = cerrada ? 'none' : ''; });
  $('parte-footer').style.display = cerrada ? 'none' : '';

  // Botón validar: refleja estado actual del día
  const validado = partesMeta[iso] && partesMeta[iso].validado;
  const btnVal = $('parte-validar');
  btnVal.textContent = validado ? '↺ Quitar validación' : '✓ Validar día';
  btnVal.className   = validado ? 'btn btn-warning' : 'btn btn-success';

  $('modal-parte').classList.remove('hidden');
}

function recolectarItems() {
  const items = {};
  $('parte-list').querySelectorAll('.parte-row').forEach(row => {
    const id = row.dataset.id;
    const adjuntos = parteAdjuntos[id] || [];
    items[id] = {
      horas:   parseFloat(row.querySelector('.pf-horas').value) || 0,
      comida:  row.querySelector('.pf-comidachk').checked,
      viatico: parseFloat(row.querySelector('.pf-viatico').value) || 0,
      estado:  row.querySelector('.pf-estadosel').value || '',
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
  $('p-foto').addEventListener('change', e => {
    fotoFile = e.target.files[0] || null;
    if (fotoFile) setFotoPreview(URL.createObjectURL(fotoFile));
  });

  // Modal padrón
  $('btn-padron').addEventListener('click', openPadron);
  $('modal-padron-close').addEventListener('click',  () => $('modal-padron').classList.add('hidden'));
  $('modal-padron-cancel').addEventListener('click', () => $('modal-padron').classList.add('hidden'));

  // Modal parte del día
  $('modal-parte-close').addEventListener('click', () => $('modal-parte').classList.add('hidden'));
  $('parte-guardar').addEventListener('click', onGuardarParte);
  $('parte-validar').addEventListener('click', onValidarDia);

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
