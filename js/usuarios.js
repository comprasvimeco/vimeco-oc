/* VIMECO S.A. — Gestión de Usuarios (solo Admin) */

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

let allUsuarios = [];

function renderUsers(list) {
  const container = $('users-list');
  if (!list.length) {
    container.innerHTML = '<div class="hist-empty">No hay usuarios cargados.</div>';
    return;
  }
  container.innerHTML = list.map(u => {
    const esSuper = u.codigo === '0000';
    const cajaBadge = esSuper
      ? '<span class="u-badge u-badge-activo">🧮 Caja (admin)</span>'
      : `<span class="u-badge ${u.caja ? 'u-badge-activo' : 'u-badge-inactivo'}">${u.caja ? '🧮 Caja' : '🧮 Sin caja'}</span>`;
    const adminBadge = esSuper
      ? '<span class="u-badge u-badge-activo">⚙️ Admin (super)</span>'
      : (u.admin ? '<span class="u-badge u-badge-activo">⚙️ Admin</span>' : '');
    const jefeBadge = (!esSuper && u.jefeObra)
      ? '<span class="u-badge u-badge-activo">👷 Jefe de Obra</span>'
      : '';
    const jefeBtn = esSuper
      ? ''
      : `<button class="btn btn-sm ${u.jefeObra ? 'btn-warning' : 'btn-success'} btn-toggle-jefe">${u.jefeObra ? 'Quitar jefe' : 'Dar jefe'}</button>`;
    const cajaBtn = esSuper
      ? ''
      : `<button class="btn btn-sm ${u.caja ? 'btn-warning' : 'btn-success'} btn-toggle-caja">${u.caja ? 'Quitar caja' : 'Dar caja'}</button>`;
    const adminBtn = esSuper
      ? ''
      : `<button class="btn btn-sm ${u.admin ? 'btn-warning' : 'btn-success'} btn-toggle-admin">${u.admin ? 'Quitar admin' : 'Dar admin'}</button>`;
    return `
    <div class="user-card ${u.activo ? '' : 'user-card--inactive'}">
      <div class="user-card-info">
        <span class="user-card-code">${esc(u.codigo)}</span>
        <span class="user-card-name">${esc(u.nombre)}</span>
        <span class="u-badge ${u.activo ? 'u-badge-activo' : 'u-badge-inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span>
        <span class="u-badge ${u.passwordHash ? 'u-badge-pwd-ok' : 'u-badge-pwd-none'}">${u.passwordHash ? '🔑 Con contraseña' : '⚠ Sin contraseña'}</span>
        ${cajaBadge}
        ${adminBadge}
        ${jefeBadge}
      </div>
      <div class="user-card-actions">
        <button class="btn btn-sm btn-outline btn-edit-user">Editar</button>
        <button class="btn btn-sm btn-secondary btn-reset-pwd">Reset pwd</button>
        ${cajaBtn}
        ${adminBtn}
        ${jefeBtn}
        <button class="btn btn-sm ${u.activo ? 'btn-danger' : 'btn-success'} btn-toggle-user">
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
      </div>
    </div>
  `;
  }).join('');

  container.querySelectorAll('.user-card').forEach((card, i) => {
    const u = list[i];
    card.querySelector('.btn-edit-user').addEventListener('click',   () => editUser(u.codigo, u.nombre));
    card.querySelector('.btn-reset-pwd').addEventListener('click',   () => resetPwd(u.codigo, u.nombre));
    card.querySelector('.btn-toggle-user').addEventListener('click', () => toggleActivo(u.codigo, u.activo, u.nombre));
    card.querySelector('.btn-toggle-caja')?.addEventListener('click',  () => toggleCaja(u.codigo, u.caja, u.nombre));
    card.querySelector('.btn-toggle-admin')?.addEventListener('click', () => toggleAdmin(u.codigo, u.admin, u.nombre));
    card.querySelector('.btn-toggle-jefe')?.addEventListener('click',  () => toggleJefe(u.codigo, u.jefeObra, u.nombre));
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
    `¿Resetear la contraseña de ${nombre}? El usuario deberá crear una nueva al próximo ingreso.`
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

window.toggleAdmin = async function (codigo, enabled, nombre) {
  const ok = await showConfirm(
    enabled ? 'Quitar admin' : 'Dar admin',
    enabled
      ? `¿Quitar los permisos de administrador a ${nombre}?`
      : `¿Dar permisos de administrador a ${nombre}? Tendrá las funciones de admin (incluida la gestión completa de Caja de todos los usuarios), salvo el menú de Administración.`
  );
  if (!ok) return;
  try {
    await patchUsuario(codigo, { admin: !enabled });
    showToast(`Admin ${enabled ? 'quitado' : 'otorgado'} a ${nombre}.`);
    await loadUsers();
  } catch (_) {
    showToast('Error al actualizar el permiso de admin.', 'error');
  }
};

window.toggleJefe = async function (codigo, enabled, nombre) {
  const ok = await showConfirm(
    enabled ? 'Quitar Jefe de Obra' : 'Dar Jefe de Obra',
    enabled
      ? `¿Quitar el rol de Jefe de Obra a ${nombre}? Dejará de ver el módulo Personal.`
      : `¿Dar el rol de Jefe de Obra a ${nombre}? Podrá gestionar la cuadrilla y los partes de las obras que se le asignen.`
  );
  if (!ok) return;
  try {
    await patchUsuario(codigo, { jefeObra: !enabled });
    showToast(`Jefe de Obra ${enabled ? 'quitado' : 'otorgado'} a ${nombre}.`);
    await loadUsers();
  } catch (_) {
    showToast('Error al actualizar el rol de Jefe de Obra.', 'error');
  }
};

window.toggleCaja = async function (codigo, enabled, nombre) {
  const ok = await showConfirm(
    enabled ? 'Quitar acceso a Caja' : 'Habilitar Caja',
    enabled
      ? `¿Quitar el acceso a Caja Chica de ${nombre}?`
      : `¿Habilitar Caja Chica para ${nombre}? Podrá registrar ingresos y egresos de su propia caja.`
  );
  if (!ok) return;
  try {
    await patchUsuario(codigo, { caja: !enabled });
    showToast(`Caja ${enabled ? 'deshabilitada' : 'habilitada'} para ${nombre}.`);
    await loadUsers();
  } catch (_) {
    showToast('Error al actualizar el permiso de Caja.', 'error');
  }
};

window.toggleActivo = async function (codigo, activo, nombre) {
  const ok = await showConfirm(
    activo ? 'Desactivar usuario' : 'Activar usuario',
    activo
      ? `¿Desactivar a ${nombre}? No podrá ingresar al sistema.`
      : `¿Activar a ${nombre}?`
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
  $('btn-logout').addEventListener('click', () => {
    sessionStorage.clear();
    localStorage.removeItem('responsable_code');
    localStorage.removeItem('responsable_name');
    localStorage.removeItem('vimeco_session');
    window.location.href = 'index.html';
  });

  $('btn-add-user').addEventListener('click', openAddModal);
  $('modal-user-close').addEventListener('click', () => $('modal-user').classList.add('hidden'));
  $('modal-user-cancel').addEventListener('click', () => $('modal-user').classList.add('hidden'));
  $('modal-user-save').addEventListener('click', saveUser);
  $('user-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveUser(); });

  loadUsers();
});
