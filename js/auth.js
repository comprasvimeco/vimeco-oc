/* Ingreso: elegir quién sos (lista con buscador o "Seguir como …" para la
   última persona que entró en este dispositivo) y poner la contraseña, o
   crearla la primera vez. */
const LS_ULTIMO = 'vimeco_ultimo_ingreso';

document.addEventListener('DOMContentLoaded', async () => {
  // Sesión nueva (vimeco_session)
  const savedSession = localStorage.getItem('vimeco_session');
  if (savedSession) {
    try {
      const s = JSON.parse(savedSession);
      if (s.codigo && s.nombre) {
        sessionStorage.setItem('responsable_code', s.codigo);
        sessionStorage.setItem('responsable_name', s.nombre);
        window.location.href = destinoTrasLogin();
        return;
      }
    } catch (_) {}
  }
  // Quien entró antes de que existiera "Seguir como …": su código viejo sirve de recuerdo.
  try {
    const viejo = localStorage.getItem('responsable_code');
    if (viejo && !localStorage.getItem(LS_ULTIMO)) localStorage.setItem(LS_ULTIMO, JSON.stringify({ codigo: viejo }));
  } catch (_) {}
  // Limpiar claves viejas para forzar re-login con contraseña
  localStorage.removeItem('responsable_code');
  localStorage.removeItem('responsable_name');

  const $ = id => document.getElementById(id);
  const cargandoEl    = $('lg-cargando');
  const pasoQuien     = $('lg-paso-quien');
  const form          = $('lg-form');
  const buscar        = $('lg-buscar');
  const listEl        = $('lg-list');
  const pwdSection    = $('pwd-section');
  const pwdInput      = $('pwd-input');
  const newPwdSection = $('new-pwd-section');
  const newPwd1       = $('new-pwd-1');
  const newPwd2       = $('new-pwd-2');
  const hintEl        = $('lg-hint');
  const btnLogin      = $('btn-login');
  const errorEl       = $('login-error');
  const olvideBtn     = $('lg-olvide-btn');
  const olvideBox     = $('lg-olvide');
  const esEscritorio  = () => window.matchMedia('(min-width: 900px)').matches;

  const h = new Date().getHours();
  $('lg-saludo').textContent = h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  $('lg-ic-buscar').outerHTML = icSvg('search');
  $('lg-seguir-go').innerHTML = icSvg('arrowRight');
  document.querySelectorAll('.lg-eye').forEach(b => {
    b.innerHTML = icSvg('eye');
    b.addEventListener('click', () => {
      const ver = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(ver));
      b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
      b.innerHTML = icSvg(ver ? 'eyeOff' : 'eye');
      // La de "Nueva" muestra también la repetición, que no tiene ojito propio.
      const ids = b.dataset.for === 'new-pwd-1' ? ['new-pwd-1', 'new-pwd-2'] : [b.dataset.for];
      ids.forEach(id => { $(id).type = ver ? 'text' : 'password'; });
    });
  });

  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Sin el título ("Arq.", "Ing."), para ordenar y para las iniciales.
  const sinTitulo = n => String(n || '').split(/\s+/).filter(p => p && !p.endsWith('.')).join(' ') || String(n || '');
  function iniciales(nombre) {
    const pal = sinTitulo(nombre).split(/\s+/).filter(Boolean);
    if (!pal.length) return '?';
    return (pal.length > 1 ? pal[0][0] + pal[pal.length - 1][0] : pal[0].slice(0, 2)).toUpperCase();
  }
  function tono(codigo) {
    let n = 0;
    for (const c of String(codigo)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return 'lg-c' + (n % 7);
  }
  const avatar = (el, u) => { el.className = el.className.replace(/\blg-c\d\b/g, '').trim() + ' ' + tono(u.codigo); el.textContent = iniciales(u.nombre); };

  function showError(msg, reintentar) {
    errorEl.innerHTML = icSvg('alert') + '<span>' + esc(msg) + '</span>' + (reintentar ? '<button type="button">Reintentar</button>' : '');
    if (reintentar) errorEl.querySelector('button').addEventListener('click', reintentar);
    errorEl.classList.remove('hidden');
  }
  function hideError() { errorEl.classList.add('hidden'); }

  function cuando(ts) {
    if (!ts) return 'Fue quien entró la última vez acá';
    const d = new Date(ts), hoy = new Date();
    const dias = Math.round((new Date(hoy.toDateString()) - new Date(d.toDateString())) / 864e5);
    if (dias <= 0) return 'Entraste hoy en este dispositivo';
    if (dias === 1) return 'Entraste ayer en este dispositivo';
    if (dias < 7) return 'Entraste el ' + d.toLocaleDateString('es-AR', { weekday: 'long' }) + ' en este dispositivo';
    return 'Entraste el ' + d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) + ' en este dispositivo';
  }

  function saveSession(codigo, nombre) {
    localStorage.setItem('vimeco_session', JSON.stringify({ codigo, nombre }));
    localStorage.setItem('responsable_code', codigo);
    localStorage.setItem('responsable_name', nombre);
    try { localStorage.setItem(LS_ULTIMO, JSON.stringify({ codigo, ts: Date.now() })); } catch (_) {}
    sessionStorage.setItem('responsable_code', codigo);
    sessionStorage.setItem('responsable_name', nombre);
    window.location.href = destinoTrasLogin();
  }

  async function hashPassword(pwd) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- Paso 1: quién sos ----
  // La lista ya trae si cada uno tiene contraseña: elegir no hace otro pedido.
  let usuarios = [];
  async function cargar() {
    hideError();
    cargandoEl.textContent = 'Cargando…';
    cargandoEl.classList.remove('hidden');
    pasoQuien.classList.add('hidden');
    try {
      usuarios = (await getAllUsuarios())
        .filter(u => u.activo)
        .sort((a, b) => sinTitulo(a.nombre).localeCompare(sinTitulo(b.nombre), 'es'));
    } catch (_) {
      cargandoEl.classList.add('hidden');
      form.after(errorEl);
      showError('No se pudo cargar la lista de personas. Revisá la conexión.', () => {
        btnLogin.before(errorEl);
        cargar();
      });
      return;
    }
    cargandoEl.classList.add('hidden');
    if (!usuarios.length) {
      cargandoEl.textContent = 'No hay usuarios configurados. Avisale a quien administra.';
      cargandoEl.classList.remove('hidden');
      return;
    }
    pintarSeguir();
    pintarLista();
    pasoQuien.classList.remove('hidden');
    if (esEscritorio()) buscar.focus();
  }

  function pintarSeguir() {
    const btn = $('lg-seguir');
    let ult = null;
    try { ult = JSON.parse(localStorage.getItem(LS_ULTIMO)); } catch (_) {}
    const u = ult && usuarios.find(x => x.codigo === ult.codigo);
    btn.classList.toggle('hidden', !u);
    if (!u) return;
    avatar($('lg-seguir-av'), u);
    $('lg-seguir-nombre').textContent = 'Seguir como ' + sinTitulo(u.nombre).split(' ')[0];
    $('lg-seguir-cuando').textContent = cuando(ult.ts);
    btn.onclick = () => elegir(u);
  }

  function resaltar(nombre, q) {
    if (!q) return esc(nombre);
    const n = norm(nombre), i = n.indexOf(q);
    if (i < 0) return esc(nombre);
    return esc(nombre.slice(0, i)) + '<mark>' + esc(nombre.slice(i, i + q.length)) + '</mark>' + esc(nombre.slice(i + q.length));
  }

  let visibles = [];
  function pintarLista() {
    const q = norm(buscar.value.trim());
    visibles = q ? usuarios.filter(u => norm(u.nombre).includes(q)) : usuarios;
    if (!visibles.length) {
      listEl.innerHTML = '<div class="lg-vacio">No hay nadie con ese nombre.</div>';
      return;
    }
    listEl.innerHTML = visibles.map((u, i) =>
      `<button type="button" class="lg-it" role="option" data-i="${i}"><span class="lg-av ${tono(u.codigo)}">${esc(iniciales(u.nombre))}</span>${resaltar(u.nombre, q)}</button>`
    ).join('');
  }
  buscar.addEventListener('input', pintarLista);
  buscar.addEventListener('keydown', e => {
    if (e.key === 'Enter' && visibles.length === 1) { e.preventDefault(); elegir(visibles[0]); }
    if (e.key === 'ArrowDown') { e.preventDefault(); listEl.querySelector('.lg-it')?.focus(); }
  });
  listEl.addEventListener('click', e => {
    const b = e.target.closest('.lg-it');
    if (b) elegir(visibles[+b.dataset.i]);
  });
  listEl.addEventListener('keydown', e => {
    const b = e.target.closest('.lg-it');
    if (!b) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); (b.nextElementSibling || b).focus(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); (b.previousElementSibling || buscar).focus(); }
  });

  // ---- Paso 2: contraseña ----
  let currentUser = null;
  let isFirstTime = false;

  function modoContrasena() {
    isFirstTime = !currentUser.passwordHash;
    $('lg-sel-estado').textContent = isFirstTime ? 'Primera vez: creá tu contraseña' : 'Poné tu contraseña';
    pwdSection.classList.toggle('hidden', isFirstTime);
    newPwdSection.classList.toggle('hidden', !isFirstTime);
    olvideBtn.classList.toggle('hidden', isFirstTime);
    olvideBox.classList.add('hidden');
    btnLogin.innerHTML = isFirstTime ? 'Crear contraseña e ingresar' : 'Ingresar ' + icSvg('arrowRight');
    pintarHint();
    setTimeout(() => (isFirstTime ? newPwd1 : pwdInput).focus(), 50);
  }

  function elegir(u) {
    currentUser = u;
    hideError();
    pwdInput.value = newPwd1.value = newPwd2.value = '';
    avatar($('lg-sel-av'), u);
    $('lg-sel-nombre').textContent = u.nombre;
    // Para que el navegador guarde y complete la contraseña de cada persona.
    $('lg-username').value = u.codigo;
    pasoQuien.classList.add('hidden');
    form.classList.remove('hidden');
    btnLogin.disabled = false;
    modoContrasena();
    pintarOlvide();
  }

  $('lg-cambiar').addEventListener('click', () => {
    currentUser = null;
    hideError();
    form.classList.add('hidden');
    pasoQuien.classList.remove('hidden');
    pintarSeguir();
    if (esEscritorio()) buscar.focus();
  });

  function pintarHint() {
    if (!isFirstTime) return;
    const p1 = newPwd1.value, p2 = newPwd2.value;
    let ok = false, txt = 'Mínimo 4 caracteres.';
    if (p1 && p1.length < 4) txt = 'Falta: al menos 4 caracteres.';
    else if (p1 && !p2) txt = 'Ahora repetila abajo.';
    else if (p1 && p2 && p1 !== p2) txt = 'Todavía no coinciden.';
    else if (p1 && p1 === p2) { ok = true; txt = 'Coinciden y tienen al menos 4 caracteres.'; }
    hintEl.className = 'lg-hint' + (ok ? ' lg-hint--ok' : '');
    hintEl.innerHTML = icSvg(ok ? 'check' : 'info') + '<span>' + txt + '</span>';
  }
  newPwd1.addEventListener('input', pintarHint);
  newPwd2.addEventListener('input', pintarHint);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    hideError();
    if (!currentUser) return;
    const etiqueta = btnLogin.innerHTML;
    const volver = () => { btnLogin.disabled = false; btnLogin.innerHTML = etiqueta; };

    if (isFirstTime) {
      const p1 = newPwd1.value, p2 = newPwd2.value;
      if (p1.length < 4) { showError('La contraseña debe tener al menos 4 caracteres.'); newPwd1.focus(); return; }
      if (p1 !== p2)     { showError('Las contraseñas no coinciden.'); newPwd2.focus(); return; }
      btnLogin.disabled = true;
      btnLogin.textContent = 'Guardando…';
      try {
        const hash = await hashPassword(p1);
        await patchUsuario(currentUser.codigo, { passwordHash: hash, resetPedido: null });
        saveSession(currentUser.codigo, currentUser.nombre);
      } catch (_) {
        showError('No se pudo guardar la contraseña. Revisá la conexión y probá de nuevo.');
        volver();
      }
      return;
    }

    const pwd = pwdInput.value;
    if (!pwd) { showError('Poné tu contraseña.'); pwdInput.focus(); return; }
    btnLogin.disabled = true;
    btnLogin.textContent = 'Verificando…';
    // Se relee la persona: si quien administra le reseteó la contraseña
    // mientras la pantalla estaba abierta, pasa a crear una nueva.
    let fresco = null;
    try { fresco = await getUsuario(currentUser.codigo); } catch (_) {}
    if (fresco) {
      if (!fresco.activo) { showError('Este usuario está desactivado. Avisale a quien administra.'); volver(); return; }
      currentUser = { codigo: currentUser.codigo, ...fresco };
      if (!currentUser.passwordHash) {
        btnLogin.disabled = false;
        modoContrasena();
        pintarOlvide();
        showError('Tu contraseña fue reseteada: creá una nueva.');
        return;
      }
    }
    const hash = await hashPassword(pwd);
    if (hash !== currentUser.passwordHash) {
      showError('Contraseña incorrecta. Probá de nuevo.');
      volver();
      pwdInput.value = '';
      pwdInput.focus();
      return;
    }
    saveSession(currentUser.codigo, currentUser.nombre);
  });

  // ---- Olvidé la contraseña: avisar a quien administra (Usuarios es del 0000) ----
  const ADMIN = '0000';
  function pintarOlvide() {
    const ped = currentUser && currentUser.resetPedido;
    $('lg-olvide-txt').textContent = ped
      ? 'Ya le avisaste a quien administra el ' + new Date(ped).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) +
        ' a las ' + new Date(ped).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) +
        '. Cuando la resetee, al entrar vas a crear una nueva.'
      : 'La resetea quien administra, desde Usuarios. Después, al entrar, vas a crear una nueva.';
    const b = $('lg-avisar');
    b.disabled = false;
    b.textContent = ped ? 'Avisarle de nuevo' : 'Avisarle que la resetee';
  }
  olvideBtn.addEventListener('click', () => {
    olvideBox.classList.toggle('hidden');
  });
  $('lg-avisar').addEventListener('click', async () => {
    const b = $('lg-avisar');
    b.disabled = true;
    b.textContent = 'Avisando…';
    const ts = Date.now();
    try {
      await patchUsuario(currentUser.codigo, { resetPedido: ts });
    } catch (_) {
      b.disabled = false;
      b.textContent = 'Avisarle que la resetee';
      $('lg-olvide-txt').textContent = 'No se pudo avisar. Revisá la conexión y probá de nuevo.';
      return;
    }
    currentUser.resetPedido = ts;
    if (typeof notificarUsuario === 'function' && currentUser.codigo !== ADMIN) {
      notificarUsuario(ADMIN, {
        title: 'Pedido de contraseña',
        body:  `${currentUser.nombre} no recuerda su contraseña. Reseteala desde Usuarios.`,
        url:   'usuarios.html?u=' + currentUser.codigo,
        tag:   'reset-' + currentUser.codigo
      });
    }
    pintarOlvide();
    b.disabled = true;
    b.textContent = 'Listo, le avisamos';
  });

  cargar();
});

// Si se llegó al login desde un archivo compartido (app.html sin sesión), se
// vuelve a la pantalla de OC para mostrar el cartel en vez de perderlo.
function destinoTrasLogin() {
  if (sessionStorage.getItem('vimeco_share_pendiente')) {
    sessionStorage.removeItem('vimeco_share_pendiente');
    return 'app.html?compartido=1';
  }
  return 'menu.html';
}
