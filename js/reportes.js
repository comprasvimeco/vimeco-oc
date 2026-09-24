/* ===================================================
   VIMECO S.A. — Panel de Reportes
   reportes.js

   Lee /historial completo (solo admin) y muestra el gasto por obra,
   equipo, proveedor, responsable y mes. Reexpresa cada OC en ARS o USD
   usando la cotización guardada en la propia OC (cotizacion), con
   fallback al dólar del día para OC históricas sin snapshot.

   Alcance: sólo las OC emitidas a partir de que existió el respaldo en
   Drive (ver driveCutoff). Las primeras iteraciones, con datos sucios y
   sin respaldo, quedan fuera del reporte.

   Al tocar una OC se abre su ficha completa: ítems, impuestos, totales,
   con acceso al PDF y a su carpeta de Drive.
   =================================================== */

let ALL     = [];   // OC dentro del alcance del reporte
let ALL_RAW = [];   // todo lo que devolvió /historial (para calcular el corte)
let cutoffTs   = 0; // desde cuándo hay respaldo en Drive

// esObraPrueba, driveFolderId, driveUrlOf, driveCutoff, histKeyOf y ocDataDe
// viven en driveBackup.js, compartidos con el panel de Novedades.

const $ = id => document.getElementById(id);

const state = {
  desde:  '',
  hasta:  '',
  moneda: 'ARS',       // moneda de visualización
  rate:   'oficial',   // 'oficial' | 'blue' — qué cotización usar para convertir
  // Resumen del período: preset activo ('semana'|'quincena'|'mes'|null) y
  // cuántos períodos hacia atrás está parado. El preset ESCRIBE desde/hasta,
  // así que todo el panel se mueve con él; tocar las fechas a mano lo apaga.
  periodo:  null,
  pOffset:  0,
  // Orden del listado del resumen (y del PDF, que sale en el mismo orden).
  resOrden: 'fecha',
  resDir:   1,          // 1 ascendente, -1 descendente
  // Buscador del listado del resumen (el mismo motor que Novedades).
  resQ:     '',
};

const expanded = new Set(); // claves de filas desplegadas (por sección+key)
const drillAll = new Set(); // desplegadas que muestran todas sus OC, no sólo las primeras
const DRILL_MAX = 8;

// ?? y no ||: con `||` un 0 legítimo (p. ej. la cantidad de un ítem) se
// renderizaría como celda vacía.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function ocByKey(key) { return ALL.find(o => histKeyOf(o) === key); }

let OBRAS_ALL = []; // nombres de obras (para el datalist de reasignación)
let PATENTES  = {}; // código de equipo → patente (desde la ficha del equipo)

// La OC guarda un snapshot del equipo (código, tipo, categoría). La patente se
// toma de ahí si está, y si no de la ficha actual: así las OC viejas —cargadas
// antes de que el equipo tuviera patente— también la muestran.
function patenteDe(eq) {
  return (eq && (eq.patente || PATENTES[eq.codigo])) || '';
}

function equipoLabel(eq) {
  if (!eq || !eq.codigo) return '';
  const pat = patenteDe(eq);
  return eq.codigo + (pat ? ` (${pat})` : '') + (eq.tipo ? ' — ' + eq.tipo : '');
}
function distinctObras() {
  const s = new Set(OBRAS_ALL);
  ALL.forEach(o => { if (o.obra) s.add(o.obra); });
  return [...s].sort((a, b) => a.localeCompare(b));
}

// Parseo tolerante de montos (acepta 2400469632, 2.400.469,63 o 2400469.63).
function parseNum(s) {
  s = String(s).trim();
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/\s/g, '');
  return parseFloat(s);
}

// Monto completo con separadores de miles.
function fmtFull(n, cur) {
  const v = (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (cur === 'USD' ? 'US$ ' : '$ ') + v;
}

function fmtDec(n, cur) {
  const v = (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (cur === 'USD' ? 'US$ ' : '$ ') + v;
}

// Monto compacto para barras: millones / miles.
function fmtCompact(n, cur) {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Number(n) || 0);
  const s = (cur === 'USD' ? 'US$ ' : '$ ') + sign;
  if (a >= 1e6) return s + (a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: a >= 1e8 ? 0 : 1 }) + ' M';
  if (a >= 1e3) return s + (a / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' mil';
  return s + a.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// ---- Conversión de moneda por OC ----
function rateFor(oc) {
  const snap = oc.cotizacion || (typeof getDolarCached === 'function' ? getDolarCached() : null);
  if (!snap) return null;
  const r = snap[state.rate];
  if (!r) return null;
  return r.venta || r.compra || null;
}

function amountIn(oc, cur) {
  const total  = Number(oc.total) || 0;
  const moneda = oc.moneda === 'USD' ? 'USD' : 'ARS';
  if (moneda === cur) return total;
  const rate = rateFor(oc);
  if (!rate) return null;
  return cur === 'ARS' ? total * rate : total / rate;
}

// ---- Filtro ----
// Sólo lo que se compró: pendientes, rechazadas y canceladas nunca entran.
function getFiltered() {
  return ALL.filter(oc => {
    if (!esFirme(oc)) return false;
    const ts = oc.timestamp || 0;
    if (state.desde && ts < new Date(state.desde + 'T00:00:00').getTime()) return false;
    if (state.hasta && ts > new Date(state.hasta + 'T23:59:59').getTime()) return false;
    return true;
  });
}

// ---- Agrupación (con detalle de OC para drill-down) ----
function groupAgg(list, keyFn, labelFn) {
  const map = new Map();
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) return;
    const k = keyFn(oc);
    const row = map.get(k) || { key: k, label: labelFn(oc), total: 0, count: 0, ocs: [] };
    row.total += amt;
    row.count += 1;
    row.ocs.push({ oc, amt });
    map.set(k, row);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ---- Identidad del proveedor ----
// El CUIT es la identidad real; `proveedor.nombre` es un snapshot de texto libre
// que varía entre OC del mismo proveedor ("MARCU SA" vs "MARCU S.A", "SOPPE
// INGENIERIA S.R.L." vs "...S.R.L"). Agrupar por nombre partía un proveedor en
// varias filas del ranking (SOPPE salía #5 y #7 en vez de #2) aunque todas esas
// OC ya traían el mismo CUIT. Gemelo de normalizeProvName() en app.js.
function normProvName(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(s\.a\.s\.|s\.r\.l\.|s\.a\.|s\.a\.s|s\.r\.l|s\.a|sas|srl|sa)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Un CUIT de menos de 10 dígitos no es un CUIT: el OCR a veces mete el código
// interno del proveedor en ese campo (una OC de GER-VIAL guardó "00003658").
function cuitDigits(oc) {
  const d = String(oc.proveedor?.cuit || '').replace(/\D/g, '');
  return d.length >= 10 ? d : '';
}

let _provUnion = new Map();   // átomo → átomo padre (conjuntos de proveedor)
let _provCanon = new Map();   // clave → { name, score }

// El CUIT solo no alcanza como identidad: se tipea a mano (o lo saca la IA de
// un presupuesto) y un dígito de más parte al proveedor en dos. Pasó con
// INDUTERM INGENIERIA S.R.L., que salía dos veces en el ranking —#6 y #7, una OC
// cada una— y cuyas dos órdenes del mismo día por el mismo importe no se
// detectaban como duplicadas porque el detector agrupa por proveedor.
//
// Así que la identidad se arma con las DOS señales, CUIT y nombre normalizado,
// y es transitiva: dos OC son del mismo proveedor si comparten cualquiera de
// las dos. Eso une "mismo nombre, CUIT mal tipeado" (el caso de arriba) y
// "mismo CUIT, nombre escrito distinto" (el que ya resolvía el CUIT).
//
// El precio: dos proveedores realmente distintos que compartan nombre
// normalizado quedan en un solo grupo aunque tengan CUIT distinto. Con nombres
// de empresa completos es mucho menos probable que el error de tipeo inverso.
function _provFind(atom, crear) {
  if (!_provUnion.has(atom)) {
    if (!crear) return atom;          // fuera del índice: vale por sí mismo
    _provUnion.set(atom, atom);
  }
  let raiz = atom;
  while (_provUnion.get(raiz) !== raiz) raiz = _provUnion.get(raiz);
  // Compresión de camino: las próximas búsquedas son directas.
  let k = atom;
  while (_provUnion.get(k) !== raiz) { const sig = _provUnion.get(k); _provUnion.set(k, raiz); k = sig; }
  return raiz;
}

// Átomos de una OC: su CUIT (si es válido) y su nombre normalizado.
function _provAtoms(oc) {
  const d = cuitDigits(oc);
  const n = normProvName(oc.proveedor?.nombre);
  return { cuit: d ? 'c' + d : null, nombre: n ? 'n' + n : null };
}

// Se reconstruye en cada render(): provKey() depende de estos índices.
function buildProvIndex(list) {
  _provUnion = new Map();
  list.forEach(oc => {
    const { cuit, nombre } = _provAtoms(oc);
    if (!cuit && !nombre) return;
    const a = _provFind(cuit || nombre, true);
    const b = _provFind(nombre || cuit, true);
    // La raíz del CUIT gana cuando hay uno: es la clave más estable.
    if (a !== b) _provUnion.set(b, a);
  });

  // Nombre a mostrar: gana el de la base maestra (el que trae codigoInterno);
  // si ninguna OC del grupo pasó por la base, la más reciente.
  _provCanon = new Map();
  list.forEach(oc => {
    const k     = provKey(oc);
    const score = (oc.proveedor?.codigoInterno ? 1e15 : 0) + (oc.timestamp || 0);
    const cur   = _provCanon.get(k);
    if (!cur || score > cur.score) _provCanon.set(k, { name: oc.proveedor?.nombre || 'Sin proveedor', score });
  });
}

function provKey(oc) {
  const { cuit, nombre } = _provAtoms(oc);
  if (!cuit && !nombre) return '—';
  return _provFind(cuit || nombre, false);
}

function provLabel(oc) {
  return _provCanon.get(provKey(oc))?.name || oc.proveedor?.nombre || 'Sin proveedor';
}

function monthKey(ts) {
  const d = new Date(ts || 0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabel(k) {
  const [y, m] = k.split('-');
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${meses[Number(m) - 1] || m} ${y}`;
}
// Semana calendario, identificada por su lunes.
function weekKey(ts) {
  const d = new Date(ts || 0);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // 0 = lunes
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function weekShort(k) {
  const p = k.split('-');
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return Number(p[2]) + ' ' + (meses[Number(p[1]) - 1] || p[1]);
}
function weekLabel(k) {
  const p = k.split('-');
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return 'Semana del ' + Number(p[2]) + ' de ' + (meses[Number(p[1]) - 1] || p[1]) + ' de ' + p[0];
}

const DIAS_SEM = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
function dayShort(k) {
  const p = k.split('-');
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return Number(p[2]) + ' ' + (meses[Number(p[1]) - 1] || p[1]);
}
function dayLabel(k) {
  const d = new Date(k + 'T00:00:00');
  const l = DIAS_SEM[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES_LG[d.getMonth()] + ' de ' + d.getFullYear();
  return l.charAt(0).toUpperCase() + l.slice(1);
}

const bucketShort = (k, unit) => unit === 'dia' ? dayShort(k) : unit === 'semana' ? weekShort(k) : monthShort(k);
const bucketLabel = (k, unit) => unit === 'dia' ? dayLabel(k) : unit === 'semana' ? weekLabel(k) : monthLabel(k);
const bucketKey   = (ts, unit) => unit === 'dia' ? isoDe(new Date(ts)) : unit === 'semana' ? weekKey(ts) : monthKey(ts);

// Todos los baldes (día, semana o mes) entre dos fechas, en orden.
function bucketsEntre(ini, fin, unit) {
  const keys = [];
  const d = new Date(ini); d.setHours(0, 0, 0, 0);
  if (unit === 'semana') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (unit === 'mes')    d.setDate(1);
  while (d <= fin) {
    keys.push(bucketKey(d.getTime(), unit));
    if (unit === 'dia')         d.setDate(d.getDate() + 1);
    else if (unit === 'semana') d.setDate(d.getDate() + 7);
    else                        d.setMonth(d.getMonth() + 1);
  }
  return keys;
}

// Granularidad de la evolución según el período elegido: semana y quincena
// van por día, el mes por semana; "Todo" o fechas a mano, según el largo.
// El eje cubre el rango entero (hasta hoy) con los baldes sin compras en
// cero, así el gráfico no queda vacío aunque haya pocas OC. Si la unidad
// elegida da un solo balde (primeros días del mes), baja a días.
function timeSeries(list) {
  const r   = rangoActual();
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ts  = list.map(o => o.timestamp || 0).filter(Boolean);

  const ini = r.desde ? new Date(r.desde + 'T00:00:00') : (ts.length ? new Date(Math.min(...ts)) : null);
  let   fin = r.hasta ? new Date(r.hasta + 'T00:00:00') : hoy;
  if (fin > hoy) fin = hoy;
  if (!ini || ini > fin) return { rows: [], unit: 'dia' };

  const dias = Math.round((fin - ini) / 86400000) + 1;
  let unit = state.periodo === 'semana' || state.periodo === 'quincena' ? 'dia'
           : state.periodo === 'mes' ? 'semana'
           : dias <= 31 ? 'dia' : dias <= 180 ? 'semana' : 'mes';
  let keys = bucketsEntre(ini, fin, unit);
  if (keys.length < 2 && unit !== 'dia') { unit = 'dia'; keys = bucketsEntre(ini, fin, unit); }

  const byKey = new Map(groupAgg(list, oc => bucketKey(oc.timestamp, unit), () => '').map(g => [g.key, g]));
  const rows = keys.map(k => byKey.get(k) || { key: k, label: '', total: 0, count: 0, ocs: [] });
  return { rows, unit };
}

function monthShort(k) {
  const [y, m] = k.split('-');
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${meses[Number(m) - 1] || m} ${String(y).slice(2)}`;
}

function estadoChip(oc) {
  const e = oc.estado || 'emitida';
  const map = {
    emitida:    ['Emitida',    '#e8eef5', '#2b537d'],
    autorizada: ['Autorizada', '#e3f5e8', '#1e7d3a'],
    pendiente:  ['Pendiente',  '#fff4e0', '#9a6a00'],
    rechazada:  ['Rechazada',  '#fde6e6', '#b02a2a'],
    cancelada:  ['Cancelada',  '#eceef1', '#5b6573'],
  };
  const [txt, bg, fg] = map[e] || map.emitida;
  return `<span class="rep-chip" style="background:${bg};color:${fg}">${txt}</span>`;
}

// Chip de categoría de la compra de un equipo (Repuestos / Mantenimiento).
function catChip(cat) {
  if (!cat) return '';
  const map = {
    'Repuestos':     ['#e8eef5', '#2b537d'],
    'Mantenimiento': ['#f3ecfb', '#5b3a9c'],
  };
  const [bg, fg] = map[cat] || ['#eceff3', '#5b6472'];
  return `<span class="rep-chip" style="background:${bg};color:${fg}">${esc(cat)}</span>`;
}

// ===================================================
//  Gráficos
// ===================================================

// ---- Paleta "burbuja" ----
// Misma estética que las pastillas Sí/No de factura del resumen: fondo pastel
// con el texto en el mismo tono, oscuro. Cada tono trae tres pasos:
//   mark → relleno de barras y segmentos
//   bg   → fondo de la burbuja (rango, %)
//   ink  → texto sobre la burbuja
// Los mark están validados con scripts/validate_palette.js de la guía de
// dataviz (peor par vecino ΔE 12.3 bajo deuteranopia). Quedan debajo de 3:1
// sobre blanco; lo compensan la leyenda rotulada y el % escrito en cada segmento.
const HUES = {
  azul:     { mark: '#4f7fe0', bg: '#e8eefc', ink: '#2c4fa8' },
  ambar:    { mark: '#e39d38', bg: '#fdf0dc', ink: '#8a5a0b' },
  turquesa: { mark: '#2aa89a', bg: '#dcf3ef', ink: '#16695f' },
  lavanda:  { mark: '#9a84ea', bg: '#efebfd', ink: '#5a45a8' },
  rosa:     { mark: '#e0708c', bg: '#fce8ee', ink: '#a23a57' },
  gris:     { mark: '#b8c0cc', bg: '#eef0f3', ink: '#4b5563' },
};
// Orden fijo de la participación (el color sigue a la obra, no al puesto).
// Turquesa y rosa no van pegados: bajo deuteranopia se confunden.
const SHARE_HUES = [HUES.azul, HUES.ambar, HUES.turquesa, HUES.lavanda, HUES.rosa];
const hueVars = h => `--h-mark:${h.mark};--h-bg:${h.bg};--h-ink:${h.ink}`;
const pctTxt  = v => v.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';

// Color de cada obra en la participación, para que "Gasto por Obra" la pinte
// igual. Lo arma renderShare, que corre antes.
let obraHue = new Map();
// "Otras N obras" desplegado (se recuerda mientras se navega el reporte).
let shareOtrasOpen = false;

// ---- Barra de participación (part-to-whole, top 5 + Otras) ----
function renderShare(containerId, rows, grand) {
  const el = $(containerId);
  if (!rows.length || grand <= 0) {
    el.innerHTML = '<div class="rep-empty">Sin datos en el rango seleccionado.</div>';
    return;
  }
  const top   = rows.slice(0, 5);
  const resto = rows.slice(5);
  obraHue = new Map(top.map((r, i) => [r.key, SHARE_HUES[i]]));
  const segs  = top.map((r, i) => ({ label: r.label, total: r.total, hue: SHARE_HUES[i] }));
  if (resto.length) {
    segs.push({
      label: `Otras ${resto.length} obra${resto.length !== 1 ? 's' : ''}`,
      total: resto.reduce((a, r) => a + r.total, 0),
      hue: HUES.gris
    });
  }

  const pct = t => (t / grand) * 100;
  // El % va en una burbuja dentro del segmento sólo si entra (≥ 8%); si no,
  // lo dice la leyenda.
  el.innerHTML = `
    <div class="rep-share-track">
      ${segs.map(s => `
        <div class="rep-share-seg" style="flex:${s.total};${hueVars(s.hue)}"
             title="${esc(s.label)} — ${esc(fmtFull(s.total, state.moneda))} (${pctTxt(pct(s.total))})">${
          pct(s.total) >= 8 ? `<span class="rep-share-pill">${Math.round(pct(s.total))}%</span>` : ''}</div>
      `).join('')}
    </div>
    <div class="rep-share-legend">
      ${segs.map((s, i) => {
        const otras = resto.length && i === segs.length - 1;
        return `
        <${otras ? 'button type="button"' : 'div'} class="rep-share-item${otras ? ' rep-share-otras' : ''}${otras && shareOtrasOpen ? ' open' : ''}"
             style="${hueVars(s.hue)}"${otras ? ` aria-expanded="${shareOtrasOpen}" title="Ver las obras agrupadas"` : ''}>
          <span class="rep-share-dot"></span>
          <span class="rep-share-lbl" title="${esc(s.label)}">${esc(s.label)}</span>
          ${otras ? `<span class="rep-share-chev">${icSvg('chevR')}</span>` : ''}
          <span class="rep-share-val">${esc(fmtCompact(s.total, state.moneda))}</span>
          <span class="rep-share-pct">${pctTxt(pct(s.total))}</span>
        </${otras ? 'button' : 'div'}>`;
      }).join('')}
    </div>
    ${resto.length && shareOtrasOpen ? `
    <div class="rep-share-rest">
      ${resto.map(r => `
        <div class="rep-share-rest-i">
          <span class="rep-share-lbl" title="${esc(r.label)}">${esc(r.label)}</span>
          <span class="rep-share-val">${esc(fmtCompact(r.total, state.moneda))}</span>
          <span class="rep-share-rest-p">${pctTxt(pct(r.total))}</span>
        </div>`).join('')}
    </div>` : ''}`;

  const btn = el.querySelector('.rep-share-otras');
  if (btn) btn.addEventListener('click', () => {
    shareOtrasOpen = !shareOtrasOpen;
    renderShare(containerId, rows, grand);
  });
}

// ---- Evolución mensual (área + línea, una sola serie) ----
// Se dibuja al ancho real del contenedor para que los trazos no se deformen.
let lineData = { rows: [], unit: 'mes' };

function renderLine(containerId, serie) {
  const el = $(containerId);
  lineData = serie;
  const { rows, unit } = serie;

  $('rep-linea-title').textContent = unit === 'dia' ? 'Evolución diaria'
    : unit === 'semana' ? 'Evolución semanal' : 'Evolución mensual';

  if (!rows.length) {
    el.innerHTML = '<div class="rep-empty">Sin movimientos en el rango seleccionado.</div>';
    return;
  }

  const W = Math.max(el.clientWidth || 640, 320);
  const H = 240;
  const pad = { t: 16, r: 16, b: 30, l: 58 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const max  = Math.max(...rows.map(r => r.total));
  const top  = niceMax(max);
  const x = i => pad.l + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const y = v => pad.t + ih - (top ? (v / top) * ih : 0);

  const pts  = rows.map((r, i) => [x(i), y(r.total)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${(pad.t + ih).toFixed(1)} L${pts[0][0].toFixed(1)},${(pad.t + ih).toFixed(1)} Z`;

  // Ejes: hairlines sólidos, un tono por encima de la superficie.
  const ticks = [0, .25, .5, .75, 1].map(f => top * f);
  const grid = ticks.map(v => `
    <line class="rep-grid" x1="${pad.l}" y1="${y(v).toFixed(1)}" x2="${(pad.l + iw).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
    <text class="rep-axis" x="${pad.l - 8}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtCompact(v, state.moneda))}</text>
  `).join('');

  // Etiquetas de mes: se ralean si no entran.
  const step = Math.ceil(rows.length / Math.max(2, Math.floor(iw / 54)));
  const xlab = rows.map((r, i) =>
    (i % step === 0 || i === rows.length - 1)
      ? `<text class="rep-axis" x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(bucketShort(r.key, unit))}</text>`
      : '').join('');

  // Sólo se rotula el último punto: el resto lo cuenta el eje y el hover.
  const last = rows.length - 1;

  el.innerHTML = `
    <svg class="rep-line-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
         aria-label="Evolución del gasto">
      <defs>
        <linearGradient id="repAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#2557a7" stop-opacity=".34"/>
          <stop offset="55%"  stop-color="#2557a7" stop-opacity=".12"/>
          <stop offset="100%" stop-color="#2557a7" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      ${xlab}
      <path class="rep-area" d="${area}" fill="url(#repAreaGrad)"/>
      <path class="rep-line" d="${line}"/>
      ${pts.map((p, i) => `<circle class="rep-dot ${i === last ? 'rep-dot-last' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === last ? 4.5 : 3}" data-i="${i}"/>`).join('')}
      <line class="rep-cross hidden" id="rep-cross" y1="${pad.t}" y2="${pad.t + ih}"/>
      <rect id="rep-hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg>
    <div class="rep-tip hidden" id="rep-tip"></div>`;

  wireLineHover(el, rows, x, y, unit);
}

// Techo "redondo" para el eje (1 / 2 / 5 × potencia de 10).
function niceMax(v) {
  if (v <= 0) return 1;
  const exp  = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / exp;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * exp;
}

function wireLineHover(el, rows, x, y, unit) {
  const svg   = el.querySelector('.rep-line-svg');
  const hit   = el.querySelector('#rep-hit');
  const cross = el.querySelector('#rep-cross');
  const tip   = el.querySelector('#rep-tip');
  if (!hit) return;

  const nearest = clientX => {
    const box = svg.getBoundingClientRect();
    const px  = (clientX - box.left) * (svg.viewBox.baseVal.width / box.width);
    let best = 0, bd = Infinity;
    rows.forEach((_, i) => { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  const show = clientX => {
    const i = nearest(clientX);
    const r = rows[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    cross.classList.remove('hidden');
    svg.querySelectorAll('.rep-dot').forEach(d =>
      d.classList.toggle('rep-dot-on', Number(d.dataset.i) === i));

    tip.innerHTML = `<strong>${esc(bucketLabel(r.key, unit))}</strong>
      <span>${esc(fmtFull(r.total, state.moneda))}</span>
      <span class="rep-tip-sub">${r.count} OC</span>`;
    tip.classList.remove('hidden');

    // Posición relativa al contenedor, sin desbordarlo.
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    let left = x(i) * scale;
    const tw = tip.offsetWidth;
    left = Math.min(Math.max(left - tw / 2, 4), box.width - tw - 4);
    tip.style.left = left + 'px';
    tip.style.top  = Math.max(y(r.total) * scale - tip.offsetHeight - 12, 4) + 'px';
  };

  const hide = () => {
    cross.classList.add('hidden');
    tip.classList.add('hidden');
    svg.querySelectorAll('.rep-dot').forEach(d => d.classList.remove('rep-dot-on'));
  };

  hit.addEventListener('mousemove', e => show(e.clientX));
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('touchstart', e => show(e.touches[0].clientX), { passive: true });
  hit.addEventListener('touchmove',  e => show(e.touches[0].clientX), { passive: true });
  hit.addEventListener('touchend', hide);
}

// ===================================================
//  Cards: plegado y buscador
// ===================================================
// Cada card de ranking se pliega desde su encabezado (mismo idioma que el
// acordeón de la OC: click en el header, clase `collapsed`, chevron que gira) y
// filtra sus filas con el buscador del encabezado. Lo que se pliega queda
// guardado por navegador: el panel arranca como lo dejaste.

const CARDS_LS = 'vimeco_rep_cards';

const cardQ = {};    // texto buscado por card
const _bars = {};    // últimas filas dibujadas por card, para refiltrar sin re-render global

// Búsqueda tolerante: sin acentos y sin mayúsculas ("MOLIENDA" encuentra "Molienda",
// "capilla" encuentra "UPC CAPILLA DEL MONTE").
function normBuscar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function cardsPlegadas() {
  try { return new Set(JSON.parse(localStorage.getItem(CARDS_LS) || '[]')); }
  catch (_) { return new Set(); }
}

function toggleCard(card) {
  const id = card.dataset.card;
  const plegada = card.classList.toggle('collapsed');
  const head = card.querySelector('.card-header');
  if (head) head.setAttribute('aria-expanded', String(!plegada));

  const set = cardsPlegadas();
  if (plegada) set.add(id); else set.delete(id);
  try { localStorage.setItem(CARDS_LS, JSON.stringify([...set])); } catch (_) {}

  // La evolución se dibuja al ancho real del contenedor: plegada mide 0, así
  // que hay que redibujarla al abrirla (mismo motivo que el listener de resize).
  if (id === 'rep-linea' && !plegada && lineData.rows.length) renderLine('rep-linea', lineData);
}

function setupCards() {
  const plegadas = cardsPlegadas();
  document.querySelectorAll('.rep-card[data-card]').forEach(card => {
    const id   = card.dataset.card;
    const head = card.querySelector('.card-header');
    if (plegadas.has(id)) {
      card.classList.add('collapsed');
      if (head) head.setAttribute('aria-expanded', 'false');
    }

    // Los controles del encabezado (buscador, "Unificar obras", flechas del
    // período) hacen lo suyo; el resto del header pliega.
    head.addEventListener('click', e => {
      if (e.target.closest('input, select, label, button, a, .seg')) return;
      toggleCard(card);
    });
    head.addEventListener('keydown', e => {
      if (e.target !== head) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(card); }
    });

    const q = card.querySelector('.rep-q');
    if (q) q.addEventListener('input', () => {
      cardQ[id] = q.value;
      const b = _bars[id];
      if (b) renderBars(id, b.rows, b.opts);   // sólo esta card, no todo el panel
    });
  });
}

// ---- Render de barras (con drill-down opcional) ----
function renderBars(containerId, rows, opts = {}) {
  const el = $(containerId);
  _bars[containerId] = { rows, opts };   // para poder refiltrar al tipear

  // El rango del ranking se conserva al filtrar: buscar un proveedor chico lo
  // muestra con su puesto real (#37) y su barra real, no como si fuera el #1.
  const busca  = cardQ[containerId] || '';
  const q      = normBuscar(busca);
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const hits   = q ? ranked.filter(r => normBuscar(r.label).includes(q)) : ranked;
  const shown  = (!q && opts.limit) ? hits.slice(0, opts.limit) : hits;

  const cnt = el.closest('.rep-card')?.querySelector('[data-count]');
  if (cnt) {
    cnt.textContent = !rows.length ? ''
      : q                                     ? `${hits.length} de ${rows.length}`
      : (opts.limit && rows.length > opts.limit) ? `top ${shown.length} de ${rows.length}`
      : String(rows.length);
  }

  if (!rows.length) {
    el.innerHTML = `<div class="rep-empty">${opts.emptyMsg || 'Sin datos en el rango seleccionado.'}</div>`;
    return;
  }
  if (!shown.length) {
    el.innerHTML = `<div class="rep-empty">Sin resultados para «${esc(busca.trim())}».</div>`;
    return;
  }

  const max   = Math.max(...ranked.map(r => r.total)) || 1;
  const grand = opts.grandTotal || max;

  el.innerHTML = shown.map(r => {
    const pct  = Math.max(2, Math.round((r.total / max) * 100));
    const share = Math.round((r.total / grand) * 100);
    const rowKey = containerId + '|' + r.key;
    const isOpen = opts.drill && expanded.has(rowKey);

    let drillHtml = '';
    if (opts.drill && isOpen) {
      const ocs   = [...r.ocs].sort((a, b) => b.amt - a.amt);
      const todas = drillAll.has(rowKey);
      const vis   = todas ? ocs : ocs.slice(0, DRILL_MAX);
      // Resumen Repuestos vs Mantenimiento del equipo (split por categoría).
      let sumHtml = '';
      if (opts.catSplit) {
        const byCat = new Map();
        r.ocs.forEach(({ oc, amt }) => {
          const c = oc.equipo?.categoria || 'Sin categoría';
          byCat.set(c, (byCat.get(c) || 0) + amt);
        });
        sumHtml = `<div class="rep-catsum">${[...byCat.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([c, v]) => `<span class="rep-catsum-i">${catChip(c) || esc(c)}<b>${esc(fmtFull(v, state.moneda))}</b></span>`)
          .join('')}</div>`;
      }
      // Una línea por OC: el dato que no repite la fila (el proveedor, o la
      // obra si ya se está mirando un proveedor) y, chico debajo, N° y fecha.
      const titulo = opts.drillTitulo || (oc => oc.proveedor?.nombre || '—');
      drillHtml = `<div class="rep-drill">${sumHtml}<div class="rep-ocs">${vis.map(({ oc, amt }) => `
        <button class="rep-oc" data-ockey="${esc(histKeyOf(oc))}" title="Ver la ficha de la OC ${esc(oc.nroOC)}">
          <span class="rep-oc-main">
            <span class="rep-oc-t">${esc(titulo(oc))}</span>
            <span class="rep-oc-s">${esc(oc.nroOC)} · ${esc(oc.fecha || '')}${
              opts.catChip && oc.equipo?.categoria ? ` · ${esc(oc.equipo.categoria)}` : ''}</span>
          </span>
          <span class="rep-oc-total">${fmtFull(amt, state.moneda)}</span>
          <span class="rep-oc-go">${icSvg('chevR')}</span>
        </button>`).join('')}</div>${ocs.length > DRILL_MAX ? `
        <button class="rep-oc-more" data-more="${esc(rowKey)}">${todas ? 'Mostrar menos' : `Ver las ${ocs.length - DRILL_MAX} restantes`}</button>` : ''}</div>`;
    }

    const hue = opts.hueFor ? opts.hueFor(r) : (opts.hue || HUES.azul);

    return `
      <div class="rep-bar-row ${opts.drill ? 'rep-clickable' : ''} ${isOpen ? 'rep-open' : ''}" data-rowkey="${esc(rowKey)}" style="${hueVars(hue)}">
        <span class="rep-bar-rank">${r.rank}</span>
        <div class="rep-bar-body">
          <div class="rep-bar-head">
            ${opts.drill ? `<span class="rep-caret">${icSvg('chevR')}</span>` : ''}
            <span class="rep-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
            <span class="rep-bar-val" title="${esc(fmtFull(r.total, state.moneda))}">${fmtCompact(r.total, state.moneda)}</span>
            <span class="rep-bar-pct" title="Del total gastado">${share || !r.total ? share : '<1'}%</span>
          </div>
          <div class="rep-bar-track">
            <div class="rep-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="rep-bar-sub">${r.count} OC</div>
          ${drillHtml}
        </div>
      </div>`;
  }).join('');

  if (opts.drill && !el._wired) {
    el._wired = true;
    el.addEventListener('click', e => {
      const ocBtn = e.target.closest('[data-ockey]');
      if (ocBtn) { e.stopPropagation(); openOCDetail(ocBtn.dataset.ockey); return; }
      const more = e.target.closest('[data-more]');
      if (more) {
        const k = more.dataset.more;
        if (drillAll.has(k)) drillAll.delete(k); else drillAll.add(k);
        render();
        return;
      }
      if (e.target.closest('.rep-drill')) return;   // clics en el panel no pliegan la fila
      const row = e.target.closest('.rep-bar-row');
      if (!row) return;
      const k = row.dataset.rowkey;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      render();
    });
  }
}

// ---- Encabezado: hero (período + total) ----
function renderHero(list) {
  let total = 0, count = 0;
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) return;
    total += amt; count++;
  });

  $('kpi-total').textContent = fmtFull(total, state.moneda);

  // Rango elegido y flechas para moverse (sólo con un preset activo).
  const r = rangoActual();
  const lbl = labelRango(r);
  $('hero-rango').textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1);
  $('rep-per-nav').classList.toggle('rh-nav-off', !state.periodo);
  $('per-next').disabled = !state.periodo || state.pOffset <= 0;

  // Contexto: cantidad de OC, el tramo real de los datos cuando se mira todo
  // el historial, y la cotización aplicada.
  let per = '';
  const ts = list.map(o => o.timestamp || 0).filter(Boolean);
  if (!r.desde && !r.hasta && ts.length) {
    const a = monthLabel(monthKey(Math.min(...ts))), b = monthLabel(monthKey(Math.max(...ts)));
    per = ` · ${a === b ? a : `${a} – ${b}`}`;
  }
  const cot = state.moneda === 'USD' ? ` · dólar ${state.rate}` : '';
  $('hero-sub').textContent = `${count} OC${per}${cot}`;

  return total;
}

// ===================================================
//  Resumen del período
// ===================================================
// La foto de la semana / quincena / mes: totales, obras y proveedores del
// período, y el listado de cada OC emitida con su estado de factura. Es lo
// mismo que se ve en pantalla y lo que sale en el PDF —los dos leen de
// resumenData()—, así que no pueden discrepar.
//
// A diferencia del resto del panel, el importe de cada fila va en la moneda
// original de la OC. Sólo los totales se convierten a la moneda elegida arriba.

const DIAS_FACTURA = 15;    // sin factura pasados estos días = a reclamar

const MESES_LG = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];

function isoDe(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dmy(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function dm(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Rango del preset `tipo` desplazado `off` períodos hacia atrás (0 = el actual).
// La semana es lunes a domingo; la quincena, 1–15 y 16–fin de mes.
function rangoPeriodo(tipo, off) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  if (tipo === 'semana') {
    const ini = new Date(hoy);
    ini.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7) - off * 7);
    const fin = new Date(ini); fin.setDate(ini.getDate() + 6);
    return { tipo, desde: isoDe(ini), hasta: isoDe(fin) };
  }

  if (tipo === 'quincena') {
    // Índice continuo de medias-mes para poder restar sin casos especiales.
    const idx = hoy.getFullYear() * 24 + hoy.getMonth() * 2 + (hoy.getDate() <= 15 ? 0 : 1) - off;
    const y   = Math.floor(idx / 24);
    const r   = idx - y * 24;
    const m   = Math.floor(r / 2);
    const q   = r % 2;
    const ini = new Date(y, m, q ? 16 : 1);
    const fin = q ? new Date(y, m + 1, 0) : new Date(y, m, 15);
    return { tipo, desde: isoDe(ini), hasta: isoDe(fin) };
  }

  const ini = new Date(hoy.getFullYear(), hoy.getMonth() - off, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() - off + 1, 0);
  return { tipo: 'mes', desde: isoDe(ini), hasta: isoDe(fin) };
}

function labelRango(r) {
  if (!r || !r.desde || !r.hasta) return 'Todo el historial';
  const [y1, m1, d1] = r.desde.split('-').map(Number);
  const [y2, m2, d2] = r.hasta.split('-').map(Number);
  if (r.tipo === 'mes')      return `${MESES_LG[m1 - 1]} de ${y1}`;
  if (r.tipo === 'quincena') return `${d1 === 1 ? '1ª' : '2ª'} quincena de ${MESES_LG[m1 - 1]} de ${y1}`;
  if (r.tipo === 'semana')   return `Semana del ${d1}/${m1} al ${d2}/${m2} de ${y2}`;
  return `${String(d1).padStart(2, '0')}/${String(m1).padStart(2, '0')}/${y1} – ${String(d2).padStart(2, '0')}/${String(m2).padStart(2, '0')}/${y2}`;
}

// El rango actual del resumen: el del preset si hay uno, y si no las fechas
// que el usuario haya puesto a mano (o todo el historial si no puso ninguna).
function rangoActual() {
  if (state.periodo) return rangoPeriodo(state.periodo, state.pOffset);
  return { tipo: null, desde: state.desde, hasta: state.hasta };
}

// Con qué se compara. Con preset, el período inmediatamente anterior; con
// fechas a mano, la ventana del mismo largo que termina el día previo.
function rangoAnterior(r) {
  if (state.periodo) return rangoPeriodo(state.periodo, state.pOffset + 1);
  if (!r.desde || !r.hasta) return null;
  const ini = new Date(r.desde + 'T00:00:00');
  const fin = new Date(r.hasta + 'T00:00:00');
  const dias = Math.round((fin - ini) / 86400000) + 1;
  const pFin = new Date(ini); pFin.setDate(ini.getDate() - 1);
  const pIni = new Date(pFin); pIni.setDate(pFin.getDate() - dias + 1);
  return { tipo: null, desde: isoDe(pIni), hasta: isoDe(pFin) };
}

function esFirme(oc) {
  const e = oc.estado || 'emitida';
  return e !== 'pendiente' && e !== 'rechazada' && e !== 'cancelada';
}

function ocsDeRango(r) {
  return ALL
    .filter(oc => {
      if (!esFirme(oc)) return false;
      const ts = oc.timestamp || 0;
      if (r.desde && ts < new Date(r.desde + 'T00:00:00').getTime()) return false;
      if (r.hasta && ts > new Date(r.hasta + 'T23:59:59').getTime()) return false;
      return true;
    })
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

// Suma en la moneda de visualización, ignorando lo que no se pueda convertir.
function sumaDe(list) {
  let total = 0, noConv = 0;
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) { noConv++; return; }
    total += amt;
  });
  return { total, noConv };
}

// null = no hay período anterior contra el cual comparar; Infinity = lo hubo
// pero sin compras (dividir por cero diría "+∞%", que no informa nada).
function variacion(actual, previo) {
  if (previo == null) return null;
  if (!previo)        return actual ? Infinity : 0;
  return ((actual - previo) / previo) * 100;
}
function fmtVar(v, unidad) {
  if (v == null)   return `sin ${unidad} anterior para comparar`;
  if (!isFinite(v)) return `la ${unidad} anterior no tuvo compras`;
  const s = v >= 0 ? '+' : '−';
  return `${s}${Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: 1 })}% vs. ${unidad} anterior`;
}

// Todo lo que necesitan la card y el PDF, calculado una sola vez.
function resumenData() {
  const r     = rangoActual();
  const prevR = rangoAnterior(r);
  const list  = ocsDeRango(r);

  const { total, noConv } = sumaDe(list);
  const prev = prevR ? ocsDeRango(prevR) : [];
  const prevSuma = prevR ? sumaDe(prev).total : null;

  // Estado de factura. "Vencida" se mide contra hoy, no contra el fin del
  // período: la pregunta es qué falta reclamar ahora.
  const corte = Date.now() - DIAS_FACTURA * 86400000;
  const fact  = { con: 0, otros: 0, mCon: 0, mSin: 0, venc: 0, mVenc: 0 };
  const filas = list.map(oc => {
    const f   = estadoFacturaOC(oc);
    const amt = amountIn(oc, state.moneda) || 0;
    const vencida = f.estado !== 'con' && (oc.timestamp || 0) < corte;
    if (f.estado === 'con') { fact.con++; fact.mCon += amt; }
    else                    { fact.mSin += amt; }          // incluye las 'sin rotular'
    if (f.estado === 'otros') fact.otros++;
    if (vencida)            { fact.venc++; fact.mVenc += amt; }
    return { oc, f, vencida, amt };
  });
  ordenarFilas(filas);

  // El índice de proveedores es global (lo usan los rankings y el detector de
  // duplicados): se arma sobre esta lista para agrupar bien acá y se restaura
  // al terminar, para no dejarlo apuntando a un subconjunto.
  buildProvIndex(list);
  const topProv = groupAgg(list, provKey, provLabel).slice(0, 5);
  const topObras = groupAgg(list, oc => oc.obra || '—', oc => oc.obra || 'Sin obra').slice(0, 5);
  buildProvIndex(getFiltered());

  const unidad = state.periodo === 'semana' ? 'semana'
               : state.periodo === 'quincena' ? 'quincena'
               : state.periodo === 'mes' ? 'mes' : 'período';

  return { r, prevR, unidad, list, filas, total, noConv, prevSuma,
           prevCount: prevR ? prev.length : null, fact, topObras, topProv };
}

// Orden del listado. El importe se compara convertido a la moneda de
// visualización (hay OC en ARS y en USD); los textos, sin distinguir
// mayúsculas ni tildes. Empates: por fecha.
const ORDEN_TXT = {
  obra:        oc => oc.obra || '',
  responsable: oc => oc.responsable?.nombre || '',
  proveedor:   oc => oc.proveedor?.nombre || '',
};
function ordenarFilas(filas) {
  const campo = state.resOrden, dir = state.resDir;
  const porFecha = (a, b) => (a.oc.timestamp || 0) - (b.oc.timestamp || 0);
  filas.sort((a, b) => {
    let c = 0;
    if (campo === 'importe') c = a.amt - b.amt;
    else if (ORDEN_TXT[campo]) {
      const va = ORDEN_TXT[campo](a.oc), vb = ORDEN_TXT[campo](b.oc);
      if (!va !== !vb) return va ? -1 : 1;   // los vacíos siempre al final
      c = va.localeCompare(vb, 'es', { sensitivity: 'base' });
    }
    return c * dir || porFecha(a, b) * (campo === 'fecha' ? dir : 1);
  });
}
// El importe arranca de mayor a menor; el resto, ascendente. Tocar la misma
// columna invierte el sentido.
function setOrdenResumen(campo, desdeColumna) {
  if (desdeColumna && state.resOrden === campo) state.resDir = -state.resDir;
  else { state.resOrden = campo; state.resDir = campo === 'importe' ? -1 : 1; }
  $('res-orden').value = campo;
  renderResumen();
}

function renderResumen() {
  const d = resumenData();

  $('res-rango').textContent = labelRango(d.r);

  const vT = variacion(d.total, d.prevSuma);
  const vC = variacion(d.list.length, d.prevCount);

  $('res-stats').innerHTML = `
    <div class="rr-stat rr-stat--hero">
      <span class="rr-k">Total del período</span>
      <span class="rr-v">${fmtFull(d.total, state.moneda)}</span>
      <span class="rr-d">${esc(fmtVar(vT, d.unidad))}</span>
    </div>
    <div class="rr-stat">
      <span class="rr-k">OC emitidas</span>
      <span class="rr-v">${d.list.length}</span>
      <span class="rr-d">${esc(fmtVar(vC, d.unidad))}</span>
    </div>
    <div class="rr-stat rr-stat--ok">
      <span class="rr-k">Con factura</span>
      <span class="rr-v">${d.fact.con}</span>
      <span class="rr-d">${fmtCompact(d.fact.mCon, state.moneda)}</span>
    </div>
    <div class="rr-stat rr-stat--no">
      <span class="rr-k">Sin factura</span>
      <span class="rr-v">${d.list.length - d.fact.con}</span>
      <span class="rr-d">${fmtCompact(d.fact.mSin, state.moneda)}${d.fact.otros ? ` · ${d.fact.otros} sin rotular` : ''}</span>
    </div>
    <div class="rr-stat ${d.fact.venc ? 'rr-stat--warn' : ''}">
      <span class="rr-k">Sin factura +${DIAS_FACTURA} días</span>
      <span class="rr-v">${d.fact.venc}</span>
      <span class="rr-d">${d.fact.venc ? fmtCompact(d.fact.mVenc, state.moneda) + ' a reclamar' : 'nada pendiente'}</span>
    </div>`;

  const mini = (titulo, rows) => `
    <div class="rr-mini">
      <div class="rr-mini-t">${titulo}</div>
      ${rows.length ? rows.map(row => `
        <div class="rr-mini-r">
          <span class="rr-mini-l">${esc(row.label)}</span>
          <span class="rr-mini-v">${fmtCompact(row.total, state.moneda)}</span>
          <span class="rr-mini-p">${d.total ? Math.round((row.total / d.total) * 100) : 0}%</span>
        </div>`).join('')
      : '<div class="rep-empty">Sin datos en el período.</div>'}
    </div>`;

  $('res-tops').innerHTML = mini('Obras del período', d.topObras)
                          + mini('Proveedores del período', d.topProv);

  const th = (campo, txt, cls = '') => {
    const on = state.resOrden === campo;
    return `<th class="${cls}${on ? ' rr-sorted' : ''}" data-sort="${campo}" title="Ordenar por ${txt.toLowerCase()}">${txt}${
      on ? `<span class="rr-arr">${state.resDir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
  };

  // El buscador filtra sólo el listado: los totales y los tops de arriba (y
  // el PDF) siguen describiendo el período entero.
  const terms = terminosBusqueda(state.resQ);
  const filas = terms.length ? d.filas.filter(({ oc }) => coincideOC(oc, terms)) : d.filas;
  $('res-q-n').textContent = terms.length ? `${filas.length} de ${d.filas.length} OC` : '';

  $('res-list').innerHTML = !d.filas.length
    ? '<div class="rep-empty">No hay órdenes de compra emitidas en este período.</div>'
    : !filas.length
    ? `<div class="rep-empty">Ninguna OC del período coincide con «${esc(state.resQ.trim())}».</div>`
    : `
    <table class="rr-tbl">
      <thead><tr>
        ${th('fecha', 'Fecha')}<th>N° OC</th>${th('proveedor', 'Proveedor')}${th('obra', 'Obra')}
        <th class="rr-c-eq">Equipo</th>${th('responsable', 'Responsable', 'rr-c-resp')}
        ${th('importe', 'Importe', 'rr-n')}<th>Factura</th>
      </tr></thead>
      <tbody>
        ${filas.map(({ oc, f, vencida }, i) => {
          const hits = itemsCoincidentes(oc, terms);
          const alt  = i % 2 ? ' rr-alt' : '';
          return `
          <tr class="rr-row rr-row-main${alt}${hits.length ? ' rr-has-hits' : ''}" data-k="${esc(histKeyOf(oc))}" tabindex="0">
            <td>${dm(oc.timestamp)}</td>
            <td class="rr-nro">${esc(oc.nroOC)}</td>
            <td title="${esc(oc.proveedor?.nombre || '')}">${esc(oc.proveedor?.nombre || '—')}</td>
            <td title="${esc(oc.obra || '')}">${esc(oc.obra || 'Sin obra')}</td>
            <td class="rr-c-eq" title="${esc(equipoLabel(oc.equipo))}">${esc(equipoLabel(oc.equipo) || '—')}</td>
            <td class="rr-c-resp">${esc(oc.responsable?.nombre || '—')}</td>
            <td class="rr-n">${fmtFull(oc.total, oc.moneda === 'USD' ? 'USD' : 'ARS')}</td>
            <td><span class="rr-f rr-f--${f.estado}">${textoFactura(f, vencida)}</span></td>
          </tr>${hits.length ? `
          <tr class="rr-row rr-row-hits${alt}" data-k="${esc(histKeyOf(oc))}">
            <td colspan="8">${hitsHtml(oc, hits, esc)}</td>
          </tr>` : ''}`;
        }).join('')}
      </tbody>
    </table>`;

  $('res-list').querySelectorAll('th[data-sort]').forEach(h =>
    h.addEventListener('click', () => setOrdenResumen(h.dataset.sort, true)));
  $('res-list').querySelectorAll('.rr-row').forEach(tr => {
    tr.addEventListener('click', () => openOCDetail(tr.dataset.k));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openOCDetail(tr.dataset.k); });
  });
}

function textoFactura(f, vencida) {
  if (f.estado === 'con')   return 'Sí · ' + dm(f.ts);
  if (f.estado === 'otros') return 'Sin rotular';
  return vencida ? `No · +${DIAS_FACTURA} días` : 'No';
}

// ---- PDF del resumen ----
function descargarResumenPDF() {
  const d = resumenData();
  const btn = $('btn-res-pdf');
  btn.disabled = true;
  try {
    const notas = ['Sólo OC emitidas y autorizadas.'];
    if (state.moneda === 'USD' || d.list.some(oc => oc.moneda === 'USD')) {
      notas.push(`Totales en ${state.moneda} — dólar ${state.rate} de la fecha de cada OC; el importe de cada fila va en su moneda original.`);
    }
    if (d.noConv) notas.push(`${d.noConv} OC sin cotización disponible quedan fuera de los totales.`);

    const ahora = new Date();
    const data = {
      rango:    labelRango(d.r),
      subrango: d.r.desde && d.r.hasta ? `${d.r.desde} ${d.r.hasta}` : 'historial',
      moneda:   state.moneda,
      totalStr: fmtFull(d.total, state.moneda),
      generado: `${dmy(ahora.getTime())} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`,
      notas,
      kpis: [
        { lbl: 'Total del período', val: fmtCompact(d.total, state.moneda),
          sub: fmtVar(variacion(d.total, d.prevSuma), d.unidad) },
        { lbl: 'OC emitidas', val: String(d.list.length),
          sub: fmtVar(variacion(d.list.length, d.prevCount), d.unidad) },
        { lbl: 'Con factura', val: String(d.fact.con),
          sub: fmtCompact(d.fact.mCon, state.moneda), color: [30, 125, 58] },
        { lbl: 'Sin factura', val: String(d.list.length - d.fact.con),
          sub: fmtCompact(d.fact.mSin, state.moneda), color: [176, 42, 42] },
        { lbl: `Sin factura +${DIAS_FACTURA} días`, val: String(d.fact.venc),
          sub: d.fact.venc ? fmtCompact(d.fact.mVenc, state.moneda) + ' a reclamar' : 'nada pendiente',
          color: d.fact.venc ? [154, 106, 0] : null }
      ],
      topObras: d.topObras.map(r => ({ label: r.label, val: fmtCompact(r.total, state.moneda),
        pct: (d.total ? Math.round((r.total / d.total) * 100) : 0) + '%' })),
      topProv: d.topProv.map(r => ({ label: r.label, val: fmtCompact(r.total, state.moneda),
        pct: (d.total ? Math.round((r.total / d.total) * 100) : 0) + '%' })),
      ocs: d.filas.map(({ oc, f, vencida }) => ({
        fecha:       dm(oc.timestamp),
        nroOC:       oc.nroOC,
        proveedor:   oc.proveedor?.nombre || '—',
        obra:        oc.obra || 'Sin obra',
        equipo:      equipoLabel(oc.equipo) || '—',
        responsable: oc.responsable?.nombre || '—',
        importe:     fmtFull(oc.total, oc.moneda === 'USD' ? 'USD' : 'ARS'),
        factura:     textoFactura(f, vencida),
        facturaEstado: f.estado
      }))
    };

    const blob = generateResumenBlob(data);
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resumenFileName(data);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast('No se pudo generar el PDF del resumen.', 'error');
    console.error('resumenPDF:', e);
  } finally {
    btn.disabled = false;
  }
}

// ---- Controles del período ----
// El preset escribe las fechas del panel: el resumen y el resto del reporte
// miran siempre el mismo rango.
function aplicarPeriodo() {
  const r = rangoPeriodo(state.periodo, state.pOffset);
  state.desde = r.desde; state.hasta = r.hasta;
  $('rep-desde').value = r.desde; $('rep-hasta').value = r.hasta;
  render();
}

function setPeriodo(tipo) {
  if (tipo === 'todo') {          // sin preset ni fechas: todo el historial
    state.periodo = null; state.pOffset = 0;
    state.desde = ''; state.hasta = '';
    $('rep-desde').value = ''; $('rep-hasta').value = '';
    syncPeriodoUI();
    render();
    return;
  }
  if (state.periodo === tipo && state.pOffset === 0) return;
  state.periodo = tipo; state.pOffset = 0;
  syncPeriodoUI();
  aplicarPeriodo();
}

function moverPeriodo(delta) {
  if (!state.periodo) return;
  const off = state.pOffset + delta;
  if (off < 0) return;            // no hay períodos futuros que mostrar
  state.pOffset = off;
  aplicarPeriodo();
}

// "Todo" queda marcado sólo sin preset ni fechas; con un rango puesto a mano
// no se marca ninguno.
function syncPeriodoUI() {
  const activo = state.periodo || (!state.desde && !state.hasta ? 'todo' : null);
  [...$('seg-periodo').querySelectorAll('[data-per]')]
    .forEach(b => b.classList.toggle('active', b.dataset.per === activo));
}

function render() {
  const list  = getFiltered();
  const total = renderHero(list);
  const grand = total || 1;

  buildProvIndex(list);
  renderDuplicados(list);

  // El botón "Unificar obras" sólo aparece si hay fusiones que proponer.
  const btnMerge = $('btn-merge-obras');
  if (btnMerge) btnMerge.classList.toggle('hidden', !mergeGroupsPresent().length);

  const obras = groupAgg(list, oc => oc.obra || '—', oc => oc.obra || 'Sin obra');

  renderShare('rep-share', obras, total);

  renderLine('rep-linea', timeSeries(list));

  renderBars('rep-obras', obras,
    { grandTotal: grand, drill: true, hueFor: r => obraHue.get(r.key) || HUES.gris,
      emptyMsg: 'No hay OC con obra en el rango.' });

  // El equipo es opcional: las OC sin equipo no son un equipo llamado "Sin
  // equipo", simplemente no pertenecen a esta vista. Los % siguen midiéndose
  // contra el gasto total, así que no suman 100 — es a propósito.
  const conEquipo = list.filter(oc => oc.equipo?.codigo);
  renderBars('rep-equipos', groupAgg(conEquipo,
      oc => oc.equipo.codigo,
      oc => equipoLabel(oc.equipo)),
    { grandTotal: grand, drill: true, catChip: true, catSplit: true, hue: HUES.turquesa,
      emptyMsg: 'Ninguna OC del rango tiene equipo asignado.' });

  // Repuestos vs Mantenimiento: sólo las OC con equipo llevan categoría. Las
  // que aún no la tienen (previas a esta función) caen en "Sin categoría".
  renderBars('rep-categorias', groupAgg(conEquipo,
      oc => oc.equipo.categoria || 'Sin categoría',
      oc => oc.equipo.categoria || 'Sin categoría'),
    { grandTotal: grand, drill: true, catChip: true,
      hueFor: r => r.key === 'Repuestos' ? HUES.azul : r.key === 'Mantenimiento' ? HUES.lavanda : HUES.gris,
      emptyMsg: 'Ninguna OC del rango tiene equipo asignado.' });

  renderBars('rep-proveedores', groupAgg(list, provKey, provLabel),
    { grandTotal: grand, limit: 10, drill: true, hue: HUES.azul,
      drillTitulo: oc => oc.obra || 'Sin obra', emptyMsg: 'Sin proveedores en el rango.' });

  renderBars('rep-responsables', groupAgg(list,
      oc => oc.responsable?.codigo || '—',
      oc => oc.responsable?.nombre || '—'),
    { grandTotal: grand, drill: true, hue: HUES.ambar, emptyMsg: 'Sin responsables en el rango.' });

  // Al final: resumenData() rearma el índice de proveedores para su propia
  // lista y lo deja como lo espera el resto del panel.
  renderResumen();
}

// ===================================================
//  OC duplicadas
// ===================================================
// Mismo proveedor + misma fecha + mismo monto = la misma compra emitida dos
// veces (doble clic, o "parecía que falló y la hice de nuevo"). La huella es que
// los números suelen salir consecutivos: 0004-00000157 y 158, con 10 ítems
// idénticos cada una.
//
// A propósito NO se usa una ventana de días: mismo proveedor y monto en fechas
// distintas puede ser una compra recurrente real (nafta, lubricantes del taller)
// y marcarla como duplicado sería gritar en falso.
//
// El monto se compara en su moneda original, no en la de visualización: el toggle
// ARS/USD no puede cambiar qué es un duplicado.
function grupoDuplicados(list) {
  const map = new Map();
  list.forEach(oc => {
    const monto = Math.round((parseFloat(oc.total) || 0) * 100);
    if (!monto) return;                       // una OC en $0 no es un duplicado
    const k = [provKey(oc), oc.fecha || '', oc.moneda || 'ARS', monto].join('|');
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(oc);
  });
  return [...map.values()]
    .filter(g => g.length > 1)
    .map(g => [...g].sort((a, b) => String(a.nroOC).localeCompare(String(b.nroOC))))
    .sort((a, b) => (parseFloat(b[0].total) || 0) - (parseFloat(a[0].total) || 0));
}

function renderDuplicados(list) {
  const card   = $('rep-dup-card');
  const grupos = grupoDuplicados(list);

  if (!grupos.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  // Lo que se ahorra si cada grupo queda con una sola OC.
  const enJuego = grupos.reduce((s, g) =>
    s + (amountIn(g[0], state.moneda) || 0) * (g.length - 1), 0);
  $('rep-dup-count').textContent =
    `${grupos.length} grupo${grupos.length > 1 ? 's' : ''} · ${fmtCompact(enJuego, state.moneda)} contados de más`;

  $('rep-dup').innerHTML = grupos.map(g => {
    const head = g[0];
    return `
      <div class="rep-dup-g">
        <div class="rep-dup-head">
          <span class="rep-dup-prov">${esc(provLabel(head))}</span>
          <span class="rep-dup-meta">${esc(head.fecha || '')} · ${esc(fmtFull(head.total, head.moneda || 'ARS'))} · ×${g.length}</span>
        </div>
        ${g.map(oc => `
          <div class="rep-dup-oc">
            <button class="rep-dup-ver" data-ockey="${esc(histKeyOf(oc))}"
                    title="Ver la ficha completa de la OC ${esc(oc.nroOC)}">
              <span class="rep-dup-nro">${esc(oc.nroOC)}</span>
              <span class="rep-dup-sub">${esc(oc.obra || 'Sin obra')} · ${esc(oc.responsable?.nombre || '—')}</span>
            </button>
            <button class="btn btn-sm btn-danger rep-dup-del" data-delkey="${esc(histKeyOf(oc))}"
                    title="Borrar la OC ${esc(oc.nroOC)} del historial">Borrar</button>
          </div>`).join('')}
      </div>`;
  }).join('');

  if (!$('rep-dup')._wired) {
    $('rep-dup')._wired = true;
    $('rep-dup').addEventListener('click', e => {
      const del = e.target.closest('[data-delkey]');
      if (del) { borrarDuplicado(del.dataset.delkey); return; }
      const ver = e.target.closest('[data-ockey]');
      if (ver) openOCDetail(ver.dataset.ockey);
    });
  }
}

// La OC deja de existir: su tarjeta en Novedades apuntaría a una orden que ya
// no está (y el link de Drive a una carpeta sin dueño). Best-effort: el borrado
// del historial, que es lo que importa, ya está hecho.
async function limpiarNovedadesDe(oc) {
  if (typeof deleteNovedadesDeOC !== 'function') return;
  try { await deleteNovedadesDeOC(oc.nroOC); }
  catch (e) { console.warn('limpiarNovedadesDe:', e); }
}

async function borrarDuplicado(key) {
  const oc = ocByKey(key);
  if (!oc) return;
  const ok = await showConfirm('Borrar OC duplicada',
    `¿Borrar la OC ${oc.nroOC} (${fmtFull(oc.total, oc.moneda || 'ARS')}) del historial? ` +
    `No se puede deshacer. El PDF en Drive no se toca: si esta OC ya se le mandó al proveedor, ` +
    `borrarla acá no la da de baja.`);
  if (!ok) return;

  try {
    await deleteHistorialEntry(key);
    await limpiarNovedadesDe(oc);
    const i = ALL.indexOf(oc);     if (i >= 0) ALL.splice(i, 1);
    const j = ALL_RAW.indexOf(oc); if (j >= 0) ALL_RAW.splice(j, 1);
    toast('OC borrada.', 'success');
    render();
  } catch (e) {
    toast('No se pudo borrar. ' + e.message, 'error');
  }
}

// ===================================================
//  Ficha de la OC
// ===================================================

let detailKey = null;

function fichaRow(lbl, val) {
  if (!val) return '';
  return `<div class="foc-f"><span class="foc-k">${esc(lbl)}</span><span class="foc-v">${esc(val)}</span></div>`;
}

function openOCDetail(key) {
  const oc = ocByKey(key);
  if (!oc) return;
  detailKey = key;
  const cur  = oc.moneda === 'USD' ? 'USD' : 'ARS';
  const prov = oc.proveedor || {};

  // Factura: misma pastilla que en el listado del resumen.
  const f = estadoFacturaOC(oc);
  const vencida = f.estado !== 'con' && (oc.timestamp || 0) < Date.now() - DIAS_FACTURA * 86400000;
  $('foc-title').textContent = oc.nroOC;
  $('foc-total').textContent = fmtDec(oc.total, cur);
  $('foc-estado').innerHTML  = estadoChip(oc)
    + `<span class="rep-chip rr-f rr-f--${f.estado}">Factura: ${esc(textoFactura(f, vencida))}</span>`;

  const items = oc.items || [];
  const itemsHtml = items.length ? `
    <div class="foc-items-w"><table class="foc-items">
      <thead><tr>
        <th>Descripción</th><th class="foc-n">Cant.</th><th>Un.</th>
        <th class="foc-n foc-c-unit">Unitario</th><th class="foc-n">Total</th>
      </tr></thead>
      <tbody>
        ${items.map(it => `<tr>
          <td>${esc(it.desc)}</td>
          <td class="foc-n">${esc(it.cant)}</td>
          <td>${it.unidad ? `<span class="foc-un">${esc(it.unidad)}</span>` : ''}</td>
          <td class="foc-n foc-c-unit">${esc(fmtDec(it.unitario, cur))}</td>
          <td class="foc-n">${esc(fmtDec(it.total, cur))}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="rep-empty">Esta OC no guardó el detalle de ítems.</div>';

  // `impuestos` ya es el desglose cerrado que imprime el PDF: Gravado, cada
  // impuesto, Subtotal/Descuento y la fila TOTAL. No se le suma `impuestosExtra`
  // (es la fuente con la que se armó, o sea los mismos impuestos) ni descuento /
  // noGravado, que ya están adentro.
  const imps = (oc.impuestos || [])
    .map(i => ({ nombre: (i.nombre || i.label || '').trim(), monto: Number(i.monto) || 0 }))
    .filter(i => i.nombre);
  const esTotal = n => /^total$/i.test(n);

  const totalesHtml = imps.length
    ? `<div class="foc-tot">
        ${imps.map(i => `<div class="foc-t ${esTotal(i.nombre) ? 'foc-t-grand' : ''}">
          <span>${esc(i.nombre)}</span><span>${esc(fmtDec(i.monto, cur))}</span></div>`).join('')}
      </div>`
    : `<div class="foc-tot">
        <div class="foc-t foc-t-grand"><span>Total</span><span>${esc(fmtDec(oc.total, cur))}</span></div>
      </div>`;

  // El reporte puede estar en otra moneda que la OC: se aclara la reexpresión.
  const conv = amountIn(oc, state.moneda);
  const convHtml = (cur !== state.moneda && conv != null)
    ? `<div class="foc-conv">En el reporte se computa como <strong>${esc(fmtFull(conv, state.moneda))}</strong>
        (dólar ${esc(state.rate)}${oc.cotizacion ? ' de la fecha de la OC' : ' de hoy — la OC no guardó cotización'}).</div>`
    : '';

  const tags = [prov.cuit && `CUIT ${prov.cuit}`, prov.condicionIVA].filter(Boolean);
  $('foc-body').innerHTML = `
    <div class="foc-prov">
      <span class="foc-prov-ic">${icSvg('truck')}</span>
      <div style="min-width:0">
        <div class="foc-prov-n">${esc(prov.nombre || 'Proveedor sin nombre')}</div>
        ${tags.length ? `<div class="foc-prov-s">${tags.map(t => `<span class="foc-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="foc-grid">
      ${fichaRow('Fecha', oc.fecha)}
      ${fichaRow('Obra', oc.obra)}
      ${fichaRow('Responsable', oc.responsable?.nombre)}
      ${fichaRow('Cond. pago', oc.condicionPago)}
      ${fichaRow('Moneda', cur)}
      ${fichaRow('Rubro', oc.rubro?.nombre)}
      ${fichaRow('Equipo', equipoLabel(oc.equipo))}
      ${fichaRow('Categoría', oc.equipo?.categoria)}
    </div>
    <div class="foc-sec">Ítems${items.length ? ` <span class="foc-cnt">${items.length}</span>` : ''}</div>
    ${itemsHtml}
    ${totalesHtml}
    ${convHtml}`;

  // Drive: sólo si la OC ya tiene su carpeta registrada.
  const url = driveUrlOf(oc);
  const drv = $('foc-drive');
  if (url) {
    drv.href = url;
    drv.classList.remove('hidden');
    $('foc-nodrive').classList.add('hidden');
  } else {
    drv.classList.add('hidden');
    $('foc-nodrive').classList.remove('hidden');
  }

  $('foc-pdf').disabled = oc.estado === 'pendiente' || oc.estado === 'cancelada';
  $('modal-oc').classList.remove('hidden');
}

function closeOCDetail() {
  $('modal-oc').classList.add('hidden');
  detailKey = null;
}

async function verPDF() {
  const oc = ocByKey(detailKey);
  if (!oc) return;
  const btn = $('foc-pdf');
  btn.disabled = true;
  try {
    const ocData = await ocDataDe(oc);
    const blob = generateOCBlob(ocData);
    // Se abre en una pestaña para verla; el navegador ofrece descargar desde ahí.
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      // sanitize() viene de ocGenerator.js: mismo nombre de archivo que al emitirla.
      a.download = `OC_${oc.nroOC}_${sanitize(prov.nombre || 'SinProveedor')}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast('No se pudo generar el PDF de la OC.', 'error');
    console.error('verPDF:', e);
  } finally {
    btn.disabled = false;
  }
}

function showConfirm(title, msg) {
  return new Promise(resolve => {
    $('mcf-title').textContent = title;
    $('mcf-msg').textContent   = msg;
    const modal = $('modal-confirm');
    modal.classList.remove('hidden');
    const done = v => { modal.classList.add('hidden'); resolve(v); };
    $('mcf-no').onclick  = () => done(false);
    $('mcf-yes').onclick = () => done(true);
  });
}

// ===================================================
//  Unificar obras (fusión de nombres fragmentados)
// ===================================================
// Mapeo sugerido (canónico ← variantes). Se filtra a las que existan en los datos.
const MERGE_PROPOSAL = [
  { to: 'La Molienda II', from: [
    'La Molienda II - Instalación Electríca Terrazas Bloque C y D',
    'La Molienda II - Ductos ACC Locales Comerciales',
    'La Molienda II - Ductos ACC Locales Comerciales+sondeo termostatos',
    'La Molienda II - Varios',
    'La Molienda II - Protección de carpinterías de chapa',
  ] },
  // "La Molienda" salió del padrón el 15/07/2026 y su carpeta de Drive se fusionó
  // con la de "La Molienda I": las OC que quedaron con el nombre viejo van ahí.
  { to: 'La Molienda I',        from: ['La Molienda I - Yeso', 'La Molienda'] },
  { to: 'Colectora Dean Funes', from: ['Dean Funes'] },
  { to: 'UPC Capilla del Monte', from: ['UPC CAPILLA DEL MONTE'] },
  { to: 'Oficina Técnica',      from: ['Oficina Tecnica'] },
  { to: 'Administración - RRHH', from: ['Administración', 'Administracion - RR.HH'] },
  { to: 'Hangar Pueblo Nativo', from: ['Pueblo Nativo'] },
];

// Fusiones sugeridas presentes en los datos actuales. Vacío = nada que unificar,
// y ahí el botón no se muestra (no tiene sentido abrir un modal sin propuestas).
function mergeGroupsPresent() {
  const present = new Set(ALL.map(o => o.obra).filter(Boolean));
  return MERGE_PROPOSAL
    .map(g => ({ to: g.to, from: g.from.filter(f => present.has(f)) }))
    .filter(g => g.from.length);
}

function openMergeModal() {
  const countFor = name => ALL.filter(o => o.obra === name).length;
  const groups = mergeGroupsPresent();

  if (!groups.length) { toast('No hay fusiones sugeridas: las obras ya están unificadas.', 'info'); return; }

  $('mmg-groups').innerHTML = groups.map((g, i) => `
    <div class="mmg-group" data-gi="${i}">
      <div class="mmg-head">
        <input type="checkbox" class="mmg-chk" checked>
        <span>Fusionar en:</span>
        <input class="form-control mmg-to" value="${esc(g.to)}">
      </div>
      <ul class="mmg-from">
        ${g.from.map(f => `<li>${esc(f)} <span class="mmg-cnt">${countFor(f)} OC</span></li>`).join('')}
      </ul>
    </div>`).join('');

  $('modal-merge')._groups = groups;
  $('mmg-error').classList.add('hidden');
  $('modal-merge').classList.remove('hidden');
}

async function applyMerge() {
  const modal  = $('modal-merge');
  const groups = modal._groups || [];
  const tasks  = [];

  [...$('mmg-groups').querySelectorAll('.mmg-group')].forEach(el => {
    if (!el.querySelector('.mmg-chk').checked) return;
    const gi = Number(el.dataset.gi);
    const to = el.querySelector('.mmg-to').value.trim();
    if (!to) return;
    groups[gi].from.forEach(from => {
      ALL.filter(o => o.obra === from).forEach(o => tasks.push({ oc: o, to }));
    });
  });

  if (!tasks.length) { modal.classList.add('hidden'); return; }

  const btn = $('mmg-apply'); btn.disabled = true; btn.textContent = 'Aplicando…';
  let ok = 0, fail = 0;
  await Promise.all(tasks.map(async t => {
    try { await patchHistorialEntry(histKeyOf(t.oc), { obra: t.to }); t.oc.obra = t.to; ok++; }
    catch (_) { fail++; }
  }));
  btn.disabled = false; btn.textContent = 'Aplicar fusiones';
  modal.classList.add('hidden');
  toast(`${ok} OC reasignada(s)${fail ? `, ${fail} con error` : ''}.`, fail ? 'warning' : 'success');
  render();
}

// ---- Cotización del día ----
function renderDolarHoy() {
  const snap = typeof getDolarCached === 'function' ? getDolarCached() : null;
  const el = $('rep-dolar-hoy');
  if (!snap) { el.textContent = 'Cotización del día no disponible.'; return; }
  const o = snap.oficial?.venta, b = snap.blue?.venta;
  const n = v => v ? Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—';
  el.innerHTML = `Dólar hoy · Oficial <strong>$${n(o)}</strong> · Blue <strong>$${n(b)}</strong>`;
}

// ---- Controles ----
function setupSegmented(groupId, key) {
  const grp = $(groupId);
  grp.addEventListener('click', e => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    state[key] = btn.dataset.val;
    [...grp.querySelectorAll('[data-val]')].forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);
  $('hdr-name').textContent = name;

  $('btn-back').addEventListener('click', () => { window.location.href = 'administracion.html'; });

  let puedeVer = code === '0000';
  if (!puedeVer) {
    try { const u = await getUsuario(code); puedeVer = !!(u && (u.admin || u.reportes)); } catch (_) {}
  }
  if (!puedeVer) { window.location.href = 'menu.html'; return; }

  setupSegmented('seg-moneda', 'moneda');
  setupSegmented('seg-rate',   'rate');
  // Tocar las fechas a mano apaga el preset de período: el resumen pasa a
  // describir el rango que puso el usuario.
  const soltarPreset = () => { state.periodo = null; state.pOffset = 0; syncPeriodoUI(); };
  $('rep-desde').addEventListener('change', () => { state.desde = $('rep-desde').value; soltarPreset(); render(); });
  $('rep-hasta').addEventListener('change', () => { state.hasta = $('rep-hasta').value; soltarPreset(); render(); });
  $('btn-export').addEventListener('click', () => window.print());

  // Período (en el hero): mueve todo el reporte, resumen incluido.
  syncPeriodoUI();
  $('seg-periodo').addEventListener('click', e => {
    const btn = e.target.closest('[data-per]');
    if (btn) setPeriodo(btn.dataset.per);
  });
  $('per-prev').addEventListener('click', () => moverPeriodo(1));
  $('per-next').addEventListener('click', () => moverPeriodo(-1));

  // Resumen del período
  $('btn-res-pdf').addEventListener('click', descargarResumenPDF);
  $('res-orden').addEventListener('change', e => setOrdenResumen(e.target.value, false));
  $('res-q').addEventListener('input', e => { state.resQ = e.target.value; renderResumen(); });

  // Plegado y buscador de las cards (restaura lo que quedó plegado la vez pasada).
  setupCards();

  // Ficha de OC
  $('foc-close').addEventListener('click', closeOCDetail);
  $('foc-cerrar').addEventListener('click', closeOCDetail);
  $('foc-pdf').addEventListener('click', verPDF);
  $('modal-oc').addEventListener('click', e => { if (e.target.id === 'modal-oc') closeOCDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOCDetail(); });

  $('btn-merge-obras').addEventListener('click', openMergeModal);
  $('mmg-close').addEventListener('click',  () => $('modal-merge').classList.add('hidden'));
  $('mmg-cancel').addEventListener('click', () => $('modal-merge').classList.add('hidden'));
  $('mmg-apply').addEventListener('click', applyMerge);

  // Nombres de obras para reasignación
  try { OBRAS_ALL = (await getAllObras()).map(o => o.nombre); } catch (_) {}

  // Patentes por código de equipo (best-effort: sin esto el reporte sigue
  // mostrando el equipo, sólo que sin la patente).
  try {
    PATENTES = {};
    (await getAllEquipos()).forEach(e => { if (e.patente) PATENTES[e.codigo] = e.patente; });
  } catch (_) {}

  renderDolarHoy();
  if (typeof getDolarSnapshot === 'function') getDolarSnapshot().then(renderDolarHoy).catch(() => {});

  try {
    ALL_RAW   = await getHistorial(code, true);
    cutoffTs  = driveCutoff(ALL_RAW);
    const conRespaldo = ALL_RAW.filter(oc => (oc.timestamp || 0) >= cutoffTs);
    ALL       = conRespaldo.filter(oc => !esObraPrueba(oc) && !esProveedorPrueba(oc));
    $('rep-loading').classList.add('hidden');
    $('rep-content').classList.remove('hidden');
    render();
  } catch (e) {
    console.error('getHistorial:', e);
    $('rep-loading').innerHTML = 'No se pudieron cargar las órdenes. Revisá tu conexión y recargá.';
  }
});

// El gráfico se dibuja al ancho real del contenedor: hay que redibujarlo al
// cambiar el tamaño de la ventana.
let _rzT = null;
window.addEventListener('resize', () => {
  clearTimeout(_rzT);
  _rzT = setTimeout(() => { if (lineData.rows.length) renderLine('rep-linea', lineData); }, 150);
});
