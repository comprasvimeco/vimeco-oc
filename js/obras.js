/* VIMECO S.A. — Gestión de Obras (solo 0000)
   Lista agrupada por categoría con buscador y filtros a la izquierda y la
   ficha de la obra a la derecha (en el teléfono, una a la vez, con ?o=clave en
   la URL). La ficha junta uso, datos, Personal y rubros; se guarda todo junto
   con la barra de abajo, que aparece sólo si hay cambios. */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MQ_ANCHA = window.matchMedia('(min-width: 1000px)');
const DIA = 864e5;
const SIN_MOV_DIAS = 90;

// Categoría de la obra: las dos líneas de trabajo de la empresa más la
// oficina. Reportes la muestra como etiqueta (casita / ruta / maletín) en el
// listado de OC.
const CATEGORIAS = {
  arquitectura: { label: 'Arquitectura', icon: 'building' },
  vial:         { label: 'Vial',         icon: 'road' },
  oficina:      { label: 'Oficina',      icon: 'briefcase' },
};
const catDe = o => (CATEGORIAS[o.categoria] ? o.categoria : '');

let allObras    = [];
let allUsuarios = [];
let filtro      = 'todas';
let selKey      = null;
let orig        = null;    // estado guardado de la ficha abierta
let draft       = null;    // lo que se está editando
let editRubro   = -1;      // índice del rubro que se está renombrando

// ---- Uso de cada obra ----
// Las OC, los remitos y los egresos de Caja guardan el NOMBRE de la obra (no la
// clave): el uso se cuenta por nombre normalizado, y al renombrar una obra se
// pasan al nombre nuevo para que el Jefe de Obra las siga viendo y Reportes no
// la parta en dos.
let refs = null;           // { ocs, remitos, caja: [{ codigo, key, obra }] }
let cuadrillas = {};       // clave de obra → personas activas asignadas
let uso = new Map();       // nombre normalizado → { oc, ult, mes, remMes }
let usoPromesa = null;

const ESTADOS_SIN_COMPRA = new Set(['pendiente', 'rechazada', 'cancelada', 'anulada']);
const claveOC = oc => (oc.nroOC || '').replace(/-/g, '');

function montoARS(oc) {
  const t = Number(oc.total) || 0;
  if (oc.moneda !== 'USD') return t;
  const r = oc.cotizacion?.oficial?.venta || oc.cotizacion?.oficial?.compra;
  return r ? t * r : 0;
}

function calcularUso() {
  uso = new Map();
  if (!refs) return;
  const hoy = new Date();
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1).getTime();
  const de = nombre => {
    const k = normObraNombre(nombre);
    if (!uso.has(k)) uso.set(k, { oc: 0, ult: 0, mes: 0, remMes: 0 });
    return uso.get(k);
  };
  refs.ocs.forEach(oc => {
    if (!oc.obra || ESTADOS_SIN_COMPRA.has(oc.estado || 'emitida')) return;
    const u = de(oc.obra), ts = oc.timestamp || 0;
    u.oc++;
    if (ts > u.ult) u.ult = ts;
    if (ts >= ini) u.mes += montoARS(oc);
  });
  refs.remitos.forEach(r => { if (r.obra && (r.timestamp || 0) >= ini) de(r.obra).remMes++; });
}

function cargarUso() {
  if (usoPromesa) return usoPromesa;
  usoPromesa = (async () => {
    const [ocs, remitos, cajas, personal] = await Promise.all([
      getHistorial('0000', true).catch(() => null),
      getRemitos().catch(() => null),
      getTodasLasCajas().catch(() => null),
      getPersonal().catch(() => [])
    ]);
    if (!ocs) { usoPromesa = null; return false; }
    const caja = [];
    Object.entries(cajas?.movimientos || {}).forEach(([codigo, movs]) =>
      movs.forEach(m => { if (m.obra) caja.push({ codigo, key: m.key, obra: m.obra }); }));
    refs = { ocs, remitos: remitos || [], caja, cajaOk: !!cajas, remitosOk: !!remitos };
    cuadrillas = {};
    (personal || []).forEach(p => {
      if (p.activo === false) return;
      Object.keys(p.obras || {}).forEach(k => { cuadrillas[k] = (cuadrillas[k] || 0) + 1; });
    });
    calcularUso();
    return true;
  })();
  return usoPromesa;
}

const usoDe = o => uso.get(normObraNombre(o.nombre)) || { oc: 0, ult: 0, mes: 0, remMes: 0 };
const sinMov = o => o.activa && !!refs && (() => {
  const u = usoDe(o), lim = Date.now() - SIN_MOV_DIAS * DIA;
  return u.ult ? u.ult < lim : (o.creadaEn || 0) < lim;
})();
const jefesActivos = o => Object.keys(o.jefes || {}).filter(c => allUsuarios.some(u => u.codigo === c && u.activo && u.jefeObra));
const sinJefe = o => o.activa && catDe(o) !== 'oficina' && !jefesActivos(o).length;

// ---- Helpers ----
function fmtMiles(n) { return Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 }); }
function fmtCompacto(n) {
  const a = Math.abs(Number(n) || 0);
  if (a >= 1e6) return '$ ' + (a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: a >= 1e8 ? 0 : 1 }) + ' M';
  if (a >= 1e3) return '$ ' + Math.round(a / 1e3).toLocaleString('es-AR') + ' mil';
  return '$ ' + fmtMiles(a);
}
function parsePesos(str) {
  const n = parseInt(String(str || '').replace(/,\d*$/, '').replace(/\D/g, ''), 10);
  return n > 0 ? n : 0;
}
function hace(ts) {
  const dia0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const d = Math.round((dia0(new Date()) - dia0(new Date(ts))) / DIA);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 31) return `hace ${d} días`;
  if (d < 365) { const m = Math.round(d / 30); return m === 1 ? 'hace un mes' : `hace ${m} meses`; }
  return 'hace más de un año';
}
// "Ing. Daniel Ortiz" → "D. Ortiz"; si otra persona activa queda igual, el nombre entero sin el título.
function nombreCorto(nombre) {
  const pal = n => String(n || '').split(/\s+/).filter(p => p && !p.endsWith('.'));
  const corto = n => { const p = pal(n); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : (p[0] || ''); };
  const c = corto(nombre);
  const repetido = allUsuarios.some(u => u.activo && u.nombre !== nombre && corto(u.nombre) === c);
  return repetido ? pal(nombre).join(' ') : c;
}
function listaNombres(ns) {
  return ns.length > 1 ? ns.slice(0, -1).join(', ') + ' y ' + ns[ns.length - 1] : (ns[0] || '');
}
const usuario = c => allUsuarios.find(u => u.codigo === c);
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// Nombres parecidos (para no duplicar obras al dar de alta): misma primera
// palabra significativa ("La Molienda III" ↔ "La Molienda II") o casi iguales.
const VACIAS = new Set(['la', 'el', 'los', 'las', 'de', 'del', 'y', 'en']);
function palabras(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/).filter(w => w && !VACIAS.has(w));
}
function distancia(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function parecidas(nombre, salvoKey) {
  const p = palabras(nombre);
  if (!p.length) return [];
  const j = p.join(' ');
  return allObras.filter(o => o.key !== salvoKey).filter(o => {
    const q = palabras(o.nombre);
    if (!q.length) return false;
    return (p[0].length >= 4 && p[0] === q[0]) || distancia(j, q.join(' ')) <= 2;
  });
}
const mismoNombre = (nombre, salvoKey) =>
  allObras.find(o => o.key !== salvoKey && normObraNombre(o.nombre) === normObraNombre(nombre));

// ---- Lista ----
function catSq(o, cls = '') {
  const c = catDe(o);
  return `<span class="ob-sq${cls} ${o.activa === false ? 't-gr' : c ? 't-' + c : 't-gr'}" aria-hidden="true">${icSvg(c ? CATEGORIAS[c].icon : 'tag')}</span>`;
}
function marcasHtml(o) {
  const out = [];
  if (sinMov(o)) {
    const u = usoDe(o);
    out.push(`<span class="ob-pm t-warn">${icSvg('clock')}${u.ult ? 'Sin compras ' + hace(u.ult) : 'Sin compras'}</span>`);
  }
  const n = rubrosList(o.rubros).length;
  if (n) out.push(`<span class="ob-pm t-gr" title="${o.rubrosCerrados ? 'Las OC nuevas piden rubro' : 'Las OC no piden rubro todavía'}">${icSvg(o.rubrosCerrados ? 'lock' : 'layers')}${plural(n, 'rubro', 'rubros')}</span>`);
  return out.join('');
}
function filaHtml(o) {
  const u = usoDe(o);
  const st = refs
    ? `<span class="st">${u.oc ? `<b>${u.oc}</b> OC${sinMov(o) ? '' : ' · última ' + hace(u.ult)}` : 'Sin OC'}</span>`
    : '';
  const jefes = jefesActivos(o).map(c => `<span class="ob-pm t-obr">${icSvg('user')}${esc(nombreCorto(usuario(c).nombre))}</span>`).join('');
  return `<button type="button" class="ob-row${o.activa ? '' : ' off'}${o.key === selKey ? ' sel' : ''}" data-key="${esc(o.key)}">
    ${catSq(o)}<span class="mid"><span class="nm">${esc(o.nombre)}</span><span class="l2">${st}${jefes}${marcasHtml(o)}</span></span>
    <span class="chev">${icSvg('chevR')}</span></button>`;
}

function filtrosDef() {
  const f = [['todas', 'Todas', '', () => true]];
  Object.entries(CATEGORIAS).forEach(([k, c]) => f.push([k, c.label, c.icon, o => catDe(o) === k]));
  f.push(['sincat', 'Sin categoría', 'tag', o => !catDe(o), true]);
  f.push(['sinjefe', 'Sin jefe', '', sinJefe, true]);
  f.push(['sinmov', 'Sin movimiento', '', sinMov, true]);
  f.push(['inactivas', 'Inactivas', '', o => !o.activa, true]);
  return f;
}

function renderFiltros() {
  $('ob-flt').innerHTML = filtrosDef().map(([k, txt, icon, fn, siHay]) => {
    const n = allObras.filter(fn).length;
    if (siHay && !n && filtro !== k) return '';
    return `<button type="button" class="${filtro === k ? 'on' : ''}" data-f="${k}" aria-pressed="${filtro === k}">${icon ? icSvg(icon) : ''}${txt} <b>${n}</b></button>`;
  }).join('');
}

function renderLista() {
  const q = palabras($('ob-q').value).join(' ');
  const fn = (filtrosDef().find(f => f[0] === filtro) || filtrosDef()[0])[3];
  const ok = o => fn(o) && (!q || palabras(o.nombre + ' ' + (o.lugar_entrega || '')).join(' ').includes(q));
  const grupo = (titulo, l) => l.length ? `<div class="ob-grp">${titulo} <span class="n">${l.length}</span></div><div class="ob-rows">${l.map(filaHtml).join('')}</div>` : '';
  const act = allObras.filter(o => o.activa && ok(o));
  let html = Object.entries(CATEGORIAS).map(([k, c]) => grupo(c.label, act.filter(o => catDe(o) === k))).join('')
    + grupo('Sin categoría', act.filter(o => !catDe(o)))
    + grupo('Inactivas', allObras.filter(o => !o.activa && ok(o)));
  $('obras-list').innerHTML = html || `<div class="ob-rows"><div class="ob-empty">${q ? 'Ninguna obra coincide con lo buscado.' : 'No hay obras en este filtro.'}</div></div>`;
}

function renderCabecera() {
  const n = allObras.filter(o => o.activa).length;
  $('ob-count').textContent = plural(n, 'activa', 'activas');
  const sm = allObras.filter(sinMov).length;
  const b = $('ob-sinmov');
  b.classList.toggle('hidden', !sm);
  b.textContent = `${sm} sin movimiento`;
}

function renderRevisar() {
  const sm = allObras.filter(sinMov), sj = allObras.filter(sinJefe);
  const items = [];
  if (sm.length) items.push(`<button type="button" class="r" data-f="sinmov">${icSvg('clock')}<span><b>${plural(sm.length, 'obra sin compras', 'obras sin compras')}</b> hace más de ${SIN_MOV_DIAS} días: ${esc(listaNombres(sm.map(o => o.nombre)))}. ¿Siguen en curso?</span><span class="chev">${icSvg('chevR')}</span></button>`);
  if (sj.length) items.push(`<button type="button" class="r" data-f="sinjefe">${icSvg('user')}<span><b>${plural(sj.length, 'obra sin Jefe de Obra', 'obras sin Jefe de Obra')}</b>: nadie ve sus OC salvo quien las emite.</span><span class="chev">${icSvg('chevR')}</span></button>`);
  $('ob-rev').innerHTML = items.length
    ? `<div class="ob-card ob-rev"><div class="ob-sec-h"><span class="ob-sq sm t-warn">${icSvg('alert')}</span><b>Para revisar</b></div>${items.join('')}</div>` : '';
}

function renderTodo() {
  renderCabecera();
  renderFiltros();
  renderLista();
  renderRevisar();
}

// ---- Ficha ----
function estadoDe(o) {
  const c = o.constantes || {};
  return {
    nombre: o.nombre || '', categoria: catDe(o) || null, lugar: o.lugar_entrega || '',
    jornada: c.jornadaHoras ?? 8, comida: Number(c.valorComida) || 0,
    jefes: Object.keys(o.jefes || {}).sort(),
    rubros: rubrosList(o.rubros).map(r => ({ id: r.id, nombre: r.nombre })),
    rubrosCerrados: !!o.rubrosCerrados && rubrosList(o.rubros).length > 0
  };
}
function cambios() {
  if (!orig || !draft) return [];
  const out = [];
  if (draft.nombre.trim() !== orig.nombre) out.push('nombre');
  if (draft.categoria !== orig.categoria) out.push('categoria');
  if (draft.lugar.trim() !== orig.lugar) out.push('lugar');
  if (Number(draft.jornada) !== Number(orig.jornada)) out.push('jornada');
  if (draft.comida !== orig.comida) out.push('comida');
  if (draft.jefes.join() !== orig.jefes.join()) out.push('jefes');
  const rk = l => JSON.stringify(l.map(r => [r.id, r.nombre.trim()]));
  if (rk(draft.rubros) !== rk(orig.rubros)) out.push('rubros');
  if (draft.rubrosCerrados !== orig.rubrosCerrados) out.push('rubrosCerrados');
  return out;
}
const hayCambios = () => cambios().length > 0;

function pintarBarra() {
  const n = cambios().length;
  $('ob-savebar').classList.toggle('hidden', !n);
  $('ob-save-txt').textContent = n === 1 ? '1 cambio sin guardar' : `${n} cambios sin guardar`;
}

// Lo que quedó con el nombre guardado y pasaría al nuevo.
function refsDelNombre(viejo, nuevo) {
  if (!refs) return null;
  const k = normObraNombre(viejo);
  const m = x => x.obra && normObraNombre(x.obra) === k && x.obra !== nuevo;
  return { ocs: refs.ocs.filter(m), remitos: refs.remitos.filter(m), caja: refs.caja.filter(m) };
}

function avisoNombreHtml() {
  const nuevo = draft.nombre.trim();
  if (!nuevo || nuevo === orig.nombre) return '';
  const otra = mismoNombre(nuevo, selKey);
  if (otra) return `<div class="ob-aviso red">${icSvg('alert')}<span>Ya hay otra obra que se llama "${esc(otra.nombre)}".</span></div>`;
  const r = refsDelNombre(orig.nombre, nuevo);
  if (!r) return `<div class="ob-aviso">${icSvg('alert')}<span>Cargando cuántas OC tienen el nombre anterior…</span></div>`;
  const partes = [];
  if (r.ocs.length) partes.push(plural(r.ocs.length, 'OC', 'OC'));
  if (r.remitos.length) partes.push(plural(r.remitos.length, 'remito', 'remitos'));
  if (r.caja.length) partes.push(plural(r.caja.length, 'egreso de Caja', 'egresos de Caja'));
  if (!partes.length) return '';
  return `<div class="ob-aviso">${icSvg('alert')}<span>${esc(listaNombres(partes))} ${r.ocs.length + r.remitos.length + r.caja.length === 1 ? 'tiene' : 'tienen'} "${esc(orig.nombre)}": al guardar pasan al nombre nuevo, así el Jefe de Obra las sigue viendo y Reportes las suma juntas. La carpeta de Drive no se renombra.</span></div>`;
}

function usoHtml(o) {
  const u = usoDe(o), c = cuadrillas[o.key] || 0;
  const v = (x, txt) => `<div><b>${refs ? x : '…'}</b><small>${txt}</small></div>`;
  return `<div class="ob-card" id="ob-uso-card"><div class="ob-sec-h"><span class="ob-sq sm t-rep">${icSvg('trend')}</span><b>Uso</b></div>
    <div class="ob-uso${refs ? '' : ' cargando'}">${v(fmtMiles(u.oc), 'OC en total')}${v(fmtCompacto(u.mes), 'comprado este mes')}${v(u.ult ? hace(u.ult) : '—', 'última OC')}${v(c ? fmtMiles(c) : '—', 'en la cuadrilla')}</div>
    ${u.oc ? `<a class="ob-lnk" href="reportes.html?obra=${encodeURIComponent(o.nombre)}">${icSvg('trend')}Ver en Reportes${icSvg('chevR')}</a>` : ''}</div>`;
}

function datosHtml() {
  const seg = Object.entries(CATEGORIAS).map(([k, c]) =>
    `<button type="button" class="t-${k}${draft.categoria === k ? ' on' : ''}" data-cat="${k}" aria-pressed="${draft.categoria === k}">${icSvg(c.icon)}${c.label}</button>`).join('');
  return `<div class="ob-card"><div class="ob-sec-h"><span class="ob-sq sm t-gr">${icSvg('edit')}</span><b>Datos</b></div>
    <div class="ob-fld"><label for="ob-nom">Nombre</label><input type="text" id="ob-nom" class="form-control${draft.nombre.trim() !== orig.nombre ? ' chg' : ''}" value="${esc(draft.nombre)}" autocomplete="off">
      <div id="ob-nom-aviso">${avisoNombreHtml()}</div></div>
    <div class="ob-fld"><span class="lb">Categoría</span><div class="ob-seg" id="ob-cat">${seg}</div></div>
    <div class="ob-fld"><label for="ob-lugar">Lugar de entrega</label><input type="text" id="ob-lugar" class="form-control" value="${esc(draft.lugar)}" placeholder="Dirección donde reciben los materiales"></div></div>`;
}

function personalHtml() {
  const chips = draft.jefes.map(c => {
    const u = usuario(c);
    const vale = u && u.activo && u.jefeObra;
    const txt = u ? nombreCorto(u.nombre) : c;
    const tit = !u ? 'Usuario inexistente' : !u.activo ? 'Usuario inactivo' : !u.jefeObra ? 'Ya no tiene el permiso Jefe de Obra' : '';
    return `<span class="ob-chip ${vale ? 'jefe' : 'inact'}${orig.jefes.includes(c) ? '' : ' nuevo'}" title="${esc(tit)}">${icSvg('user')}${esc(txt)}${vale ? '' : ` <small>(${!u ? 'no existe' : !u.activo ? 'inactivo' : 'sin el permiso'})</small>`}<button type="button" class="q" data-quitar-jefe="${esc(c)}" aria-label="Quitar ${esc(txt)}">${icSvg('x')}</button></span>`;
  }).join('');
  const activos = draft.jefes.filter(c => { const u = usuario(c); return u && u.activo && u.jefeObra; }).length;
  return `<div class="ob-card"><div class="ob-sec-h"><span class="ob-sq sm t-per">${icSvg('users')}</span><b>Personal</b></div>
    <div class="ob-fld"><span class="lb">Jefes de obra</span><div class="ob-chips">${chips}<button type="button" class="ob-chip-add${activos || draft.categoria === 'oficina' ? '' : ' hot'}" id="ob-jefe-add">${icSvg('plus')}${draft.jefes.length ? 'Agregar' : 'Elegir'}</button></div>
      <div class="ob-hint">Ven todas las OC y remitos de la obra, aunque las emita otro, y cargan sus partes.</div></div>
    <div class="ob-row2">
      <div class="ob-fld"><label for="ob-jornada">Jornada (horas)</label><input type="number" id="ob-jornada" class="form-control" min="0" max="24" step="0.5" value="${esc(draft.jornada)}"></div>
      <div class="ob-fld"><label for="ob-comida">Valor comida</label><div class="ob-pesos"><span>$</span><input type="text" id="ob-comida" class="form-control" inputmode="numeric" value="${draft.comida ? fmtMiles(draft.comida) : ''}" placeholder="0"></div></div>
    </div></div>`;
}

function rubrosHtml() {
  const abierta = !draft.rubrosCerrados, n = draft.rubros.length;
  const chips = draft.rubros.map((r, i) => i === editRubro
    ? `<span class="ob-chip edit"><input type="text" id="ob-rub-edit" value="${esc(r.nombre)}" aria-label="Nombre del rubro"></span>`
    : `<span class="ob-chip${orig.rubros.some(x => x.id === r.id) ? '' : ' nuevo'}"><button type="button" class="tx" data-rub-edit="${i}" ${abierta ? '' : 'disabled'} title="${abierta ? 'Tocá para corregir el nombre' : ''}">${esc(r.nombre)}</button><button type="button" class="q" data-rub-quitar="${i}" aria-label="Quitar ${esc(r.nombre)}">${icSvg('x')}</button></span>`).join('');
  const desc = !n ? 'Primero cargá los rubros de la obra.'
    : abierta ? 'Apagado: las OC de esta obra se emiten sin rubro. Mientras tanto los nombres se pueden corregir tocándolos.'
    : 'Prendido: toda OC nueva de esta obra elige un rubro. Para corregir un nombre, apagalo.';
  return `<div class="ob-card"><div class="ob-sec-h"><span class="ob-sq sm t-gr">${icSvg('layers')}</span><b>Rubros</b>${n ? `<span class="push ob-pm t-gr">${n}</span>` : ''}</div>
    <label class="ob-prow${n ? '' : ' dis'}"><span class="tx"><b>Las OC nuevas piden rubro</b><small>${desc}</small></span>
      <span class="ob-sw"><input type="checkbox" id="ob-rub-regla" ${draft.rubrosCerrados ? 'checked' : ''} ${n ? '' : 'disabled'} aria-label="Las OC nuevas piden rubro"><span></span></span></label>
    ${n ? `<div class="ob-chips">${chips}</div>` : ''}
    <div class="ob-rub-new"><input type="text" id="ob-rub-nuevo" class="form-control" placeholder="Nuevo rubro, ej: Instalación eléctrica"><button type="button" class="foc-btn foc-btn--clear" id="ob-rub-add">${icSvg('plus')}Agregar</button></div></div>`;
}

function estadoHtml(o) {
  return `<div class="ob-card">${o.activa
    ? `<div><button type="button" class="foc-btn foc-btn--del" id="ob-toggle">${icSvg('power')}Desactivar obra</button></div><div class="ob-hint">Deja de aparecer al hacer una OC, un remito o un egreso de Caja. Lo cargado queda.</div>`
    : `<div><button type="button" class="foc-btn foc-btn--gen" id="ob-toggle">${icSvg('power')}Activar obra</button></div><div class="ob-hint">Inactiva: no aparece al hacer una OC, un remito o un egreso de Caja.</div>`}</div>`;
}

function renderFicha() {
  const cont = $('ob-ficha');
  const o = allObras.find(x => x.key === selKey);
  if (!o) {
    cont.innerHTML = `<div class="ob-card ob-vacia">${icSvg('building')}<div>Elegí una obra de la lista para ver cuánto se usa y cambiar sus datos.</div></div>`;
    pintarBarra();
    return;
  }
  const meta = [];
  const c = draft.categoria;
  if (c) meta.push(`<span class="ob-pm t-${c}">${icSvg(CATEGORIAS[c].icon)}${CATEGORIAS[c].label}</span>`);
  if (!o.activa) meta.push(`<span class="ob-pm t-red">${icSvg('power')}Inactiva</span>`);
  if (o.creadaEn) meta.push(`<span class="ob-pm t-gr">${icSvg('calendar')}Alta ${new Date(o.creadaEn).toLocaleDateString('es-AR')}</span>`);
  if (sinMov(o)) meta.push(marcasHtml(o).match(/<span class="ob-pm t-warn">.*?<\/span>/)?.[0] || '');
  const head = `<div class="ob-card"><div class="ob-fhead">${catSq({ ...o, categoria: c }, ' lg')}
    <div class="id"><div class="nm">${esc(draft.nombre.trim() || o.nombre)}</div><div class="meta">${meta.join('')}</div></div></div></div>`;
  cont.innerHTML = head + `<div class="ob-fcols"><div>${usoHtml(o)}${datosHtml()}${personalHtml()}</div><div>${rubrosHtml()}${estadoHtml(o)}</div></div>`;
  pintarBarra();
  if (editRubro >= 0) { const i = $('ob-rub-edit'); if (i) { i.focus(); i.select(); } }
}

// Abre la ficha de `key`; si la abierta tiene cambios, pregunta antes.
async function abrirFicha(key, { push = true } = {}) {
  if (key === selKey && orig) { if (!MQ_ANCHA.matches) mostrarFicha(true, push); return; }
  if (hayCambios() && !(await descartar())) return;
  const o = allObras.find(x => x.key === key);
  selKey = o ? key : null;
  orig  = o ? estadoDe(o) : null;
  draft = o ? JSON.parse(JSON.stringify(orig)) : null;
  editRubro = -1;
  renderLista();
  renderFicha();
  if (o) mostrarFicha(true, push);
}

// Teléfono: ficha a pantalla completa, con su entrada en el historial para que
// la flecha (o el atrás del sistema) vuelva a la lista.
function mostrarFicha(on, push) {
  document.body.classList.toggle('ob-open', on);
  if (on && push) {
    const url = '?o=' + encodeURIComponent(selKey);
    // En escritorio no se apilan entradas: sólo queda la ficha abierta en la URL.
    if (location.search !== url) history[MQ_ANCHA.matches ? 'replaceState' : 'pushState']({ o: selKey }, '', url);
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
  editRubro = -1;
  renderFicha();
}

// Pasa al nombre nuevo las OC, remitos y egresos de Caja que tenían el anterior.
async function renombrarRefs(r, nuevo) {
  const tareas = [
    ...r.ocs.map(oc => () => patchHistorialEntry(claveOC(oc), { obra: nuevo }).then(() => { oc.obra = nuevo; })),
    ...r.remitos.map(x => () => patchRemito(x.key, { obra: nuevo }).then(() => { x.obra = nuevo; })),
    ...r.caja.map(x => () => patchCajaMovimiento(x.codigo, x.key, { obra: nuevo }).then(() => { x.obra = nuevo; }))
  ];
  let fallas = 0;
  for (let i = 0; i < tareas.length; i += 20) {
    const res = await Promise.allSettled(tareas.slice(i, i + 20).map(t => t()));
    fallas += res.filter(x => x.status === 'rejected').length;
  }
  return { total: tareas.length, fallas };
}

async function guardarFicha() {
  const o = allObras.find(x => x.key === selKey);
  if (!o || !hayCambios()) return;
  editRubro = -1;
  const nombre = draft.nombre.trim();
  if (!nombre) { showToast('El nombre no puede quedar vacío.', 'error'); renderFicha(); return; }
  const otra = mismoNombre(nombre, selKey);
  if (otra) { showToast(`Ya hay otra obra que se llama "${otra.nombre}".`, 'error'); renderFicha(); return; }
  if (draft.rubros.some(r => !r.nombre.trim())) { showToast('Hay rubros sin nombre.', 'error'); renderFicha(); return; }
  const ch = new Set(cambios());

  // Renombrar: las OC, remitos y egresos guardan el nombre y pasan al nuevo.
  let r = null;
  if (ch.has('nombre')) {
    const btn = $('ob-save');
    btn.disabled = true;
    btn.textContent = 'Revisando…';
    const ok = await cargarUso();
    btn.disabled = false;
    btn.innerHTML = icSvg('checkSm') + 'Guardar';
    if (!ok) { showToast('No se pudieron leer las OC para renombrarlas. Revisá la conexión.', 'error'); return; }
    r = refsDelNombre(orig.nombre, nombre);
    const n = r.ocs.length + r.remitos.length + r.caja.length;
    if (n) {
      const partes = [];
      if (r.ocs.length) partes.push(plural(r.ocs.length, 'OC', 'OC'));
      if (r.remitos.length) partes.push(plural(r.remitos.length, 'remito', 'remitos'));
      if (r.caja.length) partes.push(plural(r.caja.length, 'egreso de Caja', 'egresos de Caja'));
      const ok2 = await showConfirm('Renombrar obra',
        `"${orig.nombre}" pasa a llamarse "${nombre}". ${listaNombres(partes)} ${n === 1 ? 'pasa' : 'pasan'} también al nombre nuevo. La carpeta de Drive no se renombra: lo nuevo se guarda en una carpeta con el nombre nuevo.`,
        { boton: 'Renombrar', tono: 'info', icono: 'edit' });
      if (!ok2) return;
    } else r = null;
  }

  const f = {};
  if (ch.has('nombre')) f.nombre = nombre;
  if (ch.has('categoria')) f.categoria = draft.categoria;
  if (ch.has('lugar')) f.lugar_entrega = draft.lugar.trim();
  if (ch.has('jornada')) f['constantes/jornadaHoras'] = parseFloat(draft.jornada) || 0;
  if (ch.has('comida')) f['constantes/valorComida'] = draft.comida || 0;
  if (ch.has('jefes')) f.jefes = draft.jefes.length ? Object.fromEntries(draft.jefes.map(c => [c, true])) : null;
  if (ch.has('rubros') || ch.has('rubrosCerrados')) {
    const obj = {};
    draft.rubros.forEach((x, i) => { obj[x.id] = { nombre: x.nombre.trim(), orden: i }; });
    f.rubros = draft.rubros.length ? obj : null;
    // Sin rubros no hay lista que cerrar: el flag no puede quedar en true.
    f.rubrosCerrados = !!(draft.rubros.length && draft.rubrosCerrados);
  }

  const btn = $('ob-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await patchObra(o.key, f);
    if (r) {
      btn.textContent = 'Renombrando…';
      const res = await renombrarRefs(r, nombre);
      calcularUso();
      if (res.fallas) showToast(`Obra renombrada, pero ${res.fallas} de ${res.total} no se pudieron pasar al nombre nuevo. Volvé a guardar el mismo nombre para reintentar.`, 'error');
      else showToast(`Obra renombrada: ${res.total} ${res.total === 1 ? 'registro pasó' : 'registros pasaron'} al nombre nuevo.`);
    } else showToast('Cambios guardados.');
    orig = null;
    await cargar(selKey);
  } catch (_) {
    showToast('No se pudo guardar. Revisá la conexión y probá de nuevo.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = icSvg('checkSm') + 'Guardar';
  }
}

// ---- Eventos de la ficha ----
function onFichaInput(e) {
  const t = e.target;
  if (t.id === 'ob-nom') {
    draft.nombre = t.value;
    t.classList.toggle('chg', t.value.trim() !== orig.nombre);
    $('ob-nom-aviso').innerHTML = avisoNombreHtml();
  }
  if (t.id === 'ob-lugar') draft.lugar = t.value;
  if (t.id === 'ob-jornada') draft.jornada = t.value === '' ? 0 : parseFloat(t.value);
  if (t.id === 'ob-comida') draft.comida = parsePesos(t.value);
  if (t.id === 'ob-rub-edit' && draft.rubros[editRubro]) draft.rubros[editRubro].nombre = t.value;
  pintarBarra();
}
function onFichaChange(e) {
  if (e.target.id === 'ob-rub-regla') {
    if (e.target.checked && draft.rubros.some(r => !r.nombre.trim())) { e.target.checked = false; showToast('Hay rubros sin nombre.', 'error'); return; }
    draft.rubrosCerrados = e.target.checked;
    editRubro = -1;
    renderFicha();
  }
}
async function onFichaClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.cat) {
    draft.categoria = draft.categoria === b.dataset.cat ? null : b.dataset.cat;
    renderFicha();
    return;
  }
  if (b.dataset.quitarJefe != null) { draft.jefes = draft.jefes.filter(c => c !== b.dataset.quitarJefe); renderFicha(); return; }
  if (b.id === 'ob-jefe-add') { abrirJefes(); return; }
  if (b.dataset.rubEdit != null) { editRubro = +b.dataset.rubEdit; renderFicha(); return; }
  if (b.dataset.rubQuitar != null) {
    const i = +b.dataset.rubQuitar, r = draft.rubros[i];
    // Uno ya guardado puede estar en OC emitidas: se avisa qué pasa con ellas.
    if (orig.rubros.some(x => x.id === r.id)) {
      const ok = await showConfirm('Quitar rubro',
        `¿Quitar "${r.nombre}"? Las OC ya emitidas con ese rubro lo conservan, pero deja de ofrecerse en las OC nuevas.`,
        { boton: 'Quitar', tono: 'del', icono: 'trash' });
      if (!ok) return;
    }
    draft.rubros.splice(i, 1);
    if (!draft.rubros.length) draft.rubrosCerrados = false;
    editRubro = -1;
    renderFicha();
    return;
  }
  if (b.id === 'ob-rub-add') { agregarRubro(); return; }
  if (b.id === 'ob-toggle') { toggleActiva(); return; }
}
function onFichaFocusOut(e) {
  const t = e.target;
  if (t.id === 'ob-comida') t.value = draft.comida ? fmtMiles(draft.comida) : '';
  if (t.id === 'ob-rub-edit') {
    const r = draft.rubros[editRubro];
    if (r && !r.nombre.trim()) r.nombre = (orig.rubros.find(x => x.id === r.id) || {}).nombre || '';
    editRubro = -1;
    // Sin volver a pintar en el mismo evento: un toque en otro botón se perdería.
    setTimeout(renderFicha, 0);
  }
}

function agregarRubro() {
  const input = $('ob-rub-nuevo');
  const nombre = input.value.trim();
  if (!nombre) { input.focus(); return; }
  if (draft.rubros.some(r => r.nombre.trim().toLowerCase() === nombre.toLowerCase())) { showToast('Ese rubro ya está en la lista.', 'error'); return; }
  const slug = nombre.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').substring(0, 30);
  draft.rubros.push({ id: (slug || 'rubro') + '_' + Date.now().toString(36), nombre });
  editRubro = -1;
  renderFicha();
  $('ob-rub-nuevo').focus();
}

// ---- Elegir jefes ----
function abrirJefes() {
  const sel = new Set(draft.jefes);
  // Los Jefes de Obra activos, más los que ya estaban aunque no lo sean (para poder sacarlos).
  const lista = allUsuarios.filter(u => (u.activo && u.jefeObra) || sel.has(u.codigo));
  $('ob-jefes-ic').innerHTML = icSvg('user');
  $('ob-jlist').innerHTML = lista.length
    ? lista.map(u => {
        const otras = allObras.filter(o => o.activa && o.key !== selKey && o.jefes && o.jefes[u.codigo]).map(o => o.nombre);
        return `<label><input type="checkbox" value="${esc(u.codigo)}" ${sel.has(u.codigo) ? 'checked' : ''}>${esc(u.nombre)}${u.activo && u.jefeObra ? '' : ' (no es Jefe de Obra activo)'}${otras.length ? `<small>${esc(otras.join(', '))}</small>` : ''}</label>`;
      }).join('')
    : '<div class="ob-empty">No hay usuarios con el permiso Jefe de Obra. Se da desde Usuarios.</div>';
  $('modal-jefes').classList.remove('hidden');
}
function cerrarJefes(ok) {
  if (ok) {
    draft.jefes = [...$('ob-jlist').querySelectorAll('input:checked')].map(i => i.value).sort();
    renderFicha();
  }
  $('modal-jefes').classList.add('hidden');
}

// ---- Activar / desactivar ----
async function toggleActiva() {
  const o = allObras.find(x => x.key === selKey);
  if (!o) return;
  const ok = await showConfirm(
    o.activa ? 'Desactivar obra' : 'Activar obra',
    o.activa
      ? `¿Desactivar "${o.nombre}"? Deja de aparecer al hacer una OC, un remito o un egreso de Caja. Lo cargado queda.`
      : `¿Activar "${o.nombre}"?`,
    o.activa ? { boton: 'Desactivar', tono: 'warn', icono: 'power' } : { boton: 'Activar', tono: 'ok', icono: 'power' });
  if (!ok) return;
  try {
    await patchObra(o.key, { activa: !o.activa });
    showToast(`Obra ${o.activa ? 'desactivada' : 'activada'}.`);
    await cargar(selKey, { conservar: true });
  } catch (_) {
    showToast('Error al actualizar la obra.', 'error');
  }
}

// ---- Alta ----
let altaCat = null;

function pintarAlta() {
  $('alta-cat').innerHTML = Object.entries(CATEGORIAS).map(([k, c]) =>
    `<button type="button" class="t-${k}${altaCat === k ? ' on' : ''}" data-cat="${k}" aria-pressed="${altaCat === k}">${icSvg(c.icon)}${c.label}</button>`).join('');
  const nombre = $('alta-nombre').value.trim();
  const igual = nombre && mismoNombre(nombre);
  const par = nombre.length >= 3 ? parecidas(nombre) : [];
  $('alta-parecidas').innerHTML = igual
    ? `<div class="ob-aviso red">${icSvg('alert')}<span>Ya hay una obra que se llama "${esc(igual.nombre)}"${igual.activa ? '' : ' (inactiva: se puede volver a activar)'}.</span></div>`
    : par.length
      ? `<div class="ob-aviso">${icSvg('alert')}<span>Ya hay obras con un nombre parecido. ¿No es una de estas?</span></div><div class="ob-dupe">${par.slice(0, 6).map(o => `<span>${esc(o.nombre)}${o.activa ? '' : ' (inactiva)'}</span>`).join('')}</div>`
      : '';
}

async function openAddModal() {
  if (hayCambios() && !(await descartar())) return;
  if (orig) deshacer();
  altaCat = null;
  $('modal-obra-error').classList.add('hidden');
  $('alta-nombre').value = '';
  $('alta-lugar').value = '';
  $('ob-alta-ic').innerHTML = icSvg('plus');
  $('modal-obra-save').innerHTML = icSvg('checkSm') + 'Crear y abrir ficha';
  pintarAlta();
  $('modal-obra').classList.remove('hidden');
  setTimeout(() => $('alta-nombre').focus(), 50);
}

async function saveAlta() {
  const nombre = $('alta-nombre').value.trim();
  const err = msg => { $('modal-obra-error').textContent = msg; $('modal-obra-error').classList.remove('hidden'); };
  if (!nombre) return err('Falta el nombre.');
  if (mismoNombre(nombre)) return err('Ya hay una obra con ese nombre.');
  const key = nombre.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40) + '_' + Date.now();
  const btn = $('modal-obra-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await saveObra(key, {
      nombre, lugar_entrega: $('alta-lugar').value.trim(), categoria: altaCat, activa: true, creadaEn: Date.now(),
      constantes: { jornadaHoras: 8, valorComida: 0 }
    });
    $('modal-obra').classList.add('hidden');
    showToast('Obra creada.');
    filtro = 'todas';
    $('ob-q').value = '';
    orig = null;
    await cargar(key);
  } catch (_) {
    err('Error al guardar. Intentá de nuevo.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = icSvg('checkSm') + 'Crear y abrir ficha';
  }
}

// ---- Carga ----
// `abrir`: clave cuya ficha queda abierta. `conservar`: mantiene lo que se
// estaba editando (activar o desactivar no toca el borrador).
async function cargar(abrir, { conservar = false } = {}) {
  try {
    const [obras, us] = await Promise.all([getAllObras(), getAllUsuarios().catch(() => allUsuarios)]);
    allObras = obras;
    allUsuarios = us;
  } catch (_) {
    $('obras-list').innerHTML = '<div class="ob-rows"><div class="ob-empty">Error al cargar las obras.</div></div>';
    return;
  }
  const o = allObras.find(x => x.key === abrir);
  selKey = o ? abrir : null;
  if (o && !(conservar && draft)) {
    orig = estadoDe(o);
    draft = JSON.parse(JSON.stringify(orig));
    editRubro = -1;
  } else if (!o) { orig = draft = null; }
  renderTodo();
  renderFicha();
  if (o && !document.body.classList.contains('ob-open') && !MQ_ANCHA.matches && abrir) mostrarFicha(true, true);
}

document.addEventListener('DOMContentLoaded', () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name || code !== '0000') { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);
  $('hdr-name').textContent = name;

  $('btn-back').addEventListener('click', () => {
    if (!MQ_ANCHA.matches && document.body.classList.contains('ob-open')) { history.back(); return; }
    window.location.href = 'administracion.html';
  });
  // Atrás en el teléfono: de la ficha a la lista (preguntando si hay cambios).
  window.addEventListener('popstate', async () => {
    const k = new URLSearchParams(location.search).get('o');
    if (k) { abrirFicha(k, { push: false }); return; }
    if (hayCambios()) {
      if (!(await descartar())) { history.pushState({ o: selKey }, '', '?o=' + encodeURIComponent(selKey)); return; }
      deshacer();
    }
    mostrarFicha(false);
    if (!MQ_ANCHA.matches) { selKey = null; orig = draft = null; renderLista(); renderFicha(); }
  });
  window.addEventListener('beforeunload', e => { if (hayCambios()) { e.preventDefault(); e.returnValue = ''; } });

  $('obras-list').addEventListener('click', e => {
    const r = e.target.closest('.ob-row');
    if (r) abrirFicha(r.dataset.key);
  });
  const elegirFiltro = f => { filtro = f; renderFiltros(); renderLista(); };
  $('ob-flt').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) elegirFiltro(b.dataset.f); });
  $('ob-rev').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    elegirFiltro(b.dataset.f);
    $('ob-flt').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('ob-sinmov').addEventListener('click', () => elegirFiltro('sinmov'));
  $('ob-q').addEventListener('input', renderLista);

  const ficha = $('ob-ficha');
  ficha.addEventListener('input', onFichaInput);
  ficha.addEventListener('change', onFichaChange);
  ficha.addEventListener('click', onFichaClick);
  ficha.addEventListener('focusout', onFichaFocusOut);
  ficha.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'ob-rub-nuevo') { e.preventDefault(); agregarRubro(); }
    else if (['ob-nom', 'ob-lugar', 'ob-jornada', 'ob-comida', 'ob-rub-edit'].includes(e.target.id)) { e.preventDefault(); e.target.blur(); }
  });

  $('ob-undo').addEventListener('click', deshacer);
  $('ob-save').innerHTML = icSvg('checkSm') + 'Guardar';
  $('ob-save').addEventListener('click', guardarFicha);

  $('btn-add-obra').addEventListener('click', openAddModal);
  $('modal-obra-cancel').addEventListener('click', () => $('modal-obra').classList.add('hidden'));
  $('modal-obra-save').addEventListener('click', saveAlta);
  $('alta-nombre').addEventListener('input', pintarAlta);
  $('alta-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveAlta(); });
  $('alta-cat').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (b) { altaCat = altaCat === b.dataset.cat ? null : b.dataset.cat; pintarAlta(); }
  });
  $('ob-jefes-cancel').addEventListener('click', () => cerrarJefes(false));
  $('ob-jefes-ok').addEventListener('click', () => cerrarJefes(true));

  const inicial = new URLSearchParams(location.search).get('o');
  if (inicial) history.replaceState(null, '', location.pathname);
  // La lista sale enseguida; el uso (OC, remitos, Caja) llega después y la completa.
  cargar(inicial).then(() => cargarUso()).then(ok => {
    if (!ok) return;
    renderTodo();
    // La ficha abierta se repinta sólo si no se está escribiendo en ella.
    if (selKey && !$('ob-ficha').contains(document.activeElement)) renderFicha();
    else if (selKey) {
      const o = allObras.find(x => x.key === selKey), c = $('ob-uso-card');
      if (o && c) c.outerHTML = usoHtml(o);
      if ($('ob-nom-aviso')) $('ob-nom-aviso').innerHTML = avisoNombreHtml();
    }
  });
});
