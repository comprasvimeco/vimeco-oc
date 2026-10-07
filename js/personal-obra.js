/* VIMECO S.A. — Personal de obra: cuadrilla (Capa 1) */

const $ = id => document.getElementById(id);



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
let padronAll     = [];    // padrón completo, cargado al abrir el modal de agregar
let padronCargado = false; // evita renderizar el modal mientras se carga
let obrasMap    = {};   // { obraKey: nombre } — para los chips de obras
let editingId   = null;
let fotoFrente  = null; // archivo DNI frente elegido en el modal
let fotoDorso   = null; // archivo DNI dorso elegido en el modal

let feriados        = {};   // { "YYYY-MM-DD": "Nombre" }
let partesMeta      = {};   // { "YYYY-MM-DD": { validado, ... } }
let partesAll       = {};   // { "YYYY-MM-DD": { items, _meta } } de toda la obra
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
let genCond       = '';     // tipo de día elegido arriba: '' | 'CC' | 'F' | 'AU'
let parteSnapshot = '';     // lo cargado al abrir el día, para avisar si se cierra sin guardar

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

function iniciales(p) {
  return (((p.apellido || '')[0] || '') + ((p.nombre || '')[0] || '')).toUpperCase() || '?';
}

// Color de las iniciales: estable por persona (mismo tono en la cuadrilla y en el parte)
function avatarTono(p) {
  let h = 0;
  for (const ch of String(p.id || p.apellido || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 'a' + (h % 5);
}

// Obras (activas) donde está una persona. `excluir` saca una obra del listado:
// en la cuadrilla no tiene sentido repetir la obra en la que ya estás parado.
function obraChips(p, excluir) {
  const nombres = Object.keys(p.obras || {})
    .filter(k => p.obras[k] && k !== excluir)
    .map(k => obrasMap[k] || k)
    .sort((a, b) => a.localeCompare(b));
  if (!nombres.length) {
    return excluir ? '' : '<span class="obra-chip obra-chip--none">Sin obra</span>';
  }
  return `<span class="obra-chips">${nombres.map(n => `<span class="obra-chip">${esc(n)}</span>`).join('')}</span>`;
}

function otrasObras(p) {
  return Object.keys(p.obras || {})
    .filter(k => p.obras[k] && k !== obraKey)
    .map(k => obrasMap[k] || k)
    .sort((a, b) => a.localeCompare(b));
}

// Fotos del DNI como pastillas (la foto de Drive no se puede mostrar como imagen)
function dniPills(p) {
  const front = dniFrente(p);
  const back  = p.fotoDniDorso || '';
  if (!front && !back) return '<span class="po-mini po-mini--warn">Sin foto del DNI</span>';
  return [
    front ? `<a class="po-mini po-mini--dni" href="${esc(front)}" target="_blank" rel="noopener">DNI frente</a>` : '',
    back  ? `<a class="po-mini po-mini--dni" href="${esc(back)}" target="_blank" rel="noopener">dorso</a>` : '',
  ].join('');
}

function renderCuadrilla() {
  $('crew-count').textContent = cuadrilla.length ? `· ${cuadrilla.length}` : '';
  const cont = $('crew-list');
  if (!cuadrilla.length) {
    cont.innerHTML = '<div class="po-vacio">Todavía no hay personal en esta obra. Tocá Agregar para traer gente del padrón o incorporar a alguien nuevo.</div>';
    return;
  }
  cont.innerHTML = cuadrilla.map(p => {
    const otras = otrasObras(p);
    const cat   = categoriaLabel(p);
    return `
    <div class="po-crew" data-id="${esc(p.id)}">
      <span class="po-av ${avatarTono(p)}">${esc(iniciales(p))}</span>
      <div class="po-tx">
        <div class="po-nm">${esc(p.apellido)}, ${esc(p.nombre)}</div>
        <div class="po-sb">
          ${cat ? `<span class="po-mini">${esc(cat)}</span>` : ''}
          ${p.dni ? `<span>DNI ${esc(p.dni)}</span>` : ''}
          ${dniPills(p)}
          ${p.dniFolderUrl ? `<a href="${esc(p.dniFolderUrl)}" target="_blank" rel="noopener" title="Carpeta del DNI en Drive" aria-label="Carpeta del DNI en Drive">${icSvg('folder')}</a>` : ''}
          ${otras.length ? `<span>También en ${esc(otras.join(', '))}</span>` : ''}
        </div>
      </div>
      <div class="po-crew-x">
        <button type="button" class="po-ib btn-edit-p" title="Editar" aria-label="Editar a ${esc(p.apellido)}, ${esc(p.nombre)}">${icSvg('edit')}</button>
        <button type="button" class="po-ib po-ib--del btn-quitar-p" title="Quitar de la obra" aria-label="Quitar a ${esc(p.apellido)}, ${esc(p.nombre)} de la obra">${icSvg('userX')}</button>
      </div>
    </div>`;
  }).join('');

  cont.querySelectorAll('.po-crew').forEach(item => {
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

// Nombres de obra para los chips. Se cargan una sola vez por sesión de página.
async function ensureObrasMap() {
  if (Object.keys(obrasMap).length) return;
  try {
    const obras = await getAllObras();
    obras.forEach(o => { obrasMap[o.key] = o.nombre; });
  } catch (_) {}
}

async function loadCuadrilla() {
  try {
    const [personal] = await Promise.all([getPersonalDeObra(obraKey), ensureObrasMap()]);
    cuadrilla = ordenJerarquia(personal);
    renderCuadrilla();
    if (currentQuincena) renderQuincena();
  } catch (_) {
    $('crew-list').innerHTML = '<div class="po-vacio">Error al cargar la cuadrilla.</div>';
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
    `¿Quitar a ${p.apellido}, ${p.nombre} de esta obra? Seguirá en el padrón y podés volver a traerlo.`,
    { boton: 'Quitar', tono: 'del', icono: 'userX' }
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

// ───────── Agregar personal (padrón) ─────────
// Muestra el padrón completo con buscador. Los que ya están en esta obra se
// filtran (para sacarlos está "Quitar" en la cuadrilla) y los inactivos quedan
// ocultos salvo que se pida verlos.
function renderPadronModal() {
  if (!padronCargado) return;
  const cont = $('padron-list');
  const q    = ($('padron-search').value || '').trim().toLowerCase();
  const verInactivos = $('padron-ver-inactivos').checked;

  if (!padronAll.length) {
    cont.innerHTML = '<div class="hist-empty">El padrón está vacío. Incorporá a la primera persona.</div>';
    return;
  }

  const disponibles = padronAll.filter(p => !(p.obras && p.obras[obraKey]));
  const visibles = disponibles.filter(p => {
    if (!verInactivos && p.activo === false) return false;
    if (!q) return true;
    return `${p.apellido} ${p.nombre}`.toLowerCase().includes(q) || String(p.dni || '').includes(q);
  });

  if (!disponibles.length) {
    cont.innerHTML = '<div class="hist-empty">Todo el padrón ya está en esta obra. Incorporá a alguien nuevo.</div>';
    return;
  }
  if (!visibles.length) {
    const hayInactivos = !verInactivos && disponibles.some(p => p.activo === false);
    cont.innerHTML = `<div class="hist-empty">Sin resultados${hayInactivos ? '. Probá marcando "Ver inactivos".' : ' para la búsqueda.'}</div>`;
    return;
  }

  cont.innerHTML = visibles.map(p => `
    <div class="crew-item ${p.activo === false ? 'inactivo' : ''}" data-id="${esc(p.id)}">
      <div class="crew-info">
        <div class="crew-name">${esc(p.apellido)}, ${esc(p.nombre)}
          ${p.activo === false ? '<span class="crew-inact">(inactivo)</span>' : ''}</div>
        <div class="crew-meta">${p.categoria ? esc(p.categoria) + ' · ' : ''}${p.dni ? 'DNI ' + esc(p.dni) : 'sin DNI'}</div>
        <div class="crew-meta crew-obras">${obraChips(p)}</div>
      </div>
      <button class="btn btn-sm btn-success btn-asignar">Asignar</button>
    </div>
  `).join('');

  cont.querySelectorAll('.crew-item').forEach(item => {
    const p = padronAll.find(x => x.id === item.dataset.id);
    item.querySelector('.btn-asignar').addEventListener('click', () => asignarDelPadron(p, item));
  });
}

async function openPadron() {
  $('modal-padron').classList.remove('hidden');
  $('padron-search').value = '';
  $('padron-ver-inactivos').checked = false;
  padronCargado = false;
  const cont = $('padron-list');
  cont.innerHTML = '<div class="hist-loading">Cargando padrón…</div>';
  try {
    const [personal] = await Promise.all([getPersonal(), ensureObrasMap()]);
    padronAll     = personal;
    padronCargado = true;
    renderPadronModal();
    setTimeout(() => $('padron-search').focus(), 50);
  } catch (_) {
    cont.innerHTML = '<div class="hist-empty">Error al cargar el padrón.</div>';
  }
}

// Asignar desde el padrón. Si estaba inactivo, se reactiva al asignarlo.
async function asignarDelPadron(p, item) {
  const btn = item.querySelector('.btn-asignar');
  btn.disabled = true; btn.textContent = 'Asignando…';
  const reactivar = p.activo === false;
  const fields = { obras: { ...(p.obras || {}), [obraKey]: true } };
  if (reactivar) fields.activo = true;
  try {
    await patchPersonal(p.id, fields);
    Object.assign(p, fields);   // mantener el padrón en memoria al día
    renderPadronModal();
    showToast(reactivar
      ? `${p.apellido}, ${p.nombre} asignado y reactivado.`
      : `${p.apellido}, ${p.nombre} asignado.`);
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

function hoyIso() {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
const esPresenteE = e => e === '' || e === 'F' || e === 'CC';
const fmtPesos = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const DIAS_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function quincenaCerrada(q) {
  const c = cierres[quincenaId(q || currentQuincena)];
  return !!(c && c.cerrado);
}
function diasDeQuincena(q) {
  const r = quincenaRange(q);
  const out = [];
  for (let d = r.startDay; d <= r.endDay; d++) out.push(isoDate(q.year, q.month, d));
  return out;
}
function estaValidado(iso) { return !!(partesMeta[iso] && partesMeta[iso].validado); }

// Viáticos de un ítem guardado (compat: el dato viejo era un único número)
function viaticosDe(it) {
  if (Array.isArray(it.viaticos)) return it.viaticos;
  return (Number(it.viatico) || 0) > 0 ? [{ monto: Number(it.viatico) }] : [];
}

// Resumen de un parte guardado: presentes, ausencias, horas, comidas, viáticos
function resumenDia(iso) {
  const items = Object.values((partesAll[iso] && partesAll[iso].items) || {});
  if (!items.length) return null;
  const r = { total: items.length, pres: 0, aus: 0, horas: 0, comidas: 0, via: 0, cc: false };
  items.forEach(it => {
    const e = it.estado || '';
    if (esPresenteE(e)) r.pres++; else r.aus++;
    if (e === 'CC') r.cc = true;
    r.horas += Number(it.horas) || 0;
    if (it.comida) r.comidas++;
    r.via += viaticosDe(it).reduce((s, v) => s + (Number(v.monto) || 0), 0);
  });
  return r;
}

// Estado de un día para pintarlo:
//   ok (validado) · carg (cargado sin validar) · pend (sin parte) · fut · nolab · fer
function estadoDia(iso) {
  const ferNom = feriados[iso];
  const lab    = !esFinde(iso) && !ferNom;
  const r      = resumenDia(iso);
  const val    = estaValidado(iso);
  if (!lab && !(r && r.horas > 0)) return { k: ferNom ? 'fer' : 'nolab', r, val };
  if (val) return { k: 'ok', r, val };
  if (iso > hoyIso()) return { k: 'fut', r, val };
  return { k: r ? 'carg' : 'pend', r, val };
}

// Laborables de la quincena hasta hoy sin validar
function pendientesQuincena(q) {
  const hoy = hoyIso();
  return diasLaborables(q).filter(iso => iso <= hoy && !estaValidado(iso));
}

function renderEstadoTitulo() {
  const q = currentQuincena;
  const el = $('po-estado');
  if (quincenaCerrada(q)) { el.innerHTML = `<span class="po-closed">${icSvg('lock')}Cerrada</span>`; return; }
  const pend = pendientesQuincena(q);
  const hoy  = hoyIso();
  if (!pend.length) {
    const empezo = diasLaborables(q).some(iso => iso <= hoy);
    el.innerHTML = empezo && cuadrilla.length ? `<span class="po-okp">${icSvg('checkSm')}Al día</span>` : '';
    return;
  }
  const soloHoy = pend.length === 1 && pend[0] === hoy && !partesAll[hoy];
  el.innerHTML = `<span class="po-pend">${soloHoy ? 'Hoy sin parte' : `${pend.length} ${pend.length === 1 ? 'día' : 'días'} sin validar`}</span>`;
}

function renderHoy() {
  const el  = $('po-hoy');
  const iso = hoyIso();
  const r   = quincenaRange(currentQuincena);
  const [y, m, d] = iso.split('-').map(Number);
  const enQuincena = y === currentQuincena.year && m === currentQuincena.month && d >= r.startDay && d <= r.endDay;
  const st = enQuincena ? estadoDia(iso) : null;
  if (!st || !cuadrilla.length || st.k === 'nolab' || (st.k === 'fer' && !st.r)) { el.classList.add('hidden'); return; }
  const k = `Hoy · ${DIAS_LARGO[new Date(y, m - 1, d).getDay()].toLowerCase()} ${d}`;
  let t, s, btn, ok = false;
  if (st.val) {
    ok = true; t = 'Parte validado';
    s = st.r ? `${st.r.pres} de ${st.r.total} presentes · ${fmtHoras(st.r.horas)} h` : '';
    btn = `<button type="button" class="foc-btn foc-btn--clear" id="hoy-abrir">${icSvg('eye')}Ver</button>`;
  } else if (st.r) {
    t = 'Parte cargado, falta validar';
    s = `${st.r.pres} de ${st.r.total} presentes · ${fmtHoras(st.r.horas)} h`;
    btn = `<button type="button" class="foc-btn foc-btn--amb" id="hoy-abrir">${icSvg('edit')}Abrir</button>`;
  } else {
    t = 'Parte sin cargar';
    s = `${cuadrilla.length} en la cuadrilla · jornada de ${fmtHoras(constantes.jornadaHoras ?? 8)} h`;
    btn = `<button type="button" class="foc-btn foc-btn--amb" id="hoy-abrir">${icSvg('edit')}Cargar</button>`;
  }
  el.className = 'po-hoy' + (ok ? ' ok' : '');
  el.innerHTML = `<span class="po-sq">${icSvg(ok ? 'checkSm' : 'calendar')}</span>
    <div><div class="po-hoy-k">${k}</div><div class="po-hoy-t">${t}</div>${s ? `<div class="po-hoy-s">${s}</div>` : ''}</div>${btn}`;
  $('hoy-abrir').addEventListener('click', () => onDayClick(iso));
}

function renderCalendar() {
  const q      = currentQuincena;
  const range  = quincenaRange(q);
  const hoy    = hoyIso();
  // Alineación: lunes primero (getDay: 0=Dom..6=Sáb → (getDay+6)%7 → 0=Lun)
  const primerDow = (new Date(q.year, q.month - 1, range.startDay).getDay() + 6) % 7;

  let celdas = DOW.map(d => `<div class="po-dow">${d}</div>`).join('');
  for (let i = 0; i < primerDow; i++) celdas += '<div class="po-cd e"></div>';
  diasDeQuincena(q).forEach(iso => {
    const d = Number(iso.slice(8));
    const { k, r } = estadoDia(iso);
    const ferNom = feriados[iso];
    let m = '', c = '', tip = ferNom || '';   // c: versión corta para el teléfono
    if (k === 'ok')   { m = r ? (r.cc ? 'Lluvia' : `${r.pres}/${r.total}`) : 'Validado'; c = r ? (r.cc ? 'CC' : m) : '✓'; tip = tip || (r ? `Validado · ${r.pres} de ${r.total} presentes · ${fmtHoras(r.horas)} h` : 'Validado'); }
    if (k === 'carg') { m = 'Sin validar'; c = '•'; tip = 'Cargado, falta validar'; }
    if (k === 'pend') { m = 'Cargar'; c = '•'; tip = 'Sin parte'; }
    if (k === 'fer')  { m = 'Feriado'; c = 'F'; }
    if (k === 'fut' && r) { m = 'Cargado'; c = '•'; }
    const dot = r && (r.via > 0 || r.aus > 0) ? '<span class="x" aria-hidden="true"></span>' : '';
    celdas += `<button type="button" class="po-cd ${k} ${iso === hoy ? 'today' : ''}" data-iso="${iso}" title="${esc(tip)}" aria-label="${d} ${esc(tip)}">
      ${dot}<span class="n">${d}</span>${m ? `<span class="m"><span class="ml">${m}</span><span class="mc">${c || m}</span></span>` : ''}</button>`;
  });

  $('cal-container').className = '';
  $('cal-container').innerHTML = `
    <div class="po-cal">${celdas}</div>
    <div class="po-legend">
      <span><i style="background:#dff3e5"></i>Validado (presentes)</span>
      <span><i style="background:#fde6e6"></i>Sin parte</span>
      <span><i style="background:#fbeedd"></i>Feriado o sin validar</span>
      <span><i style="background:#6b3fa0;border-radius:50%;width:7px;height:7px"></i>Con viático o ausencia</span>
    </div>`;
  $('cal-container').querySelectorAll('.po-cd[data-iso]').forEach(cell =>
    cell.addEventListener('click', () => onDayClick(cell.dataset.iso)));
}

function renderCierre() {
  const q       = currentQuincena;
  const cerrada = quincenaCerrada(q);
  const labs    = diasLaborables(q);
  const val     = labs.filter(estaValidado).length;
  const faltan  = labs.length - val;
  const pct     = labs.length ? Math.round(val / labs.length * 100) : 0;

  let msg;
  if (cerrada)        msg = 'Quincena cerrada: solo lectura. El Excel quedó en Drive para RRHH.';
  else if (faltan > 0) { const hasta = pendientesQuincena(q).length; msg = `Faltan validar <b>${faltan} ${faltan === 1 ? 'día' : 'días'}</b>${hasta && hasta < faltan ? ` (${hasta} hasta hoy)` : ''}. Con todos validados se puede cerrar y se envía el Excel a RRHH.`; }
  else                msg = 'Todos los días laborables están validados. Cerrá la quincena para enviar el Excel a RRHH.';

  $('po-cierre').innerHTML = `
    <div class="po-side-t"><span>Cierre de la quincena</span><span>${val} de ${labs.length} días</span></div>
    <div class="po-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Días validados"><i style="width:${pct}%"></i></div>
    <div class="po-prog-t">${msg}</div>
    <div class="po-acts">
      <button type="button" class="foc-btn foc-btn--clear" id="btn-excel-preview">${icSvg('eye')} Ver planilla</button>
      ${cerrada ? `<button type="button" class="foc-btn foc-btn--drive" id="btn-excel-rrhh">${icSvg('sheet')} Excel RRHH</button>` : ''}
      ${cerrada && esAdmin ? `<button type="button" class="foc-btn foc-btn--warn" id="btn-reabrir">${icSvg('unlock')} Reabrir</button>` : ''}
      ${!cerrada ? `<button type="button" class="foc-btn foc-btn--edit" id="btn-cerrar" ${faltan > 0 ? 'disabled title="Primero hay que validar todos los días laborables"' : ''}>${icSvg('lock')} Cerrar quincena</button>` : ''}
    </div>`;
  $('btn-cerrar')?.addEventListener('click', cerrarQuincenaActual);
  $('btn-reabrir')?.addEventListener('click', reabrirQuincenaActual);
  $('btn-excel-rrhh')?.addEventListener('click', onExcelRRHH);
  $('btn-excel-preview')?.addEventListener('click', onExcelPreview);
}

function renderTotales() {
  let horas = 0, comidas = 0, via = 0;
  diasDeQuincena(currentQuincena).forEach(iso => {
    const r = resumenDia(iso);
    if (r) { horas += r.horas; comidas += r.comidas; via += r.via; }
  });
  $('po-totales').innerHTML = `
    <div class="po-side-t"><span>En la quincena</span></div>
    <div class="po-t3">
      <div><span>Horas</span><b>${fmtHoras(horas)}</b></div>
      <div><span>Comidas</span><b title="${fmtPesos(comidas * (constantes.valorComida || 0))}">${comidas}</b></div>
      <div><span>Viáticos</span><b title="${fmtPesos(via)}">${fmtPesos(via)}</b></div>
    </div>`;
}

function renderQuincena() {
  const q = currentQuincena;
  const r = quincenaRange(q);
  $('q-label').textContent = `${r.startDay}–${r.endDay} ${MESES[q.month - 1].slice(0, 3).toLowerCase()} ${q.year}`;
  renderEstadoTitulo();
  renderHoy();
  renderCalendar();
  renderCierre();
  renderTotales();
}

// Días laborables (lun-vie no feriados) de la quincena
function diasLaborables(q) {
  return diasDeQuincena(q).filter(iso => !esFinde(iso) && !feriados[iso]);
}

// Carga (cacheada) el cierre de la quincena actual y re-renderiza
async function showQuincena() {
  const qid = quincenaId(currentQuincena);
  if (cierres[qid] === undefined) {
    try { cierres[qid] = await getCierre(obraKey, qid); }
    catch (_) { cierres[qid] = null; }
  }
  renderQuincena();
}

async function cerrarQuincenaActual() {
  const q   = currentQuincena;
  const qid = quincenaId(q);
  const ok  = await showConfirm(
    'Cerrar quincena',
    `¿Cerrar la quincena ${quincenaLabel(q)}? Quedará en solo lectura. ${esAdmin ? 'Podés reabrirla luego.' : 'Solo un administrador podrá reabrirla.'}`,
    { boton: 'Cerrar', tono: 'info', icono: 'lock' }
  );
  if (!ok) return;
  try {
    await cerrarQuincena(obraKey, qid, sessionCodigo);
    cierres[qid] = { cerrado: true, cerradoPor: sessionCodigo, cerradoEn: Date.now() };
    showToast('Quincena cerrada. Generando Excel de RRHH…');
    renderQuincena();
    // Generar y subir el reporte a Drive en segundo plano (no bloquea el cierre)
    generarReporte(q, { silencioso: false }).catch(() => {});
  } catch (_) {
    showToast('Error al cerrar la quincena.', 'error');
  }
}

async function reabrirQuincenaActual() {
  const q   = currentQuincena;
  const qid = quincenaId(q);
  const ok  = await showConfirm('Reabrir quincena', `¿Reabrir la quincena ${quincenaLabel(q)} para poder editarla?`,
    { boton: 'Reabrir', tono: 'info', icono: 'unlock' });
  if (!ok) return;
  try {
    await reabrirQuincena(obraKey, qid);
    cierres[qid] = null;
    showToast('Quincena reabierta.');
    renderQuincena();
  } catch (_) {
    showToast('Error al reabrir la quincena.', 'error');
  }
}

// Todos los partes de la obra en una lectura: el calendario, el estado y los totales salen de acá.
async function loadCalendarData() {
  try {
    const [fer, todos] = await Promise.all([getFeriados(), getPartesRango(obraKey, '0000-00-00', '9999-12-31')]);
    feriados  = fer || {};
    partesAll = todos || {};
  } catch (_) {
    feriados = {}; partesAll = {};
  }
  partesMeta = {};
  Object.entries(partesAll).forEach(([f, p]) => { partesMeta[f] = (p && p._meta) || { validado: false }; });
  currentQuincena = getQuincena(new Date());
  await showQuincena();
}

// ───────── Parte del día ─────────
function fmtFechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DIAS_LARGO[new Date(y, m - 1, d).getDay()]} ${d} de ${MESES[m - 1].toLowerCase()}`;
}

function esFinde(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) >= 5;  // 5=Sáb, 6=Dom
}

async function onDayClick(iso) {
  if (!cuadrilla.length) {
    showToast('Primero agregá personal a la cuadrilla.', 'warning');
    return;
  }
  await abrirParte(iso);
  $('modal-parte').classList.remove('hidden');
  $('modal-parte').querySelector('.po-sheet').focus({ preventScroll: true });
}

const ESTADOS = [
  { e: 'presente', label: 'Presente' },
  { e: 'AU', label: 'Ausente' },
  { e: 'AC', label: 'Accidente' },
  { e: 'CM', label: 'C. médica', title: 'Carpeta médica' },
];
const ESTADO_LARGO = { AU: 'Ausente', AC: 'Accidente', CM: 'Carpeta médica' };

function stepHtml(cls, valor, label) {
  return `<span class="po-step"><button type="button" data-d="-1" aria-label="Menos horas">−</button><input type="number" class="${cls}" min="0" max="24" step="0.5" inputmode="decimal" value="${valor}" aria-label="${esc(label)}"><button type="button" data-d="1" aria-label="Más horas">+</button></span>`;
}

async function abrirParte(iso) {
  parteFecha = iso;
  const cerrada = quincenaCerrada();
  parteReadonly = cerrada;
  const ferNom  = feriados[iso];
  const noLab   = esFinde(iso) || !!ferNom;

  $('parte-title').textContent = fmtFechaLarga(iso);
  $('parte-info').textContent  = 'Cargando…';
  $('parte-list').innerHTML = '';

  // Cargar parte existente o precargar por defecto
  let parte;
  try { parte = await getParte(obraKey, iso); }
  catch (_) { parte = partesAll[iso] || { items: {}, _meta: { validado: false } }; }
  if (parte && parte.items) partesAll[iso] = { ...(partesAll[iso] || {}), items: parte.items };
  if (parteFecha !== iso) return;   // se pidió otro día mientras cargaba
  const items = parte.items || {};

  // Encabezado: obra, jornada y avisos del día
  const avisos = [];
  if (ferNom)         avisos.push(`<span class="po-mini" style="background:#fbeedd;color:#8a4f0d">Feriado: ${esc(ferNom)}</span>`);
  else if (noLab)     avisos.push('<span class="po-mini">Fin de semana</span>');
  if (cerrada)        avisos.push(`<span class="po-mini">${icSvg('lock')} Quincena cerrada</span>`);
  else if (estaValidado(iso)) avisos.push(`<span class="po-mini po-mini--ok">${icSvg('checkSm')} Validado</span>`);
  $('parte-info').innerHTML = `${esc(obraNombre)} · jornada ${fmtHoras(constantes.jornadaHoras ?? 8)} h ${avisos.join('')}`;

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
  // El tipo de día puede quedar en "Nadie" si toda la cuadrilla está ausente.
  const savedAll      = cuadrilla.length > 0 && cuadrilla.every(p => items[p.id]);
  const todosAusentes = savedAll && cuadrilla.every(p => (items[p.id].estado || '') === 'AU');
  genCond = todosAusentes ? 'AU' : parteDiaCond;

  const genHorasInit  = genCond === 'CC' ? CC_HORAS : (genCond === '' && !noLab ? constantes.jornadaHoras : 0);
  const genComidaInit = genCond === '' && !noLab;

  // Lo que vale para toda la cuadrilla
  const COND = [['', 'Día normal'], ['CC', 'Lluvia (CC)'], ['F', 'Feriado'], ['AU', 'Nadie']];
  $('parte-general').innerHTML = `
    <div class="po-side-t" style="margin-bottom:.5rem"><span>Toda la cuadrilla</span></div>
    <div class="po-seg" role="group" aria-label="Tipo de día">
      ${COND.map(([c, l]) => `<button type="button" data-c="${c}" aria-pressed="${genCond === c}">${l}</button>`).join('')}
    </div>
    <div class="po-gen-row">
      ${stepHtml('', genHorasInit, 'Horas para toda la cuadrilla').replace('class=""', 'id="pg-horas"')}
      <label class="po-tog"><input type="checkbox" id="pg-comida" ${genComidaInit ? 'checked' : ''}><i></i>Comida para todos</label>
    </div>
    <div class="po-gen-note">Lo de acá se aplica a toda la cuadrilla; abajo marcá lo distinto de cada persona.</div>`;

  $('parte-list').innerHTML = cuadrilla.map(p => {
    const guardado = items[p.id];
    const estado  = guardado ? (guardado.estado || '') : parteDiaCond;
    const horas   = guardado ? (guardado.horas ?? 0) : genHorasInit;
    const comida  = guardado ? !!guardado.comida  : genComidaInit;
    const catTxt  = categoriaLabel(p);
    const nom     = `${p.apellido}, ${p.nombre}`;
    return `
      <div class="po-pp" data-id="${esc(p.id)}" data-estado="${esc(estado)}">
        <span class="po-av ${avatarTono(p)}">${esc(iniciales(p))}</span>
        <div class="po-tx"><div class="po-nm">${esc(nom)}</div>
          <div class="po-sb">${catTxt ? `<span>${esc(catTxt)}</span>` : ''}<span class="po-badges"></span></div></div>
        <button type="button" class="po-st-tap" aria-expanded="false" aria-label="Estado de ${esc(nom)}"></button>
        <div class="po-ctl">
          <div class="po-est" role="group" aria-label="Estado de ${esc(nom)}">
            ${ESTADOS.map(s => `<button type="button" data-e="${s.e}" ${s.title ? `title="${s.title}"` : ''}>${s.label}</button>`).join('')}
          </div>
          ${stepHtml('pf-horas', horas, `Horas de ${nom}`)}
          <button type="button" class="po-food ${comida ? 'on' : ''}" aria-pressed="${comida}" title="Comida" aria-label="Comida de ${esc(nom)}">${icSvg('coffee')}</button>
        </div>
        <button type="button" class="po-ib po-ib--fill po-more-btn" aria-expanded="false" title="Viáticos y adjuntos" aria-label="Viáticos y adjuntos de ${esc(nom)}">${icSvg('plus')}</button>
        <div class="po-more">
          <div class="po-more-r"><span class="po-more-k">Viáticos</span><div class="viat-list" data-id="${esc(p.id)}"></div>
            <button type="button" class="foc-btn foc-btn--clear viat-add">${icSvg('plus')}Viático</button></div>
          <div class="po-more-r"><span class="po-more-k">Adjuntos</span><div class="adj-list" data-id="${esc(p.id)}"></div>
            <input type="file" class="adj-input" accept="image/*,application/pdf" hidden>
            <button type="button" class="foc-btn foc-btn--clear adj-btn">${icSvg('clip')}Adjuntar</button></div>
        </div>
      </div>`;
  }).join('');

  // Wiring por fila: estado, horas, comida, desplegar, viáticos y adjuntos
  $('parte-list').querySelectorAll('.po-pp').forEach(row => {
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
    row.querySelectorAll('.po-est button').forEach(b => b.addEventListener('click', () => { setRowEstado(row, b.dataset.e); actualizarResumen(); }));
    row.querySelector('.pf-horas').addEventListener('input', () => { syncRow(row); actualizarResumen(); });
    row.querySelector('.po-food').addEventListener('click', () => {
      const f = row.querySelector('.po-food');
      setFood(f, !f.classList.contains('on'));
      syncRow(row); actualizarResumen();
    });
    const toggle = () => {
      const open = row.classList.toggle('open');
      row.querySelector('.po-st-tap').setAttribute('aria-expanded', open);
      row.querySelector('.po-more-btn').setAttribute('aria-expanded', open);
    };
    row.querySelector('.po-st-tap').addEventListener('click', toggle);
    row.querySelector('.po-more-btn').addEventListener('click', toggle);
    renderAdjuntos(id);
    renderViaticos(id);
    syncRow(row);
  });

  // Controles generales.
  // Cambiar el TIPO de día es una acción masiva (aplica a toda la cuadrilla);
  // tocar solo horas/comida afecta únicamente a los presentes.
  $('parte-general').querySelectorAll('.po-seg button').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.c;
    if (c === 'CC')      { $('pg-horas').value = CC_HORAS; $('pg-comida').checked = false; }
    else if (c === 'F')  { $('pg-horas').value = 0;        $('pg-comida').checked = false; }
    else if (c === 'AU') { $('pg-horas').value = 0;        $('pg-comida').checked = false; }
    else                 { $('pg-horas').value = constantes.jornadaHoras ?? 8; $('pg-comida').checked = true; }
    applyCondToAll(c);
    actualizarResumen();
  }));
  $('pg-horas').addEventListener('input', () => { applyHorasComidaPresentes(); actualizarResumen(); });
  $('pg-comida').addEventListener('change', () => { applyHorasComidaPresentes(); actualizarResumen(); });

  // Modo lectura si la quincena está cerrada
  $('modal-parte').querySelectorAll('#parte-general button, #parte-general input, .po-est button, .po-step button, .po-step input, .po-food')
    .forEach(el => { el.disabled = cerrada; });
  $('parte-list').querySelectorAll('.adj-btn, .viat-add').forEach(b => { b.style.display = cerrada ? 'none' : ''; });
  $('parte-footer').style.display = cerrada ? 'none' : '';

  // Navegación entre días de la quincena
  const dias = diasDeQuincena(currentQuincena);
  $('parte-prev').disabled = dias.indexOf(iso) <= 0;
  $('parte-next').disabled = dias.indexOf(iso) >= dias.length - 1;

  pintarBotonValidar();
  actualizarResumen();
  parteSnapshot = JSON.stringify(recolectarItems());
}

// Próximo día para "Validar y seguir": laborable hasta hoy sin validar, primero los siguientes.
function proximoPendiente(iso) {
  const pend = pendientesQuincena(currentQuincena).filter(d => d !== iso);
  return pend.find(d => d > iso) || pend[0] || null;
}

function pintarBotonValidar() {
  const iso = parteFecha;
  const btn = $('parte-validar');
  btn.disabled = false;
  btn.removeAttribute('title');
  if (estaValidado(iso)) {
    btn.className = 'foc-btn foc-btn--warn';
    btn.innerHTML = `${icSvg('undo')} Quitar validación`;
  } else if (iso > hoyIso()) {
    btn.className = 'foc-btn foc-btn--grn-solid';
    btn.innerHTML = `${icSvg('checkSm')} Validar día`;
    btn.disabled = true;
    btn.title = 'Un día se puede validar desde ese mismo día';
  } else {
    btn.className = 'foc-btn foc-btn--grn-solid';
    btn.innerHTML = `${icSvg('checkSm')} ${proximoPendiente(iso) ? 'Validar y seguir' : 'Validar día'}`;
  }
}

function setFood(btn, on) {
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on);
}

// Refleja el estado de la fila: botón activo, pastilla del teléfono y fondo de ausente.
function syncRow(row) {
  const estado   = row.dataset.estado || '';
  const presente = esPresenteE(estado);
  const k        = presente ? 'presente' : estado;
  row.querySelectorAll('.po-est button').forEach(b => {
    const on = b.dataset.e === k;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  row.classList.toggle('aus', !presente);
  const horas  = parseFloat(row.querySelector('.pf-horas').value) || 0;
  const comida = row.querySelector('.po-food').classList.contains('on');
  const tap    = row.querySelector('.po-st-tap');
  tap.dataset.k = k;
  tap.innerHTML = `${presente ? `${fmtHoras(horas)} h · ${comida ? 'comida' : 'sin comida'}` : ESTADO_LARGO[estado]} ${icSvg('chevron')}`;
}

// Cambia el estado de una fila (persona) desde los botones.
//   'presente' → toma la condición del día ('', F o CC) + horas/comida generales
//   'AU' | 'AC' | 'CM' → pone horas en 0 y saca la comida
function setRowEstado(row, kind) {
  const horasInp = row.querySelector('.pf-horas');
  const food     = row.querySelector('.po-food');
  let estado;
  if (kind === 'presente') {
    estado = parteDiaCond;                       // '', F o CC
    horasInp.value = parseFloat($('pg-horas').value) || 0;
    setFood(food, $('pg-comida').checked);
  } else {
    estado = kind;                               // AU, AC o CM
    horasInp.value = 0;
    setFood(food, false);
  }
  row.dataset.estado = estado;
  syncRow(row);
}

// Cambio del TIPO de día (acción masiva sobre toda la cuadrilla).
//   Nadie: marca AU a todos (incluye accidente/carpeta médica).
//   Normal/Feriado/CC: pone a todos como Presente con esa condición,
//   preservando Accidente y Carpeta Médica (excepciones médicas reales).
function applyCondToAll(cond) {
  genCond = cond;
  $('parte-general').querySelectorAll('.po-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === cond));
  const rows = $('parte-list').querySelectorAll('.po-pp');
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
  $('parte-list').querySelectorAll('.po-pp').forEach(row => {
    const e = row.dataset.estado;
    if (e === 'AU' || e === 'AC' || e === 'CM') return;   // excepción por persona
    row.querySelector('.pf-horas').value = genHoras;
    setFood(row.querySelector('.po-food'), genComida);
    syncRow(row);
  });
}

// Pie de la hoja: presentes, ausencias, horas, comidas y viáticos del día
function actualizarResumen() {
  const items = Object.values(recolectarItems());
  let pres = 0, aus = 0, med = 0, horas = 0, com = 0, via = 0;
  items.forEach(it => {
    if (esPresenteE(it.estado)) pres++; else if (it.estado === 'AU') aus++; else med++;
    horas += it.horas; if (it.comida) com++;
    via += (it.viaticos || []).reduce((s, v) => s + (Number(v.monto) || 0), 0);
  });
  $('parte-sum').innerHTML = [
    `<span class="po-mini po-mini--ok">${pres} ${pres === 1 ? 'presente' : 'presentes'}</span>`,
    aus ? `<span class="po-mini po-mini--warn">${aus} ${aus === 1 ? 'ausente' : 'ausentes'}</span>` : '',
    med ? `<span class="po-mini po-mini--vio">${med} con accidente o carpeta</span>` : '',
    `<span class="po-mini">${fmtHoras(horas)} h</span>`,
    `<span class="po-mini">${com} ${com === 1 ? 'comida' : 'comidas'}</span>`,
    via ? `<span class="po-mini po-mini--vio">Viáticos ${fmtPesos(via)}</span>` : '',
  ].join('');
}

// Pastillas de viáticos y adjuntos al lado del nombre
function pintarBadges(id) {
  const row = $('parte-list').querySelector(`.po-pp[data-id="${id}"]`);
  if (!row) return;
  const v = parteViaticos[id] || [];
  const a = parteAdjuntos[id] || [];
  const tot = v.reduce((s, x) => s + (Number(x.monto) || 0), 0);
  row.querySelector('.po-badges').innerHTML =
    (v.length ? `<span class="po-mini po-mini--vio">Viático ${fmtPesos(tot)}</span>` : '') +
    (a.length ? `<span class="po-mini">${icSvg('clip')} ${a.length}</span>` : '');
  row.querySelector('.po-more-btn').classList.toggle('on', !!(v.length || a.length));
}

function recolectarItems() {
  const items = {};
  $('parte-list').querySelectorAll('.po-pp').forEach(row => {
    const id = row.dataset.id;
    items[id] = {
      horas:    parseFloat(row.querySelector('.pf-horas').value) || 0,
      comida:   row.querySelector('.po-food').classList.contains('on'),
      estado:   row.dataset.estado || '',
      viaticos: parteViaticos[id] || [],
      adjuntos: parteAdjuntos[id] || []
    };
  });
  return items;
}

function hayCambios() {
  return !parteReadonly && JSON.stringify(recolectarItems()) !== parteSnapshot;
}

async function guardarParte(silencioso) {
  const items = recolectarItems();
  await saveParteDia(obraKey, parteFecha, items);
  partesAll[parteFecha] = { ...(partesAll[parteFecha] || {}), items };
  parteSnapshot = JSON.stringify(items);
  if (!silencioso) showToast('Parte guardado.');
}

function cerrarHojaParte() {
  $('modal-parte').classList.add('hidden');
  renderQuincena();
}

async function cerrarParte() {
  if (hayCambios()) {
    const ok = await showConfirm('Cambios sin guardar',
      'Hay cambios en el parte que todavía no se guardaron. Si cerrás, se pierden.',
      { boton: 'Descartar cambios', tono: 'del', icono: 'trash', cancelar: 'Seguir editando' });
    if (!ok) return;
  }
  cerrarHojaParte();
}

// Ir al día anterior o siguiente sin cerrar: lo cargado se guarda antes de cambiar.
async function irDia(delta) {
  const dias = diasDeQuincena(currentQuincena);
  const destino = dias[dias.indexOf(parteFecha) + delta];
  if (!destino) return;
  if (hayCambios()) {
    try { await guardarParte(false); }
    catch (_) { showToast('No se pudo guardar el parte. Probá de nuevo.', 'error'); return; }
  }
  await abrirParte(destino);
}

async function onGuardarParte() {
  const btn = $('parte-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await guardarParte(false);
    cerrarHojaParte();
  } catch (_) {
    showToast('Error al guardar el parte.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

async function onValidarDia() {
  const iso = parteFecha;
  const yaValidado = estaValidado(iso);
  const btn = $('parte-validar');
  btn.disabled = true;
  try {
    if (yaValidado) {
      await setValidadoDia(obraKey, iso, false, sessionCodigo);
      partesMeta[iso] = { validado: false };
      showToast('Validación quitada.');
      await abrirParte(iso);
    } else {
      const sig = proximoPendiente(iso);
      await guardarParte(true);                       // persistir lo cargado
      await setValidadoDia(obraKey, iso, true, sessionCodigo);
      partesMeta[iso] = { validado: true, validadoPor: sessionCodigo, validadoEn: Date.now() };
      showToast('Día validado.');
      if (sig) await abrirParte(sig);
      else cerrarHojaParte();
    }
    renderQuincena();
  } catch (_) {
    showToast('Error al actualizar la validación.', 'error');
    pintarBotonValidar();
  }
}

// ───────── Configuración de la obra ─────────
function updateCfgBar() {
  $('cfg-jornada').textContent = `${fmtHoras(constantes.jornadaHoras ?? 0)} h`;
  $('cfg-comida').textContent  = fmtPesos(constantes.valorComida ?? 0);
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
    if (currentQuincena) renderQuincena();
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
  pintarBadges(id);
}

async function subirAdjunto(id, file, btn) {
  const orig = btn.innerHTML;
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
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// ───────── Viáticos del parte ─────────
function renderViaticos(id) {
  const cont = $('parte-list').querySelector(`.viat-list[data-id="${id}"]`);
  if (!cont) return;
  const list = parteViaticos[id] || [];
  pintarBadges(id);
  actualizarResumen();
  if (!list.length) { cont.innerHTML = '<span class="viat-empty">Sin viáticos.</span>'; return; }
  cont.innerHTML = list.map((v, i) => `
    <span class="viat-chip">
      <span class="viat-monto">$${Number(v.monto || 0).toLocaleString('es-AR')}</span>
      <span class="viat-motivo">${esc(v.motivo || 'Sin motivo')}</span>
      ${v.adjunto && v.adjunto.url ? `<a href="${esc(v.adjunto.url)}" target="_blank" rel="noopener" title="Ver adjunto">${icSvg('clip')}</a>` : ''}
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
  finally { if (btn) { btn.disabled = false; btn.innerHTML = `${icSvg('sheet')} Excel RRHH`; } }
}

async function onExcelPreview() {
  const btn = $('btn-excel-preview');
  if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
  try { await previewReporte(currentQuincena); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = `${icSvg('eye')} Ver planilla`; } }
}

// ───────── Init ─────────
document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }
  if (!obraKey)    { window.location.href = 'personal.html'; return; }
  sessionCodigo = _s.codigo;

  $('hdr-name').textContent = _s.nombre;
  $('hdr-obra').textContent = obraNombre;
  $('po-obra').textContent  = obraNombre;
  // Un jefe con una sola obra entra directo: volver lo lleva al menú
  $('btn-back').addEventListener('click', () => { window.location.href = params.get('unica') ? 'menu.html' : 'personal.html'; });
  $('cal-prev').addEventListener('click', () => { currentQuincena = prevQuincena(currentQuincena); showQuincena(); });
  $('cal-next').addEventListener('click', () => { currentQuincena = nextQuincena(currentQuincena); showQuincena(); });

  // Modal personal
  $('btn-add-personal').addEventListener('click', openPadron);
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
  $('modal-padron-close').addEventListener('click',  () => $('modal-padron').classList.add('hidden'));
  $('modal-padron-cancel').addEventListener('click', () => $('modal-padron').classList.add('hidden'));
  $('padron-search').addEventListener('input', renderPadronModal);
  $('padron-ver-inactivos').addEventListener('change', renderPadronModal);
  $('btn-incorporar').addEventListener('click', () => {
    $('modal-padron').classList.add('hidden');
    openAddPersonal();
  });

  // Modal parte del día
  $('modal-parte-close').addEventListener('click', cerrarParte);
  $('parte-prev').addEventListener('click', () => irDia(-1));
  $('parte-next').addEventListener('click', () => irDia(1));
  // Botones − / + de las horas (generales y por persona)
  $('modal-parte').addEventListener('click', e => {
    const b = e.target.closest('.po-step button');
    if (!b || b.disabled) return;
    const inp = b.parentNode.querySelector('input');
    inp.value = Math.min(24, Math.max(0, (parseFloat(inp.value) || 0) + 0.5 * Number(b.dataset.d)));
    inp.dispatchEvent(new Event('input'));
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || $('modal-parte').classList.contains('hidden')) return;
    if (!$('modal-viatico').classList.contains('hidden') || !$('modal-excel-preview').classList.contains('hidden')) return;
    cerrarParte();
  });
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
  $('btn-cfg-jornada').addEventListener('click', openConfigObra);
  $('btn-cfg-comida').addEventListener('click', openConfigObra);
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
