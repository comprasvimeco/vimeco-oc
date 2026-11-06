/* ===================================================
   VIMECO OC — Reportes → Explorar
   reportes.js

   La pestaña Obras y la ficha de obra están en reportesObras.js, que también
   lleva las pestañas y la navegación; el Resumen, en reportesResumen.js.

   - Período: Mes (calendario, con flechas; el mes en curso se compara con los
     mismos días del anterior), 3 meses, 6 meses y Año (el calendario en curso).
     Se compara sólo si hay compras desde antes del período anterior.
   - Acumulado apilado por obra, por día, semana, quincena o mes según lo que
     haya para mostrar (granoPara); rankings por obra, proveedor, responsable y
     equipo (uno con un solo nombre no sale), y la lista de todas las OC.
   - Tocar una obra, un proveedor, un responsable o un equipo filtra toda la
     pestaña. El PDF del período sale con lo mismo que la lista.
   - El buscador va abajo del período y encuentra artículo, proveedor, obra,
     responsable o N° de OC. Mientras se busca, en vez del gráfico y los rankings:
     los precios de lo buscado (reportesPrecios.js) y las OC que coinciden.
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
const OBRAS_LEY = 4;       // obras en su ranking antes de «Ver todas»
const BARRAS_MAX = 4;      // proveedores / responsables / equipos antes de «Ver todos»
const SERIES_MAX = 6;      // obras con su color en el acumulado y la torta; el resto, «Otras»
const COLORES_OBRA = 8;    // --s1…--s8 en reportes.html, validados contra daltonismo

const EX = {
  per: 'mes', mesOff: 0,
  obra: null, prov: null, resp: null, equipo: null,     // filtros de toda la pestaña (clave) o null
  q: '', qTodo: false, artTodos: false, artFoco: {}, artProvs: {}, orden: 'fecha', dir: -1, ver: VER_PASO,
  obrasTodas: false, respTodos: false, eqTodos: false, provTodos: false,
};
let MES_MIN = 0;           // el mes más viejo con compras, como desplazamiento (≤ 0)
let PRIMERA_OC = null;     // timestamp de la primera compra firme
let PROV_KEY = () => '—';  // oc → su proveedor (las variantes de un mismo CUIT van juntas)

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
// `ign`: el filtro que no se aplica, para la tarjeta que lo elige (el ranking de
// obras se arma sin el de obra, así se ve el resto atenuado y se puede cambiar).
function pasa(oc, ign) {
  if (ign !== 'obra'   && EX.obra   !== null && obraKey(oc) !== EX.obra) return false;
  if (ign !== 'prov'   && EX.prov   !== null && PROV_KEY(oc) !== EX.prov) return false;
  if (ign !== 'resp'   && EX.resp   !== null && respKey(oc) !== EX.resp) return false;
  if (ign !== 'equipo' && EX.equipo !== null && oc.equipo?.codigo !== EX.equipo) return false;
  return true;
}
function ocsEntre(ini, fin, ign) {
  return FIRMES.filter(oc => { const t = oc.timestamp || 0; return t >= ini && t < fin && pasa(oc, ign); });
}
function ocsEx(ign) { const r = rango(); return ocsEntre(r.ini, r.fin, ign); }

// ---- Colores de las obras ----
// Cada obra tiene el suyo en todas las pestañas: se reparten por orden de la primera compra, así
// una obra nueva no le cambia el color a las que ya estaban. Pasando los ocho vuelven a empezar;
// la lista de cada gráfico dice cuál es cuál.
let COLORES = new Map();
function asignarColores() {
  COLORES = new Map();
  [...FIRMES].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).forEach(oc => {
    const k = obraKey(oc);
    if (k !== '—' && !COLORES.has(k)) COLORES.set(k, `var(--s${COLORES.size % COLORES_OBRA + 1})`);
  });
}
const colorDe = k => COLORES.get(k) || 'var(--otros)';
const swObra = k => `<span class="rx-sw" style="background:${colorDe(k)}" aria-hidden="true"></span>`;

// Series del acumulado: las obras con color y, si hay, «Otras».
function series(gruposObra) {
  if (EX.obra !== null) return [{ key: EX.obra, label: obraLabel(EX.obra), color: colorDe(EX.obra), match: oc => obraKey(oc) === EX.obra }];
  const top = gruposObra.slice(0, SERIES_MAX).map(g => ({ key: g.key, label: obraLabel(g.key), color: colorDe(g.key), match: oc => obraKey(oc) === g.key }));
  if (gruposObra.length > SERIES_MAX) {
    const conColor = new Set(top.map(s => s.key));
    top.push({ key: null, label: `Otras (${gruposObra.length - SERIES_MAX})`, color: 'var(--otros)', match: oc => !conColor.has(obraKey(oc)) });
  }
  return top;
}

// ===================================================
//  Render
// ===================================================
let VISTA = null;   // lo que necesita la lista sin recalcular todo

// Lo que se ve con la empresa sin ninguna OC (Resumen y Explorar).
function sinOCHtml() {
  return `<section class="rx-card rx-vac">
    <span class="rx-vac-i">${icSvg('file')}</span>
    <h2>Todavía no hay compras</h2>
    <p>Con la primera OC, acá vas a ver cuánto llevás, a quién le comprás y cuánto pagaste cada cosa.</p>
    <a class="rx-btn" href="app.html">Hacer la primera OC</a>
  </section>`;
}

// «↑ 12 %» contra otro período. Lo gastado va en color; una cuenta (`neutro`), sin juzgar.
function deltaHtml(a, b, neutro) {
  const v = Math.round((a / b - 1) * 100);
  return `<span class="rx-dl${neutro || !v ? '' : v > 0 ? ' up' : ' dn'}">${v > 0 ? '↑ ' : v < 0 ? '↓ ' : ''}${Math.abs(v)} %</span>`;
}

// Período y buscador quedan fijos; lo de abajo se repinta sin sacarle el foco al buscador.
function render() {
  if (!FIRMES.length) { $('rx-app').innerHTML = sinOCHtml(); return; }
  const r = rango();
  $('rx-app').innerHTML = `
    <div class="rx-seg rx-per" role="group" aria-label="Período">${Object.entries(PERIODOS).map(([k, n]) =>
      `<button type="button" data-per="${k}" class="${EX.per === k ? 'on' : ''}" aria-pressed="${EX.per === k}">${n}</button>`).join('')}</div>
    ${mesNav(r)}
    <div class="rx-qw">${icSvg('search')}<input class="rx-inp rx-q" id="rx-q" type="search" value="${esc(EX.q)}" autocomplete="off"
      placeholder="${esc(voc('Artículo, proveedor, centro, N° de OC…'))}" aria-label="${esc(voc('Buscar artículo, proveedor, centro, responsable o N° de OC'))}"></div>
    <div id="rx-ex" class="rx-col"></div>`;
  renderCuerpo();
}

// La lista de OC: la misma tarjeta con o sin búsqueda.
function listaHtml() {
  return `<section class="rx-card rx-c12" aria-label="Todas las OC">
        <div class="rx-row"><h3>${EX.q.trim() ? 'OC que coinciden' : 'Todas las OC'}</h3><span class="rx-muted rx-num" id="rx-n"></span>
          <button type="button" class="foc-btn foc-btn--oc rx-pdf" id="rx-pdf" title="Descargar en PDF las OC del período">${icSvg('file')}PDF</button></div>
        <div class="rx-buscar">
          <select class="rx-sel rx-sort-tel" id="rx-orden" aria-label="Ordenar">${ORDENES_TEL.map(([v, t]) =>
            `<option value="${v}"${v === EX.orden + ':' + EX.dir ? ' selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div id="rx-tabla"></div>
        <span class="rx-foot">Sólo OC emitidas y autorizadas. Cada fila va en la moneda de la OC; los totales, en pesos al dólar oficial de la fecha de cada OC.</span>
      </section>`;
}

function renderCuerpo() {
  const box = $('rx-ex');
  if (!box) return;
  const r = rango();
  const l = ocsEx(), tot = sumARS(l);
  const lObras = ocsEx('obra'), gObras = agrupar(lObras, obraKey, (oc, k) => obraLabel(k));
  const ser = series(gObras);

  let varPill = '';
  if (r.pIni !== null && PRIMERA_OC !== null && PRIMERA_OC <= r.pIni) {
    const prev = sumARS(ocsEntre(r.pIni, r.pFin));
    if (prev) varPill = `${deltaHtml(tot, prev)}<span class="rx-muted">${esc(r.cmp)}</span>`;
  }

  const provDe = k => FIRMES.find(oc => PROV_KEY(oc) === k);
  const filtros = [
    EX.obra   !== null && ['obra', obraLabel(EX.obra)],
    EX.prov   !== null && ['prov', provDe(EX.prov)?.proveedor?.nombre || 'Sin proveedor'],
    EX.resp   !== null && ['resp', (FIRMES.find(oc => respKey(oc) === EX.resp) && respLabel(FIRMES.find(oc => respKey(oc) === EX.resp))) || EX.resp],
    EX.equipo !== null && ['equipo', equipoLabel(FIRMES.find(oc => oc.equipo?.codigo === EX.equipo)?.equipo) || EX.equipo],
  ].filter(Boolean);

  VISTA = { r, l, ser };
  const chips = filtros.length ? `<div class="rx-ctl">
      ${filtros.map(([k, n]) => `<button type="button" class="rx-chip" data-quitar="${k}" title="Quitar el filtro"><span>${esc(n)}</span> ✕</button>`).join('')}
      ${EX.obra !== null && obraPorNombre(EX.obra) ? `<button type="button" class="rx-mas" data-ver-ficha="${esc(EX.obra)}">Ver la ficha ›</button>` : ''}
    </div>` : '';

  const terms = terminosBusqueda(EX.q);
  if (terms.length) {
    box.innerHTML = `${chips}
      ${coincidenciasHtml(terms)}
      ${preciosHtml(FIRMES.filter(oc => pasa(oc)), terms)}
      ${listaHtml()}`;
    renderTabla();
    return;
  }

  GRAF.ex = l.length ? acumulado(r, l, ser) : null;

  const gProv = agrupar(ocsEx('prov'), PROV_KEY, oc => oc.proveedor?.nombre || 'Sin proveedor');
  const gResp = agrupar(ocsEx('resp'), respKey, respLabel);
  const lEq = vocActivos() ? ocsEx('equipo').filter(oc => oc.equipo?.codigo) : [];
  // Un ranking con un solo nombre no dice nada, salvo que sea el filtro que se quiere sacar.
  const hay = (n, activo) => n > 1 || (activo !== null && n > 0);
  const dim = (titulo, cuerpo) => `<section class="rx-card rx-c6" aria-label="${esc(titulo)}">
        <div class="rx-row"><h3>${esc(titulo)}</h3><span class="rx-muted">tocá para filtrar</span></div>
        ${cuerpo}
      </section>`;

  box.innerHTML = `
    <div class="rx-tot2"><span class="v">${money(tot)}</span>
      <div class="rx-tot-l"><span class="rx-muted">${l.length} OC</span>${varPill}</div></div>
    ${chips}
    <div class="rx-grid">
      ${GRAF.ex ? `<section class="rx-card rx-c12" aria-label="${esc(GRAF.ex.titulo)}">
        <div class="rx-row"><h3>${esc(GRAF.ex.titulo)}</h3><span class="rx-muted">${esc(GRAF.ex.nota)}</span></div>
        <div id="rx-gr-ex">${grafInner('ex')}</div>
      </section>` : `<section class="rx-card rx-c12"><div class="rx-empty">No hay compras en este período.</div></section>`}
      ${hay(gObras.length, EX.obra) ? dim(voc('Por centro'), porCentroHtml(lObras, gObras)) : ''}
      ${hay(gProv.length, EX.prov) ? dim('Por proveedor', barrasHtml(gProv, 'data-fp', EX.prov, EX.provTodos, 'data-mas-prov', true)) : ''}
      ${hay(gResp.length, EX.resp) ? dim('Por responsable', barrasHtml(gResp, 'data-fr', EX.resp, EX.respTodos, 'data-mas-resp')) : ''}
      ${hay(new Set(lEq.map(oc => oc.equipo.codigo)).size, EX.equipo) ? dim(voc('Por activo'), equiposHtml()) : ''}
      ${listaHtml()}
    </div>`;

  renderTabla();
}

function mesNav(r) {
  if (EX.per !== 'mes') return '';
  const m = MESES_LG[r.mes.getMonth()];
  return `<div class="rx-mes rx-mesnav">
    <button type="button" data-mes="-1" aria-label="Mes anterior"${EX.mesOff <= MES_MIN ? ' disabled' : ''}>‹</button>
    <b>${m[0].toUpperCase() + m.slice(1)} ${r.mes.getFullYear()}</b>${r.parcial ? `<span class="rx-muted">al ${new Date(r.fin - DIA).getDate()}</span>` : ''}
    <button type="button" data-mes="1" aria-label="Mes siguiente"${EX.mesOff >= 0 ? ' disabled' : ''}>›</button></div>`;
}

// ---- Gráficos de área (Resumen y Explorar) ----
// Van en %, así que no hay que redibujarlos al cambiar el tamaño. Se tocan por columnas: la
// columna elegida pasa a la lectura de arriba y, si hay varias series, a la lista de abajo.
const GRAF = {};   // id → { cub: [{ ini, fin, x, lab }], ser: [{ label, color, vals }], sel }

// Cortes entre `ini` y `fin` (exclusivo): por día, de lunes a domingo, del 1 al 15 y del 16 a
// fin de mes, o por mes calendario.
function cubetas(ini, fin, modo) {
  const c = [];
  if (modo === 'mes') {
    const d = new Date(ini);
    for (let a = new Date(d.getFullYear(), d.getMonth(), 1); a.getTime() < fin; a = new Date(a.getFullYear(), a.getMonth() + 1, 1)) {
      const sig = new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime();
      c.push({ ini: Math.max(a.getTime(), ini), fin: Math.min(sig, fin), x: MESES[a.getMonth()], lab: MESES_LG[a.getMonth()] });
    }
    return c;
  }
  if (modo === 'quincena') {
    const d = new Date(ini);
    for (let a = new Date(d.getFullYear(), d.getMonth(), d.getDate() > 15 ? 16 : 1); a.getTime() < fin; ) {
      const sig = a.getDate() === 1 ? new Date(a.getFullYear(), a.getMonth(), 16) : new Date(a.getFullYear(), a.getMonth() + 1, 1);
      const de = new Date(Math.max(a.getTime(), ini));
      c.push({ ini: de.getTime(), fin: Math.min(sig.getTime(), fin), x: `${de.getDate()} ${MESES[de.getMonth()]}`, lab: `quincena del ${de.getDate()} de ${MESES_LG[de.getMonth()]}` });
      a = sig;
    }
    return c;
  }
  const d = new Date(ini);
  d.setHours(0, 0, 0, 0);
  if (modo === 'dia') {
    for (let a = d; a.getTime() < fin; ) {
      const sig = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
      c.push({ ini: a.getTime(), fin: Math.min(sig.getTime(), fin), x: `${a.getDate()} ${MESES[a.getMonth()]}`, lab: `${a.getDate()} de ${MESES_LG[a.getMonth()]}` });
      a = sig;
    }
    return c;
  }
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  for (let t = d.getTime(); t < fin; ) {
    const a = new Date(t), sig = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7).getTime();
    const de = new Date(Math.max(t, ini));
    c.push({ ini: Math.max(t, ini), fin: Math.min(sig, fin), x: `${de.getDate()} ${MESES[de.getMonth()]}`, lab: `semana del ${de.getDate()} de ${MESES_LG[de.getMonth()]}` });
    t = sig;
  }
  return c;
}

// Los cortes desde el primero con compras: no se dibuja lo que todavía no existía.
function cubetasCon(ini, fin, modo, l) {
  const c = cubetas(ini, fin, modo);
  const en = (x, oc) => (oc.timestamp || 0) >= x.ini && (oc.timestamp || 0) < x.fin;
  return c.slice(Math.max(0, c.findIndex(x => l.some(oc => en(x, oc)))));
}

// Cómo se nombra cada tamaño de corte en el acumulado.
const GRANOS = {
  dia:      { titulo: 'Acumulado por día', nota: 'tocá un día', prefijo: 'Hasta el ' },
  semana:   { titulo: 'Acumulado por semana', nota: 'tocá una semana', prefijo: 'Hasta la ' },
  quincena: { titulo: 'Acumulado por quincena', nota: 'tocá una quincena', prefijo: 'Hasta la ' },
  mes:      { titulo: 'Acumulado por mes', nota: 'tocá un mes', prefijo: 'Hasta ' },
};

// El acumulado de Explorar: el corte sale de los días entre la primera compra y el fin del período.
function acumulado(r, l, ser) {
  const primera = Math.min(...l.map(oc => oc.timestamp || r.fin));
  const modo = granoPara(Math.ceil((r.fin - primera) / DIA));
  const cub = cubetasCon(r.ini, r.fin, modo, l);
  const vals = ser.map(() => cub.map(() => 0));
  l.forEach(oc => {
    const s = ser.findIndex(x => x.match(oc)), t = oc.timestamp || 0, i = cub.findIndex(x => t >= x.ini && t < x.fin);
    if (s >= 0 && i >= 0) vals[s][i] += ars(oc) || 0;
  });
  return {
    cub, sel: null, ...GRANOS[modo],
    ser: ser.map((s, k) => { let a = 0; return { label: s.label, color: s.color, vals: vals[k].map(v => (a += v)) }; }),
  };
}

function grafInner(id) {
  const g = GRAF[id], n = g.cub.length, sel = g.sel !== null && g.sel < n ? g.sel : n - 1;
  const tot = i => g.ser.reduce((s, x) => s + x.vals[i], 0);
  const maxV = nice(Math.max(...g.cub.map((_, i) => tot(i)), 1));
  const xs = g.cub.map((_, i) => (i + .5) / n * 100), ix = g.cub.map((_, i) => i);
  const py = v => (100 - v / maxV * 88).toFixed(2);
  const base = ix.map(() => 0);
  let areas = '', lineas = '';
  g.ser.forEach(s => {
    if (!s.vals.some(v => v)) return;
    const abajo = ix.map((i, k) => xs[k].toFixed(2) + ' ' + py(base[k]));
    const arriba = ix.map((i, k) => { base[k] += s.vals[i]; return xs[k].toFixed(2) + ' ' + py(base[k]); });
    areas += `<path class="rx-gr-a" style="fill:${s.color}" d="M${arriba.join(' L')} L${abajo.reverse().join(' L')} Z"/>`;
    lineas += `<path class="rx-gr-l" style="stroke:${s.color}" d="M${arriba.join(' L')}"/>`;
  });
  const salto = Math.ceil(n / 5), totSel = tot(sel), parte = totSel || 1;
  const rotulo = i => g.prefijo + g.cub[i].lab;
  const leyenda = g.ser.length > 1 ? `<div class="rx-gr-ley">${[...g.ser].reverse().filter(s => s.vals[sel]).map(s => `
      <div class="rx-row"><span class="rx-ell"><span class="rx-sw" style="background:${s.color}"></span>${esc(s.label)}</span>
        <span class="rx-num">${esc(money(s.vals[sel]))} <span class="rx-muted">${pct(s.vals[sel], parte)}%</span></span></div>`).join('')}</div>` : '';
  const lectura = `<div class="rx-gr-read">${esc(rotulo(sel)[0].toUpperCase() + rotulo(sel).slice(1))}: <b>${esc(money(totSel))}</b></div>`;
  // Con un solo corte no hay línea que trazar.
  if (n === 1) return `${lectura}<span class="rx-foot rx-gr-una">Con más días de compras, acá vas a ver cómo evoluciona.</span>${leyenda}`;
  return `${lectura}
    <div class="rx-gr-plot">
      <span class="rx-gr-g" style="bottom:44%"></span><span class="rx-gr-g" style="bottom:88%"></span>
      <span class="rx-gr-top" style="bottom:89%">${esc(money(maxV))}</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${areas}${lineas}</svg>
      <div class="rx-gr-cols">${g.cub.map((c, i) => `<button type="button" class="rx-gr-c${i === sel ? ' on' : ''}" data-gr="${id}" data-gi="${i}" aria-label="${esc(rotulo(i))}: ${esc(money(tot(i)))}"></button>`).join('')}</div>
      <span class="rx-gr-dot" style="left:${((sel + .5) / n * 100).toFixed(2)}%;bottom:${(totSel / maxV * 88).toFixed(2)}%"></span>
    </div>
    <div class="rx-gr-x">${g.cub.map((c, i) => `<span><i>${(n - 1 - i) % salto === 0 ? esc(c.x) : ''}</i></span>`).join('')}</div>
    ${leyenda}`;
}

function nice(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// ---- Por obra ----
// Con el color que tiene cada una en el acumulado. Sin el filtro de obra, para poder elegir otra.
function porCentroHtml(lObras, gObras) {
  if (!lObras.length) return '<div class="rx-empty">No hay compras en este período.</div>';
  const total = sumARS(lObras) || 1, max = gObras[0].total || 1;
  const lista = EX.obrasTodas ? gObras : gObras.slice(0, OBRAS_LEY);
  return `<div class="rx-bars">${lista.map(g => `
    <button type="button" class="rx-hb${EX.obra !== null && EX.obra !== g.key ? ' rx-dim' : ''}" data-fo="${esc(g.key)}" aria-pressed="${EX.obra === g.key}">
      <span class="rx-row"><span><span class="rx-sw" style="background:${colorDe(g.key)}"></span>${esc(obraLabel(g.key))}</span>
        <span class="rx-num"><span class="rx-muted">${esc(money(g.total))}</span> <span class="por">${pct(g.total, total)}%</span></span></span>
      <span class="tr2"><i style="width:${Math.max(1, g.total / max * 100)}%;background:${colorDe(g.key)}"></i></span></button>`).join('')}
    ${gObras.length > OBRAS_LEY ? `<button type="button" class="rx-mas" data-mas-obras="1">${EX.obrasTodas ? 'Ver menos' : `Ver ${voc('todos los centros')} (${gObras.length})`}</button>` : ''}</div>`;
}

// ---- Barras por responsable y por equipo ----
function barrasHtml(grupos, attr, activo, todos, masAttr, conAvatar) {
  if (!grupos.length) return '<div class="rx-empty">No hay compras en este período.</div>';
  const max = grupos[0].total || 1;
  const lista = todos ? grupos : grupos.slice(0, BARRAS_MAX);
  return `<div class="rx-bars">${lista.map(g => `
    <button type="button" class="rx-hb${activo !== null && activo !== g.key ? ' rx-dim' : ''}" ${attr}="${esc(g.key)}" aria-pressed="${activo === g.key}">
      ${conAvatar ? avatarHtml(g.label) : ''}<span class="rx-hb-m"><span class="rx-row"><span>${esc(g.label)} <span class="rx-muted">· ${g.n} OC</span></span><span class="rx-num">${esc(money(g.total))}</span></span>
      <span class="tr2"><i style="width:${Math.max(1, g.total / max * 100)}%"></i></span></span></button>`).join('')}
    ${grupos.length > BARRAS_MAX ? `<button type="button" class="rx-mas" ${masAttr}="1">${todos ? 'Ver menos' : `Ver todos (${grupos.length})`}</button>` : ''}</div>`;
}

// El círculo con las iniciales: mismo nombre, mismo color. Sólo identifica.
function avatarHtml(nombre) {
  const n = String(nombre || '');
  const p = n.split(/\s+/).filter(w => /[a-záéíóúñ]{3}/i.test(w));
  const ini = ((p[0] || n)[0] || '?') + ((p[1] || '')[0] || '');
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 997;
  return `<span class="rx-av rx-av${h % 5}" aria-hidden="true">${esc(ini.toUpperCase())}</span>`;
}

// Estado de la factura. Recién emitida, que no tenga es lo normal: pasados 30 días, se avisa.
function facturaPill(oc) {
  const e = estadoFacturaOC(oc).estado;
  if (e === 'con') return '<span class="rx-pill rx-ok">Facturada</span>';
  if (e === 'otros') return '<span class="rx-pill rx-off">Con archivos</span>';
  const vieja = (oc.timestamp || 0) < finHoy() - 30 * DIA;
  return `<span class="rx-pill ${vieja ? 'rx-warn' : 'rx-off'}">Sin factura</span>`;
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
    barrasHtml(agrupar(l, oc => oc.equipo.codigo, oc => equipoLabel(oc.equipo)), 'data-fe', EX.equipo, EX.eqTodos, 'data-mas-eq');
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
  if (!terms.length) return { terms, filas: ordenar(l), fuera: 0 };
  const todas = FIRMES.filter(oc => pasa(oc) && coincideOC(oc, terms));
  const delPeriodo = todas.filter(oc => l.includes(oc));
  return { terms, filas: ordenar(EX.qTodo ? todas : delPeriodo), fuera: EX.qTodo ? 0 : todas.length - delPeriodo.length };
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
  const { terms, filas, fuera } = filasLista();
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
    // Buscando un insumo: el precio unitario y la unidad del renglón que coincide.
    const pu = hits.length ? _precioItem(hits[0], cur) : '';
    const puHtml = pu ? `<div class="pu">${esc(pu)}</div>` : '';
    const cat = catObra(oc);
    const sub = [cat && OBRA_CATS[cat].label, oc.rubro?.nombre || (oc.equipo?.codigo ? equipoLabel(oc.equipo) : '')].filter(Boolean);
    return `<tr data-oc="${esc(oc.nroOC)}" tabindex="0">
      <td class="c-prov"><div class="rx-ocw">${avatarHtml(oc.proveedor?.nombre || 'Sin proveedor')}<div><span class="prov">${hl(oc.proveedor?.nombre || 'Sin proveedor')}</span><div class="sub">${det}</div>${puHtml}</div></div></td>
      <td class="c-obra">${swObra(obraKey(oc))}${hl(obraLabel(obraKey(oc)))}<div class="sub">${sub.map(esc).join(' · ')}</div></td>
      <td class="c-resp">${hl(respLabel(oc))}</td>
      <td class="c-nro"><span class="fch">${dm(oc.timestamp)}</span><div class="sub nro">${hl(oc.nroOC)}</div></td>
      <td class="c-imp r rx-num"><b>${esc(fmtFull(oc.total, cur))}</b><div class="rx-imp-p">${facturaPill(oc)}</div></td></tr>`;
  }).join('');
  box.innerHTML = `<table class="rx-oc"><thead><tr>${th('proveedor', 'Proveedor · Detalle')}${th('obra', esc(voc('Centro')) + ' · Rubro')}${th('resp', 'Responsable')}${th('fecha', 'Fecha · N°')}${th('importe', 'Importe', 'r')}</tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="rx-empty">${EX.q.trim() ? (fuera ? 'En este período, ninguna.' : 'No hay OC que coincidan con la búsqueda.') : 'No hay compras en este período.'}</td></tr>`}</tbody></table>` +
    (fuera ? `<button type="button" class="rx-mas" data-q-todo="1">Ver también ${fuera === 1 ? 'la de otro período' : `las ${fuera} de otros períodos`}</button>` : '') +
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
    if (EX.obra   !== null) notas.push(`${voc('Filtrado por centro')}: ${obraLabel(EX.obra)}.`);
    if (EX.prov   !== null) notas.push(`Filtrado por proveedor: ${l.find(oc => PROV_KEY(oc) === EX.prov)?.proveedor?.nombre || 'Sin proveedor'}.`);
    if (EX.resp   !== null) notas.push(`Filtrado por responsable: ${respLabel(l.find(oc => respKey(oc) === EX.resp) || {})}.`);
    if (EX.equipo !== null) notas.push(`${voc('Filtrado por activo')}: ${equipoLabel(l.find(oc => oc.equipo?.codigo === EX.equipo)?.equipo) || EX.equipo}.`);
    if (EX.q.trim()) notas.push(`Listado filtrado por «${EX.q.trim()}»: ${filas.length} OC${EX.qTodo ? ', también de otros períodos' : ` de ${l.length}`}. Los totales son del período completo.`);
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
  renderCuerpo();
}

function onClick(e) {
  const gc = e.target.closest('[data-gi]');
  if (gc) {
    const id = gc.dataset.gr;
    GRAF[id].sel = Number(gc.dataset.gi);
    $('rx-gr-' + id).innerHTML = grafInner(id);
    return;
  }
  if (onClickResumen(e) || onClickObras(e)) return;
  const b = e.target.closest('[data-per],[data-mes],[data-quitar],[data-fo],[data-fp],[data-fr],[data-fe],[data-sort],[data-oc],[data-mas-oc],[data-mas-obras],[data-mas-resp],[data-mas-prov],[data-mas-eq],[data-q-todo],[data-art-todos],[data-foco],[data-art-provs],[data-ir-f],#rx-pdf');
  if (!b) return;
  const d = b.dataset;
  if (d.per)     { if (EX.per !== d.per) { EX.per = d.per; EX.mesOff = 0; EX.ver = VER_PASO; render(); } return; }
  if (d.mes)     { const m = EX.mesOff + Number(d.mes); if (m <= 0 && m >= MES_MIN) { EX.mesOff = m; EX.ver = VER_PASO; render(); } return; }
  if (d.quitar)  { EX[d.quitar] = null; EX.ver = VER_PASO; renderCuerpo(); return; }
  if (d.fo !== undefined) { alternar('obra', d.fo); return; }
  if (d.fr !== undefined) { alternar('resp', d.fr); return; }
  if (d.fe !== undefined) { alternar('equipo', d.fe); return; }
  if (d.fp !== undefined) { alternar('prov', d.fp); return; }
  if (d.sort)    {
    if (EX.orden === d.sort) EX.dir = -EX.dir;
    else { EX.orden = d.sort; EX.dir = d.sort === 'fecha' || d.sort === 'importe' ? -1 : 1; }
    syncOrdenTel(); renderTabla(); return;
  }
  if (d.oc)      { abrirFicha(d.oc); return; }
  if (d.qTodo)   { EX.qTodo = true; EX.ver = VER_PASO; renderTabla(); return; }
  if (d.artTodos) { EX.artTodos = !EX.artTodos; renderCuerpo(); return; }
  if (d.foco !== undefined) { EX.artFoco[d.art] = d.foco; renderCuerpo(); return; }
  if (d.artProvs) { EX.artProvs[d.artProvs] = !EX.artProvs[d.artProvs]; renderCuerpo(); return; }
  if (d.irF)     { EX[d.irF] = d.irK; EX.q = ''; EX.ver = VER_PASO; render(); return; }
  if (d.masOc)   { EX.ver += VER_PASO; renderTabla(); return; }
  if (d.masObras) { EX.obrasTodas = !EX.obrasTodas; renderCuerpo(); return; }
  if (d.masResp) { EX.respTodos = !EX.respTodos; renderCuerpo(); return; }
  if (d.masProv) { EX.provTodos = !EX.provTodos; renderCuerpo(); return; }
  if (d.masEq)   { EX.eqTodos = !EX.eqTodos; renderCuerpo(); return; }
  if (b.id === 'rx-pdf') descargarPDF(b);
}

function syncOrdenTel() {
  const s = $('rx-orden');
  if (s) s.value = EX.orden + ':' + EX.dir;
}

let _qT = null;   // la búsqueda se repinta al dejar de escribir

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);
  $('hdr-name').textContent = name;
  $('btn-back').addEventListener('click', () => vimecoVolver('administracion.html'));

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
    EX.q = e.target.value; EX.ver = VER_PASO; EX.qTodo = false; EX.artTodos = false; EX.artFoco = {}; EX.artProvs = {};
    clearTimeout(_qT);
    _qT = setTimeout(renderCuerpo, 150);
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
    PROV_KEY = indiceProveedores(FIRMES);
    asignarColores();
    const primera = FIRMES.reduce((m, oc) => Math.min(m, oc.timestamp || Infinity), Infinity);
    if (isFinite(primera)) {
      PRIMERA_OC = primera;
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


