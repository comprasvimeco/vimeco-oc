/* VIMECO S.A. — Ficha de Equipo (admin 0000 o Jefe de taller) */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Clave de Firebase derivada del código (igual que en equipos.js).
function equipoKey(codigo) {
  return String(codigo).trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
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

// Redimensiona y comprime la imagen en el cliente antes de guardarla como
// dataURL. Una foto de celular pesa 3-5 MB; así queda en ~80-150 KB.
// Helper genérico: reutilizable a futuro para la foto de rostro en Personal.
function compressImage(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('img'));
      img.onload = () => {
        let { width, height } = img;
        if (width >= height && width > maxDim) {
          height = Math.round(height * maxDim / width); width = maxDim;
        } else if (height > width && height > maxDim) {
          width = Math.round(width * maxDim / height); height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Estado ----
let currentKey = null;
let equipo     = null;   // datos del equipo cargado
let fotoActual = null;   // dataURL guardado en Firebase (para saber si cambió)
let fotoNueva  = null;   // dataURL elegido en esta sesión (null = sin cambios)
let fotoQuitar = false;  // se pidió borrar la foto

// ---- Foto ----
function pintarFoto(dataURL) {
  const box = $('eq-foto');
  if (dataURL) {
    box.innerHTML = `<img src="${dataURL}" alt="Foto del equipo">`;
    $('btn-foto').textContent = 'Cambiar foto';
    $('btn-foto-del').style.display = '';
  } else {
    box.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2"/>
        <circle cx="8.5" cy="10" r="1.5"/>
        <path d="M21 17l-5-5-4 4-2-2-7 7"/>
      </svg>`;
    $('btn-foto').textContent = 'Agregar foto';
    $('btn-foto-del').style.display = 'none';
  }
}

async function onFotoElegida(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const dataURL = await compressImage(file);
    fotoNueva  = dataURL;
    fotoQuitar = false;
    pintarFoto(dataURL);
  } catch (_) {
    showToast('No se pudo procesar la imagen.', 'error');
  }
}

function onQuitarFoto() {
  fotoNueva  = null;
  fotoQuitar = true;
  pintarFoto(null);
}

// ---- Repuestos ----
function addItemRow(valor = '') {
  const row = document.createElement('div');
  row.className = 'eq-item-row';
  row.innerHTML = `
    <input type="text" class="form-control" placeholder="Ej: Filtro de aceite Mann W940">
    <button class="eq-item-del" title="Quitar">&times;</button>`;
  row.querySelector('input').value = valor;
  row.querySelector('.eq-item-del').addEventListener('click', () => {
    row.remove();
    refreshItemsEmpty();
  });
  $('eq-items').appendChild(row);
  refreshItemsEmpty();
  return row;
}

function refreshItemsEmpty() {
  const cont = $('eq-items');
  const hasRows = cont.querySelector('.eq-item-row');
  let ph = cont.querySelector('.eq-items-empty');
  if (!hasRows && !ph) {
    ph = document.createElement('div');
    ph.className = 'eq-items-empty';
    ph.textContent = 'Sin repuestos ni características cargados todavía.';
    cont.prepend(ph);
  } else if (hasRows && ph) {
    ph.remove();
  }
}

function collectItems() {
  return Array.from($('eq-items').querySelectorAll('.eq-item-row input'))
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

// ---- Carga ----
async function loadFicha() {
  try {
    equipo = await getEquipo(currentKey);
    if (!equipo) {
      $('eq-loading').innerHTML = '<div class="hist-empty">El equipo no existe.</div>';
      return;
    }
    fotoActual = await getEquipoFoto(currentKey).catch(() => null);

    $('eq-codigo').value  = equipo.codigo || '';
    $('eq-tipo').value    = equipo.tipo || '';
    $('eq-activo').checked = equipo.activo !== false;

    (equipo.items || []).forEach(it => addItemRow(it));
    refreshItemsEmpty();

    pintarFoto(fotoActual);

    $('eq-loading').style.display = 'none';
    $('eq-ficha').style.display   = '';
    document.querySelector('.header-title').textContent = equipo.codigo || 'Ficha de Equipo';
  } catch (_) {
    $('eq-loading').innerHTML = '<div class="hist-empty">Error al cargar la ficha.</div>';
  }
}

// ---- Guardar ----
async function save() {
  const codigo = $('eq-codigo').value.trim();
  const tipo   = $('eq-tipo').value.trim();
  const activo = $('eq-activo').checked;
  const items  = collectItems();
  const errEl  = $('eq-error');
  errEl.classList.add('hidden');

  if (!codigo) {
    errEl.textContent = 'El código es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const newKey = equipoKey(codigo);
  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    let keyFinal = currentKey;

    if (newKey !== currentKey) {
      // Cambió el código = cambió la clave: mover el equipo (y su foto) a la clave nueva.
      const existentes = await getAllEquipos();
      if (existentes.some(e => e.key === newKey)) {
        errEl.textContent = 'Ya existe un equipo con ese código.';
        errEl.classList.remove('hidden');
        return;
      }
      await saveEquipo(newKey, {
        codigo, tipo, activo, items,
        creadoEn: equipo.creadoEn || Date.now()
      });
      await deleteEquipo(currentKey);
      keyFinal = newKey;
    } else {
      await patchEquipo(currentKey, { codigo, tipo, activo, items });
    }

    // Foto
    if (fotoNueva) {
      await saveEquipoFoto(keyFinal, fotoNueva);
      if (keyFinal !== currentKey) await deleteEquipoFoto(currentKey).catch(() => {});
    } else if (fotoQuitar) {
      await deleteEquipoFoto(keyFinal).catch(() => {});
      if (keyFinal !== currentKey) await deleteEquipoFoto(currentKey).catch(() => {});
    } else if (keyFinal !== currentKey && fotoActual) {
      // No se tocó la foto, pero cambió la clave: moverla.
      await saveEquipoFoto(keyFinal, fotoActual);
      await deleteEquipoFoto(currentKey).catch(() => {});
    }

    showToast('Ficha guardada.');
    if (keyFinal !== currentKey) {
      window.location.replace('equipo.html?key=' + encodeURIComponent(keyFinal));
      return;
    }
    // Refrescar estado local
    equipo = { key: keyFinal, codigo, tipo, activo, items, creadoEn: equipo.creadoEn };
    if (fotoNueva) fotoActual = fotoNueva;
    else if (fotoQuitar) fotoActual = null;
    fotoNueva = null; fotoQuitar = false;
    document.querySelector('.header-title').textContent = codigo;
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  }
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  const code = _s?.codigo || sessionStorage.getItem('responsable_code');
  const name = _s?.nombre || sessionStorage.getItem('responsable_name');
  if (!code) { window.location.href = 'index.html'; return; }

  // Acceso: super-admin (0000) o Jefe de taller.
  let allowed = code === '0000';
  if (!allowed) {
    try { const u = await getUsuario(code); allowed = !!(u && u.jefeTaller); } catch (_) {}
  }
  if (!allowed) { window.location.href = 'menu.html'; return; }

  currentKey = new URLSearchParams(location.search).get('key');
  if (!currentKey) { window.location.href = 'equipos.html'; return; }

  $('hdr-name').textContent = name || '—';
  $('btn-back').addEventListener('click', () => { window.location.href = 'equipos.html'; });
  $('btn-foto').addEventListener('click', () => $('eq-file').click());
  $('eq-file').addEventListener('change', onFotoElegida);
  $('btn-foto-del').addEventListener('click', onQuitarFoto);
  $('btn-add-item').addEventListener('click', () => addItemRow().querySelector('input').focus());
  $('btn-save').addEventListener('click', save);

  loadFicha();
});
