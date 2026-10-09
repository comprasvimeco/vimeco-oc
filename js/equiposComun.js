/* VIMECO S.A. — Equipos: piezas compartidas por la lista (equipos.js) y la ficha (equipo.js)

   Familias, pastilla de ubicación, fotos a demanda y "Compras del equipo"
   (lo comprado con OC para el equipo, con el mismo criterio que Reportes). */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Clave de Firebase derivada del código (sin caracteres inválidos).
function equipoKey(codigo) {
  return String(codigo).trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ---- Familias ----
// Salen del prefijo del código (C 172 → Camiones, MTXF 382 → Bobcat…). El equipo
// puede guardar `familia` para corregirla; si no la tiene, vale la del prefijo.
const FAMILIAS = [
  { k: 'cam',  n: 'Camiones y bateas',             i: 'truck',  pre: ['C', 'CB', 'VQ'] },
  { k: 'acop', n: 'Acoplados y semirremolques',    i: 'truck',  pre: ['AC', 'AT', 'S', 'SC'] },
  { k: 'pick', n: 'Pick ups y autos',              i: 'truck',  pre: ['P', 'PA', 'PU'] },
  { k: 'vial', n: 'Viales y movimiento de suelo',  i: 'road',   pre: ['MN', 'RE', 'REC', 'TX', 'TXM', 'TO', 'TA', 'PH', 'BS', 'DA', 'TR', 'RD'] },
  { k: 'comp', n: 'Compactadores',                 i: 'layers', pre: ['RLV', 'RNA', 'RNV', 'RPC', 'CVA', 'CPT', 'MC', 'MPC'] },
  { k: 'bob',  n: 'Bobcat y accesorios',           i: 'tool',   pre: ['MCASE', 'RPP'] },   // + todo lo que empieza con MTX
  { k: 'plan', n: 'Plantas',                       i: 'settings', pre: ['PTA', 'PC', 'PT', 'PTC'] },
  { k: 'men',  n: 'Grupos, bombas y herramientas', i: 'zap',    pre: ['GE', 'MB', 'MG', 'MS', 'D', 'CJ', 'LAB'] },
  { k: 'otro', n: 'Otros',                         i: 'box',    pre: [] },
];
const FAM_BY_KEY = Object.fromEntries(FAMILIAS.map(f => [f.k, f]));

function familiaPorCodigo(codigo) {
  const pre = (String(codigo || '').trim().toUpperCase().match(/^[A-Z]+/) || [''])[0];
  if (pre.startsWith('MTX')) return FAM_BY_KEY.bob;
  return FAMILIAS.find(f => f.pre.includes(pre)) || FAM_BY_KEY.otro;
}

function familiaDe(e) {
  return FAM_BY_KEY[e && e.familia] || familiaPorCodigo(e && e.codigo);
}

// ---- Ubicación ----
// Pastilla: teal si está en una obra, azul si está en el Taller, gris si no tiene.
function esTaller(nombre) { return /^taller\b/i.test(String(nombre || '').trim()); }

function ubicPill(e, obrasMap, opts = {}) {
  if (e.activo === false && !opts.sinEstado) return '<span class="eq-ub eq-ub--off">Inactivo</span>';
  if (!e.ubicacion) return `<span class="eq-ub eq-ub--none">Sin ubicación</span>`;
  const nombre = obrasMap[e.ubicacion] || 'Obra dada de baja';
  const taller = esTaller(nombre);
  return `<span class="eq-ub ${taller ? 'eq-ub--taller' : 'eq-ub--obra'}" title="${esc(nombre)}">${icSvg(taller ? 'tool' : 'pin')}<span>${esc(nombre)}</span></span>`;
}

// ---- Fotos a demanda ----
const _fotos = new Map();   // key → Promise<dataURL|null>
function fotoDe(key) {
  if (!_fotos.has(key)) {
    const p = getEquipoFoto(key).catch(() => null);
    _fotos.set(key, p);
  }
  return _fotos.get(key);
}

// ---- Compras del equipo ----
// Mismo alcance que Reportes: OC firmes (sin pendientes, rechazadas, canceladas ni
// anuladas), desde que existe el respaldo en Drive y sin las de prueba.
let _ocsEq = null;
function ocsConEquipo() {
  if (_ocsEq) return _ocsEq;
  _ocsEq = (async () => {
    const resp = await fetch(FIREBASE_CONFIG.databaseURL + '/historial.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const todas = Object.values((await resp.json()) || {}).filter(oc => oc && oc.nroOC);
    const corte = driveCutoff(todas);
    return todas.filter(oc => oc.equipo?.codigo && (oc.timestamp || 0) >= corte &&
      esCompraFirme(oc) && !esObraPrueba(oc) && !esProveedorPrueba(oc));
  })();
  _ocsEq.catch(() => { _ocsEq = null; });
  return _ocsEq;
}

// En pesos: las OC en dólares se pasan con la cotización oficial guardada en la
// propia OC. Sin cotización no se puede sumar: se cuenta aparte.
function montoARS(oc) {
  const total = Number(oc.total) || 0;
  if (oc.moneda !== 'USD') return total;
  const r = oc.cotizacion?.oficial;
  const rate = r && (r.venta || r.compra);
  return rate ? total * rate : null;
}

const COMPRAS_PERIODOS = [['12m', 'Últimos 12 meses'], ['todo', 'Todo']];

function resumenCompras(ocs, codigo, periodo) {
  const desde = periodo === '12m' ? Date.now() - 365 * 864e5 : 0;
  const lista = ocs
    .filter(oc => oc.equipo.codigo === codigo && (oc.timestamp || 0) >= desde)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const r = { total: 0, rep: 0, man: 0, sinCot: 0, lista };
  lista.forEach(oc => {
    const m = montoARS(oc);
    if (m == null) { r.sinCot++; return; }
    r.total += m;
    if (oc.equipo.categoria === 'Repuestos') r.rep += m;
    else if (oc.equipo.categoria === 'Mantenimiento') r.man += m;
  });
  return r;
}

const fmtPesos = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');

// Contenido de la tarjeta (sin el encabezado). `max` = cuántas OC listar.
function comprasHTML(r, { max = 3, linkReportes = '' } = {}) {
  if (!r.lista.length) return '<div class="eq-vacio">No hay compras con OC para este equipo en el período.</div>';
  const cat = c => c === 'Repuestos' ? '<span class="eq-cat eq-cat--rep">Rep.</span>'
    : c === 'Mantenimiento' ? '<span class="eq-cat eq-cat--man">Mant.</span>' : '';
  const filas = r.lista.slice(0, max).map(oc => {
    const m = montoARS(oc);
    return `<div><span class="n">${esc(oc.nroOC)}</span>
      <span class="p" title="${esc(oc.proveedor?.nombre || '')}">${esc(oc.proveedor?.nombre || '—')}</span>${cat(oc.equipo.categoria)}
      <span class="m">${m == null ? 'US$ ' + Math.round(Number(oc.total) || 0).toLocaleString('es-AR') : fmtPesos(m)}</span></div>`;
  }).join('');
  const resto = r.lista.length - max;
  return `<div class="eq-gasto">
      <div><span>Total · ${r.lista.length} OC</span><b>${fmtPesos(r.total)}</b></div>
      <div><span>Repuestos</span><b>${fmtPesos(r.rep)}</b></div>
      <div><span>Mantenimiento</span><b>${fmtPesos(r.man)}</b></div>
    </div>
    ${r.sinCot ? `<div class="eq-nota">${r.sinCot} OC en dólares sin cotización no están sumadas.</div>` : ''}
    <div class="eq-ocl">${filas}</div>
    ${linkReportes ? `<a class="eq-more" href="${linkReportes}">${resto > 0 ? `Ver las ${r.lista.length} en Reportes` : 'Ver en Reportes'} ›</a>`
      : resto > 0 ? `<div class="eq-nota" style="text-align:center">y ${resto} OC más</div>` : ''}`;
}

// Desplegable-pastilla del período de compras (piezas .act-dd de styles.css).
function periodoDdHTML(id, periodo) {
  const label = (COMPRAS_PERIODOS.find(p => p[0] === periodo) || COMPRAS_PERIODOS[0])[1];
  return `<div class="act-dd">
      <button type="button" class="act-pick" data-dd="${id}" aria-haspopup="listbox" aria-expanded="false">${esc(label)}${icSvg('chevron', 'act-chev')}</button>
      <div class="act-menu act-menu--right hidden" role="listbox">${COMPRAS_PERIODOS.map(([k, l]) =>
        `<button type="button" class="act-opt" role="option" data-periodo="${k}" aria-selected="${k === periodo}">${esc(l)}</button>`).join('')}</div>
    </div>`;
}

// Abre/cierra los desplegables .act-dd que usan [data-dd]; elegir una opción
// llama a onPick(opt). Un solo listener por página.
function bindDesplegables(onPick) {
  const cerrar = () => document.querySelectorAll('.act-dd .act-menu').forEach(m => {
    m.classList.add('hidden');
    const b = m.parentElement.querySelector('.act-pick');
    if (b) b.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', ev => {
    const pick = ev.target.closest('.act-dd .act-pick');
    if (pick) {
      const menu = pick.parentElement.querySelector('.act-menu');
      const abrir = menu.classList.contains('hidden');
      cerrar();
      if (abrir) { menu.classList.remove('hidden'); pick.setAttribute('aria-expanded', 'true'); }
      return;
    }
    const opt = ev.target.closest('.act-dd .act-opt');
    if (opt) { cerrar(); onPick(opt, opt.closest('.act-dd').querySelector('.act-pick').dataset.dd); return; }
    if (!ev.target.closest('.act-dd')) cerrar();
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrar(); });
}

// Reportes con el filtro del equipo puesto (sólo para quien puede ver Reportes).
function linkReportesEquipo(codigo) {
  return 'reportes.html?equipo=' + encodeURIComponent(codigo);
}

async function puedeVerReportes(code) {
  if (code === '0000') return true;
  try { const u = await getUsuario(code); return !!(u && (u.admin || u.reportes)); } catch (_) { return false; }
}
