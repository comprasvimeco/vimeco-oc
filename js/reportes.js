/* ===================================================
   VIMECO OC — Reportes → Explorar
   reportes.js

   Paso 2 del rediseño de Reportes, traído de Leva.
   La pestaña Obras y la ficha de obra (paso 3) están en reportesObras.js, que
   también lleva las pestañas y la navegación; el Tablero (paso 4), en
   reportesTablero.js, y el Resumen (paso 5), en reportesResumen.js.

   - Período: Mes (calendario, con flechas; el mes en curso se compara con los
     mismos días del anterior), 3 meses, 6 meses y Año (el calendario en curso).
   - Acumulado por semana apilado por obra, torta por obra, barras por
     responsable y por equipo, y la lista de todas las OC con buscador.
   - Tocar una obra, un responsable o un equipo filtra toda la pestaña; la
     búsqueda, sólo la lista. El PDF del período sale con lo mismo que la lista.
   - Totales en pesos al dólar oficial de la fecha de cada OC (el que guardó la
     OC; si no guardó, el de hoy). Cada OC de la lista, en su moneda.
   - Sólo compras firmes (emitidas y autorizadas) desde que existe el respaldo
     en Archivo, sin las OC de prueba.

   Lo operativo (OC duplicadas, obras con otro nombre, borrar una OC) se mudó a
   Novedades: js/novedadesDatos.js.
   =================================================== */

let ALL_RAW = [];   // todo /historial (la comparación de precios de la ficha)
let FIRMES  = [];   // lo que cuenta: compras firmes con respaldo, sin las de prueba
let PATENTES = {};  // código de equipo → patente (de la ficha del equipo)
let remitosPorOC = {};

const $ = id => document.getElementById(id);
const DIA = 864e5;
const MESES    = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MESES_LG = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];
const PERIODOS = { mes: 'Mes', '3m': '3 meses', '6m': '6 meses', anio: 'Año' };
const PER_DIAS = { '3m': 91, '6m': 182 };
const VER_PASO = 20;       // OC de la lista por tanda
const OBRAS_LEY = 8;       // obras en la leyenda de la torta antes de «Ver todas»
const BARRAS_MAX = 8;      // responsables / equipos antes de «Ver todos»

const EX = {
  per: 'mes', mesOff: 0,
  obra: null, resp: null, equipo: null,     // filtros de toda la pestaña (clave) o null
  q: '', orden: 'fecha', dir: -1, ver: VER_PASO,
  obrasTodas: false, respTodos: false, eqTodos: false,
};
let MES_MIN = 0;           // el mes más viejo con compras, como desplazamiento (≤ 0)

// ---- Formato ----
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const nf = (n, d = 0) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtFull(n, cur) { return (cur === 'USD' ? 'US$ ' : '$ ') + nf(Math.round(Number(n) || 0)); }
// Totales: millones con un decimal; lo chico, entero.
function money(n, cur) {
  if (cur === 'USD') return fmtFull(n, 'USD');
  const m = (Number(n) || 0) / 1e6;
  if (Math.abs(m) >= 1) return '$ ' + nf(m, Math.abs(m) >= 100 ? 0 : 1) + ' M';
  return fmtFull(n, 'ARS');
}
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const dd = n => String(n).padStart(2, '0');
const dm  = ts => { const d = new Date(ts); return dd(d.getDate()) + '/' + dd(d.getMonth() + 1); };
const dmy = ts => { const d = new Date(ts); return dm(ts) + '/' + d.getFullYear(); };
const isoDe = ts => { const d = new Date(ts); return d.getFullYear() + '-' + dd(d.getMonth() + 1) + '-' + dd(d.getDate()); };

// ---- Pesos ----
// Al oficial que guardó la OC al emitirse; las viejas sin cotización, al de hoy.
// null = no hay con qué convertir: esa OC queda fuera de los totales.
const _ars = new WeakMap();
function ars(oc) {
  if (_ars.has(oc)) return _ars.get(oc);
  const total = Number(oc.total) || 0;
  let v = total;
  if (oc.moneda === 'USD') {
    const snap = oc.cotizacion || (typeof getDolarCached === 'function' ? getDolarCached() : null);
    const r = snap?.oficial?.venta || snap?.oficial?.compra;
    v = r ? total * r : null;
  }
  _ars.set(oc, v);
  return v;
}
const sumARS = list => list.reduce((s, oc) => s + (ars(oc) || 0), 0);

// ---- Claves de agrupación ----
// Por el nombre de la obra en /obras: «Edificio  belgrano» y «Edificio Belgrano» son una.
const obraKey   = oc => oc.obra ? canonObra(oc.obra) : '—';
const obraLabel = k => k === '—' ? 'Sin obra' : k;
const respKey   = oc => oc.responsable?.codigo || oc.responsable?.nombre || '—';
const respLabel = oc => oc.responsable?.nombre || '—';
function patenteDe(eq) { return (eq && (eq.patente || PATENTES[eq.codigo])) || ''; }
function equipoLabel(eq) {
  if (!eq || !eq.codigo) return '';
  const pat = patenteDe(eq);
  return eq.codigo + (pat ? ` (${pat})` : '') + (eq.tipo ? ' — ' + eq.tipo : '');
}

// Grupos de `list` por clave, del que más gastó al que menos.
function agrupar(list, keyFn, labelFn) {
  const m = new Map();
  list.forEach(oc => {
    const k = keyFn(oc);
    let g = m.get(k);
    if (!g) m.set(k, g = { key: k, label: labelFn(oc, k), total: 0, n: 0 });
    g.total += ars(oc) || 0;
    g.n++;
  });
  return [...m.values()].sort((a, b) => b.total - a.total);
}

// ===================================================
//  Período
// ===================================================
function finHoy() { const h = new Date(); h.setHours(0, 0, 0, 0); return h.getTime() + DIA; }   // 0 h de mañana

// { ini, fin } (fin exclusivo) y el período con que se compara: { pIni, pFin } o null.
function rango() {
  const fin0 = finHoy(), hoy = new Date();
  if (EX.per === 'mes') {
    const a = new Date(hoy.getFullYear(), hoy.getMonth() + EX.mesOff, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    const ini = a.getTime(), fin = Math.min(b.getTime(), fin0), parcial = fin < b.getTime();
    const pa = new Date(a.getFullYear(), a.getMonth() - 1, 1);
    // En curso: del 1 al mismo día del mes anterior (o hasta su fin, si es más corto).
    const dias = Math.round((fin - ini) / DIA);
    const pFin = parcial ? Math.min(new Date(pa.getFullYear(), pa.getMonth(), 1 + dias).getTime(), ini) : ini;
    return { ini, fin, pIni: pa.getTime(), pFin, mes: a, parcial,
      cmp: parcial ? `vs. 1 al ${new Date(pFin - DIA).getDate()} de ${MESES_LG[pa.getMonth()]}` : `vs. ${MESES_LG[pa.getMonth()]}` };
  }
  if (EX.per === 'anio') {
    return { ini: new Date(hoy.getFullYear(), 0, 1).getTime(), fin: fin0, pIni: null, pFin: null, cmp: '' };
  }
  const n = PER_DIAS[EX.per], ini = fin0 - n * DIA;
  return { ini, fin: fin0, pIni: ini - n * DIA, pFin: ini, cmp: `vs. los ${PERIODOS[EX.per]} anteriores` };
}

function labelRango(r) {
  if (EX.per === 'mes') {
    const m = MESES_LG[r.mes.getMonth()];
    return m[0].toUpperCase() + m.slice(1) + ' de ' + r.mes.getFullYear() + (r.parcial ? ` (al ${new Date(r.fin - DIA).getDate()})` : '');
  }
  if (EX.per === 'anio') return `Año ${new Date(r.ini).getFullYear()} (al ${dm(r.fin - DIA)})`;
  return `${dmy(r.ini)} – ${dmy(r.fin - DIA)}`;
}

// ---- Filtros ----
// `ign`: el filtro que no se aplica, para la tarjeta que lo elige (la torta se
// arma sin el de obra, así se ve el resto atenuado y se puede cambiar).
function pasa(oc, ign) {
  if (ign !== 'obra'   && EX.obra   !== null && obraKey(oc) !== EX.obra) return false;
  if (ign !== 'resp'   && EX.resp   !== null && respKey(oc) !== EX.resp) return false;
  if (ign !== 'equipo' && EX.equipo !== null && oc.equipo?.codigo !== EX.equipo) return false;
  return true;
}
function ocsEntre(ini, fin, ign) {
  return FIRMES.filter(oc => { const t = oc.timestamp || 0; return t >= ini && t < fin && pasa(oc, ign); });
}
function ocsEx(ign) { const r = rango(); return ocsEntre(r.ini, r.fin, ign); }

// ---- Colores de las obras ----
// Las cuatro que más gastaron en el período (sin el filtro de obra) llevan
// color propio; el resto va como «Otras», en gris.
let COLORES = new Map();
function asignarColores(gruposObra) {
  COLORES = new Map(gruposObra.slice(0, 4).map((g, i) => [g.key, `var(--s${i + 1})`]));
}
const colorDe = k => COLORES.get(k) || 'var(--otros)';

// Series del acumulado y de la torta: las obras con color y, si hay, «Otras».
function series(gruposObra) {
  if (EX.obra !== null) return [{ key: EX.obra, label: obraLabel(EX.obra), color: colorDe(EX.obra), match: oc => obraKey(oc) === EX.obra }];
  const top = gruposObra.slice(0, 4).map(g => ({ key: g.key, label: obraLabel(g.key), color: colorDe(g.key), match: oc => obraKey(oc) === g.key }));
  if (gruposObra.length > 4) {
    const conColor = new Set(top.map(s => s.key));
    top.push({ key: null, label: `Otras (${gruposObra.length - 4})`, color: 'var(--otros)', match: oc => !conColor.has(obraKey(oc)) });
  }
  return top;
}

// ===================================================
//  Render
// ===================================================
let VISTA = null;   // lo que necesitan el gráfico y la lista sin recalcular todo

function render() {
  const r = rango();
  const l = ocsEx(), tot = sumARS(l);
  const lObras = ocsEx('obra'), gObras = agrupar(lObras, obraKey, (oc, k) => obraLabel(k));
  asignarColores(gObras);
  const ser = series(gObras);

  let varPill = '';
  if (r.pIni !== null) {
    const prev = sumARS(ocsEntre(r.pIni, r.pFin));
    if (prev) {
      const v = Math.round((tot / prev - 1) * 100);
      varPill = `<span class="rx-pill ${v > 0 ? 'rx-warn' : 'rx-ok'}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}% ${esc(r.cmp)}</span>`;
    } else if (tot) {
      varPill = `<span class="rx-pill rx-off">sin compras ${esc(r.cmp.replace(/^vs\. /, 'en '))}</span>`;
    }
  }

  const filtros = [
    EX.obra   !== null && ['obra', obraLabel(EX.obra)],
    EX.resp   !== null && ['resp', (FIRMES.find(oc => respKey(oc) === EX.resp) && respLabel(FIRMES.find(oc => respKey(oc) === EX.resp))) || EX.resp],
    EX.equipo !== null && ['equipo', equipoLabel(FIRMES.find(oc => oc.equipo?.codigo === EX.equipo)?.equipo) || EX.equipo],
  ].filter(Boolean);

  VISTA = { r, l, ser };
  const conEquipo = (EX.equipo !== null || ocsEx('equipo').some(oc => oc.equipo?.codigo));

  $('rx-app').innerHTML = `
    <div class="rx-head">
      <div class="rx-ctl">
        <div class="rx-seg" role="group" aria-label="Período">${Object.entries(PERIODOS).map(([k, n]) =>
          `<button type="button" data-per="${k}" class="${EX.per === k ? 'on' : ''}" aria-pressed="${EX.per === k}">${n}</button>`).join('')}</div>
        ${mesNav(r)}
        ${filtros.map(([k, n]) => `<button type="button" class="rx-chip" data-quitar="${k}" title="Quitar el filtro"><span>${esc(n)}</span> ✕</button>`).join('')}
        ${EX.obra !== null && obraPorNombre(EX.obra) ? `<button type="button" class="rx-mas" data-ver-ficha="${esc(EX.obra)}">Ver la ficha ›</button>` : ''}
        ${filtros.length ? '<span class="rx-muted">filtra toda la página</span>' : ''}
      </div>
      <div class="rx-tot"><span class="v">${money(tot)}</span><span class="rx-muted">${l.length} OC</span>${varPill}</div>
    </div>
    <div class="rx-grid">
      <section class="rx-card rx-c7" aria-label="Acumulado por semana">
        <div class="rx-row"><h3>Acumulado por semana</h3><span class="rx-muted" id="rx-acum-u"></span></div>
        <div class="rx-chart" id="rx-acum"></div>
        <div class="rx-ley">${l.length ? ser.map(s => `<span><span class="rx-sw" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('') : ''}</div>
      </section>
      <section class="rx-card rx-c5" aria-label="${esc('Por obra')}">
        <div class="rx-row"><h3>${esc('Por obra')}</h3><span class="rx-muted">tocá para filtrar</span></div>
        ${tortaHtml(lObras, gObras)}
      </section>
      <div class="rx-col rx-c4">
        <section class="rx-card" aria-label="Por responsable">
          <div class="rx-row"><h3>Por responsable</h3><span class="rx-muted">tocá para filtrar</span></div>
          ${respHtml()}
        </section>
        ${conEquipo ? `<section class="rx-card" aria-label="${esc('Por equipo')}">
          <div class="rx-row"><h3>${esc('Por equipo')}</h3><span class="rx-muted">tocá para filtrar</span></div>
          ${equiposHtml()}
        </section>` : ''}
      </div>
      <section class="rx-card rx-c8" aria-label="Todas las OC">
        <div class="rx-row"><h3>Todas las OC</h3><span class="rx-muted rx-num" id="rx-n"></span>
          <button type="button" class="foc-btn foc-btn--oc rx-pdf" id="rx-pdf" title="Descargar en PDF las OC del período">${icSvg('file')}PDF</button></div>
        <div class="rx-buscar">
          <input class="rx-inp" id="rx-q" type="search" value="${esc(EX.q)}" autocomplete="off"
            placeholder="${esc('Buscar artículo, proveedor, obra, responsable o N° de OC…')}" aria-label="Buscar OC">
          <select class="rx-sel rx-sort-tel" id="rx-orden" aria-label="Ordenar">${ORDENES_TEL.map(([v, t]) =>
            `<option value="${v}"${v === EX.orden + ':' + EX.dir ? ' selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div id="rx-tabla"></div>
        <span class="rx-foot">Sólo OC emitidas y autorizadas. Cada fila va en la moneda de la OC; los totales, en pesos al dólar oficial de la fecha de cada OC.</span>
      </section>
    </div>`;

  dibujarAcum();
  renderTabla();
}

function mesNav(r) {
  if (EX.per !== 'mes') return '';
  const m = MESES_LG[r.mes.getMonth()];
  return `<div class="rx-mes">
    <button type="button" data-mes="-1" aria-label="Mes anterior"${EX.mesOff <= MES_MIN ? ' disabled' : ''}>‹</button>
    <b>${m[0].toUpperCase() + m.slice(1)} ${r.mes.getFullYear()}</b>${r.parcial ? `<span class="rx-muted">al ${new Date(r.fin - DIA).getDate()}</span>` : ''}
    <button type="button" data-mes="1" aria-label="Mes siguiente"${EX.mesOff >= 0 ? ' disabled' : ''}>›</button></div>`;
}

// ---- Acumulado por semana, apilado por obra ----
// Arranca en 0 el primer día del período y suma al cierre de cada semana (de
// lunes a domingo; la última, hasta hoy). Se dibuja al ancho real.
let ACUM = null;
function dibujarAcum() {
  const box = $('rx-acum');
  if (!box || !VISTA) return;
  const { r, l, ser } = VISTA;
  if (!l.length) { box.innerHTML = '<div class="rx-empty">No hay compras en este período.</div>'; $('rx-acum-u').textContent = ''; ACUM = null; return; }

  const W = Math.max(280, box.clientWidth || 600), H = W < 520 ? 210 : 260;
  const Lm = 40, B = 22, T = 18, Rm = 12;
  const lun = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
  const cortes = [r.ini];
  for (let t = lun(r.ini) + 7 * DIA; t < r.fin; t += 7 * DIA) cortes.push(t);
  cortes.push(r.fin);
  // valores[s][i]: acumulado de la serie s al corte i.
  const nCortes = cortes.length;
  const sem = ser.map(() => new Array(nCortes).fill(0));
  l.forEach(oc => {
    const s = ser.findIndex(x => x.match(oc));
    if (s < 0) return;
    const t = oc.timestamp || 0;
    let i = 1; while (i < nCortes - 1 && t >= cortes[i]) i++;
    sem[s][i] += ars(oc) || 0;
  });
  const acum = sem.map(v => { let a = 0; return v.map(x => (a += x)); });
  const tot = cortes.map((_, i) => acum.reduce((s, v) => s + v[i], 0));

  const maxT = Math.max(...tot, 1);
  const div = maxT >= 1e6 ? 1e6 : 1e3;
  $('rx-acum-u').textContent = div === 1e6 ? 'millones de $' : 'miles de $';
  const maxV = nice(maxT / div);
  const x = i => Lm + (cortes[i] - r.ini) / (r.fin - r.ini) * (W - Lm - Rm);
  const y = v => H - B - v / div / maxV * (H - B - T);

  let base = cortes.map(() => 0), areas = '';
  ser.forEach((s, k) => {
    const tope = base.map((b, i) => b + acum[k][i]);
    const d = tope.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ') + ' ' +
      base.map((v, i) => 'L' + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).reverse().join(' ') + ' Z';
    areas += `<path d="${d}" fill="${s.color}" fill-opacity=".85" stroke="var(--surface)" stroke-width="1.5" stroke-linejoin="round"/>`;
    base = tope;
  });
  const ticks = [0, .25, .5, .75, 1].map(f => {
    const v = maxV * f * div;
    return `<line x1="${Lm}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>` +
      `<text x="${Lm - 7}" y="${y(v) + 4}" text-anchor="end">${nf(maxV * f, Number.isInteger(maxV * f) ? 0 : 1)}</text>`;
  }).join('');
  // Abajo: los meses; en un solo mes, el día de cada corte.
  let marcas = '', ultX = -99, ultM = -1;
  cortes.forEach((t, i) => {
    if (i === nCortes - 1 && nCortes > 2) return;
    const d = new Date(t);
    const txt = EX.per === 'mes' ? dm(t) : (d.getMonth() !== ultM ? MESES[d.getMonth()] : '');
    ultM = d.getMonth();
    if (!txt || x(i) - ultX < (EX.per === 'mes' ? 42 : 30)) return;
    marcas += `<text x="${x(i)}" y="${H - 5}" text-anchor="${i ? 'middle' : 'start'}">${txt}</text>`;
    ultX = x(i);
  });
  const fin = tot[nCortes - 1];
  const finLbl = `<text x="${x(nCortes - 1)}" y="${y(fin) - 7}" text-anchor="end" style="fill:var(--ink);font-weight:700;font-size:12px">${esc(money(fin))}</text>`;

  ACUM = { cortes, acum, tot, ser, x, W };
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Compras acumuladas por semana: ${esc(money(fin))} al final del período">
    ${ticks}${areas}${finLbl}${marcas}
    <line id="rx-acum-x" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" opacity="0"/>
    <rect x="${Lm}" y="0" width="${W - Lm}" height="${H - B}" fill="transparent"/></svg>
    <div class="rx-tip" id="rx-acum-tip" hidden></div>`;

  const svg = box.querySelector('svg'), tip = $('rx-acum-tip'), linea = $('rx-acum-x');
  const mover = e => {
    const b = svg.getBoundingClientRect(), sx = (e.clientX - b.left) / b.width * ACUM.W;
    let i = 1, mejor = Infinity;
    for (let k = 1; k < ACUM.cortes.length; k++) { const dd2 = Math.abs(ACUM.x(k) - sx); if (dd2 < mejor) { mejor = dd2; i = k; } }
    linea.setAttribute('x1', ACUM.x(i)); linea.setAttribute('x2', ACUM.x(i)); linea.setAttribute('opacity', '.5');
    tip.innerHTML = `<b>Hasta el ${dm(ACUM.cortes[i] - DIA)}</b>` +
      ACUM.ser.map((s, k) => `<div class="tr"><span><span class="rx-sw" style="background:${s.color}"></span>${esc(s.label)}</span><span>${esc(money(ACUM.acum[k][i]))}</span></div>`).join('') +
      (ACUM.ser.length > 1 ? `<div class="tr tt"><span>Total</span><span>${esc(money(ACUM.tot[i]))}</span></div>` : '');
    tip.hidden = false;
    const px = ACUM.x(i) / ACUM.W * b.width, w = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(b.width - w, px + (px > b.width / 2 ? -w - 14 : 14))) + 'px';
  };
  svg.addEventListener('pointermove', mover);
  svg.addEventListener('pointerdown', mover);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; linea.setAttribute('opacity', '0'); });
}

function nice(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// ---- Torta por obra ----
function tortaHtml(lObras, gObras) {
  if (!lObras.length) return '<div class="rx-empty">No hay compras en este período.</div>';
  const total = sumARS(lObras) || 1;
  // Los gajos: las obras con color y «Otras» (sin el filtro de obra, para elegir otra).
  const conColor = gObras.slice(0, 4);
  const resto = gObras.slice(4).reduce((s, g) => s + g.total, 0);
  const gajos = conColor.map(g => ({ key: g.key, label: obraLabel(g.key), total: g.total, color: colorDe(g.key) }));
  if (resto) gajos.push({ key: null, label: 'Otras', total: resto, color: 'var(--otros)' });

  const R = 80, r = 52, c = 85;
  let a0 = -Math.PI / 2, segs = '';
  gajos.forEach(g => {
    if (!g.total) return;
    const a1 = a0 + g.total / total * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0;
    const P = (rad, a) => (c + rad * Math.cos(a)).toFixed(2) + ' ' + (c + rad * Math.sin(a)).toFixed(2);
    const d = g.total >= total * 0.9999
      ? `M ${c} ${c - R} A ${R} ${R} 0 1 1 ${c - 0.01} ${c - R} L ${c - 0.01} ${c - r} A ${r} ${r} 0 1 0 ${c} ${c - r} Z`
      : `M ${P(R, a0)} A ${R} ${R} 0 ${big} 1 ${P(R, a1)} L ${P(r, a1)} A ${r} ${r} 0 ${big} 0 ${P(r, a0)} Z`;
    const dim = EX.obra !== null && g.key !== EX.obra;
    segs += `<path d="${d}" fill="${g.color}" stroke="var(--surface)" stroke-width="2"${dim ? ' class="rx-dim"' : ''}
      ${g.key !== null ? `data-fo="${esc(g.key)}"` : 'data-otras="1"'}><title>${esc(g.label)}: ${esc(money(g.total))} (${pct(g.total, total)}%)</title></path>`;
    a0 = a1;
  });
  const lista = EX.obrasTodas ? gObras : gObras.slice(0, OBRAS_LEY);
  return `<div class="rx-donut">
    <svg viewBox="0 0 170 170" width="170" height="170" role="img" aria-label="${esc('Compras por obra')}">${segs}
      <text x="85" y="80" text-anchor="middle" style="fill:var(--ink-2);font-size:11px;font-family:var(--font-texto)">Total</text>
      <text x="85" y="99" text-anchor="middle" style="fill:var(--ink);font-size:16px;font-weight:800;font-family:var(--font-display)">${esc(money(total))}</text></svg>
    <div class="rx-lg">${lista.map(g => `
      <button type="button" class="rx-it${EX.obra !== null && EX.obra !== g.key ? ' rx-dim' : ''}" data-fo="${esc(g.key)}" aria-pressed="${EX.obra === g.key}">
        <span class="nm"><span class="rx-sw" style="background:${colorDe(g.key)}"></span>${esc(obraLabel(g.key))}</span>
        <span class="rx-num rx-muted">${esc(money(g.total))}</span><b class="rx-num">${pct(g.total, total)}%</b></button>`).join('')}
      ${gObras.length > OBRAS_LEY ? `<button type="button" class="rx-mas" data-mas-obras="1">${EX.obrasTodas ? 'Ver menos' : `Ver todas las obras (${gObras.length})`}</button>` : ''}
    </div></div>`;
}

// ---- Barras por responsable y por equipo ----
function barrasHtml(grupos, attr, activo, todos, masAttr, cls) {
  if (!grupos.length) return '<div class="rx-empty">No hay compras en este período.</div>';
  const max = grupos[0].total || 1;
  const lista = todos ? grupos : grupos.slice(0, BARRAS_MAX);
  return `<div class="rx-bars">${lista.map(g => `
    <button type="button" class="rx-hb${cls ? ' ' + cls : ''}${activo !== null && activo !== g.key ? ' rx-dim' : ''}" ${attr}="${esc(g.key)}" aria-pressed="${activo === g.key}">
      <span class="rx-row"><span>${esc(g.label)} <span class="rx-muted">· ${g.n} OC</span></span><span class="rx-num">${esc(money(g.total))}</span></span>
      <span class="tr2"><i style="width:${Math.max(1, g.total / max * 100)}%"></i></span></button>`).join('')}
    ${grupos.length > BARRAS_MAX ? `<button type="button" class="rx-mas" ${masAttr}="1">${todos ? 'Ver menos' : `Ver todos (${grupos.length})`}</button>` : ''}</div>`;
}

function respHtml() {
  return barrasHtml(agrupar(ocsEx('resp'), respKey, respLabel), 'data-fr', EX.resp, EX.respTodos, 'data-mas-resp', '');
}

// Sólo las OC con equipo: las demás no son un equipo llamado «Sin equipo». Arriba,
// Repuestos / Mantenimiento de lo que se ve.
function equiposHtml() {
  const l = ocsEx('equipo').filter(oc => oc.equipo?.codigo);
  const cats = agrupar(EX.equipo !== null ? l.filter(oc => oc.equipo.codigo === EX.equipo) : l,
    oc => oc.equipo.categoria || 'Sin categoría', (oc, k) => k);
  const tono = { Repuestos: 'rx-ok', Mantenimiento: 'rx-warn' };
  return (cats.length ? `<div class="rx-cats">${cats.map(c =>
      `<span class="rx-pill ${tono[c.key] || 'rx-off'}">${esc(c.label)} · ${esc(money(c.total))}</span>`).join('')}</div>` : '') +
    barrasHtml(agrupar(l, oc => oc.equipo.codigo, oc => equipoLabel(oc.equipo)), 'data-fe', EX.equipo, EX.eqTodos, 'data-mas-eq', 'eq');
}

// ---- Todas las OC ----
const ORDENES_TEL = [
  ['fecha:-1', 'Más nuevas'], ['fecha:1', 'Más viejas'],
  ['importe:-1', 'Mayor importe'], ['importe:1', 'Menor importe'],
  ['proveedor:1', 'Proveedor A–Z'], ['obra:1', 'Obra A–Z'],
];
const ORDEN_KEY = {
  fecha:     oc => oc.timestamp || 0,
  importe:   oc => ars(oc) || 0,
  proveedor: oc => normTxt(oc.proveedor?.nombre),
  obra:      oc => normTxt(obraLabel(obraKey(oc))),
  resp:      oc => normTxt(respLabel(oc)),
};
function ordenar(list) {
  const k = ORDEN_KEY[EX.orden] || ORDEN_KEY.fecha;
  return [...list].sort((a, b) => {
    const A = k(a), B = k(b);
    return (A < B ? -1 : A > B ? 1 : (a.timestamp || 0) - (b.timestamp || 0)) * EX.dir;
  });
}
function filasLista() {
  const terms = terminosBusqueda(EX.q);
  const l = VISTA ? VISTA.l : [];
  return { terms, filas: ordenar(terms.length ? l.filter(oc => coincideOC(oc, terms)) : l) };
}

// Categoría de la obra (la de obras.js): casita, ruta o maletín, con los tonos de Obras.
const CAT_ICON = { arquitectura: 'building', vial: 'road', oficina: 'briefcase' };
function catObra(oc) {
  const c = oc.obra ? obraPorNombre(oc.obra)?.categoria : '';
  return CAT_ICON[c] ? c : '';
}
function catTile(cat) {
  const lbl = cat ? OBRA_CATS[cat].label : 'Sin categoría';
  return `<span class="rx-cat rx-cat--${cat || 'sin'}" title="${esc(lbl)}" aria-label="${esc(lbl)}">${icSvg(CAT_ICON[cat] || 'box')}</span>`;
}

function renderTabla() {
  const box = $('rx-tabla');
  if (!box) return;
  const { terms, filas } = filasLista();
  $('rx-n').textContent = `${filas.length} · ${money(sumARS(filas))}`;
  const hl = t => resaltarTxt(t, terms, esc);
  const th = (k, txt, cls = '') => `<th class="${cls}" data-sort="${k}" tabindex="0" aria-sort="${EX.orden === k ? (EX.dir > 0 ? 'ascending' : 'descending') : 'none'}">${txt}${EX.orden === k ? (EX.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  const rows = filas.slice(0, EX.ver).map(oc => {
    const items = oc.items || [];
    const hits = terms.length ? itemsCoincidentes(oc, terms) : [];
    const it = hits[0] || items[0];
    const otros = (hits.length ? hits.length : items.length) - 1;
    const det = it ? hl(it.desc) + (otros > 0 ? ` <span>y ${otros} más</span>` : '') : '';
    const cur = oc.moneda === 'USD' ? 'USD' : 'ARS';
    const cat = catObra(oc);
    const sub = [cat && OBRA_CATS[cat].label, oc.rubro?.nombre || (oc.equipo?.codigo ? equipoLabel(oc.equipo) : '')].filter(Boolean);
    return `<tr data-oc="${esc(oc.nroOC)}" tabindex="0">
      <td class="c-cat">${catTile(cat)}</td>
      <td class="c-prov"><span class="prov">${hl(oc.proveedor?.nombre || 'Sin proveedor')}</span><div class="sub">${det}</div></td>
      <td class="c-obra">${hl(obraLabel(obraKey(oc)))}<div class="sub">${sub.map(esc).join(' · ')}</div></td>
      <td class="c-resp">${hl(respLabel(oc))}</td>
      <td class="c-nro"><span class="fch">${dm(oc.timestamp)}</span><div class="sub nro">${hl(oc.nroOC)}</div></td>
      <td class="c-imp r rx-num"><b>${esc(fmtFull(oc.total, cur))}</b></td></tr>`;
  }).join('');
  box.innerHTML = `<table class="rx-oc"><thead><tr><th class="c-cat" aria-label="Categoría"></th>${th('proveedor', 'Proveedor · Detalle')}${th('obra', esc('Obra') + ' · Rubro')}${th('resp', 'Responsable')}${th('fecha', 'Fecha · N°')}${th('importe', 'Importe', 'r')}</tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="rx-empty">${EX.q.trim() ? 'No hay OC que coincidan con la búsqueda.' : 'No hay compras en este período.'}</td></tr>`}</tbody></table>` +
    (filas.length > EX.ver ? `<div style="text-align:center;margin-top:.75rem"><button type="button" class="foc-btn foc-btn--sec" data-mas-oc="1">Ver ${Math.min(VER_PASO, filas.length - EX.ver)} más de ${filas.length - EX.ver}</button></div>` : '');
}

// ===================================================
//  Ficha de la OC (la de Novedades y Historial)
// ===================================================
function abrirFicha(nro) {
  const oc = FIRMES.find(o => o.nroOC === nro);
  if (!oc) return;
  cerrarFicha();
  const modal = $('modal-preview');
  const token = String(Math.random());
  modal.dataset.token = token;
  const vigente = () => modal.dataset.token === token;

  const data  = ocDataFromRecord(oc);
  const facts = facturasDeOC(oc);
  const rems  = remitosPorOC[oc.nroOC] || [];
  const pill  = (tipo, n, txt) => n
    ? `<button class="hist-doc hist-doc--${tipo}" data-doc="${tipo}" aria-expanded="false">${icSvg(tipo === 'fact' ? 'file' : 'truck')}${esc(txt)}${
        n > 1 ? icSvg('chevron', 'hist-doc-chev') : ''}</button>`
    : '';
  const resp = oc.responsable?.nombre ? `<span class="foc-chip">${esc(oc.responsable.nombre)}</span>` : '';
  const cmp  = checkOCHistorial(data, ALL_RAW, oc.timestamp);
  // En dólares: cuánto cuenta en los totales del reporte.
  const v = ars(oc);
  const conv = oc.moneda === 'USD'
    ? `<div class="foc-info">${v != null
        ? `En los totales de Reportes cuenta como <b>${esc(fmtFull(v, 'ARS'))}</b>, al dólar oficial ${oc.cotizacion ? 'de la fecha de la OC' : 'de hoy (la OC no guardó cotización)'}.`
        : 'No hay cotización para pasarla a pesos: queda fuera de los totales.'}</div>`
    : '';

  pintarFichaOC(data,
    estadoChipFicha(oc) + resp
      + pill('fact', facts.length, facts.length > 1 ? `Facturas · ${facts.length}` : 'Factura')
      + pill('rem',  rems.length,  rems.length  > 1 ? `Remitos · ${rems.length}` : `Remito ${rems[0]?.nro || ''}`),
    conv + `<div id="foc-docs">${docsListasHtml(facts, rems)}</div>` + fichaInfoHtml(cmp.info) + comparacionHtml(cmp.cambios));
  bindDocsOC(modal, oc, facts, rems, { encima: true });

  // Drive: sólo si la OC ya tiene su carpeta registrada. El PDF se arma en el momento.
  const url = driveUrlOf(oc);
  const drv = $('preview-drive');
  drv.classList.toggle('hidden', !url);
  if (url) drv.href = url; else drv.removeAttribute('href');
  $('preview-nodrive').classList.toggle('hidden', !!url);
  const pdf = $('preview-pdf');
  pdf.removeAttribute('href');
  pdf.setAttribute('aria-disabled', 'true');
  modal.classList.remove('hidden');
  ocDataParaPdf(oc).then(d => {
    if (!vigente()) return;
    const blobUrl = URL.createObjectURL(generateOCBlob(d));
    modal.dataset.blobUrl = blobUrl;
    pdf.href = blobUrl;
    pdf.removeAttribute('aria-disabled');
  }).catch(e => {
    if (vigente()) toast('No se pudo generar el PDF.', 'error');
    console.error('ficha/pdf:', e);
  });
}

function cerrarFicha() {
  const modal = $('modal-preview');
  if (modal.dataset.blobUrl) { URL.revokeObjectURL(modal.dataset.blobUrl); delete modal.dataset.blobUrl; }
  delete modal.dataset.token;
  $('preview-body').innerHTML = '';
  modal.classList.add('hidden');
}

// ===================================================
//  PDF del período (js/resumenPDF.js)
// ===================================================
function remDetalle(rem) {
  if (!rem.con) return 'ninguna con entregas';
  const p = [];
  if (rem.completas) p.push(`${rem.completas} completa${rem.completas !== 1 ? 's' : ''}`);
  if (rem.parciales) p.push(`${rem.parciales} parcial${rem.parciales !== 1 ? 'es' : ''}`);
  return p.join(' · ');
}

function descargarPDF(btn) {
  btn.disabled = true;
  try {
    const { r, l } = VISTA;
    const { filas } = filasLista();
    const total = sumARS(l);
    const prevL = r.pIni !== null ? ocsEntre(r.pIni, r.pFin) : null;
    const varTxt = (a, b) => {
      if (b == null) return 'sin período anterior para comparar';
      if (!b) return 'sin compras en el período anterior';
      const v = (a / b - 1) * 100;
      return `${v >= 0 ? '+' : '−'}${nf(Math.abs(v), 1)}% ${r.cmp}`;
    };
    const conF = l.filter(oc => estadoFacturaOC(oc).estado === 'con');
    const rem = { con: 0, completas: 0, parciales: 0 };
    l.forEach(oc => {
      const e = oc.entrega?.estado;
      if (e !== 'parcial' && e !== 'completa') return;
      rem.con++; if (e === 'completa') rem.completas++; else rem.parciales++;
    });
    const tops = gs => gs.slice(0, 5).map(g => ({ label: g.label, val: money(g.total), pct: pct(g.total, total) + '%' }));
    const prov = indiceProveedores(l);

    const notas = ['Sólo OC emitidas y autorizadas.'];
    if (EX.obra   !== null) notas.push(`Filtrado por obra: ${obraLabel(EX.obra)}.`);
    if (EX.resp   !== null) notas.push(`Filtrado por responsable: ${respLabel(l.find(oc => respKey(oc) === EX.resp) || {})}.`);
    if (EX.equipo !== null) notas.push(`Filtrado por equipo: ${equipoLabel(l.find(oc => oc.equipo?.codigo === EX.equipo)?.equipo) || EX.equipo}.`);
    if (EX.q.trim()) notas.push(`Listado filtrado por «${EX.q.trim()}»: ${filas.length} de ${l.length} OC. Los totales son del período completo.`);
    if (l.some(oc => oc.moneda === 'USD')) notas.push('Totales en pesos al dólar oficial de la fecha de cada OC; el importe de cada fila va en su moneda.');
    const noConv = l.filter(oc => ars(oc) == null).length;
    if (noConv) notas.push(`${noConv} OC en dólares sin cotización quedan fuera de los totales.`);

    const ahora = new Date();
    const data = {
      rango:    labelRango(r),
      subrango: `${isoDe(r.ini)} ${isoDe(r.fin - DIA)}`,
      moneda:   'ARS',
      totalStr: fmtFull(total, 'ARS'),
      generado: `${dmy(ahora.getTime())} ${dd(ahora.getHours())}:${dd(ahora.getMinutes())}`,
      notas,
      kpis: [
        { lbl: 'Total del período', val: money(total), sub: varTxt(total, prevL && sumARS(prevL)) },
        { lbl: 'OC emitidas', val: String(l.length), sub: varTxt(l.length, prevL && prevL.length) },
        { lbl: 'Con factura', val: String(conF.length), sub: money(sumARS(conF)), color: [30, 125, 58] },
        { lbl: 'Con remito', val: String(rem.con), sub: remDetalle(rem), color: [22, 105, 95] },
      ],
      topObras: tops(agrupar(l, obraKey, (oc, k) => obraLabel(k))),
      topProv:  tops(agrupar(l, prov, oc => oc.proveedor?.nombre || 'Sin proveedor')),
      ocs: filas.map(oc => ({
        fecha:       dm(oc.timestamp),
        nroOC:       oc.nroOC,
        proveedor:   oc.proveedor?.nombre || '—',
        obra:        obraLabel(obraKey(oc)),
        equipo:      equipoLabel(oc.equipo) || oc.rubro?.nombre || '—',
        responsable: respLabel(oc),
        importe:     fmtFull(oc.total, oc.moneda === 'USD' ? 'USD' : 'ARS'),
      })),
    };

    const url = URL.createObjectURL(generateResumenBlob(data));
    const a = document.createElement('a');
    a.href = url;
    a.download = resumenFileName(data);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast('No se pudo generar el PDF.', 'error');
    console.error('resumenPDF:', e);
  } finally {
    btn.disabled = false;
  }
}

// ===================================================
//  Controles
// ===================================================
function alternar(campo, key) {
  EX[campo] = EX[campo] === key ? null : key;
  EX.ver = VER_PASO;
  render();
}

function onClick(e) {
  if (onClickResumen(e) || onClickTablero(e) || onClickObras(e)) return;
  const b = e.target.closest('[data-per],[data-mes],[data-quitar],[data-fo],[data-otras],[data-fr],[data-fe],[data-sort],[data-oc],[data-mas-oc],[data-mas-obras],[data-mas-resp],[data-mas-eq],#rx-pdf');
  if (!b) return;
  const d = b.dataset;
  if (d.per)     { if (EX.per !== d.per) { EX.per = d.per; EX.mesOff = 0; EX.ver = VER_PASO; render(); } return; }
  if (d.mes)     { const m = EX.mesOff + Number(d.mes); if (m <= 0 && m >= MES_MIN) { EX.mesOff = m; EX.ver = VER_PASO; render(); } return; }
  if (d.quitar)  { EX[d.quitar] = null; EX.ver = VER_PASO; render(); return; }
  if (d.fo !== undefined) { alternar('obra', d.fo); return; }
  if (d.otras)   { EX.obrasTodas = true; render(); return; }
  if (d.fr !== undefined) { alternar('resp', d.fr); return; }
  if (d.fe !== undefined) { alternar('equipo', d.fe); return; }
  if (d.sort)    {
    if (EX.orden === d.sort) EX.dir = -EX.dir;
    else { EX.orden = d.sort; EX.dir = d.sort === 'fecha' || d.sort === 'importe' ? -1 : 1; }
    syncOrdenTel(); renderTabla(); return;
  }
  if (d.oc)      { abrirFicha(d.oc); return; }
  if (d.masOc)   { EX.ver += VER_PASO; renderTabla(); return; }
  if (d.masObras) { EX.obrasTodas = !EX.obrasTodas; render(); return; }
  if (d.masResp) { EX.respTodos = !EX.respTodos; render(); return; }
  if (d.masEq)   { EX.eqTodos = !EX.eqTodos; render(); return; }
  if (b.id === 'rx-pdf') descargarPDF(b);
}

function syncOrdenTel() {
  const s = $('rx-orden');
  if (s) s.value = EX.orden + ':' + EX.dir;
}

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);
  $('hdr-name').textContent = name;
  $('btn-back').addEventListener('click', () => { window.location.href = 'administracion.html'; });

  let puedeVer = code === '0000', esAdmin = puedeVer;
  if (!puedeVer) {
    try { const u = await getUsuario(code); puedeVer = !!(u && (u.admin || u.reportes)); esAdmin = !!(u && u.admin); } catch (_) {}
  }
  if (!puedeVer) { window.location.href = 'menu.html'; return; }

  const app = $('rx-app');
  app.addEventListener('click', onClick);
  app.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.target.matches('tr[data-oc], th[data-sort], [data-ficha]')) return;
    e.preventDefault();
    onClick(e);
  });
  app.addEventListener('input', e => {
    if (e.target.id !== 'rx-q') return;
    EX.q = e.target.value; EX.ver = VER_PASO;
    renderTabla();
  });
  app.addEventListener('change', e => {
    if (e.target.id !== 'rx-orden') return;
    const [o, dir] = e.target.value.split(':');
    EX.orden = o; EX.dir = Number(dir);
    renderTabla();
  });
  $('modal-preview-close').addEventListener('click', cerrarFicha);
  $('modal-preview').addEventListener('click', e => { if (e.target.id === 'modal-preview') cerrarFicha(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal-preview').classList.contains('hidden')) cerrarFicha(); });

  // Desde la ficha de una obra (obras.html) o de un equipo se llega con
  // ?obra=NOMBRE o ?equipo=CÓDIGO: arranca filtrado, en el año.
  const qs = new URLSearchParams(location.search);
  if (qs.get('obra'))   { EX.obra = qs.get('obra'); EX.per = 'anio'; }
  if (qs.get('equipo')) { EX.equipo = qs.get('equipo'); EX.per = 'anio'; }

  if (typeof getDolarSnapshot === 'function') getDolarSnapshot().catch(() => {});
  try {
    const eqP = getAllEquipos().catch(() => []);
    const obP = getAllObras().catch(e => { console.error('getAllObras:', e); return []; });
    ALL_RAW = await getHistorial(code, true);
    (await eqP).forEach(e => { if (e.patente) PATENTES[e.codigo] = e.patente; });
    OBRAS = await obP;
    OBRA_CANON = new Map(OBRAS.map(o => [normObraNombre(o.nombre), o.nombre]));
    if (EX.obra !== null) EX.obra = canonObra(EX.obra);
    const corte = driveCutoff(ALL_RAW);
    FIRMES = ALL_RAW.filter(oc => (oc.timestamp || 0) >= corte && esCompraFirme(oc) && !esOCPrueba(oc));
    const primera = FIRMES.reduce((m, oc) => Math.min(m, oc.timestamp || Infinity), Infinity);
    if (isFinite(primera)) {
      const a = new Date(primera), h = new Date();
      MES_MIN = -((h.getFullYear() - a.getFullYear()) * 12 + h.getMonth() - a.getMonth());
    }
    initNav(esAdmin, qs);
    pintar();
    remitosPorOCAsync().then(m => { remitosPorOC = m; }).catch(() => {});
  } catch (e) {
    console.error('getHistorial:', e);
    app.innerHTML = '<div class="rx-cargando">No se pudieron cargar las órdenes. Revisá tu conexión y recargá.</div>';
  }
});

// El acumulado y las compras por mes se dibujan al ancho real: se redibujan al cambiar el tamaño.
let _rzT = null;
window.addEventListener('resize', () => {
  clearTimeout(_rzT);
  _rzT = setTimeout(() => { dibujarAcum(); dibujarMeses(); }, 150);
});
