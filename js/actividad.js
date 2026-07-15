/* VIMECO S.A. — Feed de Actividad / Novedades (solo admins) */

const $ = id => document.getElementById(id);

// Ventana en la que una novedad todavía cuenta como "sin ver". El feed se puede
// mirar hacia atrás sin límite, pero lo viejo ya no reclama atención (ni infla
// el badge del menú).
const UNSEEN_DAYS = 7;

let allEvents     = [];          // feed completo; el rango se aplica al mostrar
let currentFilter = 'all';
let seenKey       = 'vimeco_actividad_vistas';
let rangeKey      = 'vimeco_actividad_rango';
let seen          = new Set();   // claves de eventos marcados como vistos
let isSuper       = false;       // solo Administración (código 0000) puede borrar

// preset: '7' | '30' | '90' | 'all' | 'custom'
const range = { preset: '30', desde: '', hasta: '' };

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function tipoMeta(tipo) {
  switch (tipo) {
    case 'oc':      return { label: 'OC',      icon: 'print',  cls: 'act-t-oc' };
    case 'adjunto': return { label: 'Adjunto', icon: 'clip',   cls: 'act-t-adjunto' };
    case 'caja':    return { label: 'Caja',    icon: 'dollar', cls: 'act-t-caja' };
    default:        return { label: '—',       icon: 'check',  cls: '' };
  }
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  // Al mirar hacia atrás varios años, el día sin año es ambiguo.
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return new Date(ts).toLocaleDateString('es-AR', opts);
}

function fmtHora(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// Un evento sólo puede estar "sin ver" mientras es reciente.
function esReciente(e) {
  return (Date.now() - (e.timestamp || 0)) <= UNSEEN_DAYS * 86400000;
}
function sinVer(e) {
  return esReciente(e) && !seen.has(e.key);
}

// Persiste las vistas. Sólo se guardan las de eventos recientes: pasada la
// ventana el evento ya no cuenta como sin ver, así que la clave no hace falta.
function persistSeen() {
  const vigentes = new Set(allEvents.filter(esReciente).map(e => e.key));
  const arr = [...seen].filter(k => vigentes.has(k));
  seen = new Set(arr);
  try { localStorage.setItem(seenKey, JSON.stringify(arr)); } catch (_) {}
}

function marcarVista(key) {
  if (seen.has(key)) return;
  seen.add(key);
  persistSeen();
  render();
}

function updateBanner() {
  const n = allEvents.filter(sinVer).length;
  const banner = $('act-banner');
  if (n > 0) {
    banner.textContent = `${n} novedad${n !== 1 ? 'es' : ''} sin ver`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// Límites del rango elegido, en timestamps.
function rangeBounds() {
  if (range.preset === 'all') return { from: 0, to: Infinity };
  if (range.preset === 'custom') {
    return {
      from: range.desde ? new Date(range.desde + 'T00:00:00').getTime() : 0,
      to:   range.hasta ? new Date(range.hasta + 'T23:59:59').getTime() : Infinity
    };
  }
  return { from: Date.now() - Number(range.preset) * 86400000, to: Infinity };
}

function rangeLabel() {
  if (range.preset === 'all')    return 'en el historial';
  if (range.preset === 'custom') return 'en el rango elegido';
  return `en los últimos ${range.preset} días`;
}

function getVisible() {
  const { from, to } = rangeBounds();
  return allEvents.filter(e => {
    const ts = e.timestamp || 0;
    if (ts < from || ts > to) return false;
    return currentFilter === 'all' || e.tipo === currentFilter;
  });
}

function persistRange() {
  try { localStorage.setItem(rangeKey, JSON.stringify(range)); } catch (_) {}
}

function render() {
  const list   = $('act-list');
  const events = getVisible();

  $('act-count').textContent = events.length
    ? `${events.length} ${events.length !== 1 ? 'operaciones' : 'operación'}`
    : '';

  updateBanner();

  if (!events.length) {
    list.innerHTML = `<div class="hist-empty">No hay operaciones ${esc(rangeLabel())}.</div>`;
    return;
  }

  let html    = '';
  let lastDay = null;
  events.forEach(e => {
    const dk = dayKey(e.timestamp);
    if (dk !== lastDay) {
      html += `<div class="act-day">${esc(dayLabel(e.timestamp))}</div>`;
      lastDay = dk;
    }
    const meta     = tipoMeta(e.tipo);
    const reciente = esReciente(e);
    const vista    = !sinVer(e);
    const drive  = e.driveUrl
      ? `<a class="btn btn-sm btn-primary act-drive" data-key="${esc(e.key)}" href="${esc(e.driveUrl)}" target="_blank" rel="noopener">Abrir en Drive</a>`
      : '<span class="act-nodrive">sin link</span>';
    // Fuera de la ventana de novedades no se ofrece "marcar vista": ya no aplica.
    const accion = !reciente ? ''
      : vista
        ? `<span class="act-seen-label">${icSvg('check')} Vista</span>`
        : `<button class="btn btn-sm btn-outline act-mark" data-key="${esc(e.key)}">Marcar vista</button>`;
    const borrar = isSuper
      ? `<button class="btn btn-sm btn-danger act-del" data-key="${esc(e.key)}">Borrar</button>`
      : '';
    const cardCls = !reciente ? 'act-card-old' : (vista ? 'act-card-seen' : 'act-card-unseen');
    html += `
      <div class="hist-card act-card ${cardCls}">
        <div class="act-row">
          <span class="act-badge ${meta.cls}">${icSvg(meta.icon)} ${meta.label}</span>
          <div class="act-body">
            <div class="act-title">${esc(e.titulo)}</div>
            <div class="act-detalle">${esc(e.detalle)}</div>
            <div class="act-meta">${esc(e.usuario?.nombre || '—')} · ${fmtHora(e.timestamp)}</div>
          </div>
          <div class="act-actions">${drive}${accion}${borrar}</div>
        </div>
      </div>`;
  });
  list.innerHTML = html;

  // Abrir en Drive también marca como vista (sin frenar la apertura del link)
  list.querySelectorAll('.act-drive').forEach(a =>
    a.addEventListener('click', () => marcarVista(a.dataset.key)));
  list.querySelectorAll('.act-mark').forEach(b =>
    b.addEventListener('click', () => marcarVista(b.dataset.key)));
  list.querySelectorAll('.act-del').forEach(b =>
    b.addEventListener('click', () => borrarNovedad(b.dataset.key)));
}

async function borrarNovedad(key) {
  const ev = allEvents.find(e => e.key === key);
  const ok = await showConfirm(
    'Borrar novedad',
    `¿Borrar esta novedad para todos? "${ev?.titulo || ''}". Esta acción no se puede deshacer.`
  );
  if (!ok) return;
  try {
    await deleteActividad(key);
    allEvents = allEvents.filter(e => e.key !== key);
    persistSeen();
    render();
    showToast('Novedad borrada.');
  } catch (_) {
    showToast('Error al borrar la novedad.', 'error');
  }
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.act-filter').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
  render();
}

function syncRangeUI() {
  document.querySelectorAll('.act-range').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range.preset));
  $('act-desde').value = range.desde;
  $('act-hasta').value = range.hasta;
}

function setRange(preset) {
  range.preset = preset;
  if (preset !== 'custom') { range.desde = ''; range.hasta = ''; }
  syncRangeUI();
  persistRange();
  render();
}

// Tocar una fecha implica rango a medida.
function onCustomDate() {
  range.desde  = $('act-desde').value;
  range.hasta  = $('act-hasta').value;
  range.preset = (range.desde || range.hasta) ? 'custom' : '30';
  syncRangeUI();
  persistRange();
  render();
}

document.addEventListener('DOMContentLoaded', async () => {
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) {}
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code') || sess?.codigo;
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name') || sess?.nombre;
  if (!code) { window.location.href = 'index.html'; return; }

  $('hdr-name').textContent = name || '';

  $('btn-back').addEventListener('click', () => { window.location.href = 'menu.html'; });
  // Sólo admins acceden a Novedades
  let isAdmin = code === '0000';
  if (!isAdmin) {
    try { const u = await getUsuario(code); isAdmin = !!(u && u.admin); } catch (_) {}
  }
  if (!isAdmin) { window.location.href = 'menu.html'; return; }

  // Solo Administración (super-admin 0000) puede borrar novedades para todos.
  isSuper = code === '0000';

  seenKey  = `vimeco_actividad_vistas_${code}`;
  rangeKey = `vimeco_actividad_rango_${code}`;
  try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]')); } catch (_) { seen = new Set(); }
  try { Object.assign(range, JSON.parse(localStorage.getItem(rangeKey) || 'null') || {}); } catch (_) {}

  document.querySelectorAll('.act-filter').forEach(b =>
    b.addEventListener('click', () => setFilter(b.dataset.filter)));
  document.querySelectorAll('.act-range').forEach(b =>
    b.addEventListener('click', () => setRange(b.dataset.range)));
  $('act-desde').addEventListener('change', onCustomDate);
  $('act-hasta').addEventListener('change', onCustomDate);
  syncRangeUI();

  try {
    // Se baja el feed completo; el rango elegido se aplica al mostrar.
    allEvents = await getActividad(null);
  } catch (e) {
    $('act-list').innerHTML = '<div class="hist-empty">No se pudo cargar la actividad. Revisá tu conexión.</div>';
    console.error('getActividad:', e);
    return;
  }

  render();

  // El panel de OC sin respaldo no depende del feed ni de sus filtros: se carga
  // aparte para no demorar las novedades si /historial tarda o falla.
  cargarSinRespaldo(code);
});

// ===================================================
//  OC sin respaldo en Drive
// ===================================================

let sinRespaldoOCs = [];

async function cargarSinRespaldo(code) {
  try {
    sinRespaldoOCs = ocsSinRespaldo(await getHistorial(code, true));
  } catch (e) {
    console.warn('sin respaldo:', e);
    return;
  }
  renderSinRespaldo();
}

function renderSinRespaldo() {
  const box = $('act-sinrespaldo');
  if (!sinRespaldoOCs.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');

  // dayLabel() da "miércoles, 18 de junio": demasiado largo para un chip.
  const fecha = ts => new Date(ts || 0).toLocaleDateString('es-AR');

  const chips = sinRespaldoOCs.map(oc => `
    <div class="act-alert-oc">
      <b>${esc(oc.nroOC)}</b>
      <span>${esc(oc.obra || 'Sin obra')} · ${esc(fecha(oc.timestamp))}</span>
    </div>`).join('');

  const n = sinRespaldoOCs.length;
  box.innerHTML = `
    <div class="act-alert-hd">${icSvg('alert')} ${n} ${n === 1 ? 'orden sin respaldo' : 'órdenes sin respaldo'} en Drive</div>
    <div class="act-alert-sub">Su PDF no quedó archivado en Drive, o se archivó pero no se registró dónde.</div>
    <div class="act-alert-list">${chips}</div>
    <div class="act-alert-actions">
      <button class="btn btn-sm btn-secondary" id="act-resubir">${icSvg('folder')} Resubir a Drive</button>
    </div>`;

  $('act-resubir').addEventListener('click', resubirTodas);
}

async function resubirTodas() {
  if (typeof uploadToDrive !== 'function') { toast('Drive no está configurado.', 'error'); return; }
  const list = [...sinRespaldoOCs];
  if (!list.length) return;

  const btn = $('act-resubir');
  btn.disabled = true;

  let ok = 0;
  const fallaron = [];
  for (const [i, oc] of list.entries()) {
    btn.innerHTML = `<span class="spinner"></span> Subiendo ${i + 1} de ${list.length}…`;
    try { await resubirOC(oc); ok++; }
    catch (e) { fallaron.push(`${oc.nroOC} (${e.message})`); }
  }

  sinRespaldoOCs = list.filter(oc => !driveFolderId(oc));
  btn.disabled = false;
  btn.innerHTML = icSvg('folder') + ' Resubir a Drive';
  renderSinRespaldo();

  if (fallaron.length) toast(`${ok} subidas. Fallaron: ${fallaron.join(', ')}`, 'warning');
  else toast(`Listo: ${ok} ${ok === 1 ? 'orden subida' : 'órdenes subidas'} a Drive.`, 'success');
}
