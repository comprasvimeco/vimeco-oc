/* ===================================================
   VIMECO OC — Reportes → Obras y ficha de obra
   reportesObras.js

   Paso 3 del rediseño de Reportes, traído de Leva.
   Usa lo de reportes.js (FIRMES, ars, money, esc, abrirFicha…) y el
   presupuesto y plazo de js/presupuesto.js.

   - Obras: una tarjeta por obra, primero lo que necesita atención
     (presupuesto o rubro excedido → gasto adelantado → en ritmo → sin
     presupuesto), con la barra de gasto y la marca del plazo.
   - Ficha: presupuesto contra plazo, proveedores, rubros contra su propio
     presupuesto (el ritmo se mide sólo para la obra entera: cada rubro tiene su
     momento), «Sin rubro» con un toque por OC y «Ver sus OC en Explorar».
   - Cada obra va en la moneda de su presupuesto (sin presupuesto, en pesos):
     las OC en la otra moneda se pasan al dólar oficial de su fecha. Los totales
     de la empresa, en pesos. No se comparan rubros entre obras.
   =================================================== */

let OBRAS = [];                 // /obras completas (con presupuesto, plazo y rubros)
let OBRA_CANON = new Map();     // nombre normalizado → nombre en /obras
const RITMO_UMBRAL = 8;         // puntos de % gastado por encima del % de plazo = gasto adelantado
const RECIENTE_DIAS = 30;       // una obra inactiva con compras en estos días sigue en la lista
const SIN_RUBRO = '__sin';      // rubro elegido en la ficha: las OC sin rubro
const OBRA_CATS = { arquitectura: { label: 'Arquitectura' }, vial: { label: 'Vial' }, oficina: { label: 'Oficina' } };   // las de obras.js

const TABS = [['resumen', 'Resumen'], ['tablero', 'Tablero'], ['obras', 'Obras'], ['explorar', 'Explorar']];
const NAV = { tab: 'explorar', ficha: null, rsel: null };
let TAB_INICIAL = 'explorar';
let VER_INACTIVAS = false;

// Las OC guardan el NOMBRE de la obra: «Edificio  belgrano» y «Edificio Belgrano»
// son la misma. Explorar agrupa por este nombre.
function canonObra(nombre) { return OBRA_CANON.get(normObraNombre(nombre)) || nombre; }
const obraPorKey = k => OBRAS.find(o => o.key === k) || null;
const obraPorNombre = n => OBRAS.find(o => normObraNombre(o.nombre) === normObraNombre(n)) || null;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Monto de una OC en la moneda de la obra. null = no hay cotización para pasarla.
function enMoneda(oc, cur) {
  if (cur !== 'USD') return ars(oc);
  const total = Number(oc.total) || 0;
  if (oc.moneda === 'USD') return total;
  const snap = oc.cotizacion || (typeof getDolarCached === 'function' ? getDolarCached() : null);
  const r = snap?.oficial?.venta || snap?.oficial?.compra;
  return r ? total / r : null;
}

// ===================================================
//  Análisis de una obra
// ===================================================
function analizarObra(o) {
  const n = normObraNombre(o.nombre);
  const ocs = FIRMES.filter(oc => normObraNombre(oc.obra) === n);
  const ed = presEdicion(o);
  const pres = ed.total, cur = pres ? ed.moneda : 'ARS';
  const val = oc => enMoneda(oc, cur) || 0;
  const suma = l => l.reduce((s, oc) => s + val(oc), 0);
  const gast = suma(ocs);

  const fin = finHoy();
  const d30 = suma(ocs.filter(oc => (oc.timestamp || 0) >= fin - 30 * DIA));
  const p30 = suma(ocs.filter(oc => (oc.timestamp || 0) >= fin - 60 * DIA && (oc.timestamp || 0) < fin - 30 * DIA));

  let pl = null;
  if (ed.n && ed.inicio) {
    const plazo = { inicio: ed.inicio, n: ed.n, unidad: ed.unidad };
    pl = { ini: plazoFecha(ed.inicio), fin: plazoFin(ed.inicio, ed.n, ed.unidad), p: plazoAvance(plazo),
      empezo: plazoFecha(ed.inicio) <= new Date(), txt: ed.unidad === 'meses' ? plural(ed.n, 'mes', 'meses') : plural(ed.n, 'día corrido', 'días corridos') };
  }

  // Rubros de la obra, más los que ya no están pero quedaron nombrados en sus OC.
  const lista = rubrosList(o.rubros);
  const porId = new Map(lista.map(r => [r.id, { id: r.id, n: r.nombre, p: ed.rubros[r.id] || 0, g: 0, ocs: [] }]));
  const porNombre = new Map([...porId.values()].map(r => [normTxt(r.n), r]));
  const viejos = new Map(), sinRubro = [];
  ocs.forEach(oc => {
    const rb = oc.rubro;
    if (!rb || (!rb.id && !rb.nombre)) { sinRubro.push(oc); return; }
    let R = porId.get(rb.id) || porNombre.get(normTxt(rb.nombre));
    if (!R) {
      const k = 'x:' + normTxt(rb.nombre || rb.id);
      if (!viejos.has(k)) viejos.set(k, { id: k, n: rb.nombre || rb.id, p: 0, g: 0, ocs: [], viejo: true });
      R = viejos.get(k);
    }
    R.g += val(oc);
    R.ocs.push(oc);
  });
  const rubros = [...porId.values(), ...viejos.values()];
  const repartido = rubros.reduce((s, r) => s + r.p, 0);
  const gp = pres ? pct(gast, pres) : 0;
  const ritmo = pres && pl && pl.empezo ? gp - Math.min(pl.p, 100) : null;

  const a = { o, ocs, cur, val, gast, d30, p30, pres, d30ars: sumARS(ocs.filter(oc => (oc.timestamp || 0) >= fin - 30 * DIA)), pl, gp, ritmo, rubros, conRubros: lista.length > 0,
    sinRubro, sinRubroG: suma(sinRubro), otrosPres: pres && repartido ? pres - repartido : 0 };
  a.estado = estadoObra(a);
  return a;
}

function estadoObra(a) {
  if (!a.pres) return { cls: 'rx-off', txt: 'Sin presupuesto', nivel: 0 };
  if (a.gast > a.pres) return { cls: 'rx-bad', txt: 'Presupuesto excedido', nivel: 4 };
  const exc = a.rubros.filter(r => r.p && r.g > r.p).length;
  if (exc) return { cls: 'rx-bad', txt: exc === 1 ? '1 rubro excedido' : `${exc} rubros excedidos`, nivel: 3 };
  if (a.ritmo !== null && a.ritmo > RITMO_UMBRAL) return { cls: 'rx-warn', txt: 'Gasto adelantado', nivel: 2 };
  return { cls: 'rx-ok', txt: a.ritmo !== null ? 'En ritmo' : 'Dentro del presupuesto', nivel: 1 };
}

const pctRubro = r => r.p ? pct(r.g, r.p) : null;
function varTxt(a, b) {
  const v = Math.round((a / b - 1) * 100);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%';
}

// La frase de la tarjeta: lo primero que hay que saber de la obra.
function fraseObra(a) {
  const m = v => money(v, a.cur);
  if (!a.pres) {
    if (!a.d30 && !a.p30) return 'Sin compras en los últimos 60 días.';
    const cargar = ' Cargale presupuesto para saber si está bien.';
    if (!a.p30) return 'Empezó a comprar en los últimos 30 días.' + cargar;
    if (!a.d30) return 'Sin compras en los últimos 30 días.';
    const v = Math.round((a.d30 / a.p30 - 1) * 100);
    if (Math.abs(v) < 10) return 'Compra parecido a los 30 días anteriores.' + cargar;
    return `Compró ${varTxt(a.d30, a.p30)} que los 30 días anteriores.` + cargar;
  }
  if (a.gast > a.pres) return `Se pasó ${m(a.gast - a.pres)} del presupuesto.`;
  const conP = a.rubros.filter(r => r.p).sort((x, y) => y.g / y.p - x.g / x.p);
  if (conP.length && conP[0].g > conP[0].p) return `${conP[0].n} al ${pctRubro(conP[0])}% de lo presupuestado.`;
  if (a.ritmo !== null && a.ritmo > RITMO_UMBRAL) return `${a.gp}% del presupuesto con ${Math.min(a.pl.p, 100)}% del plazo.`;
  if (conP.length && conP[0].g) return `${conP[0].n} al ${pctRubro(conP[0])}%; el resto, dentro de lo previsto.`;
  return `${a.gp}% del presupuesto usado${a.pl && a.pl.empezo ? ` con ${Math.min(a.pl.p, 100)}% del plazo` : ''}.`;
}

function ritmoTexto(a) {
  if (!a.pl) return 'Sin plazo cargado: se compara sólo contra el total.';
  if (!a.pl.empezo) return `El plazo empieza el ${presDMA(a.pl.ini)}.`;
  if (a.pl.p >= 100) return `El plazo terminó el ${presDMA(a.pl.fin)}, con el ${a.gp}% del presupuesto gastado.`;
  if (a.ritmo > RITMO_UMBRAL) return `Va por arriba del ritmo: ${a.gp}% del presupuesto con ${a.pl.p}% del plazo.`;
  if (a.ritmo < -15) return `Gastó menos de lo que lleva de plazo: ${a.gp}% del presupuesto con ${a.pl.p}% del plazo.`;
  return `Gasto y plazo van parejos: ${a.gp}% del presupuesto con ${a.pl.p}% del plazo.`;
}

function ritmoBar(a) {
  const col = a.gast > a.pres ? 'var(--rosa-fg)' : a.ritmo !== null && a.ritmo > RITMO_UMBRAL ? 'var(--durazno-fg)' : 'var(--lila)';
  const marca = a.pl && a.pl.empezo ? Math.min(a.pl.p, 100) : null;
  return `<div class="rx-track" role="img" aria-label="Gastado ${a.gp}%${marca !== null ? `, plazo ${marca}%` : ''}">
    <i style="width:${Math.min(a.gp, 100)}%;background:${col}"></i>${marca !== null ? `<b style="left:calc(${marca}% - 1px)"></b>` : ''}</div>
    <div class="rx-legend"><span>${a.gp}% gastado</span><span>${marca !== null ? `▏${marca}% del plazo` : a.pl ? `empieza el ${presDMA(a.pl.ini)}` : 'sin plazo'}</span></div>`;
}

const subObra = (o, a, largo) => {
  const cat = OBRA_CATS[o.categoria]?.label || '';
  const p = [cat, !o.activa && 'Inactiva'];
  if (a.pl) p.push(largo ? `${a.pl.txt} · del ${presDMA(a.pl.ini)} al ${presDMA(a.pl.fin)}` : `${presDMA(a.pl.ini)} al ${presDMA(a.pl.fin)}`);
  return p.filter(Boolean).map(esc).join(' · ');
};

// ===================================================
//  Pestaña Obras
// ===================================================
function obrasVisibles() {
  const desde = finHoy() - RECIENTE_DIAS * DIA;
  const todas = OBRAS.filter(o => !OBRAS_PRUEBA.has(normObraNombre(o.nombre))).map(analizarObra);
  const vis = todas.filter(a => a.o.activa || VER_INACTIVAS || a.ocs.some(oc => (oc.timestamp || 0) >= desde));
  vis.sort((x, y) => y.estado.nivel - x.estado.nivel || y.d30ars - x.d30ars || x.o.nombre.localeCompare(y.o.nombre));
  return { vis, ocultas: todas.length - vis.length, todas };
}

function renderObras() {
  const { vis, ocultas, todas } = obrasVisibles();
  const fin = finHoy();
  const t30 = sumARS(FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 30 * DIA));
  const tp30 = sumARS(FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 60 * DIA && (oc.timestamp || 0) < fin - 30 * DIA));
  const nSin = todas.filter(a => a.conRubros).reduce((s, a) => s + a.sinRubro.length, 0);
  const varP = tp30 ? `<span class="rx-pill ${t30 > tp30 ? 'rx-warn' : 'rx-ok'}">${varTxt(t30, tp30)} vs. 30 días anteriores</span>` : '';

  const tarjeta = a => {
    const o = a.o;
    return `<article class="rx-card rx-c6 rx-go" data-ficha="${esc(o.key)}" tabindex="0" role="link" aria-label="${esc(o.nombre)}: ${esc(a.estado.txt)}">
      <div class="rx-row"><div class="rx-l"><h3 class="rx-h3o">${esc(o.nombre)}</h3><span class="rx-muted">${subObra(o, a)}</span></div>
        <span class="rx-pill ${a.estado.cls}">${esc(a.estado.txt)}</span></div>
      ${a.pres ? `<div class="rx-row"><span class="rx-mid">${esc(money(a.gast, a.cur))}</span><span class="rx-muted">de ${esc(money(a.pres, a.cur))}</span></div>${ritmoBar(a)}`
        : `<div class="rx-row"><span class="rx-mid">${esc(money(a.d30, a.cur))}</span><span class="rx-muted">últimos 30 días</span></div>`}
      <div class="rx-frase">${esc(fraseObra(a))}</div>
    </article>`;
  };

  $('rx-app').innerHTML = `
    <div class="rx-head">
      <div class="rx-ctl"><span class="rx-pill rx-lila">Primero lo que necesita atención</span>
        ${nSin ? `<button type="button" class="rx-chip2" data-sinrubro="1">${plural(nSin, 'OC sin rubro', 'OC sin rubro')}</button>` : ''}</div>
      <div class="rx-tot"><span class="rx-muted">Toda la empresa · 30 días</span><span class="v">${esc(money(t30))}</span>${varP}</div>
    </div>
    ${vis.length ? `<div class="rx-grid">${vis.map(tarjeta).join('')}</div>`
      : `<div class="rx-card"><div class="rx-empty">${esc('Todavía no hay obras cargadas. Se dan de alta en Administración → Obras.')}</div></div>`}
    ${ocultas || VER_INACTIVAS ? `<button type="button" class="rx-mas" data-inactivas="1">${VER_INACTIVAS ? 'Ocultar las inactivas sin compras recientes' : `Ver también ${plural(ocultas, 'inactiva sin compras recientes', 'inactivas sin compras recientes')}`}</button>` : ''}`;
}

// ===================================================
//  Ficha de obra
// ===================================================
const OC_PANEL = 30;   // OC en el panel del rubro antes de mandar a Explorar

function rubroDefault(a) {
  const conP = a.rubros.filter(r => r.p).sort((x, y) => y.g / y.p - x.g / x.p);
  return (conP[0] || [...a.rubros].sort((x, y) => y.g - x.g)[0] || {}).id || (a.sinRubro.length ? SIN_RUBRO : null);
}

function renderFicha() {
  const o = obraPorKey(NAV.ficha);
  if (!o) { irA({ ficha: null, rsel: null }, false); return; }
  const a = analizarObra(o), m = v => esc(money(v, a.cur));
  const hayRubros = a.rubros.length > 0 || (a.conRubros && a.sinRubro.length);
  if (hayRubros && (!NAV.rsel || (NAV.rsel !== SIN_RUBRO && !a.rubros.some(r => r.id === NAV.rsel)) || (NAV.rsel === SIN_RUBRO && !a.sinRubro.length))) NAV.rsel = rubroDefault(a);
  const tabNom = (TABS.find(t => t[0] === NAV.tab) || TABS[0])[1];

  // Proveedores, en la moneda de la obra.
  const prov = indiceProveedores(a.ocs), provs = new Map();
  a.ocs.forEach(oc => {
    const k = prov(oc);
    if (!provs.has(k)) provs.set(k, { n: oc.proveedor?.nombre || 'Sin proveedor', g: 0 });
    provs.get(k).g += a.val(oc);
  });
  const topProv = [...provs.values()].sort((x, y) => y.g - x.g);

  const principal = a.pres ? `
    <section class="rx-card rx-c8" aria-label="Presupuesto">
      <div class="rx-row"><span class="rx-k">Presupuesto de compras</span><span class="rx-pill ${a.estado.cls}">${esc(a.estado.txt)}</span></div>
      <div><span class="rx-big">${m(a.gast)}</span> <span class="rx-muted">de ${m(a.pres)}</span></div>
      ${ritmoBar(a)}
      <div>${esc(ritmoTexto(a))}</div>
    </section>` : `
    <section class="rx-card rx-c8" aria-label="Últimos 30 días">
      <span class="rx-k">Últimos 30 días</span>
      <div><span class="rx-big">${m(a.d30)}</span> ${a.p30 ? `<span class="rx-pill ${a.d30 > a.p30 ? 'rx-warn' : 'rx-ok'}">${varTxt(a.d30, a.p30)} vs. 30 días anteriores</span>` : ''}</div>
      <div class="rx-muted">${a.ocs.length ? `En total, ${m(a.gast)} en ${plural(a.ocs.length, 'OC', 'OC')}. ` : 'Todavía no tiene compras. '}Sin presupuesto, sólo se puede comparar contra los 30 días anteriores.</div>
    </section>`;

  const proveedores = `
    <section class="rx-card rx-c4" aria-label="Proveedores">
      <h3>Proveedores</h3>
      ${topProv.length ? `<div class="rx-list">${topProv.slice(0, 6).map(p => `<div class="rx-row rx-li"><span class="rx-ell">${esc(p.n)}</span><span class="rx-num">${m(p.g)}</span></div>`).join('')}</div>
        ${topProv.length > 6 ? `<span class="rx-muted">y ${plural(topProv.length - 6, 'proveedor más', 'proveedores más')}</span>` : ''}`
        : '<div class="rx-empty">Todavía no tiene compras.</div>'}
    </section>`;

  let rubrosSec = '';
  if (hayRubros) {
    const max = Math.max(...a.rubros.map(r => Math.max(r.p, r.g)), a.conRubros ? a.sinRubroG : 0) || 1;
    const rb = r => {
      const wg = r.g / max * 100, wp = r.p / max * 100, p = pctRubro(r);
      const tag = p === null ? (r.viejo ? '<span class="rx-pill rx-off">ya no está</span>' : '')
        : p > 100 ? `<span class="rx-pill rx-bad">${p}%</span>` : !r.g ? '<span class="rx-pill rx-off">sin empezar</span>' : `<span class="rx-pill rx-ok">${p}%</span>`;
      return `<button type="button" class="rx-rb${NAV.rsel === r.id ? ' sel' : ''}" data-rsel="${esc(r.id)}" aria-pressed="${NAV.rsel === r.id}">
        <span class="rx-row"><b class="rx-ell">${esc(r.n)}</b>${tag}</span>
        <span class="rx-rbar">${r.p ? `<span class="bud" style="width:${wp}%"></span>` : ''}<span class="g${r.p ? '' : ' solo'}" style="width:${r.p ? Math.min(wg, wp) : wg}%"></span>
          ${r.p && r.g > r.p ? `<span class="ov" style="left:${wp}%;width:${wg - wp}%"></span>` : ''}</span>
        <span class="rx-legend"><span>${m(r.g)}</span><span>${r.p ? 'de ' + m(r.p) : ''}</span></span></button>`;
    };
    const sin = a.conRubros && a.sinRubro.length ? `
      <button type="button" class="rx-rb${NAV.rsel === SIN_RUBRO ? ' sel' : ''}" data-rsel="${SIN_RUBRO}" aria-pressed="${NAV.rsel === SIN_RUBRO}">
        <span class="rx-row"><b>Sin rubro</b><span class="rx-pill rx-lila">Asignar · ${a.sinRubro.length}</span></span>
        <span class="rx-rbar"><span class="g sin" style="width:${a.sinRubroG / max * 100}%"></span></span>
        <span class="rx-legend"><span>${m(a.sinRubroG)}</span><span>${pct(a.sinRubroG, a.gast)}% de lo gastado</span></span></button>` : '';
    rubrosSec = `
    <section class="rx-card rx-c7" aria-label="Por rubro">
      <div class="rx-row"><h3>Por rubro</h3>${a.rubros.some(r => r.p) ? `<span class="rx-muted rx-ley2">┆ presupuesto <span class="rx-sw" style="background:var(--lila)"></span>gastado <span class="rx-sw" style="background:var(--rosa-fg)"></span>excedido</span>` : ''}</div>
      <div class="rx-rbs">${a.rubros.map(rb).join('')}${sin}</div>
      ${a.otrosPres ? `<div class="rx-muted">Otros (presupuesto sin repartir en rubros): ${m(a.otrosPres)}</div>` : ''}
      ${a.pres && !a.rubros.some(r => r.p) && a.conRubros ? '<div class="rx-muted">El presupuesto no está repartido por rubro: cada rubro muestra sólo lo gastado.</div>' : ''}
    </section>
    <section class="rx-card rx-c5 rx-panel" id="rx-panel" aria-live="polite">${panelRubro(a)}</section>`;
  } else if (a.ocs.length) {
    const ult = [...a.ocs].sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
    rubrosSec = `
    <section class="rx-card rx-c8" aria-label="Últimas OC">
      <div class="rx-row"><h3>Últimas OC</h3><span class="rx-muted">sin rubros cargados</span></div>
      <div class="rx-list">${ult.slice(0, 8).map(oc => ocFila(oc, a)).join('')}</div>
    </section>`;
  }

  $('rx-app').innerHTML = `
    <nav class="rx-crumbs" aria-label="Ubicación"><button type="button" data-volver="1">Reportes</button><span>›</span><button type="button" data-volver="1">${esc(tabNom)}</button><span>›</span><span class="rx-ell">${esc(o.nombre)}</span></nav>
    <div class="rx-fhead">
      <div class="rx-l"><h1>${esc(o.nombre)}</h1><span class="rx-muted">${subObra(o, a, true)}</span></div>
      <div class="rx-ctl">
        ${a.ocs.length ? `<button type="button" class="foc-btn foc-btn--sec" data-verocs="1">Ver sus OC en Explorar</button>` : ''}
        <button type="button" class="foc-btn ${a.pres || a.pl ? 'foc-btn--sec' : 'foc-btn--main'}" data-pres="1">${a.pres || a.pl ? 'Editar presupuesto' : 'Cargar presupuesto'}</button>
      </div>
    </div>
    <div class="rx-grid">${principal}${proveedores}${rubrosSec}</div>
    ${a.cur === 'USD' && a.ocs.some(oc => oc.moneda !== 'USD') ? '<span class="rx-foot">El presupuesto está en dólares: las OC en pesos se pasan al dólar oficial de la fecha de cada una.</span>' : ''}
    ${a.cur === 'ARS' && a.ocs.some(oc => oc.moneda === 'USD') ? '<span class="rx-foot">Las OC en dólares se pasan a pesos al dólar oficial de la fecha de cada una.</span>' : ''}`;
}

function ocFila(oc, a, extra = '') {
  const it = (oc.items || [])[0];
  return `<div class="rx-ocr">
    <button type="button" class="rx-ocb" data-oc="${esc(oc.nroOC)}">
      <span class="rx-l"><span><b>OC ${esc(oc.nroOC)}</b> <span class="rx-muted">· ${dm(oc.timestamp)}</span></span>
        <span class="rx-muted rx-ell2">${esc(oc.proveedor?.nombre || 'Sin proveedor')}${it ? ' · ' + esc(it.desc) : ''}</span></span>
      <span class="rx-num">${esc(money(a.val(oc), a.cur))}</span></button>${extra}</div>`;
}

// Chips para asignar el rubro a una OC sin rubro.
function chipsAsignar(oc, o) {
  return `<div class="rx-cats">${rubrosList(o.rubros).map(r =>
    `<button type="button" class="rx-chip2" data-asignar="${esc(oc.nroOC)}" data-rid="${esc(r.id)}" data-okey="${esc(o.key)}">${esc(r.nombre)}</button>`).join('')}</div>`;
}

// La OC con la que lo comprado pasó el tope (en orden de fecha).
function cruceOC(ocs, val, tope) {
  let acc = 0;
  return [...ocs].sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0)).find(oc => (acc += val(oc)) > tope) || null;
}

function panelRubro(a) {
  const m = v => esc(money(v, a.cur));
  if (NAV.rsel === SIN_RUBRO) {
    const l = [...a.sinRubro].sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
    return `<div class="rx-row"><h3>Sin rubro</h3><span class="rx-muted">${plural(l.length, 'OC', 'OC')}</span></div>
      <div><span class="rx-big rx-big2">${m(a.sinRubroG)}</span></div>
      <div class="rx-muted">Elegí el rubro de cada OC: así lo gastado aparece donde corresponde.</div>
      <div class="rx-list">${l.slice(0, OC_PANEL).map(oc => ocFila(oc, a, chipsAsignar(oc, a.o))).join('')}</div>
      ${l.length > OC_PANEL ? `<span class="rx-muted">Y ${plural(l.length - OC_PANEL, 'OC más', 'OC más')}: asigná estas y aparecen las siguientes.</span>` : ''}`;
  }
  const R = a.rubros.find(r => r.id === NAV.rsel);
  if (!R) return '';
  const p = pctRubro(R);
  const l = [...R.ocs].sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
  let nota = '';
  if (R.p && R.g > R.p) {
    const cruce = cruceOC(R.ocs, a.val, R.p);
    if (cruce) nota = `El presupuesto se pasó el <b>${dmy(cruce.timestamp)}</b> con la OC ${esc(cruce.nroOC)}.`;
  }
  if (R.ocs.length > 1 && R.g) {
    const pv = new Map();
    R.ocs.forEach(oc => { const n = oc.proveedor?.nombre || 'Sin proveedor'; pv.set(n, (pv.get(n) || 0) + a.val(oc)); });
    const [n, g] = [...pv.entries()].sort((x, y) => y[1] - x[1])[0];
    if (g / R.g >= .5) nota += `${nota ? ' ' : ''}El ${pct(g, R.g)}% lo compró ${esc(n)}.`;
  }
  return `<div class="rx-row"><h3>${esc(R.n)}</h3>${p !== null ? `<span class="rx-pill ${p > 100 ? 'rx-bad' : 'rx-ok'}">${p}% de lo presupuestado</span>` : ''}</div>
    <div><span class="rx-big rx-big2">${m(R.g)}</span> ${R.p ? `<span class="rx-muted">de ${m(R.p)}</span>` : ''}</div>
    ${R.viejo ? `<div class="rx-muted">${esc('Este rubro ya no está en la obra, pero quedó en estas OC.')}</div>` : ''}
    ${nota ? `<div>${nota}</div>` : ''}
    ${l.length ? `<div class="rx-list">${l.slice(0, OC_PANEL).map(oc => ocFila(oc, a)).join('')}</div>
      ${l.length > OC_PANEL ? `<span class="rx-muted">Y ${plural(l.length - OC_PANEL, 'OC más', 'OC más')}: están todas en Explorar.</span>` : ''}`
      : '<div class="rx-empty">Todavía no hay compras en este rubro.</div>'}`;
}

// ===================================================
//  Asignar rubro
// ===================================================
async function asignarRubro(b) {
  const oc = FIRMES.find(x => x.nroOC === b.dataset.asignar);
  const o = obraPorKey(b.dataset.okey);
  const r = o && rubrosList(o.rubros).find(x => x.id === b.dataset.rid);
  if (!oc || !r) return;
  b.closest('.rx-cats')?.querySelectorAll('button').forEach(x => { x.disabled = true; });
  const rubro = { id: r.id, nombre: r.nombre };
  try {
    await patchHistorialEntry(histKeyOf(oc), { rubro });
    oc.rubro = rubro;
    toast(`OC ${oc.nroOC}: ${r.nombre}`, 'success');
  } catch (e) {
    console.error('asignarRubro:', e);
    toast('No se pudo guardar el rubro. Revisá tu conexión.', 'error');
  }
  if (MODAL === 'sinrubro') pintarModalSinRubro();
  pintar();
}

// ===================================================
//  Ventana: todas las OC sin rubro (desde Obras)
// ===================================================
let MODAL = null, PRES = null;

function abrirModal(kicker, titulo, cuerpo, pie) {
  $('rx-mk').textContent = kicker;
  $('rx-mt').textContent = titulo;
  $('rx-mb').innerHTML = cuerpo;
  $('rx-mf').innerHTML = pie || '';
  $('rx-mf').classList.toggle('hidden', !pie);
  $('modal-rx').classList.remove('hidden');
}
function cerrarModal() {
  MODAL = null; PRES = null;
  $('modal-rx').classList.add('hidden');
  $('rx-mb').innerHTML = '';
}

function pintarModalSinRubro() {
  const grupos = OBRAS.map(analizarObra).filter(a => a.conRubros && a.sinRubro.length);
  const n = grupos.reduce((s, a) => s + a.sinRubro.length, 0);
  const cuerpo = n ? `<div class="rx-muted">Elegí el rubro de cada OC: así lo gastado aparece donde corresponde.</div>` +
    grupos.map(a => `<div class="rx-mgrp"><h3>${esc(a.o.nombre)}</h3><div class="rx-list">${
      [...a.sinRubro].sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0)).slice(0, OC_PANEL)
        .map(oc => ocFila(oc, a, chipsAsignar(oc, a.o))).join('')}</div></div>`).join('')
    : '<div><b>Listo.</b> <span class="rx-muted">No quedan OC sin rubro.</span></div>';
  MODAL = 'sinrubro';
  abrirModal('Sin rubro', n ? plural(n, 'OC por asignar', 'OC por asignar') : 'Todo asignado', cuerpo);
}

// ===================================================
//  Ventana: presupuesto y plazo (el mismo formulario de Obras)
// ===================================================
function abrirPres() {
  const o = obraPorKey(NAV.ficha);
  if (!o) return;
  const ed = presEdicion(o);
  PRES = { key: o.key, f: ed, orig: ed.total || ed.n ? true : false };
  MODAL = 'pres';
  pintarPres();
}
function pintarPres() {
  const o = obraPorKey(PRES.key), rubros = rubrosList(o.rubros);
  abrirModal('Presupuesto y plazo', o.nombre,
    `<div class="pres-hint">${esc('Opcional. Con ellos, Reportes muestra cuánto del presupuesto se usó y si la obra gasta más rápido de lo que avanza el plazo.')}</div>` +
      presFormHtml(PRES.f, rubros) +
      (rubros.length ? '' : `<div class="pres-hint">${esc('Los rubros de la obra se cargan en Administración → Obras.')}</div>`),
    `${PRES.orig ? '<button type="button" class="foc-btn foc-btn--del" data-pres-quitar="1">Quitar</button>' : '<span></span>'}
     <div class="foc-foot-r"><button type="button" class="foc-btn foc-btn--sec" data-cerrar="1">Cancelar</button>
       <button type="button" class="foc-btn foc-btn--main" data-pres-guardar="1">Guardar</button></div>`);
  presPintarCalc(PRES.f, rubros, $('modal-rx'));
}

async function guardarPres(quitar, btn) {
  const o = obraPorKey(PRES.key);
  const ids = rubrosList(o.rubros).map(r => r.id);
  let nodos;
  if (quitar) {
    if (!confirm('¿Quitar el presupuesto y el plazo de esta obra? Las OC no se tocan.')) return;
    nodos = { presupuesto: null, plazo: null };
  } else {
    nodos = presNodos(PRES.f, ids);
    if (nodos.error) { toast(nodos.error, 'error'); return; }
  }
  btn.disabled = true;
  try {
    await patchObra(o.key, { presupuesto: nodos.presupuesto, plazo: nodos.plazo });
    if (nodos.presupuesto) o.presupuesto = nodos.presupuesto; else delete o.presupuesto;
    if (nodos.plazo) o.plazo = nodos.plazo; else delete o.plazo;
    cerrarModal();
    pintar();
    toast(quitar ? 'Presupuesto quitado' : 'Presupuesto guardado', 'success');
  } catch (e) {
    console.error('guardarPres:', e);
    btn.disabled = false;
    toast('No se pudo guardar. Revisá tu conexión.', 'error');
  }
}

function initModalRx() {
  const modal = $('modal-rx');
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-cerrar]') || e.target.closest('#rx-mx')) { cerrarModal(); return; }
    const as = e.target.closest('[data-asignar]');
    if (as) { asignarRubro(as); return; }
    const oc = e.target.closest('[data-oc]');
    if (oc) { abrirFicha(oc.dataset.oc); return; }
    if (onClickResumen(e)) return;
    if (!PRES) return;
    const g = e.target.closest('[data-pres-guardar],[data-pres-quitar]');
    if (g) { guardarPres(!!g.dataset.presQuitar, g); return; }
    const s = e.target.closest('[data-pres-seg]');
    if (s && presOnClick(PRES.f, s)) pintarPres();
  });
  modal.addEventListener('input', e => {
    if (PRES && presOnInput(PRES.f, e.target)) presPintarCalc(PRES.f, rubrosList(obraPorKey(PRES.key).rubros), modal);
  });
  modal.addEventListener('focusout', e => { if (PRES) presOnBlur(e.target); });
  // En captura: corre antes que el Escape de la ficha de OC (reportes.js), que puede estar encima.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden') && $('modal-preview').classList.contains('hidden')) cerrarModal();
  }, true);
}

// ===================================================
//  Navegación: pestañas y ficha, con la URL y el botón Atrás
// ===================================================
function urlNav() {
  const q = new URLSearchParams();
  if (NAV.ficha) q.set('ficha', NAV.ficha);
  else if (NAV.tab !== TAB_INICIAL) q.set('tab', NAV.tab);
  const s = q.toString();
  return location.pathname + (s ? '?' + s : '');
}

function irA(cambio, push = true) {
  Object.assign(NAV, cambio);
  if (push && NAV.ficha) VINO_DE_ADENTRO = true;
  const st = { tab: NAV.tab, ficha: NAV.ficha, rsel: NAV.rsel };
  if (push) history.pushState(st, '', urlNav()); else history.replaceState(st, '', urlNav());
  pintar();
  window.scrollTo(0, 0);
}

function pintar() {
  $('rx-top').hidden = !!NAV.ficha;
  document.querySelectorAll('#rx-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(!NAV.ficha && b.dataset.tab === NAV.tab)));
  if (NAV.ficha) renderFicha();
  else if (NAV.tab === 'obras') renderObras();
  else if (NAV.tab === 'tablero') renderTablero();
  else if (NAV.tab === 'resumen') renderResumen();
  else render();
}

// Clicks de Obras y de la ficha. Devuelve true si eran suyos.
function onClickObras(e) {
  const b = e.target.closest('[data-ficha],[data-volver],[data-rsel],[data-verocs],[data-pres],[data-asignar],[data-sinrubro],[data-inactivas],[data-ver-ficha]');
  if (!b) return false;
  const d = b.dataset;
  if (d.ficha)    { irA({ ficha: d.ficha, rsel: null }); return true; }
  if (d.verFicha) { const o = obraPorNombre(d.verFicha); if (o) irA({ ficha: o.key, rsel: null }); return true; }
  if (d.volver)   { if (VINO_DE_ADENTRO) history.back(); else irA({ ficha: null, rsel: null }); return true; }
  if (d.rsel)     {
    NAV.rsel = d.rsel;
    history.replaceState({ tab: NAV.tab, ficha: NAV.ficha, rsel: NAV.rsel }, '', urlNav());
    renderFicha();
    if (window.innerWidth < 1000) $('rx-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  if (d.verocs)   {
    const o = obraPorKey(NAV.ficha);
    Object.assign(EX, { obra: o.nombre, resp: null, equipo: null, q: '', per: 'anio', mesOff: 0, ver: VER_PASO });
    irA({ tab: 'explorar', ficha: null, rsel: null });
    return true;
  }
  if (d.pres)      { abrirPres(); return true; }
  if (d.asignar)   { asignarRubro(b); return true; }
  if (d.sinrubro)  { pintarModalSinRubro(); return true; }
  if (d.inactivas) { VER_INACTIVAS = !VER_INACTIVAS; renderObras(); return true; }
  return false;
}

// Si la ficha se abrió desde una pestaña, «volver» es el Atrás del navegador (vuelve
// a donde estaba). Si se entró directo con ?ficha=, no hay a dónde volver: va a la pestaña.
let VINO_DE_ADENTRO = false;

function initNav(esAdmin, qs) {
  TAB_INICIAL = esAdmin ? 'resumen' : 'explorar';
  NAV.tab = TAB_INICIAL;
  if (qs.get('obra') || qs.get('equipo')) NAV.tab = 'explorar';
  if (TABS.some(t => t[0] === qs.get('tab'))) NAV.tab = qs.get('tab');
  if (qs.get('ficha') && obraPorKey(qs.get('ficha'))) NAV.ficha = qs.get('ficha');

  $('rx-tabs').innerHTML = TABS.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="false">${n}</button>`).join('');
  $('rx-tabs').hidden = false;
  $('rx-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b && b.dataset.tab !== NAV.tab) irA({ tab: b.dataset.tab, ficha: null, rsel: null });
  });
  history.replaceState({ tab: NAV.tab, ficha: NAV.ficha, rsel: NAV.rsel }, '', urlNav());
  window.addEventListener('popstate', e => {
    const s = e.state || { tab: TAB_INICIAL, ficha: null, rsel: null };
    Object.assign(NAV, { tab: s.tab || TAB_INICIAL, ficha: s.ficha || null, rsel: s.rsel || null });
    if (!NAV.ficha) VINO_DE_ADENTRO = false;
    cerrarModal();
    pintar();
  });
  initModalRx();
}
