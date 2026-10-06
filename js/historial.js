/* VIMECO S.A. — Historial de Órdenes de Compra */

let allOCs = [];
let viewerIsAdmin = false;   // 0000 o usuario con permiso admin
let viewerCode    = '';
let searchTerms = [];        // búsqueda vigente, para marcar los ítems que coinciden

const $ = id => document.getElementById(id);



function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Badge de estado de autorización. Las OC viejas (sin `estado`) se consideran emitidas.
function estadoBadge(oc) {
  const e = oc.estado || 'emitida';
  const base = 'display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.72rem;font-weight:700;';
  if (e === 'pendiente') {
    const quien = oc.autorizacion?.solicitadoA?.nombre;
    return `<span style="${base}background:#fff4e0;color:#9a6a00;">Pendiente${quien ? ' — ' + esc(quien) : ''}</span>`;
  }
  if (e === 'autorizada') {
    const quien = oc.autorizacion?.firmante;
    return `<span style="${base}background:#e3f5e8;color:#1e7d3a;">Autorizada${quien ? ' — ' + esc(quien) : ''}</span>`;
  }
  if (e === 'rechazada') {
    const motivo = oc.autorizacion?.motivoRechazo;
    return `<span style="${base}background:#fde6e6;color:#b02a2a;" title="${esc(motivo || '')}">Rechazada</span>`;
  }
  if (e === 'cancelada') {
    return `<span style="${base}background:#eceef1;color:#5b6573;">Cancelada</span>`;
  }
  if (e === 'anulada') return `<span class="dup-tag">${esc(textoDuplicada(oc))}</span>`;
  return '';
}

// La OC que corrigió a otra lo dice (la otra quedó anulada como duplicada).
function reemplazaBadge(oc) {
  const nros = oc.reemplazaA || [];
  return nros.length ? `<span class="dup-tag dup-tag--nueva">Reemplaza a OC ${esc(nros.join(', '))}</span>` : '';
}

// Estado de entrega, espejado en la OC por Remitos (`entrega.estado`). Las OC
// sin remitos no muestran nada: sólo se avisa de lo que ya empezó a llegar.
function entregaBadge(oc) {
  const e = oc.entrega?.estado;
  if (!e || e === 'sin') return '';
  const base = 'display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.72rem;font-weight:700;';
  if (e === 'parcial')
    return `<span style="${base}background:#fff4e0;color:#9a6a00;">Entrega parcial</span>`;
  return `<span style="${base}background:#e3f5e8;color:#1e7d3a;">Entregada</span>`;
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

function renderCards(ocs) {
  ultimaLista = ocs;
  const list = $('hist-list');

  $('hist-count').textContent = ocs.length === 0 ? '' : `${ocs.length} orden${ocs.length !== 1 ? 'es' : ''}`;

  if (ocs.length === 0) {
    list.innerHTML = '<div class="hist-empty">No se encontraron órdenes de compra.</div>';
    return;
  }

  const canRegen = typeof generateOCBlob === 'function';

  list.innerHTML = '';
  // `hist-count` sigue mostrando el total del filtro; acá se pinta sólo la página.
  pager.take('hist', ocs).forEach(oc => {
    const card = document.createElement('div');
    card.className = 'hist-card' + (oc.estado === 'anulada' ? ' hist-card--anulada' : '');

    const provNombre = oc.proveedor?.nombre || '—';
    const obra       = oc.obra || '—';
    const total      = oc.total != null ? `$ ${fmtMoney(oc.total)}` : '—';
    const resp       = oc.responsable?.nombre || '';
    const badge      = estadoBadge(oc) + reemplazaBadge(oc);
    const entrega    = entregaBadge(oc);
    // Las OC pendientes todavía no tienen PDF definitivo, y las canceladas no lo
    // van a tener → no se descarga.
    const showRegen  = canRegen && oc.estado !== 'pendiente' && oc.estado !== 'cancelada';

    card.innerHTML = `
      <div class="hist-card-top">
        <span class="hist-nro">${esc(oc.nroOC)}</span>
        <span class="hist-fecha">${esc(oc.fecha || '')}</span>
      </div>
      <div class="hist-proveedor">${esc(provNombre)}</div>
      <div class="hist-obra">${esc(obra)}</div>
      ${badge ? `<div style="margin-top:.35rem;display:flex;gap:.35rem;flex-wrap:wrap;">${badge}</div>` : ''}
      ${docsHtml(oc, entrega)}
      ${hitsHtml(oc, itemsCoincidentes(oc, searchTerms), esc)}
      <div class="hist-card-bottom">
        <span class="hist-total">${total}</span>
        ${verResp(oc) ? `<span class="hist-responsable">${esc(resp)}</span>` : ''}
        <div class="hist-actions">
          <button class="foc-btn foc-btn--edit btn-ver" title="Ver la OC">${icSvg('eye')}Vista</button>
          ${showRegen ? `<button class="foc-btn foc-btn--pdf btn-regenerar" title="Descargar o compartir el PDF">${icSvg('share')}PDF</button>` : ''}
          <button class="foc-btn foc-btn--gen btn-usar-base" title="Cargar en formulario">${icSvg('undo')}Usar como base</button>
        </div>
      </div>`;

    card.querySelector('.btn-usar-base').addEventListener('click', () => usarComoBase(oc));
    card.querySelector('.btn-ver').addEventListener('click', () => abrirFicha(oc));
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

// ---- Filtros ----
function applyFilters() {
  // Filtro nuevo → la lista es otra, se vuelve a la primera página.
  pager.reset('hist');
  searchTerms = terminosBusqueda($('hist-search').value);
  const desde = $('hist-desde').value; // YYYY-MM-DD
  const hasta = $('hist-hasta').value;

  let result = allOCs;

  // Como en Remitos: también por la descripción de los ítems comprados.
  if (searchTerms.length) result = result.filter(oc => coincideOC(oc, searchTerms));

  if (desde || hasta) {
    const desdeTs = desde ? new Date(desde + 'T00:00:00').getTime() : 0;
    const hastaTs = hasta ? new Date(hasta + 'T23:59:59').getTime() : Infinity;
    result = result.filter(oc => {
      const ts = oc.timestamp || 0;
      return ts >= desdeTs && ts <= hastaTs;
    });
    $('btn-clear-dates').classList.remove('hidden');
  } else {
    $('btn-clear-dates').classList.add('hidden');
  }

  renderCards(result);
}

// ---- OC duplicadas por resolver ----
// Las propias que se parecen (criterio en js/duplicados.js) y que nadie resolvió:
// las que se escaparon del aviso al emitir, o las de antes de que existiera.
// Por defecto se marcan para anular todas menos la última, que es la que queda;
// el responsable puede elegir otra o decir que son compras distintas.
let gruposDup = [];

function renderDuplicadas() {
  const box = $('hist-dup');
  gruposDup = typeof duplicadosPorRevisar === 'function' ? duplicadosPorRevisar(allOCs, viewerCode) : [];
  if (!gruposDup.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const n = gruposDup.length;
  const money = oc => (oc.moneda === 'USD' ? 'USD ' : '$ ') + fmtMoney(oc.total);
  box.innerHTML = `
    <div class="dup-panel-t">${icSvg('alert')} ${n > 1 ? n + ' posibles OC duplicadas' : 'Posible OC duplicada'}</div>
    <div class="dup-panel-sub">Le emitiste más de una OC al mismo proveedor, en menos de una hora, por un monto parecido.
      Marcá la que quedó sin validez: sigue en el historial como "Duplicada", pero deja de contar en Reportes.</div>
    ${gruposDup.map((g, gi) => `
      <div class="dup-grupo" data-g="${gi}">
        <div class="dup-grupo-head"><b>${esc(g[0].proveedor?.nombre || 'Sin proveedor')}</b> · ${esc(g[0].fecha || '')}</div>
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
  renderCards(ultimaLista);
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

  $('btn-facturas').addEventListener('click', () => { window.location.href = 'facturas.html'; });
  $('btn-back').addEventListener('click',    () => { window.location.href = 'compras.html'; });
  $('hist-search').addEventListener('input',  applyFilters);
  $('modal-preview-close').addEventListener('click', cerrarFicha);
  $('preview-base').addEventListener('click', () => { if (fichaOC) usarComoBase(fichaOC); });
  $('hist-desde').addEventListener('change',  applyFilters);
  $('hist-hasta').addEventListener('change',  applyFilters);
  $('btn-clear-dates').addEventListener('click', () => {
    $('hist-desde').value = '';
    $('hist-hasta').value = '';
    applyFilters();
  });

  // Indicador de pendientes Drive
  if (typeof driveQueue !== 'undefined') {
    try {
      const pending = await driveQueue.getAll();
      if (pending.length > 0)
        toast(`${pending.length} OC${pending.length > 1 ? 's' : ''} pendiente${pending.length > 1 ? 's' : ''} de subir a Drive.`, 'warning');
    } catch (_) {}
  }

  let isAdmin = code === '0000';
  if (!isAdmin) {
    try { const u = await getUsuario(code); isAdmin = !!(u && u.admin); } catch (_) {}
  }
  viewerIsAdmin = isAdmin;
  viewerCode    = code;

  try {
    allOCs = await getHistorial(code, isAdmin, true);
    renderCards(allOCs);
    renderDuplicadas();
    cargarRemitos();
  } catch (e) {
    const cached = typeof getHistorialCached === 'function' ? getHistorialCached(code) : null;
    if (cached && cached.length) {
      allOCs = cached;
      renderCards(allOCs);
      $('hist-list').insertAdjacentHTML('afterbegin',
        `<div class="hist-offline-notice">${icSvg('wifi0')} Sin conexión — mostrando últimas 5 OC guardadas</div>`);
    } else {
      $('hist-list').innerHTML = '<div class="hist-empty">Sin conexión y sin datos locales. Abrí el historial con red al menos una vez.</div>';
    }
    console.error('getHistorial:', e);
  }
});
