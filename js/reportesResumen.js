/* ===================================================
   VIMECO OC — Reportes → Resumen
   reportesResumen.js

   Usa lo de reportes.js (FIRMES, ars, money, los gráficos…) y reportesObras.js
   (analizarObra, obrasVisibles, la ventana de Sin rubro, irA…).

   - Arriba, una tarjeta con la frase y «Para mirar». La frase: lo comprado en
     los últimos 30 días contra los 30 anteriores y la obra que explica la
     diferencia. Hasta RES_USO_MIN días desde la primera OC no hay con qué
     comparar: lo dice, y las cuentas van desde esa OC.
   - «Para mirar»: alertas por gravedad, cada una abre lo que ya existe.
     Presupuesto o rubro pasado → la ficha (con ese rubro); gasto adelantado →
     la ficha; precio que sube en un proveedor → su detalle, con el más barato;
     sin factura → su lista; sin rubro → la ventana de asignar.
   - Comprado, OC y promedio; compras por semana; las últimas OC.

   Los umbrales son los iniciales: se afinan con datos reales.
   =================================================== */

const RES_DIA = 864e5;
const RES_PRECIO_SUBA = 0.10;     // suba de precio que se avisa (10% o más)
const RES_PRECIO_RECIENTE = 30;   // días: la compra con el precio nuevo
const RES_PRECIO_VENTANA = 180;   // días: compras anteriores y otros proveedores que cuentan
const RES_PRECIO_MES = 90;        // días para estimar cuánto se compra por mes
const RES_PRECIO_MAX = 3;         // subas sueltas en «Para mirar»; el resto, en una sola
const RES_PAREJO = 0.05;          // variación de 30 días que se considera «casi lo mismo»
const RES_USO_MIN = 60;           // días desde la primera OC para comparar 30 días contra 30
const RES_SEMANAS = 8;            // semanas del gráfico
const RES_ULTIMAS = 5;            // OC en «Últimas OC»
const RES_SINFACT_DIAS = 30;      // sin factura pasados estos días

// ===================================================
//  Lógica (sin DOM; tests/resumen.test.js)
// ===================================================

// La frase de arriba. `obras`: [{ n, d, p }] con lo de los últimos 30 días (d) y
// los 30 anteriores (p) de cada obra, en pesos. {M} es el lugar del monto.
function fraseVariacion(t30, tp30, obras) {
  if (!t30 && !tp30) return { cuerpo: 'No hubo compras en los últimos 60 días.', explica: '' };
  if (!t30) return { cuerpo: 'No hubo compras en los últimos 30 días; en los 30 anteriores, {M}.', explica: '' };
  if (!tp30) return { cuerpo: 'En los últimos 30 días compraste {M}. En los 30 anteriores no hubo compras.', explica: '' };
  const v = t30 / tp30 - 1;
  if (Math.abs(v) < RES_PAREJO) return { cuerpo: 'En los últimos 30 días compraste {M}, casi lo mismo que en los 30 anteriores.', explica: '' };
  const sube = v > 0, dif = t30 - tp30;
  const cuerpo = `En los últimos 30 días compraste {M}, ${Math.round(Math.abs(v) * 100)}% ${sube ? 'más' : 'menos'} que en los 30 anteriores.`;
  const cand = obras.map(o => ({ n: o.n, delta: (o.d || 0) - (o.p || 0) }))
    .filter(o => sube ? o.delta > 0 : o.delta < 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (!cand.length) return { cuerpo, explica: '' };
  const parte = cand[0].delta / dif, n = cand[0].n;
  let explica;
  if (parte >= .7) explica = sube ? `Casi todo el aumento es ${n}.` : `Casi toda la baja es ${n}.`;
  else if (parte >= .4) explica = sube ? `La mayor parte del aumento es ${n}.` : `La mayor parte de la baja es ${n}.`;
  else explica = sube ? `Lo que más subió fue ${n}.` : `Lo que más bajó fue ${n}.`;
  return { cuerpo, explica };
}

// La frase mientras no hay con qué comparar. `desde`: la fecha de la primera OC, ya escrita.
// `obra`: { n, parte (0 a 100) } de la que más compró, o null si no tiene centro.
function fraseInicio(desde, obra, proveedor) {
  const cuerpo = `Desde el ${desde} compraste {M}.`;
  if (!obra) return { cuerpo, explica: proveedor ? `Tu mayor proveedor es ${proveedor}.` : '' };
  const reparto = obra.parte >= 100 ? `Todo fue para ${obra.n}` : `El ${obra.parte}% fue para ${obra.n}`;
  return { cuerpo, explica: proveedor ? `${reparto} y tu mayor proveedor es ${proveedor}.` : `${reparto}.` };
}

// Subas de precio: la última compra de cada artículo a cada proveedor (en los
// últimos 30 días) contra la anterior al mismo proveedor, en la misma moneda,
// como compara la ficha de la OC (checkOCHistorial, fichaOC.js). Con el más
// barato entre los otros proveedores que vendieron ese artículo (su último
// precio, misma moneda y unidad).
// deps: { norm: normDesc, prov: oc → clave del proveedor, ahora, aPesos?(v, cur) }
function subasDePrecio(ocs, deps) {
  const { norm, prov, ahora } = deps;
  const aPesos = deps.aPesos || (v => v);
  const desde = ahora - RES_PRECIO_VENTANA * RES_DIA;
  const compras = [];
  ocs.forEach(oc => {
    const t = oc.timestamp || 0;
    if (t < desde || t > ahora) return;
    const p = prov(oc);
    if (!p || p === '—') return;
    (oc.items || []).forEach(it => {
      const d = norm(it.desc), pu = parseFloat(it.unitario) || 0;
      if (!d || pu <= 0) return;
      compras.push({ oc, t, d, desc: it.desc, pu, cant: parseFloat(it.cant) || 0, un: norm(it.unidad || ''),
        unidad: it.unidad || '', cur: oc.moneda === 'USD' ? 'USD' : 'ARS', p, pn: oc.proveedor?.nombre || 'Sin proveedor' });
    });
  });
  compras.sort((a, b) => a.t - b.t);
  const mismaUnidad = (a, b) => !a.un || !b.un || a.un === b.un;

  const series = new Map();   // proveedor | artículo | moneda → compras, de la más vieja a la más nueva
  compras.forEach(c => {
    const k = c.p + '|' + c.d + '|' + c.cur;
    if (!series.has(k)) series.set(k, []);
    series.get(k).push(c);
  });

  const subas = [];
  series.forEach(l => {
    const ult = l[l.length - 1];
    if (ult.t < ahora - RES_PRECIO_RECIENTE * RES_DIA) return;
    let prev = null;
    for (let i = l.length - 2; i >= 0; i--) {
      if (l[i].oc !== ult.oc && mismaUnidad(l[i], ult)) { prev = l[i]; break; }
    }
    if (!prev) return;
    const dif = (ult.pu - prev.pu) / prev.pu;
    if (dif < RES_PRECIO_SUBA - 1e-9) return;

    const otros = new Map();   // el último precio de cada otro proveedor
    compras.forEach(c => {
      if (c.d === ult.d && c.cur === ult.cur && c.p !== ult.p && mismaUnidad(c, ult)) otros.set(c.p, c);
    });
    let barato = null;
    otros.forEach(c => { if (c.pu < ult.pu && (!barato || c.pu < barato.pu)) barato = c; });

    const cantMes = l.filter(c => c.t >= ahora - RES_PRECIO_MES * RES_DIA && mismaUnidad(c, ult))
      .reduce((s, c) => s + c.cant, 0) / (RES_PRECIO_MES / 30);
    const ahorroMes = barato ? cantMes * (ult.pu - barato.pu) : 0;
    subas.push({ ult, prev, dif, barato, cantMes, ahorroMes, serie: l.filter(c => mismaUnidad(c, ult)),
      impacto: aPesos((ult.pu - prev.pu) * (cantMes || ult.cant || 1), ult.cur) });
  });
  return subas.sort((a, b) => b.impacto - a.impacto);
}

if (typeof module !== 'undefined') {
  module.exports = { fraseVariacion, fraseInicio, subasDePrecio };
}

// ===================================================
//  Pestaña Resumen
// ===================================================
let SUBAS = [];   // las subas de precio de la última vez que se pintó (las ventanas las leen)


const mayus = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const corto = (s, n = 60) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

// El dólar de hoy, para ordenar y sumar cosas en distintas monedas.
function aPesosHoy(v, cur) {
  if (cur !== 'USD') return v;
  const snap = typeof getDolarCached === 'function' ? getDolarCached() : null;
  return v * (snap?.oficial?.venta || snap?.oficial?.compra || 0);
}

function calcularSubas() {
  const prov = indiceProveedores(FIRMES);
  SUBAS = subasDePrecio(FIRMES, { norm: normDesc, prov, ahora: Date.now(), aPesos: aPesosHoy });
  return SUBAS;
}

// Cuánto se pasó: «el doble», «2,6 veces» o «12%».
function pasoTxt(g, p) {
  const r = g / p;
  if (r >= 1.95 && r < 2.5) return 'ya costó el doble de lo presupuestado';
  if (r >= 2.5) return `ya costó ${nf(r, 1)} veces lo presupuestado`;
  return `se pasó ${Math.max(1, Math.round((r - 1) * 100))}% de lo presupuestado`;
}

// «bolsa» → «bolsas», «unidad» → «unidades»; las abreviaturas («kg», «m3», «u.») quedan igual.
function unidadPlural(u) {
  if (!/^[a-záéíóúñ]{4,}$/i.test(u)) return u;
  return /[aeiouáéó]$/i.test(u) ? u + 's' : u + 'es';
}

const precioTxt = (v, cur) => (cur === 'USD' ? 'US$ ' : '$ ') + nf(v, v < 100 && v % 1 ? 2 : 0);

function alertasResumen(todas) {
  const A = [];
  todas.forEach(a => {
    if (!a.pres) return;
    const m = v => money(v, a.cur), nom = a.o.nombre, key = esc(a.o.key);
    const cruceTxt = (l, tope) => {
      const oc = cruceOC(l, a.val, tope);
      return oc ? ` Se pasó el ${dm(oc.timestamp)} con la OC ${oc.nroOC}.` : '';
    };
    if (a.gast > a.pres) {
      A.push({ orden: 0, cls: 'bad', imp: aPesosHoy(a.gast - a.pres, a.cur), attr: `data-ficha="${key}"`,
        t: `${nom} se pasó del presupuesto de compras`,
        s: `${m(a.gast)} de ${m(a.pres)} (${a.gp}%).${cruceTxt(a.ocs, a.pres)}` });
    }
    a.rubros.filter(r => r.p && r.g > r.p).forEach(r => A.push({
      orden: 1, cls: 'bad', imp: aPesosHoy(r.g - r.p, a.cur), attr: `data-ficha="${key}" data-rubro="${esc(r.id)}"`,
      t: `${r.n} en ${nom} ${pasoTxt(r.g, r.p)}`,
      s: `${m(r.g)} de ${m(r.p)}.${cruceTxt(r.ocs, r.p)}` }));
    if (a.gast <= a.pres && a.ritmo !== null && a.ritmo > RITMO_UMBRAL) {
      A.push({ orden: 2, cls: 'warn', imp: a.ritmo, attr: `data-ficha="${key}"`,
        t: `${nom} gasta más rápido de lo que avanza el plazo`,
        s: `${a.gp}% del presupuesto con ${Math.min(a.pl.p, 100)}% del plazo.` });
    }
  });

  SUBAS.slice(0, RES_PRECIO_MAX).forEach((x, i) => A.push({ orden: 3, cls: 'warn', imp: -i, attr: `data-precio="${i}"`,
    t: `${mayus(corto(x.ult.desc))} subió ${Math.round(x.dif * 100)}% en ${x.ult.pn}`, s: subaSub(x) }));
  if (SUBAS.length > RES_PRECIO_MAX) {
    const n = SUBAS.length - RES_PRECIO_MAX;
    A.push({ orden: 4, cls: 'warn', imp: 0, attr: 'data-precios="1"',
      t: `${n === 1 ? 'Otro precio subió' : `Otros ${n} precios subieron`} ${Math.round(RES_PRECIO_SUBA * 100)}% o más`,
      s: 'Contra la compra anterior al mismo proveedor.' });
  }

  const sinF = ocsSinFactura();
  if (sinF.length) A.push({ orden: 5, cls: 'info', imp: 0, attr: 'data-sinfact="1"',
    t: `${plural(sinF.length, 'OC', 'OC')} sin factura hace más de ${RES_SINFACT_DIAS} días`,
    s: `${money(sumARS(sinF))} en total.` });

  const sinR = todas.filter(a => a.conRubros).flatMap(a => a.sinRubro);
  if (sinR.length) A.push({ orden: 6, cls: 'info', imp: 0, attr: 'data-sinrubro="1"',
    t: `${plural(sinR.length, 'OC', 'OC')} sin rubro`,
    s: `${money(sumARS(sinR))} que no aparece en ningún rubro. Se asignan con un toque.` });

  return A.sort((x, y) => x.orden - y.orden || y.imp - x.imp);
}

function subaSub(x) {
  const u = x.ult, b = x.barato;
  if (b) {
    const menos = Math.round((1 - b.pu / u.pu) * 100);
    const ahorro = x.ahorroMes > 0 && aPesosHoy(x.ahorroMes, u.cur) >= 1000 ? `: serían ${money(x.ahorroMes, u.cur)} menos por mes` : '';
    return `${b.pn} lo tiene ${menos}% más barato${ahorro}.`;
  }
  return `Pasó de ${precioTxt(x.prev.pu, u.cur)} a ${precioTxt(u.pu, u.cur)} entre el ${dm(x.prev.t)} y el ${dm(u.t)}.`;
}

function renderResumen() {
  if (!FIRMES.length) { $('rx-app').innerHTML = sinOCHtml(); return; }
  const { todas } = obrasVisibles();
  calcularSubas();
  const fin = finHoy();
  const poco = fin - PRIMERA_OC < RES_USO_MIN * DIA;
  const l30 = FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 30 * DIA);
  const lp30 = FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 60 * DIA && (oc.timestamp || 0) < fin - 30 * DIA);
  const base = poco ? FIRMES : l30;   // lo que cuentan los números de arriba
  const t = sumARS(base), tp30 = sumARS(lp30);
  const ini = new Date(PRIMERA_OC);

  let fr;
  if (poco) {
    const gO = agrupar(FIRMES, obraKey, (oc, k) => obraLabel(k))[0];
    const gP = agrupar(FIRMES, PROV_KEY, oc => oc.proveedor?.nombre || '')[0];
    fr = fraseInicio(`${ini.getDate()} de ${MESES_LG[ini.getMonth()]}`,
      gO.key === '—' ? null : { n: gO.label, parte: pct(gO.total, t) }, gP.label);
  } else {
    const porObra = new Map();
    const sumar = (l, campo) => l.forEach(oc => {
      const k = obraKey(oc);
      if (!porObra.has(k)) porObra.set(k, { n: obraLabel(k), d: 0, p: 0 });
      porObra.get(k)[campo] += ars(oc) || 0;
    });
    sumar(l30, 'd'); sumar(lp30, 'p');
    fr = fraseVariacion(t, tp30, [...porObra.values()]);
  }
  const frase = esc(fr.cuerpo).replace('{M}', `<b class="rx-num">${esc(money(t || tp30))}</b>`) + (fr.explica ? ' ' + esc(fr.explica) : '');
  const titulo = !poco ? 'Últimos 30 días' : fin - PRIMERA_OC <= 31 * DIA ? 'Tu primer mes' : 'Tus primeros meses';

  const A = alertasResumen(todas);
  const compara = new Date(PRIMERA_OC + RES_USO_MIN * DIA);
  // Una recomendación sólo si no hay nada que atender: es la misma del menú (js/consejos.js).
  const conTip = poco && !A.length && OBRAS.length > 0 && !todas.some(a => a.pres);
  const mirar = `
    ${A.length ? `<div class="rx-list">${A.map(x => `
      <button type="button" class="rx-alert" ${x.attr}><span class="rx-dot rx-dot-${x.cls}" aria-hidden="true"></span>
        <span class="rx-l"><span class="t">${esc(x.t)}</span><span class="s">${esc(x.s)}</span></span></button>`).join('')}</div>` : ''}
    ${!poco && !A.length ? '<span class="rx-muted">Nada fuera de lo normal.</span>' : ''}
    ${poco ? `<p class="rx-muted rx-poco">Todavía es poco para sacar conclusiones. Desde el ${compara.getDate()} de ${MESES_LG[compara.getMonth()]} vas a poder comparar un período contra otro.</p>` : ''}
    ${conTip ? `<button type="button" class="rx-tipr" data-irtab="obras">${icSvg('bulb')}<span>${esc(voc('Cargale presupuesto a tus centros: Reportes te avisa si el gasto se pasa o va más rápido que el plazo.'))}</span>${icSvg('chevR')}</button>` : ''}`;

  const nCentros = agrupar(base, obraKey, (oc, k) => k).length;
  const prom = base.length ? t / base.length : 0, promP = lp30.length ? tp30 / lp30.length : 0;
  const desdeCorto = `desde el ${ini.getDate()} ${MESES[ini.getMonth()]}`;
  const kpi = (k, v, delta, sub) => `<div class="rx-kpi"><span class="k">${k}</span><span class="v">${esc(v)}</span>${delta}<span class="s">${esc(sub)}</span></div>`;
  const vsAnt = 'vs. 30 días ant.';
  const kpis = poco
    ? kpi('Comprado', money(t), '', desdeCorto) +
      kpi('OC', String(base.length), '', `en ${nCentros} ${nCentros === 1 ? voc('centro') : voc('centro.p')}`) +
      kpi('Promedio', money(prom), '', 'por OC')
    : kpi('Comprado', money(t), tp30 ? deltaHtml(t, tp30) : '', tp30 ? vsAnt : 'últimos 30 días') +
      kpi('OC', String(base.length), lp30.length ? deltaHtml(base.length, lp30.length, true) : '', lp30.length ? vsAnt : 'últimos 30 días') +
      kpi('Promedio', money(prom), promP ? deltaHtml(prom, promP, true) : '', promP ? vsAnt : 'por OC');

  // Compras por semana: lo de cada semana, no el acumulado (ése va en Explorar).
  const lun = new Date(fin - DIA);
  lun.setDate(lun.getDate() - (lun.getDay() + 6) % 7 - (RES_SEMANAS - 1) * 7);
  const lSem = FIRMES.filter(oc => (oc.timestamp || 0) >= lun.getTime());
  GRAF.res = null;
  if (lSem.length) {
    const cub = cubetasCon(lun.getTime(), fin, 'semana', lSem);
    GRAF.res = { cub, sel: null, prefijo: '', ser: [{ label: 'Compras', color: 'var(--rx-bar)',
      vals: cub.map(c => sumARS(lSem.filter(oc => (oc.timestamp || 0) >= c.ini && (oc.timestamp || 0) < c.fin))) }] };
  }

  const ult = [...FIRMES].sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0)).slice(0, RES_ULTIMAS);
  const fila = oc => `<button type="button" class="rx-ocf" data-oc="${esc(oc.nroOC)}">
      ${avatarHtml(oc.proveedor?.nombre || 'Sin proveedor')}
      <span class="rx-l"><b class="rx-ell2">${esc(oc.proveedor?.nombre || 'Sin proveedor')}</b><span class="rx-muted rx-ell2">${swObra(obraKey(oc))}${esc(obraLabel(obraKey(oc)))} · ${dm(oc.timestamp)}</span></span>
      <span class="rx-ocf-r"><b class="rx-num">${esc(money(oc.total, oc.moneda === 'USD' ? 'USD' : 'ARS'))}</b>${facturaPill(oc)}</span></button>`;

  $('rx-app').innerHTML = `
    <section class="rx-card" aria-label="${esc(titulo)}">
      <h3>${esc(titulo)}</h3>
      <p class="rx-lead">${frase}</p>
      <div class="rx-mirar"><h3>Para mirar</h3>${mirar}</div>
    </section>
    <div class="rx-kpis">${kpis}</div>
    <div class="rx-grid">
      <section class="rx-card rx-c7" aria-label="Compras por semana">
        <div class="rx-row"><h3>Compras por semana</h3><span class="rx-muted">${poco ? 'desde tu primera OC' : `últimas ${RES_SEMANAS} semanas`}</span></div>
        ${GRAF.res ? `<div id="rx-gr-res">${grafInner('res')}</div>` : `<div class="rx-empty">Sin compras en las últimas ${RES_SEMANAS} semanas.</div>`}
      </section>
      <section class="rx-card rx-c5" aria-label="Últimas OC">
        <h3>Últimas OC</h3>
        <div class="rx-list">${ult.map(fila).join('')}</div>
      </section>
    </div>`;
}

// ---- Sin factura: la lista, agrupada por obra ----
// La OC sin ningún archivo, pasados 30 días. Las que tienen archivos sin rotular
// no cuentan: no se puede afirmar que les falte (estadoFacturaOC, firebase.js).
function ocsSinFactura() {
  const tope = finHoy() - RES_SINFACT_DIAS * DIA;
  return FIRMES.filter(oc => (oc.timestamp || 0) < tope && estadoFacturaOC(oc).estado === 'sin')
    .sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));
}

function pintarModalSinFactura() {
  const l = ocsSinFactura();
  const grupos = agrupar(l, obraKey, (oc, k) => obraLabel(k));
  const enSuMoneda = oc => ({ val: x => Number(x.total) || 0, cur: oc.moneda === 'USD' ? 'USD' : 'ARS' });
  const cuerpo = l.length
    ? `<div class="rx-muted">${esc(`OC emitidas hace más de ${RES_SINFACT_DIAS} días sin ningún archivo cargado. La factura se carga en Compras → Facturas.`)}</div>` +
      grupos.map(gr => `<div class="rx-mgrp"><div class="rx-row"><h3>${esc(gr.label)}</h3><span class="rx-muted rx-num">${esc(money(gr.total))}</span></div><div class="rx-list">${
        l.filter(oc => obraKey(oc) === gr.key).map(oc => ocFila(oc, enSuMoneda(oc))).join('')}</div></div>`).join('')
    : '<div><b>Listo.</b> <span class="rx-muted">No quedan OC viejas sin factura.</span></div>';
  MODAL = 'sinfact';
  abrirModal('Sin factura', l.length ? `${plural(l.length, 'OC', 'OC')} · ${money(sumARS(l))}` : 'Todo al día', cuerpo,
    l.length ? '<span></span><div class="foc-foot-r"><a class="foc-btn foc-btn--fac" href="facturas.html">Ir a Facturas</a></div>' : '');
}

// ===================================================
//  Ventanas de precios
// ===================================================
function pintarModalPrecio(i) {
  const x = SUBAS[i];
  if (!x) return;
  const u = x.ult, b = x.barato, cur = u.cur;
  const un = u.unidad ? u.unidad.toLowerCase() : 'unidad';

  // Precio de este proveedor en cada compra, con la línea del más barato.
  const pts = x.serie.slice(-8);
  const W = 500, H = 170, L = 64, B = 22, T = 14, R = 16;
  const vals = pts.map(c => c.pu).concat(b ? [b.pu] : []);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const pad = (mx - mn) * .15 || mx * .1;
  mn = Math.max(0, mn - pad); mx += pad;
  const xs = k => pts.length === 1 ? (L + W - R) / 2 : L + k * (W - L - R) / (pts.length - 1);
  const ys = v => H - B - (v - mn) / (mx - mn) * (H - B - T);
  const path = pts.map((c, k) => (k ? 'L' : 'M') + xs(k).toFixed(1) + ' ' + ys(c.pu).toFixed(1)).join(' ');
  const ticks = [mn + (mx - mn) * .1, (mn + mx) / 2, mx - (mx - mn) * .1];
  const svg = `<svg class="rx-psvg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Precio de ${esc(u.desc)} en ${esc(u.pn)}, compra por compra">
    ${ticks.map(v => `<line x1="${L}" x2="${W - 4}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end">${esc(nf(v, v < 100 ? 2 : 0))}</text>`).join('')}
    ${b ? `<line x1="${L}" x2="${W - 8}" y1="${ys(b.pu)}" y2="${ys(b.pu)}" stroke="var(--menta-fg)" stroke-dasharray="4 3"/>
      <text x="${W - 10}" y="${ys(b.pu) + 14}" text-anchor="end" style="fill:var(--menta-fg)">${esc(corto(b.pn, 30))} ${esc(precioTxt(b.pu, cur))}</text>` : ''}
    <path d="${path}" fill="none" stroke="var(--lila)" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((c, k) => `<circle cx="${xs(k)}" cy="${ys(c.pu)}" r="${k === pts.length - 1 ? 5 : 3}" fill="var(--lila)" stroke="var(--surface)" stroke-width="2"><title>${dmy(c.t)} · OC ${esc(c.oc.nroOC)}: ${esc(precioTxt(c.pu, cur))}</title></circle>
      <text x="${xs(k)}" y="${H - 5}" text-anchor="middle">${dm(c.t)}</text>`).join('')}
  </svg>`;

  const cant = x.cantMes >= 1 ? nf(x.cantMes, x.cantMes < 10 ? 1 : 0) : null;
  let cuanto = '';
  if (cant) {
    cuanto = `<div><b>Le comprás unas ${cant} ${esc(u.unidad ? unidadPlural(un) : 'unidades')} por mes.</b>${b && x.ahorroMes > 0
      ? ` <span class="rx-muted">Al precio de ${esc(b.pn)} serían <span class="rx-num">${esc(money(x.ahorroMes, cur))}</span> menos por mes.</span>` : ''}</div>`;
  } else if (b) {
    cuanto = `<div class="rx-muted">${esc(b.pn)} lo vendió a ${esc(precioTxt(b.pu, cur))} el ${dm(b.t)}.</div>`;
  }

  const ocs = [u, x.prev].map(c => `
    <div class="rx-ocr"><button type="button" class="rx-ocb" data-oc="${esc(c.oc.nroOC)}">
      <span class="rx-l"><span><b>OC ${esc(c.oc.nroOC)}</b> <span class="rx-muted">· ${dmy(c.t)}</span></span>
        <span class="rx-muted rx-ell2">${esc(c.oc.obra || 'Sin obra')} · ${esc(nf(c.cant, c.cant % 1 ? 2 : 0))} ${esc(u.unidad ? (c.cant === 1 ? un : unidadPlural(un)) : 'u.')}</span></span>
      <span class="rx-num">${esc(precioTxt(c.pu, cur))}</span></button></div>`).join('');

  MODAL = 'precio';
  abrirModal(`Precio por ${un}`, mayus(corto(u.desc, 80)), `
    <div class="rx-row"><div class="rx-l"><span class="rx-k">${esc(u.pn)}</span><span class="rx-big rx-big2">${esc(precioTxt(u.pu, cur))}</span></div>
      <span class="rx-pill rx-warn">+${Math.round(x.dif * 100)}% desde el ${dm(x.prev.t)}</span></div>
    <div class="rx-chart">${svg}</div>
    ${cuanto}
    ${b ? `<div class="rx-muted">${esc(b.pn)}: último precio el ${dmy(b.t)}, en la OC ${esc(b.oc.nroOC)}. Se comparan las compras de los últimos ${RES_PRECIO_VENTANA / 30} meses, en la misma moneda y unidad.</div>`
      : `<div class="rx-muted">Ningún otro proveedor lo vendió más barato en los últimos ${RES_PRECIO_VENTANA / 30} meses.</div>`}
    <div class="rx-mgrp"><h3>Las dos últimas compras</h3><div class="rx-list">${ocs}</div></div>`);
}

function pintarModalPrecios() {
  MODAL = 'precios';
  abrirModal('Precios', plural(SUBAS.length, 'suba de 10% o más', 'subas de 10% o más'), `
    <div class="rx-muted">La última compra de cada artículo en los últimos ${RES_PRECIO_RECIENTE} días, contra la anterior al mismo proveedor.</div>
    <div class="rx-list">${SUBAS.map((x, i) => `
      <button type="button" class="rx-alert" data-precio="${i}"><span class="rx-dot rx-dot-warn" aria-hidden="true"></span>
        <span class="rx-l"><span class="t">${esc(mayus(corto(x.ult.desc)))} subió ${Math.round(x.dif * 100)}% en ${esc(x.ult.pn)}</span><span class="s">${esc(subaSub(x))}</span></span></button>`).join('')}</div>`);
}

// Clicks del Resumen (en la página y en la ventana). Devuelve true si eran suyos.
function onClickResumen(e) {
  const b = e.target.closest('[data-precio],[data-precios],[data-sinfact],[data-irtab],[data-rubro]');
  if (!b) return false;
  const d = b.dataset;
  if (d.sinfact) { pintarModalSinFactura(); return true; }
  if (d.irtab)   { irA({ tab: d.irtab, ficha: null, rsel: null }); return true; }
  if (d.rubro)   { irA({ ficha: d.ficha, rsel: d.rubro }); return true; }
  if (d.precios) pintarModalPrecios();
  else pintarModalPrecio(Number(d.precio));
  return true;
}
