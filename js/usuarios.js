/* VIMECO S.A. — Gestión de Usuarios (solo Admin) */

const $ = id => document.getElementById(id);



function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let allUsuarios = [];

// Iniciales para el avatar, sin el título ("Arq.", "Ing."): "Arq. Gustavo Pes" → "GP".
function iniciales(nombre) {
  const pal = String(nombre || '').split(/\s+/).filter(p => p && !p.endsWith('.'));
  if (!pal.length) return '?';
  const ini = pal.length > 1 ? pal[0][0] + pal[pal.length - 1][0] : pal[0].slice(0, 2);
  return ini.toUpperCase();
}

function permsHtml(u) {
  const perm = (tono, icon, txt) => `<span class="usr-perm usr-perm--${tono}">${icSvg(icon)}${txt}</span>`;
  if (u.codigo === '0000')
    return perm('admin', 'settings', 'Admin (super)') + perm('caja', 'calc', 'Caja (todas)');
  const out = [];
  if (u.admin)             out.push(perm('admin',    'settings', 'Admin'));
  if (u.caja)              out.push(perm('caja',     'calc',     'Caja'));
  if (u.jefeObra)          out.push(perm('obra',     'user',     'Jefe de Obra'));
  if (u.jefeTaller)        out.push(perm('taller',   'layers',   'Jefe de Taller'));
  if (u.reportes)          out.push(perm('reportes', 'sheet',    'Reportes'));
  if (tieneNovedades(u))   out.push(perm('nov',      'info',     'Novedades'));
  if (u.autorizaDesde > 0) out.push(perm('autoriza', 'check',    `Autoriza OC &gt; <b>$ ${fmtMonto(u.autorizaDesde)}</b>`));
  return out.length ? out.join('') : '<span class="usr-noperms">Sin permisos adicionales</span>';
}

function renderUsers(list) {
  const container = $('users-list');
  const activos = list.filter(u => u.activo).length;
  $('users-count').textContent = list.length
    ? `${list.length} usuario${list.length !== 1 ? 's' : ''} · ${activos} activo${activos !== 1 ? 's' : ''}` : '';
  if (!list.length) {
    container.innerHTML = '<div class="hist-empty">No hay usuarios cargados.</div>';
    return;
  }
  container.innerHTML = list.map(u => {
    const esSuper = u.codigo === '0000';
    const pwd = u.passwordHash
      ? `<span class="usr-meta-i">${icSvg('key')}Con contraseña</span>`
      : `<span class="usr-meta-i usr-warn">${icSvg('alert')}Sin contraseña</span>`;
    return `
    <div class="usr-card ${u.activo ? '' : 'usr-card--off'}">
      <div class="usr-head">
        <div class="usr-avatar" aria-hidden="true">${esc(iniciales(u.nombre))}</div>
        <div class="usr-id">
          <div class="usr-name" title="${esc(u.nombre)}">${esc(u.nombre)}</div>
          <div class="usr-meta"><span class="usr-code">${esc(u.codigo)}</span>${pwd}</div>
        </div>
        ${u.activo ? '' : '<span class="usr-off">Inactivo</span>'}
      </div>
      <div class="usr-perms">${permsHtml(u)}</div>
      <div class="usr-actions">
        <button class="foc-btn foc-btn--edit btn-edit-user">${icSvg('edit')}Editar</button>
        ${esSuper ? '' : `<button class="foc-btn foc-btn--gen btn-permisos">${icSvg('userCheck')}Permisos</button>`}
        <button class="foc-btn foc-btn--clear btn-reset-pwd">${icSvg('key')}Resetear clave</button>
        <button class="foc-btn ${u.activo ? 'foc-btn--del' : 'foc-btn--gen'} usr-toggle btn-toggle-user">
          ${u.activo ? icSvg('x') + 'Desactivar' : icSvg('checkSm') + 'Activar'}
        </button>
      </div>
    </div>
  `;
  }).join('');

  container.querySelectorAll('.usr-card').forEach((card, i) => {
    const u = list[i];
    card.querySelector('.btn-edit-user').addEventListener('click',   () => editUser(u.codigo, u.nombre));
    card.querySelector('.btn-reset-pwd').addEventListener('click',   () => resetPwd(u.codigo, u.nombre));
    card.querySelector('.btn-toggle-user').addEventListener('click', () => toggleActivo(u.codigo, u.activo, u.nombre));
    card.querySelector('.btn-permisos')?.addEventListener('click',   () => openPermisos(u));
  });
}

async function loadUsers() {
  try {
    allUsuarios = await getAllUsuarios();
    renderUsers(allUsuarios);
  } catch (_) {
    $('users-list').innerHTML = '<div class="hist-empty">Error al cargar usuarios.</div>';
  }
}

// ---- Agregar / Editar ----
let editingCodigo = null;

function openAddModal() {
  editingCodigo = null;
  $('modal-user-title').textContent = 'Agregar usuario';
  $('modal-user-error').classList.add('hidden');

  const maxCode = allUsuarios
    .map(u => parseInt(u.codigo, 10))
    .filter(n => !isNaN(n) && n !== 0)
    .reduce((a, b) => Math.max(a, b), 0);
  $('user-codigo').value    = String(maxCode + 1).padStart(4, '0');
  $('user-codigo').disabled = false;
  $('user-nombre').value    = '';
  $('modal-user').classList.remove('hidden');
  setTimeout(() => $('user-nombre').focus(), 50);
}

window.editUser = function (codigo, nombre) {
  editingCodigo = codigo;
  $('modal-user-title').textContent = 'Editar usuario';
  $('modal-user-error').classList.add('hidden');
  $('user-codigo').value    = codigo;
  $('user-codigo').disabled = true;
  $('user-nombre').value    = nombre;
  $('modal-user').classList.remove('hidden');
  setTimeout(() => $('user-nombre').focus(), 50);
};

async function saveUser() {
  const codigo = $('user-codigo').value.trim().padStart(4, '0');
  const nombre = $('user-nombre').value.trim();
  const errEl  = $('modal-user-error');

  if (!/^\d{4}$/.test(codigo)) {
    errEl.textContent = 'El código debe ser de 4 dígitos numéricos.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!editingCodigo && allUsuarios.some(u => u.codigo === codigo)) {
    errEl.textContent = 'Ya existe un usuario con ese código.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-user-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    if (editingCodigo) {
      await patchUsuario(editingCodigo, { nombre });
    } else {
      await saveUsuario(codigo, { nombre, activo: true, passwordHash: null, creadoEn: Date.now() });
    }
    $('modal-user').classList.add('hidden');
    showToast(editingCodigo ? 'Usuario actualizado.' : 'Usuario creado.');
    await loadUsers();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

window.resetPwd = async function (codigo, nombre) {
  const ok = await showConfirm(
    'Resetear contraseña',
    `¿Resetear la contraseña de ${nombre}? El usuario deberá crear una nueva al próximo ingreso.`,
    { boton: 'Resetear', tono: 'warn', icono: 'key' }
  );
  if (!ok) return;
  try {
    await patchUsuario(codigo, { passwordHash: null });
    showToast('Contraseña reseteada.');
    await loadUsers();
  } catch (_) {
    showToast('Error al resetear la contraseña.', 'error');
  }
};

// ---- Permisos (modal unificado) ----
let permisosCodigo = null;

// Novedades era parte de `admin`: quien nunca tuvo el permiso propio lo
// conserva mientras sea admin, hasta que se lo toque desde acá.
function tieneNovedades(u) {
  return u.novedades != null ? !!u.novedades : !!u.admin;
}

function fmtMonto(n) {
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// "2.000.000" / "2000000" / "$ 2.000.000,00" → 2000000. Vacío o 0 → null.
function parseMonto(str) {
  const n = parseInt(String(str || '').replace(/,\d*$/, '').replace(/\D/g, ''), 10);
  return n > 0 ? n : null;
}

window.openPermisos = function (u) {
  permisosCodigo = u.codigo;
  $('modal-permisos-name').textContent = u.nombre;
  $('perm-caja').checked       = !!u.caja;
  $('perm-admin').checked      = !!u.admin;
  $('perm-jefeObra').checked   = !!u.jefeObra;
  $('perm-jefeTaller').checked = !!u.jefeTaller;
  $('perm-reportes').checked   = !!u.reportes;
  $('perm-novedades').checked  = tieneNovedades(u);
  $('perm-autorizaDesde').value = u.autorizaDesde > 0 ? fmtMonto(u.autorizaDesde) : '';
  $('modal-permisos-error').classList.add('hidden');
  $('modal-permisos').classList.remove('hidden');
};

async function savePermisos() {
  if (!permisosCodigo) return;
  const fields = {
    caja:       $('perm-caja').checked,
    admin:      $('perm-admin').checked,
    jefeObra:   $('perm-jefeObra').checked,
    jefeTaller: $('perm-jefeTaller').checked,
    reportes:   $('perm-reportes').checked,
    novedades:  $('perm-novedades').checked,
    autorizaDesde: parseMonto($('perm-autorizaDesde').value)
  };
  const btn = $('modal-permisos-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await patchUsuario(permisosCodigo, fields);
    $('modal-permisos').classList.add('hidden');
    showToast('Permisos actualizados.');
    await loadUsers();
  } catch (_) {
    $('modal-permisos-error').textContent = 'Error al guardar los permisos.';
    $('modal-permisos-error').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

window.toggleActivo = async function (codigo, activo, nombre) {
  const ok = await showConfirm(
    activo ? 'Desactivar usuario' : 'Activar usuario',
    activo
      ? `¿Desactivar a ${nombre}? No podrá ingresar al sistema.`
      : `¿Activar a ${nombre}?`,
    activo ? { boton: 'Desactivar', tono: 'warn', icono: 'power' } : { boton: 'Activar', tono: 'ok', icono: 'power' }
  );
  if (!ok) return;
  try {
    await patchUsuario(codigo, { activo: !activo });
    showToast(`Usuario ${activo ? 'desactivado' : 'activado'}.`);
    await loadUsers();
  } catch (_) {
    showToast('Error al actualizar el usuario.', 'error');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name || code !== '0000') { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  $('hdr-name').textContent = name;
  $('btn-back').addEventListener('click', () => { window.location.href = 'administracion.html'; });
  $('btn-add-user').addEventListener('click', openAddModal);
  $('modal-user-close').addEventListener('click', () => $('modal-user').classList.add('hidden'));
  $('modal-user-cancel').addEventListener('click', () => $('modal-user').classList.add('hidden'));
  $('modal-user-save').addEventListener('click', saveUser);
  $('user-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveUser(); });
  $('modal-permisos-close').addEventListener('click',  () => $('modal-permisos').classList.add('hidden'));
  $('modal-permisos-cancel').addEventListener('click', () => $('modal-permisos').classList.add('hidden'));
  $('modal-permisos-save').addEventListener('click', savePermisos);
  $('perm-autorizaDesde').addEventListener('blur', e => {
    const n = parseMonto(e.target.value);
    e.target.value = n ? fmtMonto(n) : '';
  });

  loadUsers();
});
