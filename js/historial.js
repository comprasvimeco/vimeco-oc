/* VIMECO S.A. — Historial de Órdenes de Compra */

let allOCs = [];
let viewerIsAdmin = false;   // 0000 o usuario con permiso admin
let viewerCode    = '';
let viewerObras   = null;    // obras a cargo si es Jefe de Obra (ver alcanceOC)
let searchTerms = [];        // búsqueda vigente, para marcar los ítems que coinciden

const $ = id => document.getElementById(id);



function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- Estado de la OC ----
// Las OC viejas (sin `estado`) se consideran emitidas. Las categorías son las
// del desplegable de Estado; anuladas (duplicadas) y canceladas van juntas.
function categoriaEstado(oc) {
  switch (oc.estado) {
    case 'autorizada': return 'aprob';
    case 'pendiente':  return 'espera';
    case 'rechazada':  return 'rech';
    case 'anulada': case 'cancelada': return 'anul';
    default: return 'emit';
  }
}

const estPill = (cls, icono, txt) =>
  `<span class="hc-est hc-est-${cls}" title="${esc(txt)}">${icSvg(icono)}${esc(txt)}</span>`;

// Pastilla con ícono a la derecha del número, como en Autorizaciones. Las
// emitidas sin autorización no la llevan: es el caso común.
function estadoHtml(oc) {
  const a = oc.autorizacion || {};
  switch (oc.estado) {
    case 'pendiente':  return estPill('espera', 'clock', 'Pendiente' + (a.solicitadoA?.nombre ? ' · ' + a.solicitadoA.nombre : ''));
    case 'autorizada': return estPill('aprob', 'checkSm', 'Autorizada' + (a.firmante ? ' · ' + a.firmante : ''));
    case 'rechazada':  return estPill('rech', 'x', 'Rechazada');
    case 'cancelada':  return estPill('canc', 'slash', 'Cancelada');
    case 'anulada':    return estPill('canc', 'copy', textoDuplicada(oc));
    default: return '';
  }
}

// La OC que corrigió a otra lo dice (la otra quedó anulada como duplicada).
function reemplazaBadge(oc) {
  const nros = oc.reemplazaA || [];
  return nros.length ? `<span class="hc-est hc-est-reemp">Reemplaza a OC ${esc(nros.join(', '))}</span>` : '';
}

// Estado de entrega, espejado en la OC por Remitos (`entrega.estado`). Las OC
// sin remitos no muestran nada: sólo se avisa de lo que ya empezó a llegar.
function entregaBadge(oc) {
  const e = oc.entrega?.estado;
  if (!e || e === 'sin') return '';
  return e === 'parcial' ? estPill('par', 'clock', 'Entrega parcial') : estPill('ent', 'checkSm', 'Entregada');
}

// ---- Factura y remitos de la OC ----
// Pastillas debajo de los estados. La factura abre el archivo; el remito abre
// su ficha. Con más de uno, la pastilla despliega la lista.

let remitosPorOC = {};   // nroOC → remitos (del más nuevo al más viejo); llega después que las OC
let ultimaLista  = [];   // lo último pintado, para repintar cuando llegan los remitos

// Las listas desplegables y qué abre cada renglón viven en js/fichaRemito.js
// (las comparte la ficha de la OC en Reportes).
// `entrega` (el sello de Entregada / Entrega parcial) va en el mismo renglón.
function docsHtml(oc, entrega) {
  const facts = facturasDeOC(oc);
  const rems  = remitosPorOC[oc.nroOC] || [];
  if (!facts.length && !rems.length) return entrega ? `<div class="hist-docs">${entrega}</div>` : '';

  const pill = (tipo, txt, varios) =>
    `<button class="hist-doc hist-doc--${tipo}" data-doc="${tipo}" aria-expanded="false">${icSvg(tipo === 'fact' ? 'file' : 'truck')}${esc(txt)}${
      varios ? icSvg('chevron', 'hist-doc-chev') : ''}</button>`;

  return `<div class="hist-docs">
      ${entrega || ''}
      ${facts.length ? pill('fact', facts.length > 1 ? `Facturas · ${facts.length}` : 'Factura', facts.length > 1) : ''}
      ${rems.length  ? pill('rem',  rems.length  > 1 ? `Remitos · ${rems.length}` : `Remito ${rems[0].nro || ''}`, rems.length > 1) : ''}
    </div>${docsListasHtml(facts, rems)}`;
}

const bindDocs = (card, oc) => bindDocsOC(card, oc, facturasDeOC(oc), remitosPorOC[oc.nroOC] || []);

// Los remitos no hacen falta para ver la lista: llegan en segundo plano y se
// repinta la página actual.
async function cargarRemitos() {
  try {
    remitosPorOC = await remitosPorOCAsync();
    renderCards(ultimaLista);
  } catch (e) {
    console.warn('getRemitos:', e);
  }
}

// El responsable se muestra a los admin y en las OC ajenas que aparecen por
// haber pedido o firmado su autorización.
const verResp = oc => !!oc.responsable?.nombre &&
  (viewerIsAdmin || oc.responsable.codigo !== viewerCode);

const esAjena = oc => !!oc.responsable?.nombre && oc.responsable.codigo !== viewerCode;

const moneyOC = oc => oc.total != null ? (oc.moneda === 'USD' ? 'US$ ' : '$ ') + fmtMoney(oc.total) : '—';

function renderCards(ocs) {
  ultimaLista = ocs;
  const list = $('hist-list');

  // La pastilla de la cabecera cuenta lo filtrado; con filtro, "N de M".
  const cnt = $('hist-count');
  cnt.textContent = ocs.length === allOCs.length ? `${ocs.length} OC` : `${ocs.length} de ${allOCs.length} OC`;
  cnt.classList.toggle('hidden', !allOCs.length);

  if (ocs.length === 0) {
    list.innerHTML = '<div class="hist-empty">No se encontraron órdenes de compra.</div>';
    return;
  }

  const canRegen = typeof generateOCBlob === 'function';

  list.innerHTML = '';
  // La pastilla de la cabecera sigue mostrando el total del filtro; acá se pinta sólo la página.
  pager.take('hist', ocs).forEach(oc => {
    const card = document.createElement('div');
    card.className = 'hist-card' + (oc.estado === 'anulada' ? ' hist-card--anulada' : '');

    const motivo = oc.estado === 'rechazada' ? oc.autorizacion?.motivoRechazo : '';
    // Las OC pendientes todavía no tienen PDF definitivo, y las canceladas no lo
    // van a tener → no se descarga.
    const showRegen  = canRegen && oc.estado !== 'pendiente' && oc.estado !== 'cancelada';

    card.innerHTML = `
      <div class="hc-top">
        <span class="hc-nro"><span class="hc-nro-n">${esc(oc.nroOC)}</span>${oc.fecha ? ' · ' + esc(oc.fecha) : ''}</span>
        ${estadoHtml(oc)}
      </div>
      <div class="hc-prov">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="hc-obra">${esc(oc.obra || '—')}</div>
      ${motivo ? `<div class="hc-motivo">Motivo: ${esc(motivo)}</div>` : ''}
      ${docsHtml(oc, reemplazaBadge(oc) + entregaBadge(oc))}
      ${hitsHtml(oc, itemsCoincidentes(oc, searchTerms), esc, searchTerms)}
      <div class="hc-bottom">
        <span class="hc-total">${moneyOC(oc)}</span>
        ${verResp(oc) ? `<span class="hc-resp">${esc(oc.responsable.nombre)}</span>` : ''}
      </div>
      <div class="hc-actions">
        <button class="foc-btn foc-btn--edit btn-ver" title="Ver la OC">${icSvg('eye')}Ver OC</button>
        ${showRegen ? `<button class="foc-btn foc-btn--pdf btn-regenerar" title="Descargar o compartir el PDF">${icSvg('share')}PDF</button>` : ''}
        <button class="foc-btn foc-btn--gen btn-usar-base" title="Cargar en el formulario">${icSvg('undo')}Usar como base</button>
        ${puedeAnular(oc) ? `<button class="foc-btn foc-btn--del btn-anular" title="Anularla como duplicada: la reemplazó otra OC">${icSvg('x')}Anular</button>`
          : puedeDesanular(oc) ? `<button class="foc-btn foc-btn--clear btn-anular" title="Deshacer la anulación: vuelve a contar en Reportes">${icSvg('undo')}Desanular</button>` : ''}
      </div>`;

    card.querySelector('.btn-usar-base').addEventListener('click', () => usarComoBase(oc));
    card.querySelector('.btn-ver').addEventListener('click', () => abrirFicha(oc));
    card.querySelector('.btn-anular')?.addEventListener('click', () => abrirAnular(oc));
    bindDocs(card, oc);

    if (showRegen) {
      const regenBtn = card.querySelector('.btn-regenerar');
      regenBtn.addEventListener('click', () => compartirPdfOC(oc, regenBtn));
    }

    list.appendChild(card);
  });

  pager.footer('hist', list, ocs, () => renderCards(ocs));
}

function displayToISODate(d) {
  const p = (d || '').split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (d || '');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---- Filtros: Estado y Período, desplegables-pastilla como los de Novedades ----
// En el teléfono la pastilla usa el nombre corto, para que las dos entren en un renglón.
const ESTADOS = [
  { v: 'all',    nombre: 'Todos los estados',     corto: 'Todas',       icon: 'layers',  tono: 'act-t-all'     },
  { v: 'emit',   nombre: 'Emitidas',              corto: 'Emitidas',    icon: 'print',   tono: 'hc-est-emit'   },
  { v: 'aprob',  nombre: 'Autorizadas',           corto: 'Autorizadas', icon: 'checkSm', tono: 'hc-est-aprob'  },
  { v: 'espera', nombre: 'Pendientes de firma',   corto: 'Pendientes',  icon: 'clock',   tono: 'hc-est-espera' },
  { v: 'rech',   nombre: 'Rechazadas',            corto: 'Rechazadas',  icon: 'x',       tono: 'hc-est-rech'   },
  { v: 'anul',   nombre: 'Anuladas y canceladas', corto: 'Anuladas',    icon: 'slash',   tono: 'hc-est-canc'   }
];
const PERIODOS = [
  { v: '30',     nombre: 'Últimos 30 días', corto: '30 días' },
  { v: '90',     nombre: 'Últimos 90 días', corto: '90 días' },
  { v: 'all',    nombre: 'Todo',            corto: 'Todo'    },
  { v: 'custom', nombre: 'Elegir fechas…',  corto: 'Fechas'  }
];
let filtroEstado = 'all', filtroPeriodo = 'all';

const etiqueta = (x, extra = '') =>
  `<span class="act-largo">${esc(x.nombre)}</span><span class="act-corto">${esc(x.corto)}</span>${extra}`;
const CHEV = () => icSvg('chevron', 'act-chev');

// Búsqueda y período, sin el estado: sobre eso se cuentan las opciones de Estado.
function filtrarSinEstado() {
  let result = allOCs;
  // Como en Remitos: también por la descripción de los ítems comprados.
  if (searchTerms.length) result = result.filter(oc => coincideOC(oc, searchTerms));

  let desdeTs = 0, hastaTs = Infinity;
  if (filtroPeriodo === 'custom') {
    const desde = $('hist-desde').value, hasta = $('hist-hasta').value;   // YYYY-MM-DD
    if (desde) desdeTs = new Date(desde + 'T00:00:00').getTime();
    if (hasta) hastaTs = new Date(hasta + 'T23:59:59').getTime();
  } else if (filtroPeriodo !== 'all') {
    desdeTs = Date.now() - Number(filtroPeriodo) * 86400000;
  }
  if (desdeTs || hastaTs !== Infinity)
    result = result.filter(oc => { const ts = oc.timestamp || 0; return ts >= desdeTs && ts <= hastaTs; });
  return result;
}

function pintarFiltros(base) {
  const n = { all: base.length };
  base.forEach(oc => { const c = categoriaEstado(oc); n[c] = (n[c] || 0) + 1; });
  const sel = ESTADOS.find(e => e.v === filtroEstado);
  const btn = $('hist-estado-btn');
  btn.className = 'act-pick' + (sel.v === 'all' ? '' : ' hist-tono ' + sel.tono);
  btn.innerHTML = icSvg(sel.icon) + etiqueta(sel, ` <span class="act-pick-n">· ${n[sel.v] || 0}</span>`) + CHEV();
  $('hist-estado-menu').innerHTML = ESTADOS.map(e => `
    <button type="button" class="act-opt" role="option" data-v="${e.v}" aria-selected="${e.v === sel.v}">
      <span class="act-opt-ic ${e.tono}">${icSvg(e.icon)}</span>${esc(e.nombre)}
      <span class="act-opt-n">${n[e.v] || 0}</span>
    </button>`).join('');

  const per = PERIODOS.find(p => p.v === filtroPeriodo);
  $('hist-periodo-btn').innerHTML = icSvg('calendar') + etiqueta(per) + CHEV();
  $('hist-periodo-menu').innerHTML = PERIODOS.map(p => `
    <button type="button" class="act-opt" role="option" data-v="${p.v}" aria-selected="${p.v === per.v}">${esc(p.nombre)}</button>`).join('');
  $('hist-custom').classList.toggle('hidden', filtroPeriodo !== 'custom');
}

function cerrarMenus() {
  ['estado', 'periodo'].forEach(k => {
    $(`hist-${k}-menu`).classList.add('hidden');
    $(`hist-${k}-btn`).setAttribute('aria-expanded', 'false');
  });
}

function bindDesplegable(k, alElegir) {
  const btn = $(`hist-${k}-btn`), menu = $(`hist-${k}-menu`);
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    const abrir = menu.classList.contains('hidden');
    cerrarMenus();
    if (abrir) { menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); }
  });
  menu.addEventListener('click', ev => {
    const opt = ev.target.closest('.act-opt');
    if (!opt) return;
    cerrarMenus();
    alElegir(opt.dataset.v);
  });
}

function applyFilters() {
  // Filtro nuevo → la lista es otra, se vuelve a la primera página.
  pager.reset('hist');
  searchTerms = terminosBusqueda($('hist-search').value);
  const base = filtrarSinEstado();
  pintarFiltros(base);
  renderCards(filtroEstado === 'all' ? base : base.filter(oc => categoriaEstado(oc) === filtroEstado));
}

// ---- OC duplicadas por resolver ----
// Las propias que se parecen (criterio en js/duplicados.js) y que nadie resolvió:
// las que se escaparon del aviso al emitir, o las de antes de que existiera.
// Por defecto se marcan para anular todas menos la última, que es la que queda;
// el responsable puede elegir otra o decir que son compras distintas. El Jefe de
// Obra resuelve también las de sus obras, aunque las haya emitido otro.
let gruposDup = [];

function renderDuplicadas() {
  const box = $('hist-dup');
  gruposDup = typeof duplicadosPorRevisar === 'function' ? duplicadosPorRevisar(allOCs, viewerCode, viewerObras) : [];
  const pill = $('hist-dupn');
  pill.classList.toggle('hidden', !gruposDup.length);
  if (!gruposDup.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const n = gruposDup.length;
  pill.textContent = n > 1 ? `${n} duplicadas` : '1 duplicada';
  const money = oc => (oc.moneda === 'USD' ? 'USD ' : '$ ') + fmtMoney(oc.total);
  box.innerHTML = `
    <div class="dup-panel-h">
      <span class="dup-panel-ic">${icSvg('alert')}</span>
      <div>
        <div class="dup-panel-t">${n > 1 ? n + ' posibles OC duplicadas' : 'Posible OC duplicada'}</div>
        <div class="dup-panel-sub">${gruposDup.every(g => !esAjena(g[0])) ? 'Le emitiste' : 'Se le emitió'} más de una OC al mismo proveedor, en menos de una hora, por un monto parecido o repitiendo los mismos artículos.
          Marcá la que quedó sin validez: sigue en el historial como "Duplicada", pero deja de contar en Reportes.</div>
      </div>
    </div>
    ${gruposDup.map((g, gi) => `
      <div class="dup-grupo" data-g="${gi}">
        <div class="dup-grupo-head"><b>${esc(g[0].proveedor?.nombre || 'Sin proveedor')}</b> · ${esc(g[0].fecha || '')}${
          esAjena(g[0]) ? ' · emitió ' + esc(g[0].responsable.nombre) : ''}</div>
        <div class="dup-lista">${g.map((oc, i) => {
          const anular = i < g.length - 1;
          return `
          <label class="dup-oc${anular ? ' dup-oc--anular' : ''}">
            <input type="checkbox" value="${i}"${anular ? ' checked' : ''}>
            <span class="dup-oc-main">
              <span class="dup-oc-nro">${esc(oc.nroOC)}</span>
              <span class="dup-oc-sub">${esc(horaDe(oc.timestamp))} · ${esc(oc.obra || 'Sin obra')}</span>
            </span>
            <span class="dup-oc-monto">${esc(money(oc))}<small>${esc(etiquetaDup(oc, g[0]))}</small></span>
          </label>`;
        }).join('')}</div>
        <div class="dup-grupo-foot">
          <button class="foc-btn foc-btn--clear dup-distintas">Son compras distintas</button>
          <button class="foc-btn foc-btn--del dup-anular"></button>
        </div>
      </div>`).join('')}`;
  box.querySelectorAll('.dup-grupo').forEach(syncAnularBtn);
  box.classList.remove('hidden');

  if (!box._wired) {
    box._wired = true;
    box.addEventListener('change', e => {
      const lbl = e.target.closest('.dup-oc');
      if (!lbl) return;
      lbl.classList.toggle('dup-oc--anular', e.target.checked);
      syncAnularBtn(e.target.closest('.dup-grupo'));
    });
    box.addEventListener('click', e => {
      const grupo = e.target.closest('.dup-grupo');
      if (!grupo) return;
      if (e.target.closest('.dup-anular'))    resolverDup(grupo, 'anular', e.target.closest('button'));
      if (e.target.closest('.dup-distintas')) resolverDup(grupo, 'distintas', e.target.closest('button'));
    });
  }
}

function marcadasDe(grupo) {
  const g = gruposDup[+grupo.dataset.g];
  const sel = new Set([...grupo.querySelectorAll('input:checked')].map(c => +c.value));
  return { anular: g.filter((_, i) => sel.has(i)), quedan: g.filter((_, i) => !sel.has(i)) };
}

function syncAnularBtn(grupo) {
  const { anular } = marcadasDe(grupo);
  const btn = grupo.querySelector('.dup-anular');
  btn.innerHTML = icSvg('x') + (anular.length === 1 ? `Anular la ${esc(anular[0].nroOC)}`
    : anular.length ? `Anular ${anular.length} OC` : 'Anular');
  btn.disabled = !anular.length;
}

async function resolverDup(grupo, accion, btn) {
  const { anular, quedan } = marcadasDe(grupo);
  if (accion === 'anular' && !quedan.length) {
    toast('Tiene que quedar al menos una OC sin anular: la que vale.', 'error');
    return;
  }
  grupo.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    if (accion === 'distintas') {
      await marcarComprasDistintas([...anular, ...quedan]);
      toast('Listo: no se marcan más como duplicadas.', 'success');
    } else {
      // La reemplaza la más nueva de las que quedan. Si quedan varias, el
      // responsable dijo que entre ellas son compras distintas.
      await anularPorReemplazo(anular, quedan[quedan.length - 1].nroOC);
      if (quedan.length > 1) await marcarComprasDistintas(quedan);
      toast(`${anular.map(oc => 'OC ' + oc.nroOC).join(', ')} anulada${anular.length > 1 ? 's' : ''} como duplicada.`, 'success');
    }
  } catch (e) {
    toast('No se pudo guardar. ' + e.message, 'error');
  }
  renderDuplicadas();
  applyFilters();   // cambió el estado de las OC: también los contadores de Estado
}

// ---- Anular una OC como duplicada, desde su tarjeta ----
// El diálogo está en js/duplicados.js (anularOCManual). La anula quien puede
// resolver sus duplicadas: la propia, la de las obras del Jefe de Obra, o un admin.
// Las mismas personas la desanulan (desanularOC).
const puedeResolver = oc =>
  oc.responsable?.codigo === viewerCode || viewerIsAdmin || (viewerObras && esDeObrasJefe(oc, viewerObras));
const puedeAnular    = oc => esCompraFirme(oc) && puedeResolver(oc);
const puedeDesanular = oc => oc.estado === 'anulada' && puedeResolver(oc);

async function abrirAnular(oc) {
  if (!await (oc.estado === 'anulada' ? desanularOC(oc, allOCs) : anularOCManual(oc, allOCs))) return;
  renderDuplicadas();
  applyFilters();   // cambió el estado de la OC: también los contadores de Estado
}

// ---- Ficha de la OC ----
// La misma ficha que la vista previa de la OC nueva (js/fichaOC.js), con el PDF
// a un toque. Las pendientes y canceladas no tienen PDF definitivo.
let fichaOC = null;

function abrirFicha(oc) {
  cerrarFicha();
  fichaOC = oc;
  const modal = $('modal-preview');
  const data  = ocDataFromRecord(oc);
  const token = String(Math.random());
  modal.dataset.token = token;
  const vigente = () => modal.dataset.token === token;

  const resp = verResp(oc)
    ? `<span class="foc-chip">${esc(oc.responsable.nombre)}</span>` : '';
  pintarFichaOC(data, estadoChipFicha(oc) + resp);

  const pdf = $('preview-pdf');
  const sinPdf = oc.estado === 'pendiente' || oc.estado === 'cancelada';
  pdf.removeAttribute('href');
  pdf.setAttribute('aria-disabled', 'true');
  pdf.title = sinPdf ? (oc.estado === 'pendiente' ? 'Todavía no tiene PDF: está pendiente de firma' : 'La OC se canceló: no tiene PDF')
                     : 'Abrir el PDF de la OC';
  modal.classList.remove('hidden');

  if (!sinPdf) {
    ocDataParaPdf(oc).then(d => {
      if (!vigente()) return;
      const url = URL.createObjectURL(generateOCBlob(d));
      modal.dataset.blobUrl = url;
      pdf.href = url;
      pdf.removeAttribute('aria-disabled');
    }).catch(e => {
      if (vigente()) toast('No se pudo generar el PDF.', 'error');
      console.error('ficha/pdf:', e);
    });
  }

  // Comparación con las OC anteriores al mismo proveedor.
  const res = checkOCHistorial(data, allOCs, oc.timestamp);
  $('preview-warn').innerHTML = fichaInfoHtml(res.info) + comparacionHtml(res.cambios);
}

function cerrarFicha() {
  const modal   = $('modal-preview');
  const blobUrl = modal.dataset.blobUrl;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); delete modal.dataset.blobUrl; }
  delete modal.dataset.token;
  $('preview-body').innerHTML = '';
  modal.classList.add('hidden');
  fichaOC = null;
}

function usarComoBase(oc) {
  sessionStorage.setItem('oc_base', JSON.stringify(oc));
  window.location.href = 'app.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  $('hdr-name').textContent = name;

  $('btn-back').addEventListener('click',    () => { window.location.href = 'compras.html'; });
  $('hist-search').addEventListener('input',  applyFilters);
  $('modal-preview-close').addEventListener('click', cerrarFicha);
  $('preview-base').addEventListener('click', () => { if (fichaOC) usarComoBase(fichaOC); });
  $('hist-desde').addEventListener('change',  applyFilters);
  $('hist-hasta').addEventListener('change',  applyFilters);
  bindDesplegable('estado',  v => { filtroEstado = v; applyFilters(); });
  bindDesplegable('periodo', v => { filtroPeriodo = v; applyFilters(); });
  document.addEventListener('click', ev => { if (!ev.target.closest('.act-dd')) cerrarMenus(); });
  $('hist-dupn').addEventListener('click', () => $('hist-dup').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  pintarFiltros([]);

  // Indicador de pendientes Drive
  if (typeof driveQueue !== 'undefined') {
    try {
      const pending = await driveQueue.getAll();
      if (pending.length > 0)
        toast(`${pending.length} OC${pending.length > 1 ? 's' : ''} pendiente${pending.length > 1 ? 's' : ''} de subir a Drive.`, 'warning');
    } catch (_) {}
  }

  const { isAdmin, obrasJefe } = await alcanceOC(code);
  viewerIsAdmin = isAdmin;
  viewerCode    = code;
  viewerObras   = obrasJefe;

  try {
    allOCs = await getHistorial(code, isAdmin, true, obrasJefe);
    applyFilters();
    renderDuplicadas();
    cargarRemitos();
  } catch (e) {
    const cached = typeof getHistorialCached === 'function' ? getHistorialCached(code) : null;
    if (cached && cached.length) {
      allOCs = cached;
      applyFilters();
      $('hist-list').insertAdjacentHTML('afterbegin',
        `<div class="hist-offline-notice">${icSvg('wifi0')} Sin conexión — mostrando últimas 5 OC guardadas</div>`);
    } else {
      $('hist-list').innerHTML = '<div class="hist-empty">Sin conexión y sin datos locales. Abrí el historial con red al menos una vez.</div>';
    }
    console.error('getHistorial:', e);
  }
});
