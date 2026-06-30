/* VIMECO S.A. — Feed de Actividad / Novedades (solo admins) */

const $ = id => document.getElementById(id);

const RETENTION_DAYS = 7;

let allEvents     = [];
let currentFilter = 'all';
let seenKey       = 'vimeco_actividad_vistas';
let seen          = new Set();   // claves de eventos marcados como vistos

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  return new Date(ts).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtHora(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// Persiste las vistas, podando claves que ya no están en el feed actual.
function persistSeen() {
  const validas = new Set(allEvents.map(e => e.key));
  const arr = [...seen].filter(k => validas.has(k));
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
  const sinVer = allEvents.filter(e => !seen.has(e.key)).length;
  const banner = $('act-banner');
  if (sinVer > 0) {
    banner.textContent = `${sinVer} novedad${sinVer !== 1 ? 'es' : ''} sin ver`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function render() {
  const list   = $('act-list');
  const events = currentFilter === 'all'
    ? allEvents
    : allEvents.filter(e => e.tipo === currentFilter);

  $('act-count').textContent = events.length
    ? `${events.length} operación${events.length !== 1 ? 'es' : ''}`
    : '';

  updateBanner();

  if (!events.length) {
    list.innerHTML = '<div class="hist-empty">No hay operaciones en los últimos 7 días.</div>';
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
    const meta   = tipoMeta(e.tipo);
    const vista  = seen.has(e.key);
    const drive  = e.driveUrl
      ? `<a class="btn btn-sm btn-primary act-drive" data-key="${esc(e.key)}" href="${esc(e.driveUrl)}" target="_blank" rel="noopener">Abrir en Drive</a>`
      : '<span class="act-nodrive">sin link</span>';
    const accion = vista
      ? `<span class="act-seen-label">${icSvg('check')} Vista</span>`
      : `<button class="btn btn-sm btn-outline act-mark" data-key="${esc(e.key)}">Marcar vista</button>`;
    html += `
      <div class="hist-card act-card ${vista ? 'act-card-seen' : 'act-card-unseen'}">
        <div class="act-row">
          <span class="act-badge ${meta.cls}">${icSvg(meta.icon)} ${meta.label}</span>
          <div class="act-body">
            <div class="act-title">${esc(e.titulo)}</div>
            <div class="act-detalle">${esc(e.detalle)}</div>
            <div class="act-meta">${esc(e.usuario?.nombre || '—')} · ${fmtHora(e.timestamp)}</div>
          </div>
          <div class="act-actions">${drive}${accion}</div>
        </div>
      </div>`;
  });
  list.innerHTML = html;

  // Abrir en Drive también marca como vista (sin frenar la apertura del link)
  list.querySelectorAll('.act-drive').forEach(a =>
    a.addEventListener('click', () => marcarVista(a.dataset.key)));
  list.querySelectorAll('.act-mark').forEach(b =>
    b.addEventListener('click', () => marcarVista(b.dataset.key)));
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.act-filter').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
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
  $('btn-logout').addEventListener('click', () => {
    sessionStorage.clear();
    localStorage.removeItem('responsable_code');
    localStorage.removeItem('responsable_name');
    localStorage.removeItem('vimeco_session');
    window.location.href = 'index.html';
  });

  // Sólo admins acceden a Novedades
  let isAdmin = code === '0000';
  if (!isAdmin) {
    try { const u = await getUsuario(code); isAdmin = !!(u && u.admin); } catch (_) {}
  }
  if (!isAdmin) { window.location.href = 'menu.html'; return; }

  seenKey = `vimeco_actividad_vistas_${code}`;
  try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]')); } catch (_) { seen = new Set(); }

  document.querySelectorAll('.act-filter').forEach(b =>
    b.addEventListener('click', () => setFilter(b.dataset.filter)));

  try {
    allEvents = await getActividad(RETENTION_DAYS);
  } catch (e) {
    $('act-list').innerHTML = '<div class="hist-empty">No se pudo cargar la actividad. Revisá tu conexión.</div>';
    console.error('getActividad:', e);
    return;
  }

  render();
});
