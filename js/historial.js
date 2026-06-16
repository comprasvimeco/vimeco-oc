/* VIMECO S.A. — Historial de Órdenes de Compra */

let allOCs = [];

const $ = id => document.getElementById(id);

function toast(msg, type = 'info') {
  const c  = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderCards(ocs) {
  const isAdmin = (sessionStorage.getItem('responsable_code') || '') === '0000';
  const list = $('hist-list');

  $('hist-count').textContent = ocs.length === 0 ? '' : `${ocs.length} orden${ocs.length !== 1 ? 'es' : ''}`;

  if (ocs.length === 0) {
    list.innerHTML = '<div class="hist-empty">No se encontraron órdenes de compra.</div>';
    return;
  }

  const canRegen = typeof generateOCBlob === 'function';

  list.innerHTML = '';
  ocs.forEach(oc => {
    const card = document.createElement('div');
    card.className = 'hist-card';

    const provNombre = oc.proveedor?.nombre || '—';
    const obra       = oc.obra || '—';
    const total      = oc.total != null ? `$ ${fmtMoney(oc.total)}` : '—';
    const resp       = oc.responsable?.nombre || '';

    card.innerHTML = `
      <div class="hist-card-top">
        <span class="hist-nro">${esc(oc.nroOC)}</span>
        <span class="hist-fecha">${esc(oc.fecha || '')}</span>
      </div>
      <div class="hist-proveedor">${esc(provNombre)}</div>
      <div class="hist-obra">${esc(obra)}</div>
      <div class="hist-card-bottom">
        <span class="hist-total">${total}</span>
        ${isAdmin && resp ? `<span class="hist-responsable">${esc(resp)}</span>` : ''}
        <div class="hist-actions">
          ${canRegen ? `<button class="btn btn-sm btn-outline btn-regenerar" title="Regenerar y descargar PDF">${icSvg('print')}</button>` : ''}
          <button class="btn btn-sm btn-primary btn-usar-base" title="Cargar en formulario">Usar como base</button>
        </div>
      </div>`;

    card.querySelector('.btn-usar-base').addEventListener('click', () => usarComoBase(oc));

    if (canRegen) {
      const regenBtn = card.querySelector('.btn-regenerar');
      regenBtn.addEventListener('click', () => regenerarPDF(oc, regenBtn));
    }

    list.appendChild(card);
  });
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
  const q     = ($('hist-search').value || '').toLowerCase().trim();
  const desde = $('hist-desde').value; // YYYY-MM-DD
  const hasta = $('hist-hasta').value;

  let result = allOCs;

  if (q) {
    result = result.filter(oc =>
      (oc.proveedor?.nombre || '').toLowerCase().includes(q) ||
      (oc.obra || '').toLowerCase().includes(q) ||
      (oc.nroOC || '').toLowerCase().includes(q)
    );
  }

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
    const ocData = {
      nroOC:    oc.nroOC,
      fecha:    oc.fecha,
      ejecutor: oc.responsable?.nombre || '',
      proveedor: {
        nombre:    prov.nombre       || '',
        cuit:      prov.cuit         || '',
        domicilio: prov.domicilio    || '',
        telefonos: prov.telefonos    || '',
        iva:       prov.condicionIVA || '',
        pago:      oc.condicionPago  || '',
        plazo:     '',
        lugar:     '',
        ref:       prov.ref          || '',
        ubicacion: oc.obra           || ''
      },
      items: (oc.items || []).map(it => ({
        desc:    it.desc    || '',
        unidad:  it.unidad  || '',
        cant:    it.cant    || 0,
        unitario: it.unitario || 0,
        total:   it.total   || 0
      })),
      impuestos:       oc.impuestos      || [],
      totalLetras:     numberToWords(oc.total || 0),
      _total:          oc.total          || 0,
      _firma:          null,
      _descuento:      oc.descuento      || { pct: null, monto: 0 },
      _noGravado:      oc.noGravado      || { pct: null, monto: 0 },
      _impuestosExtra: oc.impuestosExtra || []
    };
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

  $('btn-adjuntar').addEventListener('click', () => { window.location.href = 'adjuntar.html'; });
  $('btn-back').addEventListener('click',    () => { window.location.href = 'compras.html'; });
  $('btn-logout').addEventListener('click',  () => {
    sessionStorage.clear();
    localStorage.removeItem('responsable_code');
    localStorage.removeItem('responsable_name');
    localStorage.removeItem('vimeco_session');
    window.location.href = 'index.html';
  });

  $('hist-search').addEventListener('input',  applyFilters);
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

  try {
    allOCs = await getHistorial(code);
    renderCards(allOCs);
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
