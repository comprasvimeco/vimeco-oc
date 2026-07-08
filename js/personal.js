/* VIMECO S.A. — Personal: selección de obra (Jefe de Obra / Admin) */

const $ = id => document.getElementById(id);

function showToast(msg, type = 'success') {
  const icons = { success: icSvg('checkSm'), error: icSvg('x'), warning: icSvg('alert'), info: icSvg('info') };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || icons.info}</span><span>${msg}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderObras(list) {
  const cont = $('obras-list');
  if (!list.length) {
    cont.innerHTML = '<div class="hist-empty">No tenés obras asignadas. Pedile al administrador que te asigne una.</div>';
    return;
  }
  cont.innerHTML = list.map(o => `
    <div class="user-card" data-key="${esc(o.key)}" data-nombre="${esc(o.nombre)}" style="cursor:pointer;">
      <div class="user-card-info">
        <span class="user-card-name">${esc(o.nombre)}</span>
        ${o.lugar_entrega ? `<span style="font-size:.8rem;color:var(--gray-500);">${esc(o.lugar_entrega)}</span>` : ''}
      </div>
      <div class="user-card-actions">
        <svg class="icon" viewBox="0 0 24 24" style="color:var(--gray-400);"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  `).join('');

  cont.querySelectorAll('.user-card').forEach(card => {
    card.addEventListener('click', () => {
      const key    = card.dataset.key;
      const nombre = card.dataset.nombre;
      window.location.href = `personal-obra.html?obra=${encodeURIComponent(key)}&nombre=${encodeURIComponent(nombre)}`;
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
    const obras = esAdmin ? await getObrasActivas() : await getObrasDeJefe(_s.codigo);
    renderObras(obras);
  } catch (_) {
    $('obras-list').innerHTML = '<div class="hist-empty">Error al cargar las obras.</div>';
  }
});
