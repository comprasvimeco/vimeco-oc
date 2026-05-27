/* VIMECO S.A. — Historial de Órdenes de Compra */

let allOCs = [];
let attachFileReady = null; // archivo pendiente de adjuntar (modo share)

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
          <span class="hist-attach-status hidden" style="font-size:.78rem;color:var(--gray-500);"></span>
          <button class="btn btn-sm btn-outline btn-adjuntar" title="Adjuntar archivo a Drive">📎</button>
          <button class="btn btn-sm btn-primary btn-usar-base" title="Cargar en formulario">Usar como base</button>
        </div>
      </div>`;

    card.querySelector('.btn-usar-base').addEventListener('click', () => usarComoBase(oc));

    const attachBtn    = card.querySelector('.btn-adjuntar');
    const attachStatus = card.querySelector('.hist-attach-status');
    const attachInput  = document.createElement('input');
    attachInput.type   = 'file';
    attachInput.accept = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx';
    attachInput.style.display = 'none';
    card.appendChild(attachInput);

    attachBtn.addEventListener('click', () => {
      if (attachFileReady) {
        doAttach(attachFileReady, oc, attachBtn, attachStatus, true);
      } else {
        attachInput.click();
      }
    });

    attachInput.addEventListener('change', () => {
      const file = attachInput.files[0];
      if (!file) return;
      attachInput.value = '';
      doAttach(file, oc, attachBtn, attachStatus, false);
    });

    list.appendChild(card);
  });
}

function displayToISODate(d) {
  // "27/05/2026" → "2026-05-27"  (locale argentina DD/MM/YYYY → ISO)
  const p = (d || '').split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (d || '');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function filterOCs(query) {
  if (!query.trim()) return allOCs;
  const q = query.toLowerCase();
  return allOCs.filter(oc =>
    (oc.proveedor?.nombre || '').toLowerCase().includes(q) ||
    (oc.obra || '').toLowerCase().includes(q) ||
    (oc.nroOC || '').toLowerCase().includes(q)
  );
}

function usarComoBase(oc) {
  sessionStorage.setItem('oc_base', JSON.stringify(oc));
  window.location.href = 'app.html';
}

async function doAttach(file, oc, attachBtn, statusEl, fromShare) {
  if (typeof attachToDriveOC !== 'function') {
    toast('Drive no disponible.', 'error');
    return;
  }
  attachBtn.disabled = true;
  statusEl.textContent = '⏳ Subiendo…';
  statusEl.classList.remove('hidden');
  try {
    await attachToDriveOC(file, {
      drive_folder_id: oc.drive_folder_id || null,
      obra:      oc.obra              || '',
      fecha:     displayToISODate(oc.fecha),
      proveedor: oc.proveedor?.nombre || '',
      nroOC:     oc.nroOC
    });
    statusEl.textContent = '✓ Subido';
    setTimeout(() => { statusEl.textContent = ''; statusEl.classList.add('hidden'); }, 3000);
    toast(`Archivo adjuntado a OC ${oc.nroOC}.`, 'success');
    if (fromShare) clearAttachFile();
  } catch (_) {
    statusEl.textContent = '✕ Error';
    setTimeout(() => { statusEl.textContent = ''; statusEl.classList.add('hidden'); }, 4000);
    toast('Error al adjuntar. Se registró el error.', 'error');
  } finally {
    attachBtn.disabled = false;
  }
}

async function checkAttachFile() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('share-target');
    const match = await cache.match('attach-file');
    if (!match) return;
    const blob     = await match.blob();
    const filename = match.headers.get('X-File-Name') || 'archivo';
    const filetype = match.headers.get('Content-Type') || blob.type;
    attachFileReady = new File([blob], filename, { type: filetype });
    $('attach-banner-filename').textContent = filename;
    $('attach-banner').classList.remove('hidden');
  } catch (e) {
    console.warn('checkAttachFile:', e);
  }
}

async function clearAttachFile() {
  try {
    const cache = await caches.open('share-target');
    await cache.delete('attach-file');
  } catch (_) {}
  attachFileReady = null;
  $('attach-banner').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  $('hdr-name').textContent = name;

  $('btn-back').addEventListener('click', () => { window.location.href = 'app.html'; });
  $('btn-logout').addEventListener('click', () => {
    sessionStorage.clear();
    localStorage.removeItem('responsable_code');
    localStorage.removeItem('responsable_name');
    localStorage.removeItem('vimeco_session');
    window.location.href = 'index.html';
  });

  $('hist-search').addEventListener('input', e => {
    renderCards(filterOCs(e.target.value));
  });

  $('btn-attach-cancel').addEventListener('click', clearAttachFile);

  await checkAttachFile();

  try {
    allOCs = await getHistorial(code);
    renderCards(allOCs);
  } catch (e) {
    $('hist-list').innerHTML = '<div class="hist-empty">Error al cargar el historial. Verificá tu conexión.</div>';
    console.error('getHistorial:', e);
  }
});
