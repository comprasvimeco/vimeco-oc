/* VIMECO S.A. — Personal: selección de obra (Jefe de Obra / Admin) */

const $ = id => document.getElementById(id);



function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Cuenta de personal activo por obra: { obraKey: n }. Una sola lectura del padrón
// alcanza para todas las obras.
async function contarPorObra() {
  try {
    const personal = await getPersonal();
    const out = {};
    personal.forEach(p => {
      if (p.activo === false) return;
      Object.keys(p.obras || {}).forEach(k => { if (p.obras[k]) out[k] = (out[k] || 0) + 1; });
    });
    return out;
  } catch (_) {
    return null;   // sin conteo: las cards se muestran igual, sin el chip
  }
}

function renderObras(list, counts) {
  const cont = $('obras-list');
  if (!list.length) {
    cont.className = '';
    cont.innerHTML = '<div class="hist-empty">No tenés obras asignadas. Pedile al administrador que te asigne una.</div>';
    return;
  }
  cont.className = 'obra-grid';
  cont.innerHTML = list.map(o => {
    const n = counts ? (counts[o.key] || 0) : null;
    const chip = n === null ? '' : `
      <span class="obra-card-count ${n === 0 ? 'is-empty' : ''}">
        ${icSvg('users')} ${n === 0 ? 'Sin personal' : n + ' en obra'}
      </span>`;
    return `
      <div class="obra-card" data-key="${esc(o.key)}" data-nombre="${esc(o.nombre)}" role="button" tabindex="0">
        <div class="obra-card-icon">${icSvg('building')}</div>
        <div class="obra-card-body">
          <div class="obra-card-name">${esc(o.nombre)}</div>
          ${o.lugar_entrega ? `<div class="obra-card-sub">${esc(o.lugar_entrega)}</div>` : ''}
          ${chip}
        </div>
      </div>`;
  }).join('');

  cont.querySelectorAll('.obra-card').forEach(card => {
    const abrir = () => {
      const key    = card.dataset.key;
      const nombre = card.dataset.nombre;
      window.location.href = `personal-obra.html?obra=${encodeURIComponent(key)}&nombre=${encodeURIComponent(nombre)}`;
    };
    card.addEventListener('click', abrir);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }

  $('hdr-name').textContent = _s.nombre;
  $('btn-back').addEventListener('click', () => { window.location.href = 'menu.html'; });
  // Determinar rol: admin (0000 o flag admin) ve todas las obras; jefe ve las suyas.
  let esAdmin = _s.codigo === '0000';
  let esJefe  = false;
  if (!esAdmin) {
    try {
      const u = await getUsuario(_s.codigo);
      esAdmin = !!(u && u.admin);
      esJefe  = !!(u && u.jefeObra);
    } catch (_) {}
    if (!esAdmin && !esJefe) { window.location.href = 'menu.html'; return; }
  }

  try {
    const [obras, counts] = await Promise.all([
      esAdmin ? getObrasActivas() : getObrasDeJefe(_s.codigo),
      contarPorObra()
    ]);
    renderObras(obras, counts);
  } catch (_) {
    $('obras-list').className = '';
    $('obras-list').innerHTML = '<div class="hist-empty">Error al cargar las obras.</div>';
  }
});
