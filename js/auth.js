/* global USUARIOS */

document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('responsable_code')) {
    window.location.href = 'app.html';
    return;
  }

  const selResp = document.getElementById('responsable');
  const errorEl = document.getElementById('login-error');

  USUARIOS.forEach(u => {
    const opt = document.createElement('option');
    opt.value       = u.codigo;
    opt.textContent = u.nombre;
    selResp.appendChild(opt);
  });

  function getUserName(codigo) {
    const u = USUARIOS.find(u => u.codigo === codigo);
    return u ? u.nombre : codigo;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  selResp.addEventListener('change', () => errorEl.classList.add('hidden'));

  document.getElementById('btn-login').addEventListener('click', () => {
    const code = selResp.value.trim();
    if (!code) {
      showError('Por favor, seleccioná un responsable.');
      selResp.focus();
      return;
    }
    sessionStorage.setItem('responsable_code', code);
    sessionStorage.setItem('responsable_name', getUserName(code));
    window.location.href = 'app.html';
  });
});
