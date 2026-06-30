/* VIMECO S.A. — Feed de Actividad / Novedades (solo admins) */

const $ = id => document.getElementById(id);

const RETENTION_DAYS = 7;

let allEvents     = [];
let currentFilter = 'all';
let seenKey       = 'vimeco_actividad_seen';
let lastSeen      = 0;

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

function render() {
  const list   = $('act-list');
  const events = currentFilter === 'all'
    ? allEvents
    : allEvents.filter(e => e.tipo === currentFilter);

  $('act-count').textContent = events.length
    ? `${events.length} operación${events.length !== 1 ? 'es' : ''}`
    : '';

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
    const meta  = tipoMeta(e.tipo);
    const isNew = (e.timestamp || 0) > lastSeen;
    const drive = e.driveUrl
      ? `<a class="btn btn-sm btn-primary act-drive" href="${esc(e.driveUrl)}" target="_blank" rel="noopener">Abrir en Drive</a>`
      : '<span class="act-nodrive">sin link</span>';
    html += `
      <div class="hist-card act-card${isNew ? ' act-card-new' : ''}">
        <div class="act-row">
          <span class="act-badge ${meta.cls}">${icSvg(meta.icon)} ${meta.label}</span>
          <div class="act-body">
            <div class="act-title">${isNew ? '<span class="act-dot" title="Nuevo"></span>' : ''}${esc(e.titulo)}</div>
            <div class="act-detalle">${esc(e.detalle)}</div>
            <div class="act-meta">${esc(e.usuario?.nombre || '—')} · ${fmtHora(e.timestamp)}</div>
          </div>
          ${drive}
        </div>
      </div>`;
  });
  list.innerHTML = html;
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

  $('btn-back').addEventListener('click', () => { window.location.href = 'compras.html'; });
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
  if (!isAdmin) { window.location.href = 'compras.html'; return; }

  seenKey  = `vimeco_actividad_seen_${code}`;
  lastSeen = parseInt(localStorage.getItem(seenKey) || '0', 10);

  document.querySelectorAll('.act-filter').forEach(b =>
    b.addEventListener('click', () => setFilter(b.dataset.filter)));

  try {
    allEvents = await getActividad(RETENTION_DAYS);
  } catch (e) {
    $('act-list').innerHTML = '<div class="hist-empty">No se pudo cargar la actividad. Revisá tu conexión.</div>';
    console.error('getActividad:', e);
    return;
  }

  const nuevos = allEvents.filter(e => (e.timestamp || 0) > lastSeen).length;
  if (nuevos > 0) {
    const banner = $('act-banner');
    banner.textContent = `${nuevos} operación${nuevos !== 1 ? 'es' : ''} nueva${nuevos !== 1 ? 's' : ''} desde tu última visita`;
    banner.classList.remove('hidden');
  }

  render();

  // Marcar como visto: guardar el timestamp del evento más reciente
  if (allEvents.length) {
    localStorage.setItem(seenKey, String(allEvents[0].timestamp || Date.now()));
  }
});
