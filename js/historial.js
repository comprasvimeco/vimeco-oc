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
  return '';
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
    card.className = 'hist-card';

    const provNombre = oc.proveedor?.nombre || '—';
    const obra       = oc.obra || '—';
    const total      = oc.total != null ? `$ ${fmtMoney(oc.total)}` : '—';
    const resp       = oc.responsable?.nombre || '';
    const badge      = estadoBadge(oc);
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
      regenBtn.addEventListener('click', () => regenerarPDF(oc, regenBtn));
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

function sanitizeStr(str) {
  return (str || '').replace(/[^\w\s\-\.]/g, '_').substring(0, 60).trim();
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

// ---- Regenerar PDF ----
async function regenerarPDF(oc, btn) {
  btn.disabled = true;
  try {
    const prov   = oc.proveedor || {};
    // Payload guardado (o reconstruido) y, si la autorizó otro, su firma.
    const ocData = await ocDataParaPdf(oc);

    const blob  = generateOCBlob(ocData);
    const fname = `OC_${oc.nroOC}_${sanitizeStr(prov.nombre || 'SinProveedor')}.pdf`;

    const isMobile = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (isMobile && navigator.canShare) {
      const shareFile = new File([blob], fname, { type: 'application/pdf' });
      if (navigator.canShare({ files: [shareFile] })) {
        try {
          await navigator.share({ title: `OC ${oc.nroOC} — VIMECO S.A.`, files: [shareFile] });
          toast(`PDF de OC ${oc.nroOC} compartido.`, 'success');
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
          // otro error → caer al download
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    toast(`PDF de OC ${oc.nroOC} generado.`, 'success');
  } catch (e) {
    toast('Error al regenerar el PDF.', 'error');
    console.error('regenerarPDF:', e);
  } finally {
    btn.disabled = false;
  }
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
