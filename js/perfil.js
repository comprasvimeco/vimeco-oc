/* global getUsuario, patchUsuario, getFirma, saveFirma, nombreOCGuardado, recordarNombreOC, tienePersonal,
   initPush, activarPush, showConfirm, toast, escHtml, icSvg, _hdrInitials, FIREBASE_CONFIG */
/* Perfil (perfil.html): se llega tocando la pastilla del nombre en el header (js/ui.js).
   Traído de Leva, sin la cuenta de Google ni el mail.
   - Tu firma: /firmas/{código}, el mismo lienzo que antes estaba en el menú ☰ de la OC.
   - Tu nombre en las OC: /usuarios/{código}/nombreOC. Va debajo de la firma en el
     PDF; las listas siguen con `nombre`.
   - Qué podés hacer: sólo para ver; lo carga el 0000 en Usuarios.
   - Notificaciones (js/push.js) y Cerrar sesión. */

const $ = id => document.getElementById(id);
const sesion = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')) || {}; } catch (_) { return {}; } })();
const code = sesion.codigo;
let usuario = {};
let firma = null;        // base64 de la firma guardada
let nombreOC = '';       // el guardado en la base

if (!code) location.href = 'index.html';

const fmtMonto = n => Math.round(n).toLocaleString('es-AR');
const nombreLista = () => usuario.nombre || sesion.nombre || '';

// ---- Cabecera ----
function pintarCabecera() {
  const nombre = nombreLista();
  $('hdr-name').textContent = nombre;
  $('pf-nombre').textContent = nombre;
  $('pf-av').textContent = _hdrInitials(nombre);
  $('pf-cod').textContent = 'Usuario ' + code;

  const chips = [];
  if (code === '0000') chips.push(['adm', 'Administrador']);
  else if (usuario.admin) chips.push(['adm', 'Admin']);
  if (usuario.autorizaDesde > 0) chips.push(['aut', 'Autoriza']);
  $('pf-chips').innerHTML = chips.map(([t, x]) => `<span class="pf-chip pf-chip--${t}">${escHtml(x)}</span>`).join('');
}

// ---- Tu nombre en las OC ----
const BTN_GUARDAR = () => icSvg('checkSm') + 'Guardar';

function pintarNombreOC() {
  const v = $('pf-nombre-oc').value.trim();
  $('pf-nombre-guardar').classList.toggle('hidden', v === nombreOC);
  $('pf-nombre-hint').innerHTML = v
    ? `En las listas de la app seguís apareciendo como <b>${escHtml(nombreLista())}</b>.`
    : `Vacío, sale <b>${escHtml(nombreLista())}</b>, como en las listas de la app.`;
  // Como el PDF: con firma va sólo el nombre; sin firma, «Autorizado por: …».
  $('pf-pie-nombre').textContent = (firma ? '' : 'Autorizado por: ') + (v || nombreLista());
}

async function guardarNombreOC() {
  const btn = $('pf-nombre-guardar');
  const v = $('pf-nombre-oc').value.trim().replace(/\s+/g, ' ');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando…';
  try {
    await patchUsuario(code, { nombreOC: v || null });
    nombreOC = v;
    recordarNombreOC(code, v);
    $('pf-nombre-oc').value = v;
    toast(v ? 'Listo: tus OC salen con ese nombre.' : 'Listo: tus OC salen con tu nombre de siempre.', 'success');
  } catch (_) {
    toast('No se pudo guardar el nombre. Revisá tu conexión.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = BTN_GUARDAR();
    pintarNombreOC();
  }
}

// ---- Tu firma ----
function pintarFirma() {
  const img = src => `<img src="${src}" alt="Tu firma">`;
  $('pf-firma').innerHTML = firma ? img(firma)
    : '<span class="pf-firma-vacia">Todavía no dibujaste tu firma. Sin ella, tus OC salen sin firma o hay que pedírsela a otro.</span>';
  $('pf-pie-firma').innerHTML = firma ? img(firma) : '';
  $('pf-firma-dibujar').innerHTML = icSvg('edit') + (firma ? 'Dibujar de nuevo' : 'Dibujar mi firma');
  pintarNombreOC();
}

let _dibujando = false, _lx = 0, _ly = 0;
function abrirFirma() {
  const canvas = $('firma-canvas');
  const ctx = canvas.getContext('2d');
  if (!canvas._ready) {
    canvas.width = 560;
    canvas.height = 200;
    canvas._ready = true;
    const pos = e => {
      const r = canvas.getBoundingClientRect();
      const s = e.touches ? e.touches[0] : e;
      return { x: (s.clientX - r.left) * canvas.width / r.width, y: (s.clientY - r.top) * canvas.height / r.height };
    };
    const empezar = e => { _dibujando = true; const p = pos(e); _lx = p.x; _ly = p.y; };
    const trazo = e => {
      if (!_dibujando) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(_lx, _ly); ctx.lineTo(p.x, p.y); ctx.stroke();
      _lx = p.x; _ly = p.y;
    };
    const parar = () => { _dibujando = false; };
    canvas.addEventListener('mousedown', empezar);
    canvas.addEventListener('mousemove', trazo);
    canvas.addEventListener('mouseup', parar);
    canvas.addEventListener('mouseleave', parar);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); empezar(e); }, { passive: false });
    canvas.addEventListener('touchmove', e => { e.preventDefault(); trazo(e); }, { passive: false });
    canvas.addEventListener('touchend', parar);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#1a3a5c';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (firma) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = firma;
  }
  $('modal-firma').classList.remove('hidden');
}
const cerrarFirma = () => $('modal-firma').classList.add('hidden');

const BTN_GUARDAR_FIRMA = () => icSvg('checkSm') + 'Guardar firma';
function setupFirma() {
  $('btn-firma-guardar').innerHTML = BTN_GUARDAR_FIRMA();
  $('pf-firma-dibujar').addEventListener('click', abrirFirma);
  $('modal-firma-close').addEventListener('click', cerrarFirma);
  $('modal-firma').addEventListener('click', e => { if (e.target === e.currentTarget) cerrarFirma(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('modal-firma').classList.contains('hidden')) cerrarFirma();
  });
  $('btn-firma-limpiar').addEventListener('click', () => {
    const canvas = $('firma-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  $('btn-firma-guardar').addEventListener('click', async () => {
    const btn = $('btn-firma-guardar');
    const base64 = $('firma-canvas').toDataURL('image/png');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await saveFirma(code, base64);
      firma = base64;
      cerrarFirma();
      pintarFirma();
      toast('Firma guardada.', 'success');
    } catch (_) {
      toast('Error al guardar la firma.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = BTN_GUARDAR_FIRMA();
    }
  });
}

// ---- Qué podés hacer ----
const fila = (tono, ic, titulo, sub) =>
  `<div class="pf-fila"><span class="pf-ic pf-ic--${tono}">${icSvg(ic)}</span><span>${escHtml(titulo)}${sub ? `<small>${escHtml(sub)}</small>` : ''}</span></div>`;

async function pintarPermisos() {
  const u = usuario;
  const out = [];
  if (code === '0000') {
    $('pf-permisos-sub').textContent = 'Sos el administrador';
    out.push(fila('aut', 'settings', 'Todo', 'Ves y cambiás todo, incluida Administración: usuarios, obras y equipos.'));
    $('pf-permisos').innerHTML = out.join('');
    return;
  }
  if (u.autorizaDesde > 0) out.push(fila('aut', 'userCheck', `Autorizás OC de más de $ ${fmtMonto(u.autorizaDesde)}`, 'Te las pueden pedir para que las firmes'));
  if (u.admin) out.push(fila('sec', 'settings', 'Admin', 'Funciones de admin (incluida la Caja de todos), salvo el menú de Administración'));
  if (u.caja || u.admin) out.push(fila('sec', 'calc', 'Caja', 'Ingresos y egresos de tu caja chica'));
  if (u.reportes || u.admin) out.push(fila('sec', 'trend', 'Reportes', 'Gasto por obra, equipo y proveedor'));
  if (u.novedades != null ? u.novedades : u.admin) out.push(fila('sec', 'info', 'Novedades', 'OC, remitos y facturas que se cargan'));
  if (u.jefeTaller) out.push(fila('sec', 'tool', 'Jefe de Taller', 'Equipos: datos, foto y repuestos'));
  if (u.archivo) out.push(fila('sec', 'folder', 'Archivo', 'Todos los archivos de Compras'));
  if (u.jefeObra) {
    let obras = [];
    try {
      const r = await fetch(FIREBASE_CONFIG.databaseURL + '/obras.json');
      const data = r.ok ? await r.json() : null;
      obras = Object.values(data || {}).filter(o => o && o.nombre && o.jefes && o.jefes[code]).map(o => o.nombre);
    } catch (_) {}
    const n = obras.length;
    out.push(fila('sec', 'building', n ? `Jefe de Obra en ${n} ${n === 1 ? 'obra' : 'obras'}` : 'Jefe de Obra',
      n ? obras.join(' · ') : 'Todavía no tenés obras asignadas'));
    if (tienePersonal(u)) out.push(fila('sec', 'users', 'Personal', 'Cuadrilla y partes de tus obras'));
  }
  if (!out.length) out.push(fila('sec', 'edit', 'Hacer OC y cargar facturas y remitos', 'Ves las que hiciste vos'));
  $('pf-permisos').innerHTML = out.join('');
}

// ---- Notificaciones ----
async function pintarPush() {
  const estado = await initPush(code);
  const btn = $('pf-push-btn');
  const txt = {
    'activas':      'Activadas en este dispositivo. Te avisamos cuando te pidan firmar una OC y cuando te respondan un pedido.',
    'pedir':        'Te avisamos cuando te pidan firmar una OC y cuando te respondan un pedido.',
    'bloqueadas':   'Bloqueadas en este navegador. Habilitalas desde los permisos del sitio y volvé a entrar.',
    'ios-instalar': 'En iPhone, primero agregá la app a la pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ese ícono.',
    'no-soportado': 'Este navegador no permite notificaciones.'
  }[estado];
  if (!txt) return;   // sin configurar: no se muestra
  $('pf-push-txt').textContent = txt;
  btn.classList.toggle('hidden', estado !== 'pedir');
  $('pf-push-card').classList.remove('hidden');
}

function setupPush() {
  const btn = $('pf-push-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Activando…';
    let ok = false;
    try { ok = await activarPush(code); } catch (e) { console.warn('push:', e); }
    btn.disabled = false;
    btn.textContent = 'Activar';
    if (ok) toast('Notificaciones activadas.', 'success');
    else if (Notification.permission !== 'denied') toast('No se pudieron activar. Probá de nuevo.', 'error');
    pintarPush();
  });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  if (!code) return;
  $('btn-back').addEventListener('click', () => {
    if (history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) history.back();
    else location.href = 'menu.html';
  });
  $('pf-salir').addEventListener('click', async () => {
    const ok = await showConfirm('Cerrar sesión', 'Para volver a entrar vas a tener que elegir tu usuario y poner la contraseña.',
      { boton: 'Cerrar sesión', tono: 'del', icono: 'logout' });
    if (!ok) return;
    cerrarSesionVimeco();
  });

  // Lo que ya se sabe se muestra enseguida; la base lo completa.
  nombreOC = nombreOCGuardado(code);
  $('pf-nombre-oc').value = nombreOC;
  $('pf-nombre-guardar').innerHTML = BTN_GUARDAR();
  $('pf-nombre-oc').addEventListener('input', pintarNombreOC);
  $('pf-nombre-oc').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !$('pf-nombre-guardar').classList.contains('hidden')) guardarNombreOC();
  });
  $('pf-nombre-guardar').addEventListener('click', guardarNombreOC);
  pintarCabecera();
  pintarNombreOC();
  setupFirma();
  setupPush();

  getFirma(code).then(f => { firma = f || null; pintarFirma(); })
    .catch(() => { $('pf-firma').innerHTML = '<span class="pf-firma-vacia">No se pudo cargar tu firma. Revisá tu conexión.</span>'; });

  try {
    usuario = (await getUsuario(code)) || {};
    // Si el campo no se tocó mientras cargaba, se pone lo que dice la base.
    const enBase = String(usuario.nombreOC || '').trim();
    if ($('pf-nombre-oc').value.trim() === nombreOC) $('pf-nombre-oc').value = enBase;
    nombreOC = enBase;
    recordarNombreOC(code, enBase);
  } catch (_) {}
  pintarCabecera();
  pintarNombreOC();
  pintarPermisos();
  pintarPush();
});
