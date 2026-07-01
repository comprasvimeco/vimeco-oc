/* VIMECO S.A. — Personal: configuración de categorías y feriados (solo Admin) */

const $ = id => document.getElementById(id);

function showToast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4000);
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

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ───────────── Categorías ─────────────
let categorias = [];

function renderCategorias() {
  const cont = $('cat-list');
  if (!categorias.length) {
    cont.innerHTML = '<span style="color:var(--gray-500);font-size:.85rem;">Sin categorías. Agregá la primera.</span>';
    return;
  }
  cont.innerHTML = categorias.map((c, i) => `
    <span class="chip">${esc(c)}<button data-i="${i}" title="Quitar">×</button></span>
  `).join('');
  cont.querySelectorAll('.chip button').forEach(btn => {
    btn.addEventListener('click', () => removeCategoria(parseInt(btn.dataset.i, 10)));
  });
}

async function addCategoria() {
  const val = $('cat-input').value.trim();
  if (!val) return;
  if (categorias.some(c => c.toLowerCase() === val.toLowerCase())) {
    showToast('Esa categoría ya existe.', 'warning');
    return;
  }
  categorias.push(val);
  $('cat-input').value = '';
  renderCategorias();
  try { await saveCategoriasPersonal(categorias); showToast('Categoría agregada.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

async function removeCategoria(i) {
  const nombre = categorias[i];
  const ok = await showConfirm('Quitar categoría', `¿Quitar la categoría "${nombre}"?`);
  if (!ok) return;
  categorias.splice(i, 1);
  renderCategorias();
  try { await saveCategoriasPersonal(categorias); showToast('Categoría quitada.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

// ───────────── Feriados ─────────────
let feriados = {};  // { "YYYY-MM-DD": "Nombre" }

function fmtFecha(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderFeriados() {
  const cont = $('fer-list');
  const fechas = Object.keys(feriados).sort();
  if (!fechas.length) {
    cont.innerHTML = '<span style="color:var(--gray-500);font-size:.85rem;">Sin feriados cargados.</span>';
    return;
  }
  cont.innerHTML = fechas.map(f => `
    <div class="fer-item">
      <span class="fer-fecha">${fmtFecha(f)}</span>
      <span class="fer-nombre">${esc(feriados[f])}</span>
      <button class="btn btn-sm btn-danger" data-f="${f}">Quitar</button>
    </div>
  `).join('');
  cont.querySelectorAll('button[data-f]').forEach(btn => {
    btn.addEventListener('click', () => removeFeriado(btn.dataset.f));
  });
}

async function addFeriado() {
  const fecha  = $('fer-fecha').value;       // YYYY-MM-DD
  const nombre = $('fer-nombre').value.trim();
  if (!fecha)  { showToast('Elegí una fecha.', 'warning'); return; }
  if (!nombre) { showToast('Ingresá el nombre del feriado.', 'warning'); return; }
  feriados[fecha] = nombre;
  $('fer-fecha').value = '';
  $('fer-nombre').value = '';
  renderFeriados();
  try { await saveFeriados(feriados); showToast('Feriado agregado.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

async function removeFeriado(fecha) {
  const ok = await showConfirm('Quitar feriado', `¿Quitar el feriado del ${fmtFecha(fecha)}?`);
  if (!ok) return;
  delete feriados[fecha];
  renderFeriados();
  try { await saveFeriados(feriados); showToast('Feriado quitado.'); }
  catch (_) { showToast('Error al guardar.', 'error'); }
}

// ───────────── Init ─────────────
document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }
  if (_s.codigo !== '0000') { window.location.href = 'menu.html'; return; }

  $('hdr-name').textContent = _s.nombre;
  $('btn-back').addEventListener('click', () => { window.location.href = 'administracion.html'; });
  $('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('vimeco_session');
    sessionStorage.clear();
    window.location.href = 'index.html';
  });

  $('cat-add').addEventListener('click', addCategoria);
  $('cat-input').addEventListener('keydown', e => { if (e.key === 'Enter') addCategoria(); });
  $('fer-add').addEventListener('click', addFeriado);
  $('fer-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') addFeriado(); });

  try {
    [categorias, feriados] = await Promise.all([getCategoriasPersonal(), getFeriados()]);
  } catch (_) {
    categorias = []; feriados = {};
    showToast('Error al cargar la configuración.', 'error');
  }
  renderCategorias();
  renderFeriados();
});
