/* VIMECO S.A. — Feed de Actividad / Novedades (permiso `novedades`) */

const $ = id => document.getElementById(id);

// Ventana en la que una novedad todavía cuenta como "sin ver". El feed se puede
// mirar hacia atrás sin límite, pero lo viejo ya no reclama atención (ni infla
// el badge del menú).
const UNSEEN_DAYS = 7;

let allEvents     = [];          // feed completo; el rango se aplica al mostrar
let currentFilter = 'all';
let searchQuery   = '';
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
    case 'factura': return { label: 'Factura', icon: 'file',   cls: 'act-t-factura' };
    case 'caja':    return { label: 'Caja',    icon: 'dollar', cls: 'act-t-caja' };
    case 'remito':  return { label: 'Remito',  icon: 'cart',   cls: 'act-t-remito' };
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

// OC del historial por número, para buscar novedades por los ítems comprados:
// el evento no guarda los ítems, la OC sí. Se llena cuando cargan los paneles;
// hasta entonces la búsqueda sólo mira el texto del evento.
let ocPorNro = new Map();

function ocDeEvento(e) {
  const nro = e.nroOC || (e.tipo === 'oc' ? nroDeTitulo(e.titulo) : null);
  return nro ? ocPorNro.get(nro) : null;
}

let histAll      = [];   // /historial del más nuevo al más viejo: la comparación de precios de la ficha
let remitosPorOC = {};   // nroOC → remitos (del más nuevo al más viejo); llega después que el historial

// De varios candidatos, el cargado más cerca de la novedad.
function masCercano(lista, ts, tsDe) {
  return lista.reduce((m, x) =>
    !m || Math.abs((tsDe(x) || 0) - ts) < Math.abs((tsDe(m) || 0) - ts) ? x : m, null);
}

// El remito del que habla la novedad. El evento sólo guarda su número, en el
// título ("Remito 0001-12 — Proveedor"). Si lo borraron, no hay ficha que abrir.
function remitoDeEvento(e) {
  if (e.tipo !== 'remito') return null;
  const m = /^Remito\s+(.+?)\s+—/.exec(e.titulo || '');
  if (!m) return null;
  const rems = (remitosPorOC[e.nroOC] || []).filter(r => String(r.nro) === m[1]);
  return masCercano(rems, e.timestamp || 0, r => r.timestamp);
}

// La factura de la novedad, entre las registradas en la OC: el evento guarda el
// nombre del archivo al principio del detalle. Sin coincidencia de nombre no se
// adivina: abrir otra factura sería peor que no ofrecer el botón.
function facturaDeEvento(e, oc) {
  if (e.tipo !== 'factura' || !oc) return null;
  const nombre = String(e.detalle || '').split(' · ')[0];
  const facts  = facturasDeOC(oc).filter(f => f.nombre === nombre);
  return masCercano(facts, e.timestamp || 0, f => f.ts);
}

// Debajo del detalle. En la novedad de una OC, lo mismo que en el Historial: el
// sello de entrega y las pastillas de su factura y sus remitos.
function docsHtml(e, oc) {
  if (!oc || e.tipo !== 'oc') return '';
  const facts = facturasDeOC(oc);
  const rems  = remitosPorOC[oc.nroOC] || [];
  const ent   = oc.entrega?.estado;
  const sello = ent === 'parcial' || ent === 'completa'
    ? `<span class="rem-badge rem-badge--${ent}">${ent === 'parcial' ? 'Entrega parcial' : 'Entregada'}</span>` : '';
  if (!sello && !facts.length && !rems.length) return '';

  const pill = (tipo, txt, varios) =>
    `<button class="hist-doc hist-doc--${tipo}" data-doc="${tipo}" aria-expanded="false">${icSvg(tipo === 'fact' ? 'file' : 'truck')}${esc(txt)}${
      varios ? icSvg('chevron', 'hist-doc-chev') : ''}</button>`;

  return `<div class="hist-docs">
      ${sello}
      ${facts.length ? pill('fact', facts.length > 1 ? `Facturas · ${facts.length}` : 'Factura', facts.length > 1) : ''}
      ${rems.length  ? pill('rem',  rems.length  > 1 ? `Remitos · ${rems.length}` : `Remito ${rems[0].nro || ''}`, rems.length > 1) : ''}
    </div>${docsListasHtml(facts, rems)}`;
}

// El texto se busca sobre título y detalle, que es donde viven proveedor, obra
// y monto, más el nroOC de los eventos que lo guardan aparte y —si el evento es
// de una OC (la OC, su factura o su remito)— la descripción de sus ítems. Cada
// término puede salir de cualquiera de las dos partes. Se combina con el filtro
// de tipo y el rango, no los reemplaza.
const _hayCacheEv = new WeakMap();
function coincideTexto(e, terms) {
  if (!terms.length) return true;
  let hay = _hayCacheEv.get(e);
  if (hay === undefined) {
    hay = normTxt(`${e.titulo || ''} ${e.detalle || ''} ${e.nroOC || ''} ${e.usuario?.nombre || ''}`);
    _hayCacheEv.set(e, hay);
  }
  const oc = ocDeEvento(e);
  const hayOC = oc ? haystackOC(oc) : '';
  return terms.every(t => hay.includes(t) || hayOC.includes(t));
}

function getVisible() {
  const { from, to } = rangeBounds();
  const terms = terminosBusqueda(searchQuery);
  return allEvents.filter(e => {
    const ts = e.timestamp || 0;
    if (ts < from || ts > to) return false;
    if (currentFilter !== 'all' && e.tipo !== currentFilter) return false;
    return coincideTexto(e, terms);
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
    list.innerHTML = searchQuery.trim()
      ? `<div class="hist-empty">No hay operaciones que coincidan con “${esc(searchQuery.trim())}” ${esc(rangeLabel())}.</div>`
      : `<div class="hist-empty">No hay operaciones ${esc(rangeLabel())}.</div>`;
    return;
  }

  const terms = terminosBusqueda(searchQuery);
  let html    = '';
  let lastDay = null;
  // `act-count` sigue contando todo el rango; acá se pinta sólo la página.
  const page = pager.take('act', events);
  page.forEach(e => {
    const dk = dayKey(e.timestamp);
    if (dk !== lastDay) {
      html += `<div class="act-day">${esc(dayLabel(e.timestamp))}</div>`;
      lastDay = dk;
    }
    const meta     = tipoMeta(e.tipo);
    const reciente = esReciente(e);
    const vista    = !sinVer(e);
    // Las acciones son las pastillas de las fichas (foc-btn), en un renglón al
    // pie de la tarjeta: Borrar queda aparte, a la derecha.
    const drive  = e.driveUrl
      ? `<a class="foc-btn foc-btn--drive act-drive" data-key="${esc(e.key)}" href="${esc(e.driveUrl)}" target="_blank" rel="noopener" title="Abrir la carpeta en Drive">${icSvg('folder')}Drive</a>`
      : '';
    // Fuera de la ventana de novedades no se ofrece "marcar vista": ya no aplica.
    const accion = !reciente ? ''
      : vista
        ? `<span class="act-seen-label">${icSvg('check')} Vista</span>`
        : `<button class="foc-btn foc-btn--clear act-mark" data-key="${esc(e.key)}">${icSvg('check')}Marcar vista</button>`;
    const borrar = isSuper
      ? `<button class="foc-btn foc-btn--del act-del" data-key="${esc(e.key)}" title="Borrar la novedad para todos">${icSvg('trash')}Borrar</button>`
      : '';
    const ocEv    = ocDeEvento(e);
    // Lo que abre la tarjeta: cada novedad, su propio documento. La de un
    // remito, su ficha; la de una factura, el archivo; el resto, la ficha de la
    // OC. Las de factura y remito suman el camino a su OC.
    const rem = remitoDeEvento(e);
    const fac = facturaDeEvento(e, ocEv);
    const verBtn = (que, cls, icon, txt) =>
      `<button class="foc-btn foc-btn--${cls} act-ver" data-ver="${que}">${icSvg(icon)}${txt}</button>`;
    const ver = rem  ? verBtn('rem', 'rem', 'truck', 'Ver remito')
              : fac  ? verBtn('fact', 'fact', 'file', 'Ver factura')
              : ocEv ? verBtn('oc', 'edit', 'eye', e.tipo === 'oc' ? 'Ver ficha' : 'Ver OC')
              : '';
    const verOC = (rem || fac) && ocEv
      ? `<button class="foc-btn foc-btn--edit act-oc" title="Ver la ficha de la OC ${esc(ocEv.nroOC)}">${icSvg('eye')}Ver OC</button>`
      : '';
    const cardCls = !reciente ? 'act-card-old' : (vista ? 'act-card-seen' : 'act-card-unseen');
    html += `
      <div class="hist-card act-card ${cardCls}" data-key="${esc(e.key)}">
        <div class="act-row">
          <span class="act-badge ${meta.cls}">${icSvg(meta.icon)} ${meta.label}</span>
          <div class="act-body">
            <div class="act-title">${esc(e.titulo)}</div>
            <div class="act-detalle">${esc(e.detalle)}</div>
            ${docsHtml(e, ocEv)}
            ${hitsHtml(ocEv, itemsCoincidentes(ocEv, terms), esc)}
            <div class="act-meta">${esc(e.usuario?.nombre || '—')} · ${fmtHora(e.timestamp)}</div>
            <div class="act-actions">${ver}${verOC}${drive}${accion}${borrar}</div>
          </div>
        </div>
      </div>`;
  });
  list.innerHTML = html;

  // Fichas y documentos de cada tarjeta. Abrir el documento de la novedad
  // también la marca como vista, igual que abrirla en Drive.
  const porKey = new Map(page.map(e => [e.key, e]));
  list.querySelectorAll('.act-card').forEach(card => {
    const e  = porKey.get(card.dataset.key);
    const oc = e && ocDeEvento(e);
    if (!oc && e?.tipo !== 'remito') return;
    card.querySelector('.act-ver')?.addEventListener('click', ev => {
      const que = ev.currentTarget.dataset.ver;
      if (que === 'rem')       abrirFichaRemito(remitoDeEvento(e), oc, remitosPorOC[e.nroOC]);
      else if (que === 'fact') abrirArchivoDrive(refFacturaOC(oc, facturaDeEvento(e, oc)), 'la factura');
      else                     abrirFicha(oc);
      marcarVista(e.key);
    });
    card.querySelector('.act-oc')?.addEventListener('click', () => abrirFicha(oc));
    if (oc && e.tipo === 'oc') bindDocsOC(card, oc, facturasDeOC(oc), remitosPorOC[oc.nroOC] || []);
  });

  // Abrir en Drive también marca como vista (sin frenar la apertura del link)
  list.querySelectorAll('.act-drive').forEach(a =>
    a.addEventListener('click', () => marcarVista(a.dataset.key)));
  list.querySelectorAll('.act-mark').forEach(b =>
    b.addEventListener('click', () => marcarVista(b.dataset.key)));
  list.querySelectorAll('.act-del').forEach(b =>
    b.addEventListener('click', () => borrarNovedad(b.dataset.key)));

  pager.footer('act', list, events, render);
}

// Novedades de OC borradas en esta sesión: la lápida vive en /historial, pero
// la reconciliación trabaja con la copia del historial que bajó al abrir la
// página, así que no vería una marca escrita después.
const ocBorradasEnSesion = new Set();

async function borrarNovedad(key) {
  const ev = allEvents.find(e => e.key === key);
  const ok = await showConfirm(
    'Borrar novedad',
    `¿Borrar esta novedad para todos? "${ev?.titulo || ''}". Esta acción no se puede deshacer.`
  );
  if (!ok) return;
  try {
    await deleteActividad(key);
  } catch (_) {
    showToast('Error al borrar la novedad.', 'error');
    return;
  }

  allEvents = allEvents.filter(e => e.key !== key);
  persistSeen();
  render();

  // Lápida: si es una novedad de OC, que la reconciliación no la reviva. Si no
  // se puede escribir hay que decirlo: sin la marca la tarjeta vuelve sola en
  // la próxima apertura de Novedades, y borrarla otra vez no cambia nada.
  const nro = ev && ev.tipo === 'oc' ? (ev.nroOC || nroDeTitulo(ev.titulo)) : null;
  if (nro) ocBorradasEnSesion.add(nro);   // la reconciliación puede estar corriendo
  if (nro && typeof tombstoneNovedadOC === 'function') {
    try {
      await tombstoneNovedadOC(nro);
    } catch (e) {
      console.error('tombstoneNovedadOC:', e);
      showToast(`Novedad borrada, pero la OC ${nro} puede volver a generarla.`, 'warning');
      return;
    }
  }
  showToast('Novedad borrada.');
}

// ===================================================
//  Ficha de la OC
// ===================================================
// La misma del Historial y de la vista previa (js/fichaOC.js), con lo que
// Reportes le suma: las pastillas de factura y remitos en el encabezado y la
// carpeta de Drive al pie.

function abrirFicha(oc) {
  if (!oc) return;
  cerrarFicha();
  const modal = $('modal-preview');
  const data  = ocDataFromRecord(oc);
  const token = String(Math.random());
  modal.dataset.token = token;
  const vigente = () => modal.dataset.token === token;

  const facts = facturasDeOC(oc);
  const rems  = remitosPorOC[oc.nroOC] || [];
  const pill  = (tipo, n, txt) => n
    ? `<button class="hist-doc hist-doc--${tipo}" data-doc="${tipo}" aria-expanded="false">${icSvg(tipo === 'fact' ? 'file' : 'truck')}${esc(txt)}${
        n > 1 ? icSvg('chevron', 'hist-doc-chev') : ''}</button>`
    : '';
  const resp = oc.responsable?.nombre ? `<span class="foc-chip">${esc(oc.responsable.nombre)}</span>` : '';
  // Comparación con las OC anteriores al mismo proveedor.
  const cmp = checkOCHistorial(data, histAll, oc.timestamp);

  pintarFichaOC(data,
    estadoChipFicha(oc) + resp
      + pill('fact', facts.length, facts.length > 1 ? `Facturas · ${facts.length}` : 'Factura')
      + pill('rem',  rems.length,  rems.length  > 1 ? `Remitos · ${rems.length}` : `Remito ${rems[0]?.nro || ''}`),
    `<div id="foc-docs">${docsListasHtml(facts, rems)}</div>` + fichaInfoHtml(cmp.info) + comparacionHtml(cmp.cambios));
  // La ficha del remito se abre encima de ésta.
  bindDocsOC(modal, oc, facts, rems, { encima: true });

  // Drive: sólo si la OC ya tiene su carpeta registrada. A las que no tienen
  // PDF (pendientes, rechazadas, canceladas) no se les reclama el respaldo.
  const sinPdf = SIN_PDF.has(oc.estado);
  const url    = driveUrlOf(oc);
  const drv    = $('preview-drive');
  drv.classList.toggle('hidden', !url);
  if (url) drv.href = url; else drv.removeAttribute('href');
  $('preview-nodrive').classList.toggle('hidden', !!url || sinPdf);

  const pdf = $('preview-pdf');
  pdf.removeAttribute('href');
  pdf.setAttribute('aria-disabled', 'true');
  pdf.title = !sinPdf ? 'Abrir el PDF de la OC'
            : oc.estado === 'pendiente' ? 'Todavía no tiene PDF: está pendiente de firma'
            : `La OC fue ${oc.estado}: no tiene PDF`;
  modal.classList.remove('hidden');

  if (!sinPdf) {
    ocDataParaPdf(oc).then(d => {
      if (!vigente()) return;
      const blobUrl = URL.createObjectURL(generateOCBlob(d));
      modal.dataset.blobUrl = blobUrl;
      pdf.href = blobUrl;
      pdf.removeAttribute('aria-disabled');
    }).catch(e => {
      if (vigente()) toast('No se pudo generar el PDF.', 'error');
      console.error('ficha/pdf:', e);
    });
  }
}

function cerrarFicha() {
  const modal   = $('modal-preview');
  const blobUrl = modal.dataset.blobUrl;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); delete modal.dataset.blobUrl; }
  delete modal.dataset.token;
  $('preview-body').innerHTML = '';
  modal.classList.add('hidden');
}

// Las novedades previas al campo `nroOC` sólo lo tienen en el título
// ("OC 0005-00000194 — Proveedor").
function nroDeTitulo(titulo) {
  const m = /^OC\s+(\S+)/.exec(titulo || '');
  return m ? m[1] : null;
}

function setFilter(f) {
  currentFilter = f;
  pager.reset('act');   // otro filtro → otra lista, se vuelve a la primera página
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
  pager.reset('act');
  syncRangeUI();
  persistRange();
  render();
}

// Tocar una fecha implica rango a medida.
function onCustomDate() {
  range.desde  = $('act-desde').value;
  range.hasta  = $('act-hasta').value;
  range.preset = (range.desde || range.hasta) ? 'custom' : '30';
  pager.reset('act');
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
  // Novedades: 0000 o permiso `novedades`. Quien nunca lo tuvo asignado entra
  // si es admin, que era el criterio antes de que existiera el permiso propio.
  let puedeVer = code === '0000';
  if (!puedeVer) {
    try {
      const u = await getUsuario(code);
      puedeVer = !!(u && (u.novedades != null ? u.novedades : u.admin));
    } catch (_) {}
  }
  if (!puedeVer) { window.location.href = 'menu.html'; return; }

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
  $('act-search').addEventListener('input', e => {
    searchQuery = e.target.value;
    pager.reset('act');   // otra búsqueda → otra lista, se vuelve a la primera página
    render();
  });
  $('act-desde').addEventListener('change', onCustomDate);
  $('act-hasta').addEventListener('change', onCustomDate);
  $('modal-preview-close').addEventListener('click', cerrarFicha);
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

  // Los paneles de arriba no dependen del feed ni de sus filtros: se cargan
  // aparte para no demorar las novedades si /historial tarda o falla.
  cargarPaneles(code);
});

// ===================================================
//  Paneles de estado (arriba del feed)
// ===================================================

let sinRespaldoOCs = [];
let pendientesOCs  = [];
let miCodigo       = null;

// Un solo /historial para los dos paneles.
async function cargarPaneles(code) {
  let hist;
  try { hist = await getHistorial(code, true); }
  catch (e) { console.warn('paneles:', e); return; }
  miCodigo       = code;
  histAll        = hist;
  ocPorNro       = new Map(hist.map(oc => [oc.nroOC, oc]));
  render();   // ahora las tarjetas ofrecen la ficha y la búsqueda alcanza los ítems
  sinRespaldoOCs = ocsSinRespaldo(hist);
  pendientesOCs  = ocsPendientes(hist);
  renderSinRespaldo();
  renderPendientes();
  // Los remitos no hacen falta para ver el feed: llegan aparte y se repinta.
  remitosPorOCAsync()
    .then(map => { remitosPorOC = map; render(); })
    .catch(e => console.warn('getRemitos:', e));
  await reconciliarNovedadesOC(hist);
  await reconciliarLinksOC(hist);
}

// Autocorrección: tarjetas que quedaron "sin link" porque la OC se respaldó
// después de que se publicó su novedad. El link sale del historial, que es
// donde quedan registradas las carpetas de Drive.
async function reconciliarLinksOC(hist) {
  if (typeof completarLinksNovedades !== 'function') return;
  const n = await completarLinksNovedades(hist, allEvents);
  if (n) render();
}

// Autocorrección: cualquier OC con PDF emitido que no haya dejado su tarjeta
// en el feed (aviso perdido, o un flujo que nunca avisó) se rellena acá con
// sus datos y fecha originales. Se corre cada vez que un admin abre Novedades,
// así el feed no depende de que cada aviso puntual haya llegado bien.
async function reconciliarNovedadesOC(hist) {
  if (typeof ocsSinNovedad !== 'function' || typeof logOCActivity !== 'function') return;
  // Las que un admin borró a propósito quedan marcadas en su registro del
  // historial (`novedad_borrada`) y ocsSinNovedad ya las descarta; las de esta
  // misma sesión todavía no están en la copia del historial que se bajó.
  const faltantes = ocsSinNovedad(hist, allEvents)
    .filter(oc => !ocBorradasEnSesion.has(oc.nroOC));
  if (!faltantes.length) return;

  for (const oc of faltantes) {
    try {
      await logOCActivity(oc.nroOC, oc.proveedor?.nombre, oc.obra, oc.total, driveFolderId(oc), {
        usuario:   oc.responsable,
        timestamp: oc.timestamp
      });
    } catch (_) { /* se reintenta sola en la próxima carga */ }
  }

  try { allEvents = await getActividad(null); } catch (_) { return; }
  render();
  showToast(`Se completaron ${faltantes.length} novedad${faltantes.length !== 1 ? 'es' : ''} que faltaban.`);
}

// ---- OC esperando autorización ----
// No son un evento del feed (pedir autorización no registra novedad) sino un
// estado: por eso van en un panel y no en la lista.
function renderPendientes() {
  const box = $('act-pendientes');
  if (!pendientesOCs.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');

  const fecha = ts => new Date(ts || 0).toLocaleDateString('es-AR');
  const chips = pendientesOCs.map(oc => `
    <button class="act-pend-oc" data-nro="${esc(oc.nroOC)}" title="Ver la ficha de la OC">
      <b>${esc(oc.nroOC)}</b>
      <span>${esc(oc.proveedor?.nombre || 'Sin proveedor')} · espera a ${esc(oc.autorizacion.solicitadoA.nombre || '—')}
        · ${esc(fecha(oc.autorizacion.solicitadoEn || oc.timestamp))}</span>
    </button>`).join('');

  const n = pendientesOCs.length;
  const mias = pendientesOCs.filter(oc => oc.autorizacion.solicitadoA.codigo === miCodigo).length;

  box.innerHTML = `
    <div class="act-pend-hd">${icSvg('clip')} ${n} ${n === 1 ? 'orden esperando autorización' : 'órdenes esperando autorización'}</div>
    <div class="act-pend-sub">Todavía no se emitió su PDF: quedan reservadas hasta que quien las tiene a cargo las firme o las rechace.</div>
    <div class="act-pend-list">${chips}</div>
    ${mias ? `<div class="act-pend-actions">
      <button class="btn btn-sm btn-primary" id="act-ir-autorizar">
        ${mias === 1 ? 'Tenés 1 orden para autorizar' : `Tenés ${mias} órdenes para autorizar`}
      </button></div>` : ''}`;

  if (mias) $('act-ir-autorizar').addEventListener('click', () => { window.location.href = 'autorizaciones.html'; });
  bindChipsOC(box);
}

// Los chips de los paneles abren la ficha de su OC.
function bindChipsOC(box) {
  box.querySelectorAll('[data-nro]').forEach(b =>
    b.addEventListener('click', () => abrirFicha(ocPorNro.get(b.dataset.nro))));
}

function renderSinRespaldo() {
  const box = $('act-sinrespaldo');
  if (!sinRespaldoOCs.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');

  // dayLabel() da "miércoles, 18 de junio": demasiado largo para un chip.
  const fecha = ts => new Date(ts || 0).toLocaleDateString('es-AR');

  const chips = sinRespaldoOCs.map(oc => `
    <button class="act-alert-oc" data-nro="${esc(oc.nroOC)}" title="Ver la ficha de la OC">
      <b>${esc(oc.nroOC)}</b>
      <span>${esc(oc.obra || 'Sin obra')} · ${esc(fecha(oc.timestamp))}</span>
    </button>`).join('');

  const n = sinRespaldoOCs.length;
  box.innerHTML = `
    <div class="act-alert-hd">${icSvg('alert')} ${n} ${n === 1 ? 'orden sin respaldo' : 'órdenes sin respaldo'} en Drive</div>
    <div class="act-alert-sub">Su PDF no quedó archivado en Drive, o se archivó pero no se registró dónde.</div>
    <div class="act-alert-list">${chips}</div>
    <div class="act-alert-actions">
      <button class="btn btn-sm btn-secondary" id="act-resubir">${icSvg('folder')} Resubir a Drive</button>
    </div>`;

  $('act-resubir').addEventListener('click', resubirTodas);
  bindChipsOC(box);
}

async function resubirTodas() {
  if (typeof uploadToDrive !== 'function') { toast('Drive no está configurado.', 'error'); return; }
  const list = [...sinRespaldoOCs];
  if (!list.length) return;

  const btn = $('act-resubir');
  btn.disabled = true;

  let ok = 0, yaEstaban = 0, conPresupuesto = 0, presupuestoPendiente = 0;
  const fallaron = [];
  for (const [i, oc] of list.entries()) {
    btn.innerHTML = `<span class="spinner"></span> Subiendo ${i + 1} de ${list.length}…`;
    try {
      const r = await resubirOC(oc);
      ok++;
      if (r && r.yaEstaba) yaEstaban++;
      if (r && r.presupuestoRecuperado) conPresupuesto++;
      if (r && r.presupuestoPendiente)  presupuestoPendiente++;
    }
    catch (e) { fallaron.push(`${oc.nroOC} (${e.message})`); }
  }

  sinRespaldoOCs = list.filter(oc => !driveFolderId(oc));
  btn.disabled = false;
  btn.innerHTML = icSvg('folder') + ' Resubir a Drive';
  renderSinRespaldo();

  // Recién ahora estas OC tienen carpeta: sus tarjetas pueden mostrar el link.
  await reconciliarLinksOC(list);

  if (fallaron.length) toast(`${ok} subidas. Fallaron: ${fallaron.join(', ')}`, 'warning');
  else if (yaEstaban === ok) toast(`Listo: ${ok === 1 ? 'ya estaba archivada en Drive' : `las ${ok} ya estaban archivadas en Drive`}; se registró el link.`, 'success');
  else if (yaEstaban) toast(`Listo: ${ok - yaEstaban} ${ok - yaEstaban === 1 ? 'orden subida' : 'órdenes subidas'}; ${yaEstaban} ya ${yaEstaban === 1 ? 'estaba archivada' : 'estaban archivadas'}.`, 'success');
  else toast(`Listo: ${ok} ${ok === 1 ? 'orden subida' : 'órdenes subidas'} a Drive.`, 'success');

  // El presupuesto sólo se puede rescatar de la cola de este navegador: cuando
  // aparece conviene decirlo, porque es lo que antes se perdía en silencio.
  if (conPresupuesto)
    toast(`Se archivó también el presupuesto de ${conPresupuesto} ${conPresupuesto === 1 ? 'orden' : 'órdenes'}.`, 'success');

  // Si no se pudo archivar, el archivo sigue en la cola de este navegador —no se
  // borró—. Con la OC ya respaldada el panel deja de listarla, así que el
  // reintento queda en manos de la cola: corre sola al abrir Órdenes de Compra.
  if (presupuestoPendiente)
    toast(`El presupuesto de ${presupuestoPendiente} ${presupuestoPendiente === 1 ? 'orden' : 'órdenes'} no se pudo archivar. ` +
          'Sigue guardado en este dispositivo y se reintenta al abrir Órdenes de Compra.', 'warning');
}
