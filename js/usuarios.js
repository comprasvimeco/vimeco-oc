/* VIMECO S.A. — Gestión de Usuarios (solo 0000)
   Lista con buscador y filtros a la izquierda y la ficha de la persona a la
   derecha (en el teléfono, una a la vez, con ?u=código en la URL). La ficha
   junta nombre, permisos, obras a cargo, monto de autorización y cuenta; se
   guarda todo junto con la barra de abajo, que aparece sólo si hay cambios. */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SUPER = '0000';
const MQ_ANCHA = window.matchMedia('(min-width: 1000px)');

// Permisos: campo → tono (el del módulo en el menú), ícono, nombre y descripción.
const PERMS = {
  jefeObra:   { t: 'obr', ic: 'building', n: 'Jefe de Obra',   d: 'Ve todas las OC y remitos de sus obras, aunque las haya emitido otro; les carga remitos y facturas, las usa como base y anula las duplicadas.' },
  personal:   { t: 'per', ic: 'users',    n: 'Personal',       d: 'Cuadrilla y partes de sus obras. Requiere Jefe de Obra.' },
  caja:       { t: 'caj', ic: 'calc',     n: 'Caja',           d: 'Ingresos y egresos de su propia caja chica.' },
  reportes:   { t: 'rep', ic: 'trend',    n: 'Reportes',       d: 'Gasto por obra, equipo y proveedor.' },
  novedades:  { t: 'nov', ic: 'info',     n: 'Novedades',      d: 'Feed de OC, remitos y facturas que se cargan.' },
  jefeTaller: { t: 'tal', ic: 'tool',     n: 'Jefe de Taller', d: 'Equipos: datos, foto y repuestos de cada equipo.' },
  admin:      { t: 'adm', ic: 'settings', n: 'Admin',          d: 'Funciones de admin (incluida la Caja de todos), salvo el menú de Administración.' }
};
const ORDEN_PILLS = ['admin', 'caja', 'jefeObra', 'personal', 'jefeTaller', 'reportes', 'novedades'];
const CAMPOS = ['caja', 'admin', 'jefeObra', 'personal', 'jefeTaller', 'reportes', 'novedades'];

let allUsuarios = [];
let allObras    = [];      // todas, con su `jefes`
let filtro      = 'todos';
let selCodigo   = null;
let orig        = null;    // estado guardado de la ficha abierta
let draft       = null;    // lo que se está editando
let editNombre  = false;

// ---- Helpers ----
// Novedades era parte de `admin`: quien nunca tuvo el permiso propio lo
// conserva mientras sea admin, hasta que se lo toque desde acá.
function tieneNovedades(u) {
  return u.novedades != null ? !!u.novedades : !!u.admin;
}
function permValor(u, k) {
  if (k === 'personal')  return tienePersonal(u);
  if (k === 'novedades') return tieneNovedades(u);
  return !!u[k];
}
function fmtMonto(n) {
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
// "2.000.000" / "2000000" / "$ 2.000.000,00" → 2000000. Vacío o 0 → null.
function parseMonto(str) {
  const n = parseInt(String(str || '').replace(/,\d*$/, '').replace(/\D/g, ''), 10);
  return n > 0 ? n : null;
}
// Iniciales para el avatar, sin el título ("Arq.", "Ing."): "Arq. Gustavo Pes" → "GP".
function iniciales(nombre) {
  const pal = String(nombre || '').split(/\s+/).filter(p => p && !p.endsWith('.'));
  if (!pal.length) return '?';
  const ini = pal.length > 1 ? pal[0][0] + pal[pal.length - 1][0] : pal[0].slice(0, 2);
  return ini.toUpperCase();
}
// "Ing. Daniel Ortiz" → "D. Ortiz"; si otra persona activa queda igual
// (Matías y Marcelo Pes → "M. Pes"), el nombre entero sin el título.
function nombreCorto(nombre) {
  const corto = n => {
    const pal = String(n || '').split(/\s+/).filter(p => p && !p.endsWith('.'));
    return pal.length > 1 ? pal[0][0] + '. ' + pal.slice(1).join(' ') : (pal[0] || '');
  };
  const c = corto(nombre);
  const repetido = allUsuarios.some(u => u.activo && u.nombre !== nombre && corto(u.nombre) === c);
  return repetido ? String(nombre || '').split(/\s+/).filter(p => p && !p.endsWith('.')).join(' ') : c;
}
function listaNombres(ns) {
  return ns.length > 1 ? ns.slice(0, -1).join(', ') + ' y ' + ns[ns.length - 1] : (ns[0] || '');
}
const cantAvisos   = u => Object.keys(u.pushTokens || {}).length;
const obrasDe      = codigo => allObras.filter(o => o.jefes && o.jefes[codigo]);
const sinObras     = u => u.codigo !== SUPER && u.jefeObra && !obrasDe(u.codigo).some(o => o.activa);
const pidioReset   = u => !!(u.passwordHash && u.resetPedido);
function fechaCorta(ts) {
  if (!ts) return '';
  const d = new Date(ts), hoy = new Date();
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const dia0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia0(hoy) - dia0(d)) / 864e5);
  if (dias === 0) return 'hoy ' + hora;
  if (dias === 1) return 'ayer ' + hora;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: d.getFullYear() === hoy.getFullYear() ? undefined : 'numeric' });
}

// ---- Lista ----
function pillsHtml(u) {
  const pm = (t, icon, txt) => `<span class="us-pm t-${t}">${icSvg(icon)}${txt}</span>`;
  if (u.codigo === SUPER) return pm('adm', 'settings', 'Admin (super)') + pm('caj', 'calc', 'Caja (todas)');
  const out = ORDEN_PILLS.filter(k => permValor(u, k)).map(k => pm(PERMS[k].t, PERMS[k].ic, PERMS[k].n));
  if (u.autorizaDesde > 0) out.push(pm('aut', 'userCheck', 'Autoriza &gt; $ ' + fmtMonto(u.autorizaDesde)));
  return out.join('');
}
function dotsHtml(u) {
  const dot = (t, icon, tit) => `<span class="us-dot t-${t}" title="${tit}">${icSvg(icon)}</span>`;
  if (u.codigo === SUPER) return dot('adm', 'settings', 'Admin (super)') + dot('caj', 'calc', 'Caja (todas)');
  const out = ORDEN_PILLS.filter(k => permValor(u, k)).map(k => dot(PERMS[k].t, PERMS[k].ic, PERMS[k].n));
  if (u.autorizaDesde > 0) out.push(dot('aut', 'userCheck', 'Autoriza'));
  return out.join('');
}
function marcasHtml(u) {
  const out = [];
  if (pidioReset(u))     out.push(`<span class="us-pm t-red">${icSvg('key')}Pidió resetear</span>`);
  if (!u.passwordHash)   out.push(`<span class="us-pm t-warn">${icSvg('alert')}Sin contraseña</span>`);
  if (u.activo && sinObras(u)) out.push(`<span class="us-pm t-warn">${icSvg('alert')}Sin obras</span>`);
  return out.join('');
}
function filaHtml(u) {
  const pills = pillsHtml(u), marcas = marcasHtml(u);
  const l2 = pills || marcas
    ? `<span class="us-pills">${pills}</span><span class="us-dots">${dotsHtml(u)}</span>${marcas}`
    : '<span class="none">Sin permisos adicionales</span>';
  return `<button type="button" class="us-row${u.activo ? '' : ' off'}${u.codigo === selCodigo ? ' sel' : ''}" data-cod="${esc(u.codigo)}">
    <span class="us-av${u.activo ? '' : ' off'}" aria-hidden="true">${esc(iniciales(u.nombre))}</span>
    <span class="mid"><span class="l1"><span class="nm">${esc(u.nombre)}</span><span class="us-cod">${esc(u.codigo)}</span></span>
    <span class="l2">${l2}</span></span>
    <span class="chev">${icSvg('chevR')}</span></button>`;
}

const FILTROS = [
  ['todos',    'Todos',          () => true],
  ['jefes',    'Jefes de obra',  u => u.activo && u.jefeObra],
  ['autorizan','Autorizan',      u => u.activo && u.autorizaDesde > 0],
  ['reset',    'Pidió resetear', u => pidioReset(u), 'red'],
  ['sinpwd',   'Sin contraseña', u => u.activo && !u.passwordHash],
  ['inactivos','Inactivos',      u => !u.activo]
];

function renderFiltros() {
  const cont = $('us-flt');
  cont.innerHTML = FILTROS.map(([k, txt, fn, cls]) => {
    const n = allUsuarios.filter(fn).length;
    // Los de "algo para atender" se muestran sólo si hay alguno (o si están elegidos).
    if (!n && k !== 'todos' && k !== 'jefes' && k !== 'autorizan' && filtro !== k) return '';
    return `<button type="button" class="${filtro === k ? 'on' : ''}${cls ? ' ' + cls : ''}" data-f="${k}" aria-pressed="${filtro === k}">${txt} <b>${n}</b></button>`;
  }).join('');
}

function renderLista() {
  const q = $('us-q').value.trim().toLowerCase();
  const fn = (FILTROS.find(f => f[0] === filtro) || FILTROS[0])[2];
  const ok = u => fn(u) && (!q || u.nombre.toLowerCase().includes(q) || u.codigo.includes(q));
  const act = allUsuarios.filter(u => u.activo && ok(u));
  const ina = allUsuarios.filter(u => !u.activo && ok(u));
  let html = '';
  if (act.length) html += `<div class="us-rows">${act.map(filaHtml).join('')}</div>`;
  if (ina.length) html += (act.length ? `<div class="us-grp">Inactivos <span class="n">${ina.length}</span></div>` : '') +
    `<div class="us-rows">${ina.map(filaHtml).join('')}</div>`;
  $('users-list').innerHTML = html || `<div class="us-rows"><div class="us-empty">${q ? 'Nadie coincide con lo buscado.' : 'No hay usuarios en este filtro.'}</div></div>`;
}

function renderCabecera() {
  const activos = allUsuarios.filter(u => u.activo).length;
  $('users-count').textContent = `${activos} activo${activos !== 1 ? 's' : ''}`;
  const n = allUsuarios.filter(pidioReset).length;
  const p = $('us-pend');
  p.classList.toggle('hidden', !n);
  p.textContent = n === 1 ? '1 pidió resetear' : `${n} pidieron resetear`;
}

// Escalones de autorización, con la misma regla que la OC (reglaDeMonto en app.js):
// una OC cae en el monto más alto que supera y la firma quien tenga ese monto o uno mayor.
function renderEscalera() {
  const firmantes = allUsuarios.filter(u => u.activo && u.autorizaDesde > 0);
  const cont = $('us-esc');
  if (!firmantes.length) { cont.innerHTML = ''; return; }
  const montos = [...new Set(firmantes.map(u => u.autorizaDesde))].sort((a, b) => a - b);
  const sinAviso = firmantes.filter(u => !cantAvisos(u));
  const persona = u => cantAvisos(u)
    ? `<span>${esc(nombreCorto(u.nombre))}</span>`
    : `<span class="warn" title="No tiene los avisos activados">${icSvg('alert')}${esc(nombreCorto(u.nombre))}</span>`;
  const step = (m, w) => `<div class="us-step"><span class="m">${m}</span><div class="w">${w}</div></div>`;
  cont.innerHTML = `<div class="us-card us-esc"><div class="h"><span class="us-sq t-aut">${icSvg('userCheck')}</span><b>Quién autoriza las OC</b></div>
    ${step('Hasta $ ' + fmtMonto(montos[0]), '<i>No hace falta autorización</i>')}
    ${montos.map(m => step('Más de $ ' + fmtMonto(m),
      firmantes.filter(u => u.autorizaDesde >= m).sort((a, b) => a.autorizaDesde - b.autorizaDesde || a.codigo.localeCompare(b.codigo)).map(persona).join(''))).join('')}
    ${sinAviso.length ? `<div class="us-aviso">${icSvg('alert')}<span>${esc(listaNombres(sinAviso.map(u => nombreCorto(u.nombre))))} no ${sinAviso.length > 1 ? 'tienen' : 'tiene'} los avisos activados en ningún teléfono: no se ${sinAviso.length > 1 ? 'enteran' : 'entera'} de los pedidos hasta que ${sinAviso.length > 1 ? 'entran' : 'entra'} a la app.</span></div>` : ''}
  </div>`;
}

function renderTodo() {
  renderCabecera();
  renderFiltros();
  renderLista();
  renderEscalera();
}

// ---- Ficha ----
function estadoDe(u) {
  const s = { nombre: u.nombre, autorizaDesde: u.autorizaDesde > 0 ? u.autorizaDesde : null, obras: obrasDe(u.codigo).map(o => o.key).sort() };
  CAMPOS.forEach(k => { s[k] = permValor(u, k); });
  return s;
}
function cambios() {
  if (!orig || !draft) return [];
  const out = [];
  if (draft.nombre.trim() !== orig.nombre) out.push('nombre');
  CAMPOS.forEach(k => { if (draft[k] !== orig[k]) out.push(k); });
  if ((draft.autorizaDesde || null) !== (orig.autorizaDesde || null)) out.push('autorizaDesde');
  const a = new Set(orig.obras), b = new Set(draft.obras);
  if (a.size !== b.size || [...a].some(k => !b.has(k))) out.push('obras');
  return out;
}
const hayCambios = () => cambios().length > 0;

function pintarBarra() {
  const n = cambios().length;
  $('us-savebar').classList.toggle('hidden', !n);
  $('us-save-txt').textContent = n === 1 ? '1 cambio sin guardar' : `${n} cambios sin guardar`;
}

function swHtml(k, on, dis) {
  return `<span class="us-sw" style="--c:var(--${PERMS[k].t}-sw)"><input type="checkbox" data-perm="${k}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${PERMS[k].n}"><span></span></span>`;
}
function prowHtml(k, extra = '') {
  const p = PERMS[k];
  const dis = k === 'personal' && !draft.jefeObra;
  return `<label class="us-prow${extra}${dis ? ' dis' : ''}"><span class="us-dot t-${p.t}">${icSvg(p.ic)}</span>
    <span class="tx"><b>${k === 'admin' ? 'Administrador' : p.n}</b><small>${p.d}</small></span>${swHtml(k, draft[k] && !dis, dis)}</label>`;
}

function obrasHtml(u) {
  if (!draft.jefeObra) return '';
  const lista = draft.obras.map(k => allObras.find(o => o.key === k)).filter(Boolean)
    .sort((a, b) => (b.activa ? 1 : 0) - (a.activa ? 1 : 0) || a.nombre.localeCompare(b.nombre));
  const nuevas = new Set(draft.obras.filter(k => !orig.obras.includes(k)));
  const activas = lista.filter(o => o.activa).length;
  const chips = lista.map(o => `<span class="us-ob${o.activa ? '' : ' inact'}${nuevas.has(o.key) ? ' nuevo' : ''}" title="${o.activa ? '' : 'Obra inactiva'}">${icSvg('building')}${esc(o.nombre)}<button type="button" class="q" data-quitar-obra="${esc(o.key)}" aria-label="Quitar ${esc(o.nombre)}">${icSvg('x')}</button></span>`).join('');
  return `<div class="us-obras">${chips}<button type="button" class="us-ob-add${activas ? '' : ' hot'}" id="us-ob-add">${icSvg('plus')}${lista.length ? 'Agregar obra' : 'Elegir obras'}</button></div>
    ${activas ? '' : `<div class="us-aviso">${icSvg('alert')}<span>Es Jefe de Obra pero no tiene ninguna obra activa asignada: no ve OC ni remitos de otros.</span></div>`}`;
}

function autorizaHtml(u) {
  const az = draft.autorizaDesde;
  const usados = [...new Set(allUsuarios.filter(x => x.activo && x.autorizaDesde > 0).map(x => x.autorizaDesde))].sort((a, b) => a - b);
  const chips = [`<button type="button" data-monto="" class="${az ? '' : 'on'}">Sin monto</button>`]
    .concat(usados.map(m => `<button type="button" data-monto="${m}" class="${az === m ? 'on' : ''}">$ ${fmtMonto(m)}</button>`))
    .concat([`<button type="button" data-monto="otro">Otro…</button>`]).join('');
  const hint = hintMonto(u, az);
  const aviso = az && !cantAvisos(u)
    ? `<div class="us-aviso">${icSvg('alert')}<span>No tiene los avisos activados en ningún teléfono. Los activa desde el menú de la app, con el botón Activar de los avisos.</span></div>` : '';
  return `<div class="us-card"><div class="us-sec-h"><span class="us-sq t-aut">${icSvg('userCheck')}</span><b>Autoriza OC</b></div>
    <label class="us-monto"><span>Más de $</span><input type="text" id="us-monto" inputmode="numeric" placeholder="Sin monto" value="${az ? fmtMonto(az) : ''}" aria-label="Autoriza OC desde"></label>
    <div class="us-chips" id="us-chips">${chips}</div>
    <div class="us-hint" id="us-monto-hint">${esc(hint)}</div>${aviso}</div>`;
}

function hintMonto(u, az) {
  if (!az) return 'Vacío: no autoriza. Las OC que superen su monto se le pueden pedir a esta persona o a quien tenga uno mayor; si varios comparten el monto, sirve cualquiera.';
  const junto = allUsuarios.filter(x => x.activo && x.codigo !== u.codigo && x.autorizaDesde >= az).map(x => nombreCorto(x.nombre));
  return `Firma las OC de más de $ ${fmtMonto(az)}` + (junto.length ? `, junto con ${listaNombres(junto)}.` : '. Es la única persona con ese monto o uno mayor.');
}

function cuentaHtml(u) {
  const av = cantAvisos(u);
  const filas = [];
  if (u.creadoEn) filas.push(['Alta', new Date(u.creadoEn).toLocaleDateString('es-AR')]);
  filas.push(['Último uso', u.ultimoUso ? fechaCorta(u.ultimoUso) : 'Sin datos todavía']);
  filas.push(['Contraseña', u.passwordHash ? (pidioReset(u) ? 'Pidió resetearla el ' + new Date(u.resetPedido).toLocaleDateString('es-AR') : 'Creada') : 'La crea al entrar']);
  filas.push(['Avisos', av ? `Activados en ${av} teléfono${av > 1 ? 's' : ''}` : 'Sin activar']);
  const esSuper = u.codigo === SUPER;
  return `<div class="us-card"><div class="us-sec-h"><span class="us-sq t-gr">${icSvg('user')}</span><b>Cuenta</b></div>
    <div class="us-kv">${filas.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div>
    <div class="us-acc">
      <button type="button" class="foc-btn ${pidioReset(u) ? 'foc-btn--warn' : 'foc-btn--clear'}" id="us-reset">${icSvg('key')}Resetear clave</button>
      ${esSuper ? '' : (u.activo
        ? `<button type="button" class="foc-btn foc-btn--del" id="us-toggle">${icSvg('power')}Desactivar</button>`
        : `<button type="button" class="foc-btn foc-btn--gen" id="us-toggle">${icSvg('power')}Activar</button>`)}
    </div></div>`;
}

function renderFicha() {
  const cont = $('us-ficha');
  const u = allUsuarios.find(x => x.codigo === selCodigo);
  if (!u) {
    cont.innerHTML = `<div class="us-card us-vacia">${icSvg('users')}<div>Elegí una persona de la lista para ver y cambiar sus permisos.</div></div>`;
    pintarBarra();
    return;
  }
  const esSuper = u.codigo === SUPER;
  const meta = [`<span class="us-cod">${esc(u.codigo)}</span>`];
  if (!u.activo) meta.push(`<span class="us-pm t-red">Inactivo</span>`);
  if (pidioReset(u)) meta.push(`<span class="us-pm t-red">${icSvg('key')}Pidió resetear</span>`);
  else meta.push(u.passwordHash ? `<span class="us-pm t-gr">${icSvg('key')}Con contraseña</span>` : `<span class="us-pm t-warn">${icSvg('alert')}Sin contraseña</span>`);
  if (u.ultimoUso) meta.push(`<span class="us-pm t-gr">${icSvg('clock')}Usó la app ${esc(fechaCorta(u.ultimoUso))}</span>`);

  const nombre = editNombre
    ? `<input type="text" class="us-nom-in" id="us-nom" value="${esc(draft.nombre)}" aria-label="Nombre completo">`
    : `<div class="nm"><span>${esc(draft.nombre)}</span><button type="button" class="us-pencil" id="us-nom-edit" aria-label="Cambiar el nombre" title="Cambiar el nombre">${icSvg('edit')}</button></div>`;
  const head = `<div class="us-card"><div class="us-fhead"><span class="us-av lg${u.activo ? '' : ' off'}" aria-hidden="true">${esc(iniciales(draft.nombre))}</span>
    <div class="id">${nombre}<div class="meta">${meta.join('')}</div></div></div></div>`;

  let izq, der;
  if (esSuper) {
    izq = `<div class="us-card us-super"><div class="us-sec-h"><span class="us-sq t-adm">${icSvg('settings')}</span><b>Permisos</b></div>
      Administración general: ve y hace todo, incluido el menú de Administración. Sus permisos no se cambian.
      <div><span class="us-pm t-adm">${icSvg('settings')}Admin (super)</span><span class="us-pm t-caj">${icSvg('calc')}Caja (todas)</span></div></div>`;
    der = cuentaHtml(u);
  } else {
    izq = `<div class="us-card"><div class="us-sec-h"><b>Compras y obras</b></div>${prowHtml('jefeObra')}${obrasHtml(u)}${prowHtml('personal', ' sub')}</div>
      <div class="us-card"><div class="us-sec-h"><b>Módulos</b></div>${prowHtml('caja')}${prowHtml('reportes')}${prowHtml('novedades')}${prowHtml('jefeTaller')}</div>`;
    der = autorizaHtml(u) +
      `<div class="us-card"><div class="us-sec-h"><span class="us-sq t-adm">${icSvg('settings')}</span><b>Administración</b></div>${prowHtml('admin')}</div>` +
      cuentaHtml(u);
  }
  cont.innerHTML = head + `<div class="us-fcols"><div>${izq}</div><div>${der}</div></div>`;
  pintarBarra();
  if (editNombre) { const i = $('us-nom'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

// Abre la ficha de `codigo`; si la abierta tiene cambios, pregunta antes.
async function abrirFicha(codigo, { push = true } = {}) {
  if (codigo === selCodigo && orig) { if (!MQ_ANCHA.matches) mostrarFicha(true, push); return; }
  if (hayCambios() && !(await descartar())) return;
  const u = allUsuarios.find(x => x.codigo === codigo);
  selCodigo = u ? codigo : null;
  orig  = u ? estadoDe(u) : null;
  draft = u ? JSON.parse(JSON.stringify(orig)) : null;
  editNombre = false;
  renderLista();
  renderFicha();
  if (u) mostrarFicha(true, push);
}

// Teléfono: ficha a pantalla completa, con su entrada en el historial para que
// la flecha (o el atrás del sistema) vuelva a la lista.
function mostrarFicha(on, push) {
  document.body.classList.toggle('us-open', on);
  if (on && push) {
    const url = '?u=' + encodeURIComponent(selCodigo);
    // En escritorio no se apilan entradas: sólo queda la ficha abierta en la URL.
    if (location.search !== url) history[MQ_ANCHA.matches ? 'replaceState' : 'pushState']({ u: selCodigo }, '', url);
  }
  if (on && !MQ_ANCHA.matches) window.scrollTo(0, 0);
}

function descartar() {
  return showConfirm('Cambios sin guardar', 'Hay cambios en la ficha que no se guardaron. ¿Descartarlos?',
    { boton: 'Descartar', tono: 'warn', icono: 'undo', cancelar: 'Seguir editando' });
}

function deshacer() {
  if (!orig) return;
  draft = JSON.parse(JSON.stringify(orig));
  editNombre = false;
  renderFicha();
}

async function guardarFicha() {
  const u = allUsuarios.find(x => x.codigo === selCodigo);
  if (!u || !hayCambios()) return;
  const nombre = draft.nombre.trim();
  if (!nombre) { showToast('El nombre no puede quedar vacío.', 'error'); editNombre = true; renderFicha(); return; }
  const ch = new Set(cambios());
  const fields = {};
  if (ch.has('nombre')) fields.nombre = nombre;
  if (u.codigo !== SUPER) {
    CAMPOS.forEach(k => { if (ch.has(k)) fields[k] = draft[k]; });
    // Personal cuelga de Jefe de Obra.
    if (ch.has('jefeObra') || ch.has('personal')) fields.personal = draft.jefeObra && draft.personal;
    if (ch.has('autorizaDesde')) fields.autorizaDesde = draft.autorizaDesde || null;
  }
  const btn = $('us-save');
  btn.disabled = true;
  btn.innerHTML = 'Guardando…';
  try {
    if (Object.keys(fields).length) await patchUsuario(u.codigo, fields);
    if (ch.has('obras')) {
      const antes = new Set(orig.obras), ahora = new Set(draft.obras);
      const tareas = [];
      ahora.forEach(k => { if (!antes.has(k)) tareas.push(patchObra(k, { ['jefes/' + u.codigo]: true })); });
      antes.forEach(k => { if (!ahora.has(k)) tareas.push(patchObra(k, { ['jefes/' + u.codigo]: null })); });
      await Promise.all(tareas);
    }
    showToast('Cambios guardados.');
    orig = null;
    await cargar(selCodigo);
  } catch (_) {
    showToast('No se pudo guardar. Revisá la conexión y probá de nuevo.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = icSvg('checkSm') + 'Guardar';
  }
}

// ---- Eventos de la ficha ----
function onFichaChange(e) {
  const t = e.target;
  if (t.dataset.perm) {
    draft[t.dataset.perm] = t.checked;
    if (t.dataset.perm === 'jefeObra' && !t.checked) draft.personal = false;
    // Al volver a ser Jefe de Obra, Personal vuelve a como estaba guardado.
    if (t.dataset.perm === 'jefeObra' && t.checked) draft.personal = orig.jefeObra && orig.personal;
    renderFicha();
  }
}
function onFichaInput(e) {
  const t = e.target;
  if (t.id === 'us-nom') { draft.nombre = t.value; pintarBarra(); }
  if (t.id === 'us-monto') {
    draft.autorizaDesde = parseMonto(t.value);
    $('us-chips').querySelectorAll('[data-monto]').forEach(b => b.classList.toggle('on',
      b.dataset.monto === '' ? !draft.autorizaDesde : +b.dataset.monto === draft.autorizaDesde));
    pintarBarra();
  }
}
function onFichaClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'us-nom-edit') { editNombre = true; renderFicha(); return; }
  if (b.dataset.quitarObra != null) {
    e.preventDefault();
    draft.obras = draft.obras.filter(k => k !== b.dataset.quitarObra);
    renderFicha();
    return;
  }
  if (b.id === 'us-ob-add') { abrirObras(); return; }
  if (b.dataset.monto != null) {
    if (b.dataset.monto === 'otro') { const i = $('us-monto'); i.value = ''; i.focus(); draft.autorizaDesde = null; pintarBarra(); return; }
    draft.autorizaDesde = b.dataset.monto ? +b.dataset.monto : null;
    renderFicha();
    return;
  }
  if (b.id === 'us-reset')  { resetPwd(); return; }
  if (b.id === 'us-toggle') { toggleActivo(); return; }
}
function onFichaFocusOut(e) {
  // Sin volver a pintar: un toque en un atajo justo después se perdería.
  if (e.target.id === 'us-monto') {
    e.target.value = draft.autorizaDesde ? fmtMonto(draft.autorizaDesde) : '';
    $('us-monto-hint').textContent = hintMonto(allUsuarios.find(x => x.codigo === selCodigo), draft.autorizaDesde);
  }
  if (e.target.id === 'us-nom' && draft.nombre.trim() === orig.nombre) { editNombre = false; renderFicha(); }
}

// ---- Elegir obras ----
function abrirObras() {
  const u = allUsuarios.find(x => x.codigo === selCodigo);
  const sel = new Set(draft.obras);
  // Activas, más las inactivas que ya tenía (para poder sacarlas).
  const lista = allObras.filter(o => o.activa || sel.has(o.key));
  $('us-obras-ic').innerHTML = icSvg('building');
  $('us-obras-sub').textContent = nombreCorto(u.nombre) + ' ve las OC y remitos de estas obras';
  $('us-oblist').innerHTML = lista.length
    ? lista.map(o => {
        const otros = Object.keys(o.jefes || {}).filter(c => c !== u.codigo)
          .map(c => allUsuarios.find(x => x.codigo === c)).filter(Boolean).map(x => nombreCorto(x.nombre));
        return `<label><input type="checkbox" value="${esc(o.key)}" ${sel.has(o.key) ? 'checked' : ''}>${esc(o.nombre)}${o.activa ? '' : ' (inactiva)'}${otros.length ? `<small>${esc(otros.join(', '))}</small>` : ''}</label>`;
      }).join('')
    : '<div class="us-empty">No hay obras activas. Se cargan desde Obras.</div>';
  $('modal-obras').classList.remove('hidden');
}
function cerrarObras(ok) {
  if (ok) {
    draft.obras = [...$('us-oblist').querySelectorAll('input:checked')].map(i => i.value).sort();
    renderFicha();
  }
  $('modal-obras').classList.add('hidden');
}

// ---- Cuenta ----
async function resetPwd() {
  const u = allUsuarios.find(x => x.codigo === selCodigo);
  if (!u) return;
  const ok = await showConfirm('Resetear contraseña',
    `¿Resetear la contraseña de ${u.nombre}? Va a crear una nueva al próximo ingreso.`,
    { boton: 'Resetear', tono: 'warn', icono: 'key' });
  if (!ok) return;
  try {
    await patchUsuario(u.codigo, { passwordHash: null, resetPedido: null });
    showToast('Contraseña reseteada.');
    await cargar(selCodigo, { conservar: true });
  } catch (_) {
    showToast('Error al resetear la contraseña.', 'error');
  }
}

async function toggleActivo() {
  const u = allUsuarios.find(x => x.codigo === selCodigo);
  if (!u || u.codigo === SUPER) return;
  const ok = await showConfirm(
    u.activo ? 'Desactivar usuario' : 'Activar usuario',
    u.activo ? `¿Desactivar a ${u.nombre}? No podrá ingresar al sistema.` : `¿Activar a ${u.nombre}?`,
    u.activo ? { boton: 'Desactivar', tono: 'warn', icono: 'power' } : { boton: 'Activar', tono: 'ok', icono: 'power' });
  if (!ok) return;
  try {
    await patchUsuario(u.codigo, { activo: !u.activo });
    showToast(`Usuario ${u.activo ? 'desactivado' : 'activado'}.`);
    await cargar(selCodigo, { conservar: true });
  } catch (_) {
    showToast('Error al actualizar el usuario.', 'error');
  }
}

// ---- Alta ----
let copiarDe = '';

function pintarCopia() {
  const cands = allUsuarios.filter(u => u.activo && u.codigo !== SUPER && pillsHtml(u));
  $('us-copy').innerHTML = [`<button type="button" data-copia="" class="${copiarDe ? '' : 'on'}">Nadie</button>`]
    .concat(cands.map(u => `<button type="button" data-copia="${esc(u.codigo)}" class="${copiarDe === u.codigo ? 'on' : ''}">${esc(nombreCorto(u.nombre))}</button>`)).join('');
  const src = allUsuarios.find(u => u.codigo === copiarDe);
  $('us-copy-prev').innerHTML = src ? ORDEN_PILLS.filter(k => permValor(src, k))
    .map(k => `<span class="us-pm t-${PERMS[k].t}">${icSvg(PERMS[k].ic)}${PERMS[k].n}</span>`).join('') : '';
}

async function openAddModal() {
  if (hayCambios() && !(await descartar())) return;
  if (orig) deshacer();
  copiarDe = '';
  $('modal-user-error').classList.add('hidden');
  const maxCode = allUsuarios.map(u => parseInt(u.codigo, 10)).filter(n => !isNaN(n) && n !== 0).reduce((a, b) => Math.max(a, b), 0);
  $('user-codigo').value = String(maxCode + 1).padStart(4, '0');
  $('user-nombre').value = '';
  $('us-alta-ic').innerHTML = icSvg('userPlus');
  $('modal-user-save').innerHTML = icSvg('checkSm') + 'Crear y abrir ficha';
  pintarCopia();
  $('modal-user').classList.remove('hidden');
  setTimeout(() => $('user-nombre').focus(), 50);
}

async function saveUser() {
  const codigo = $('user-codigo').value.trim().padStart(4, '0');
  const nombre = $('user-nombre').value.trim();
  const err = msg => { $('modal-user-error').textContent = msg; $('modal-user-error').classList.remove('hidden'); };
  if (!/^\d{4}$/.test(codigo)) return err('El código debe ser de 4 dígitos numéricos.');
  if (!nombre) return err('Falta el nombre.');
  if (allUsuarios.some(u => u.codigo === codigo)) return err('Ya existe un usuario con ese código.');

  const data = { nombre, activo: true, passwordHash: null, creadoEn: Date.now() };
  const src = allUsuarios.find(u => u.codigo === copiarDe);
  if (src) CAMPOS.forEach(k => { if (permValor(src, k)) data[k] = true; });

  const btn = $('modal-user-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await saveUsuario(codigo, data);
    $('modal-user').classList.add('hidden');
    showToast('Usuario creado.');
    filtro = 'todos';
    $('us-q').value = '';
    orig = null;
    await cargar(codigo);
  } catch (_) {
    err('Error al guardar. Intentá de nuevo.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = icSvg('checkSm') + 'Crear y abrir ficha';
  }
}

// ---- Carga ----
// `abrir`: código cuya ficha queda abierta. `conservar`: mantiene lo que se
// estaba editando (resetear clave o desactivar no tocan el borrador).
async function cargar(abrir, { conservar = false } = {}) {
  try {
    const [us, obras] = await Promise.all([getAllUsuarios(), getAllObras().catch(() => allObras)]);
    allUsuarios = us;
    allObras = obras;
  } catch (_) {
    $('users-list').innerHTML = '<div class="us-rows"><div class="us-empty">Error al cargar usuarios.</div></div>';
    return;
  }
  const u = allUsuarios.find(x => x.codigo === abrir);
  selCodigo = u ? abrir : null;
  if (u && !(conservar && draft)) {
    orig = estadoDe(u);
    draft = JSON.parse(JSON.stringify(orig));
    editNombre = false;
  } else if (u) {
    // Sólo cambió la cuenta: el borrador sigue, contra lo guardado de nuevo en permisos.
    const nuevo = estadoDe(u);
    nuevo.nombre = orig.nombre;
    orig = nuevo;
  } else { orig = draft = null; }
  renderTodo();
  renderFicha();
  if (u && !document.body.classList.contains('us-open') && !MQ_ANCHA.matches && abrir) mostrarFicha(true, true);
}

document.addEventListener('DOMContentLoaded', () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name || code !== SUPER) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);
  $('hdr-name').textContent = name;

  $('btn-back').addEventListener('click', () => {
    if (!MQ_ANCHA.matches && document.body.classList.contains('us-open')) { history.back(); return; }
    window.location.href = 'administracion.html';
  });
  // Atrás en el teléfono: de la ficha a la lista (preguntando si hay cambios).
  window.addEventListener('popstate', async () => {
    const c = new URLSearchParams(location.search).get('u');
    if (c) { abrirFicha(c, { push: false }); return; }
    if (hayCambios()) {
      if (!(await descartar())) { history.pushState({ u: selCodigo }, '', '?u=' + encodeURIComponent(selCodigo)); return; }
      deshacer();
    }
    mostrarFicha(false);
    if (!MQ_ANCHA.matches) { selCodigo = null; orig = draft = null; renderLista(); renderFicha(); }
  });
  window.addEventListener('beforeunload', e => { if (hayCambios()) { e.preventDefault(); e.returnValue = ''; } });

  $('users-list').addEventListener('click', e => {
    const r = e.target.closest('.us-row');
    if (r) abrirFicha(r.dataset.cod);
  });
  $('us-flt').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filtro = b.dataset.f;
    renderFiltros();
    renderLista();
  });
  $('us-q').addEventListener('input', renderLista);
  $('us-pend').addEventListener('click', () => {
    filtro = 'reset';
    renderFiltros();
    renderLista();
    const u = allUsuarios.find(pidioReset);
    if (u && allUsuarios.filter(pidioReset).length === 1) abrirFicha(u.codigo);
  });

  const ficha = $('us-ficha');
  ficha.addEventListener('change', onFichaChange);
  ficha.addEventListener('input', onFichaInput);
  ficha.addEventListener('click', onFichaClick);
  ficha.addEventListener('focusout', onFichaFocusOut);
  ficha.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.id === 'us-nom' || e.target.id === 'us-monto')) { e.preventDefault(); e.target.blur(); }
  });

  $('us-undo').addEventListener('click', deshacer);
  $('us-save').innerHTML = icSvg('checkSm') + 'Guardar';
  $('us-save').addEventListener('click', guardarFicha);

  $('btn-add-user').addEventListener('click', openAddModal);
  $('modal-user-cancel').addEventListener('click', () => $('modal-user').classList.add('hidden'));
  $('modal-user-save').addEventListener('click', saveUser);
  $('user-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveUser(); });
  $('us-copy').addEventListener('click', e => {
    const b = e.target.closest('[data-copia]');
    if (b) { copiarDe = b.dataset.copia; pintarCopia(); }
  });
  $('us-obras-cancel').addEventListener('click', () => cerrarObras(false));
  $('us-obras-ok').addEventListener('click', () => cerrarObras(true));

  const inicial = new URLSearchParams(location.search).get('u');
  // Con ?u= desde afuera (p. ej. la push de "Pidió resetear"), la lista queda debajo en el historial.
  if (inicial) history.replaceState(null, '', location.pathname);
  cargar(inicial);
});
