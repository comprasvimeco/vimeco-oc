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
let excluidas  = 0; // OC previas al respaldo, fuera del reporte
let dePrueba   = 0; // OC cargadas contra una obra de prueba

// Obras que se usan para probar la app: no son gasto real. Match exacto sobre el
// nombre normalizado — ninguna obra real tiene un nombre de un solo carácter.
const OBRAS_PRUEBA = new Set(['x']);
function esObraPrueba(oc) {
  return OBRAS_PRUEBA.has((oc.obra || '').trim().toLowerCase());
}

const $ = id => document.getElementById(id);

const state = {
  desde:  '',
  hasta:  '',
  moneda: 'ARS',       // moneda de visualización
  rate:   'oficial',   // 'oficial' | 'blue' — qué cotización usar para convertir
  incluirNoEmitidas: false,
};

const expanded = new Set(); // claves de filas desplegadas (por sección+key)

// ?? y no ||: con `||` un 0 legítimo (p. ej. la cantidad de un ítem) se
// renderizaría como celda vacía.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Clave del registro en /historial (así se guarda en saveOCToHistory).
function histKeyOf(oc) { return (oc.nroOC || '').replace(/-/g, ''); }
function ocByKey(key)  { return ALL.find(o => histKeyOf(o) === key); }

// ---- Respaldo en Drive ----
// Una OC respaldada guarda el id de su carpeta al subir el PDF.
function driveFolderId(oc) {
  return oc.drive_folder_obras_id || oc.drive_folder_proveedores_id || null;
}
function driveUrlOf(oc) {
  const id = driveFolderId(oc);
  return id ? `https://drive.google.com/drive/folders/${id}` : '';
}

// El corte se deduce de los datos: la OC respaldada más antigua marca el momento
// en que el respaldo empezó a existir. Todo lo anterior es de las primeras
// iteraciones y queda fuera. Se usa la fecha (no la presencia del id) para no
// perder una OC reciente cuya subida todavía está en la cola offline.
function driveCutoff(list) {
  const conRespaldo = list.filter(driveFolderId).map(o => o.timestamp || 0).filter(Boolean);
  return conRespaldo.length ? Math.min(...conRespaldo) : 0;
}

let OBRAS_ALL = []; // nombres de obras (para el datalist de reasignación)
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

function usedFallback(oc) {
  const moneda = oc.moneda === 'USD' ? 'USD' : 'ARS';
  return moneda !== state.moneda && !oc.cotizacion;
}

// ---- Filtro ----
function inEstado(oc) {
  if (state.incluirNoEmitidas) return true;
  const e = oc.estado || 'emitida';
  return e !== 'pendiente' && e !== 'rechazada';
}

function getFiltered() {
  return ALL.filter(oc => {
    if (!inEstado(oc)) return false;
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

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Marca una OC como "posible error" si su monto supera 10× la mediana de la
// obra/equipo (con al menos 3 OC en el grupo). Detecta los cargados ×1000.
function flagOutliers(row) {
  if (row.count < 3) return;
  const med = median(row.ocs.map(x => x.amt));
  if (med <= 0) return;
  row.ocs.forEach(x => { x.flag = x.amt > med * 10; });
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

const bucketShort = (k, unit) => unit === 'semana' ? weekShort(k) : monthShort(k);
const bucketLabel = (k, unit) => unit === 'semana' ? weekLabel(k) : monthLabel(k);

// Granularidad de la evolución. Agrupar por mes cuando todo el dato entra en
// dos meses da una recta de dos puntos que no dice nada: ahí la semana informa.
function timeSeries(list) {
  const ts = list.map(o => o.timestamp || 0).filter(Boolean);
  if (!ts.length) return { rows: [], unit: 'mes' };
  const spanDias = (Math.max(...ts) - Math.min(...ts)) / 86400000;
  const unit = spanDias <= 120 ? 'semana' : 'mes';
  const kf = oc => unit === 'semana' ? weekKey(oc.timestamp) : monthKey(oc.timestamp);
  const rows = groupAgg(list, kf, kf).sort((a, b) => a.key.localeCompare(b.key));
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
  };
  const [txt, bg, fg] = map[e] || map.emitida;
  return `<span class="rep-chip" style="background:${bg};color:${fg}">${txt}</span>`;
}

// ===================================================
//  Gráficos
// ===================================================

// Paleta categórica validada (contraste/daltonismo) para la barra de
// participación. Ver scripts/validate_palette.js de la guía de dataviz:
// peor par adyacente ΔE 24.2 bajo protanopia. Los tonos por debajo de 3:1
// sobre blanco se compensan con la leyenda rotulada (relief rule).
const SHARE_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7'];
const SHARE_OTHER  = '#9ca3af';

// ---- Barra de participación (part-to-whole, top 5 + Otras) ----
function renderShare(containerId, rows, grand) {
  const el = $(containerId);
  if (!rows.length || grand <= 0) {
    el.innerHTML = '<div class="rep-empty">Sin datos en el rango seleccionado.</div>';
    return;
  }
  const top   = rows.slice(0, 5);
  const resto = rows.slice(5);
  const segs  = top.map((r, i) => ({ label: r.label, total: r.total, color: SHARE_COLORS[i] }));
  if (resto.length) {
    segs.push({
      label: `Otras ${resto.length} obra${resto.length !== 1 ? 's' : ''}`,
      total: resto.reduce((a, r) => a + r.total, 0),
      color: SHARE_OTHER
    });
  }

  const pct = t => (t / grand) * 100;
  el.innerHTML = `
    <div class="rep-share-track">
      ${segs.map(s => `
        <div class="rep-share-seg" style="flex:${s.total};background:${s.color}"
             title="${esc(s.label)} — ${esc(fmtFull(s.total, state.moneda))} (${pct(s.total).toFixed(1)}%)"></div>
      `).join('')}
    </div>
    <div class="rep-share-legend">
      ${segs.map(s => `
        <div class="rep-share-item">
          <span class="rep-share-dot" style="background:${s.color}"></span>
          <span class="rep-share-lbl">${esc(s.label)}</span>
          <span class="rep-share-pct">${pct(s.total).toFixed(1)}%</span>
          <span class="rep-share-val">${esc(fmtCompact(s.total, state.moneda))}</span>
        </div>
      `).join('')}
    </div>`;
}

// ---- Evolución mensual (área + línea, una sola serie) ----
// Se dibuja al ancho real del contenedor para que los trazos no se deformen.
let lineData = { rows: [], unit: 'mes' };

function renderLine(containerId, serie) {
  const el = $(containerId);
  lineData = serie;
  const { rows, unit } = serie;

  $('rep-linea-title').textContent = unit === 'semana' ? 'Evolución semanal' : 'Evolución mensual';

  if (rows.length < 2) {
    el.innerHTML = `<div class="rep-empty">${rows.length ? `Una sola ${unit} en el rango — no hay evolución para graficar.` : 'Sin movimientos en el rango seleccionado.'}</div>`;
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
         aria-label="Evolución mensual del gasto">
      <defs>
        <linearGradient id="repAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#2557a7" stop-opacity=".28"/>
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

// ---- Render de barras (con drill-down opcional) ----
function renderBars(containerId, rows, opts = {}) {
  const el = $(containerId);
  if (!rows.length) {
    el.innerHTML = `<div class="rep-empty">${opts.emptyMsg || 'Sin datos en el rango seleccionado.'}</div>`;
    return;
  }
  const shown = opts.limit ? rows.slice(0, opts.limit) : rows;
  const max   = Math.max(...shown.map(r => r.total)) || 1;
  const grand = opts.grandTotal || max;

  el.innerHTML = shown.map((r, i) => {
    const pct  = Math.max(2, Math.round((r.total / max) * 100));
    const share = Math.round((r.total / grand) * 100);
    const rowKey = containerId + '|' + r.key;
    const isOpen = opts.drill && expanded.has(rowKey);

    let drillHtml = '';
    if (opts.drill && isOpen) {
      flagOutliers(r);
      const ocs = [...r.ocs].sort((a, b) => b.amt - a.amt);
      drillHtml = `<div class="rep-drill">${ocs.map(({ oc, amt, flag }) => `
        <button class="rep-oc ${flag ? 'rep-oc-flag' : ''}" data-ockey="${esc(histKeyOf(oc))}"
                title="Ver la ficha completa de la OC ${esc(oc.nroOC)}">
          <div class="rep-oc-main">
            <span class="rep-oc-nro">${esc(oc.nroOC)}</span>
            <span class="rep-oc-prov">${esc(oc.proveedor?.nombre || '—')}</span>
          </div>
          <div class="rep-oc-meta">
            <span class="rep-oc-fecha">${esc(oc.fecha || '')}</span>
            ${estadoChip(oc)}
            ${flag ? `<span class="rep-flag">${icSvg('alert')} revisar</span>` : ''}
            ${driveFolderId(oc) ? `<span class="rep-oc-drv" title="Respaldada en Drive">${icSvg('folder')}</span>` : ''}
          </div>
          <span class="rep-oc-total">${fmtFull(amt, state.moneda)}</span>
          <span class="rep-oc-go">${icSvg('chevR')}</span>
        </button>`).join('')}</div>`;
    }

    return `
      <div class="rep-bar-row ${opts.drill ? 'rep-clickable' : ''} ${isOpen ? 'rep-open' : ''}" data-rowkey="${esc(rowKey)}">
        <div class="rep-bar-head">
          <span class="rep-bar-rank">${i + 1}</span>
          ${opts.drill ? `<span class="rep-caret">${icSvg('chevR')}</span>` : ''}
          <span class="rep-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
          <span class="rep-bar-val" title="${esc(fmtFull(r.total, state.moneda))}">${fmtCompact(r.total, state.moneda)}</span>
        </div>
        <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${pct}%"></div></div>
        <div class="rep-bar-sub">${r.count} OC · ${share}%</div>
        ${drillHtml}
      </div>`;
  }).join('');

  if (opts.drill && !el._wired) {
    el._wired = true;
    el.addEventListener('click', e => {
      const ocBtn = e.target.closest('[data-ockey]');
      if (ocBtn) { e.stopPropagation(); openOCDetail(ocBtn.dataset.ockey); return; }
      const row = e.target.closest('.rep-bar-row');
      if (!row) return;
      const k = row.dataset.rowkey;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      render();
    });
  }
}

// ---- Encabezado: hero + KPIs ----
function renderHero(list) {
  let total = 0, count = 0, noConv = 0, fallback = 0;
  const amounts = [];
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) { noConv++; return; }
    total += amt; count++; amounts.push(amt);
    if (usedFallback(oc)) fallback++;
  });

  $('kpi-total').textContent = fmtFull(total, state.moneda);
  $('kpi-count').textContent = count;
  $('kpi-avg').textContent   = fmtCompact(count ? total / count : 0, state.moneda);
  $('kpi-med').textContent   = fmtCompact(median(amounts), state.moneda);
  $('kpi-obras').textContent = new Set(list.map(o => o.obra).filter(Boolean)).size;

  // Contexto del hero: período real de los datos + cotización aplicada.
  const ts = list.map(o => o.timestamp || 0).filter(Boolean);
  const per = ts.length
    ? (monthLabel(monthKey(Math.min(...ts))) === monthLabel(monthKey(Math.max(...ts)))
        ? monthLabel(monthKey(Math.min(...ts)))
        : `${monthLabel(monthKey(Math.min(...ts)))} – ${monthLabel(monthKey(Math.max(...ts)))}`)
    : 'sin datos';
  const cot = state.moneda === 'USD' ? ` · dólar ${state.rate}` : '';
  $('hero-sub').textContent = `${count} OC · ${per}${cot}`;

  const notes = [];
  if (excluidas) notes.push(`${excluidas} OC anteriores al respaldo en Drive quedan fuera del reporte.`);
  if (dePrueba)  notes.push(`${dePrueba} OC de obras de prueba quedan fuera del reporte.`);
  if (fallback)  notes.push(`${fallback} OC sin cotización propia — convertidas al dólar de hoy.`);
  if (noConv)    notes.push(`${noConv} OC no se pudieron convertir (sin cotización disponible).`);
  const noteEl = $('rep-note');
  if (notes.length) { noteEl.innerHTML = notes.map(esc).join('<br>'); noteEl.classList.remove('hidden'); }
  else noteEl.classList.add('hidden');

  return total;
}

function render() {
  const list  = getFiltered();
  const total = renderHero(list);
  const grand = total || 1;

  const obras = groupAgg(list, oc => oc.obra || '—', oc => oc.obra || 'Sin obra');

  renderShare('rep-share', obras, total);

  renderLine('rep-linea', timeSeries(list));

  renderBars('rep-obras', obras,
    { grandTotal: grand, drill: true, emptyMsg: 'No hay OC con obra en el rango.' });

  // Si ninguna OC tiene equipo, la única barra sería "Sin equipo · 100%": no
  // informa nada y ocupa la tarjeta. Mejor decirlo con palabras.
  const equipos = groupAgg(list,
    oc => oc.equipo?.codigo || 'sin',
    oc => oc.equipo ? `${oc.equipo.codigo}${oc.equipo.tipo ? ' — ' + oc.equipo.tipo : ''}` : 'Sin equipo');
  const soloSinEquipo = equipos.length === 1 && equipos[0].key === 'sin';
  renderBars('rep-equipos', soloSinEquipo ? [] : equipos,
    { grandTotal: grand, drill: true, emptyMsg: 'Ninguna OC del rango tiene equipo asignado.' });

  renderBars('rep-proveedores', groupAgg(list,
      oc => oc.proveedor?.nombre || '—',
      oc => oc.proveedor?.nombre || 'Sin proveedor'),
    { grandTotal: grand, limit: 10, emptyMsg: 'Sin proveedores en el rango.' });

  renderBars('rep-responsables', groupAgg(list,
      oc => oc.responsable?.codigo || '—',
      oc => oc.responsable?.nombre || '—'),
    { grandTotal: grand, emptyMsg: 'Sin responsables en el rango.' });
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

  $('foc-title').textContent = 'OC ' + oc.nroOC;
  $('foc-estado').innerHTML  = estadoChip(oc);

  const items = oc.items || [];
  const itemsHtml = items.length ? `
    <table class="foc-items">
      <thead><tr>
        <th>Descripción</th><th class="foc-n">Cant.</th><th>Un.</th>
        <th class="foc-n">Unitario</th><th class="foc-n">Total</th>
      </tr></thead>
      <tbody>
        ${items.map(it => `<tr>
          <td>${esc(it.desc)}</td>
          <td class="foc-n">${esc(it.cant)}</td>
          <td>${esc(it.unidad)}</td>
          <td class="foc-n">${esc(fmtDec(it.unitario, cur))}</td>
          <td class="foc-n">${esc(fmtDec(it.total, cur))}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<div class="rep-empty">Esta OC no guardó el detalle de ítems.</div>';

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

  $('foc-body').innerHTML = `
    <div class="foc-grid">
      ${fichaRow('Fecha', oc.fecha)}
      ${fichaRow('Obra', oc.obra)}
      ${fichaRow('Proveedor', prov.nombre)}
      ${fichaRow('CUIT', prov.cuit)}
      ${fichaRow('Cond. IVA', prov.condicionIVA)}
      ${fichaRow('Cond. pago', oc.condicionPago)}
      ${fichaRow('Equipo', oc.equipo ? `${oc.equipo.codigo}${oc.equipo.tipo ? ' — ' + oc.equipo.tipo : ''}` : '')}
      ${fichaRow('Responsable', oc.responsable?.nombre)}
      ${fichaRow('Moneda', cur)}
    </div>
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

  $('foc-pdf').disabled = oc.estado === 'pendiente';
  $('modal-oc').classList.remove('hidden');
}

function closeOCDetail() {
  $('modal-oc').classList.add('hidden');
  detailKey = null;
}

// Regenera el PDF a partir del payload guardado (idéntico al original) o, para
// registros viejos, reconstruyéndolo desde los campos sueltos.
async function verPDF() {
  const oc = ocByKey(detailKey);
  if (!oc) return;
  const btn = $('foc-pdf');
  btn.disabled = true;
  try {
    const prov = oc.proveedor || {};
    const ocData = oc._payload ? { ...oc._payload } : {
      nroOC:    oc.nroOC,
      fecha:    oc.fecha,
      moneda:   oc.moneda || 'ARS',
      ejecutor: oc.responsable?.nombre || '',
      proveedor: {
        nombre:    prov.nombre       || '',
        cuit:      prov.cuit         || '',
        codigoInterno: prov.codigoInterno || '',
        domicilio: prov.domicilio    || '',
        telefonos: prov.telefonos    || '',
        iva:       prov.condicionIVA || '',
        pago:      oc.condicionPago  || '',
        plazo:     '', lugar:        '',
        ref:       prov.ref          || '',
        ubicacion: oc.obra           || ''
      },
      equipo: oc.equipo || null,
      items: (oc.items || []).map(it => ({
        desc: it.desc || '', unidad: it.unidad || '', cant: it.cant || 0,
        unitario: it.unitario || 0, total: it.total || 0
      })),
      impuestos:       oc.impuestos      || [],
      totalLetras:     numberToWords(oc.total || 0),
      _total:          oc.total          || 0,
      _firma:          null,
      _descuento:      oc.descuento      || { pct: null, monto: 0 },
      _noGravado:      oc.noGravado      || { pct: null, monto: 0 },
      _impuestosExtra: oc.impuestosExtra || []
    };

    if (oc.estado === 'autorizada' && oc.autorizacion) {
      ocData._firmante = oc.autorizacion.firmante || ocData.ejecutor;
      if (oc.autorizacion.firmaCodigo && typeof getFirma === 'function') {
        try { ocData._firma = await getFirma(oc.autorizacion.firmaCodigo); } catch (_) {}
      }
    }

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

async function deleteOC() {
  const oc = ocByKey(detailKey);
  if (!oc) return;
  const ok = await showConfirm('Borrar OC',
    `¿Borrar la OC ${oc.nroOC} (${fmtFull(oc.total, oc.moneda || 'ARS')}) del historial? No se puede deshacer. El archivo en Drive no se toca.`);
  if (!ok) return;

  const btn = $('foc-delete'); btn.disabled = true; btn.textContent = 'Borrando…';
  try {
    await deleteHistorialEntry(detailKey);
    const i = ALL.indexOf(oc); if (i >= 0) ALL.splice(i, 1);
    const j = ALL_RAW.indexOf(oc); if (j >= 0) ALL_RAW.splice(j, 1);
    toast('OC borrada.', 'success');
    closeOCDetail();
    render();
  } catch (e) {
    toast('No se pudo borrar. ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Borrar OC';
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
  { to: 'La Molienda I',        from: ['La Molienda I - Yeso'] },
  { to: 'Colectora Dean Funes', from: ['Dean Funes'] },
  { to: 'UPC Capilla del Monte', from: ['UPC CAPILLA DEL MONTE'] },
  { to: 'Oficina Técnica',      from: ['Oficina Tecnica'] },
];

function openMergeModal() {
  const present  = new Set(ALL.map(o => o.obra).filter(Boolean));
  const countFor = name => ALL.filter(o => o.obra === name).length;
  const groups = MERGE_PROPOSAL
    .map(g => ({ to: g.to, from: g.from.filter(f => present.has(f)) }))
    .filter(g => g.from.length);

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

  let isAdmin = code === '0000';
  if (!isAdmin) {
    try { const u = await getUsuario(code); isAdmin = !!(u && u.admin); } catch (_) {}
  }
  if (!isAdmin) { window.location.href = 'menu.html'; return; }

  setupSegmented('seg-moneda', 'moneda');
  setupSegmented('seg-rate',   'rate');
  $('rep-desde').addEventListener('change', () => { state.desde = $('rep-desde').value; render(); });
  $('rep-hasta').addEventListener('change', () => { state.hasta = $('rep-hasta').value; render(); });
  $('chk-no-emitidas').addEventListener('change', e => { state.incluirNoEmitidas = e.target.checked; render(); });
  $('btn-clear-dates').addEventListener('click', () => {
    state.desde = ''; state.hasta = '';
    $('rep-desde').value = ''; $('rep-hasta').value = '';
    render();
  });
  $('btn-export').addEventListener('click', () => window.print());

  // Ficha de OC
  $('foc-close').addEventListener('click', closeOCDetail);
  $('foc-cerrar').addEventListener('click', closeOCDetail);
  $('foc-pdf').addEventListener('click', verPDF);
  $('foc-delete').addEventListener('click', deleteOC);
  $('modal-oc').addEventListener('click', e => { if (e.target.id === 'modal-oc') closeOCDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOCDetail(); });

  $('btn-merge-obras').addEventListener('click', openMergeModal);
  $('mmg-close').addEventListener('click',  () => $('modal-merge').classList.add('hidden'));
  $('mmg-cancel').addEventListener('click', () => $('modal-merge').classList.add('hidden'));
  $('mmg-apply').addEventListener('click', applyMerge);

  // Nombres de obras para reasignación
  try { OBRAS_ALL = (await getAllObras()).map(o => o.nombre); } catch (_) {}

  renderDolarHoy();
  if (typeof getDolarSnapshot === 'function') getDolarSnapshot().then(renderDolarHoy).catch(() => {});

  try {
    ALL_RAW   = await getHistorial(code, true);
    cutoffTs  = driveCutoff(ALL_RAW);
    const conRespaldo = ALL_RAW.filter(oc => (oc.timestamp || 0) >= cutoffTs);
    excluidas = ALL_RAW.length - conRespaldo.length;
    ALL       = conRespaldo.filter(oc => !esObraPrueba(oc));
    dePrueba  = conRespaldo.length - ALL.length;
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
