document.addEventListener('DOMContentLoaded', async () => {
  // Sesión nueva (vimeco_session)
  const savedSession = localStorage.getItem('vimeco_session');
  if (savedSession) {
    try {
      const s = JSON.parse(savedSession);
      if (s.codigo && s.nombre) {
        sessionStorage.setItem('responsable_code', s.codigo);
        sessionStorage.setItem('responsable_name', s.nombre);
        window.location.href = 'menu.html';
        return;
      }
    } catch (_) {}
  }
  // Limpiar claves viejas para forzar re-login con contraseña
  localStorage.removeItem('responsable_code');
  localStorage.removeItem('responsable_name');

  const selResp       = document.getElementById('responsable');
  const pwdSection    = document.getElementById('pwd-section');
  const pwdInput      = document.getElementById('pwd-input');
  const newPwdSection = document.getElementById('new-pwd-section');
  const newPwd1       = document.getElementById('new-pwd-1');
  const newPwd2       = document.getElementById('new-pwd-2');
  const btnLogin      = document.getElementById('btn-login');
  const errorEl       = document.getElementById('login-error');

  async function hashPassword(pwd) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function showError(msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }
  function hideError()    { errorEl.classList.add('hidden'); }

  function saveSession(codigo, nombre) {
    localStorage.setItem('vimeco_session', JSON.stringify({ codigo, nombre }));
    localStorage.setItem('responsable_code', codigo);
    localStorage.setItem('responsable_name', nombre);
    sessionStorage.setItem('responsable_code', codigo);
    sessionStorage.setItem('responsable_name', nombre);
    window.location.href = 'menu.html';
  }

  // Cargar usuarios desde Firebase
  let usuarios = [];
  try {
    usuarios = await getUsuariosActivos();
  } catch (_) {
    showError('No se pudo cargar la lista de usuarios. Verificá tu conexión.');
    btnLogin.disabled = true;
    return;
  }

  if (!usuarios.length) {
    showError('No hay usuarios configurados. Contactá al administrador.');
    btnLogin.disabled = true;
    return;
  }

  usuarios.forEach(u => {
    const opt = document.createElement('option');
    opt.value       = u.codigo;
    opt.textContent = u.nombre;
    selResp.appendChild(opt);
  });

  let currentUser = null;
  let isFirstTime = false;

  selResp.addEventListener('change', async () => {
    hideError();
    pwdSection.classList.add('hidden');
    newPwdSection.classList.add('hidden');
    btnLogin.disabled = true;
    pwdInput.value = '';
    newPwd1.value  = '';
    newPwd2.value  = '';

    const codigo = selResp.value;
    if (!codigo) { btnLogin.textContent = 'Ingresar'; return; }

    btnLogin.textContent = 'Verificando…';
    try {
      currentUser = await getUsuario(codigo);
      if (!currentUser || !currentUser.activo) throw new Error('Inactivo');
      isFirstTime = !currentUser.passwordHash;
      if (isFirstTime) {
        newPwdSection.classList.remove('hidden');
        btnLogin.textContent = 'Crear contraseña e ingresar';
        setTimeout(() => newPwd1.focus(), 50);
      } else {
        pwdSection.classList.remove('hidden');
        btnLogin.textContent = 'Ingresar';
        setTimeout(() => pwdInput.focus(), 50);
      }
      btnLogin.disabled = false;
    } catch (_) {
      showError('Error al cargar el usuario. Intentá de nuevo.');
      btnLogin.textContent = 'Ingresar';
    }
  });

  btnLogin.addEventListener('click', async () => {
    hideError();
    if (!selResp.value || !currentUser) { showError('Seleccioná un responsable.'); return; }

    if (isFirstTime) {
      const p1 = newPwd1.value, p2 = newPwd2.value;
      if (p1.length < 4) { showError('La contraseña debe tener al menos 4 caracteres.'); newPwd1.focus(); return; }
      if (p1 !== p2)     { showError('Las contraseñas no coinciden.'); newPwd2.focus(); return; }
      btnLogin.disabled = true;
      btnLogin.textContent = 'Guardando…';
      try {
        const hash = await hashPassword(p1);
        await patchUsuario(selResp.value, { passwordHash: hash });
        saveSession(selResp.value, currentUser.nombre);
      } catch (_) {
        showError('Error al guardar la contraseña. Intentá de nuevo.');
        btnLogin.disabled = false;
        btnLogin.textContent = 'Crear contraseña e ingresar';
      }
    } else {
      const pwd = pwdInput.value;
      if (!pwd) { showError('Ingresá tu contraseña.'); pwdInput.focus(); return; }
      btnLogin.disabled = true;
      btnLogin.textContent = 'Verificando…';
      const hash = await hashPassword(pwd);
      if (hash !== currentUser.passwordHash) {
        showError('Contraseña incorrecta.');
        btnLogin.disabled = false;
        btnLogin.textContent = 'Ingresar';
        pwdInput.value = '';
        pwdInput.focus();
        return;
      }
      saveSession(selResp.value, currentUser.nombre);
    }
  });

  pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnLogin.click(); });
  newPwd2.addEventListener('keydown',  e => { if (e.key === 'Enter') btnLogin.click(); });
});
