/* ===================================================
   VIMECO OC — Reportes → Resumen
   reportesResumen.js

   Paso 5 del rediseño de Reportes, traído de Leva.
   Usa lo de reportes.js (FIRMES, ars, money…), reportesObras.js (analizarObra,
   obrasVisibles, ritmoBar, la ventana de Sin rubro, irA…) y reportesTablero.js
   (tbSinFactura y su ventana).

   - Una frase: lo comprado en los últimos 30 días contra los 30 anteriores y
     la obra que explica la diferencia.
   - «Para mirar»: alertas por gravedad, cada una abre lo que ya existe.
     Presupuesto o rubro pasado → la ficha (con ese rubro); gasto adelantado →
     la ficha; precio que sube en un proveedor → su detalle, con el más barato;
     sin factura → la lista del Tablero; sin rubro → la ventana de asignar.
   - «Así vienen las obras», al costado.

   Los umbrales son los iniciales: se afinan con datos reales.
   =================================================== */

const RES_DIA = 864e5;
const RES_PRECIO_SUBA = 0.10;     // suba de precio que se avisa (10% o más)
const RES_PRECIO_RECIENTE = 30;   // días: la compra con el precio nuevo
const RES_PRECIO_VENTANA = 180;   // días: compras anteriores y otros proveedores que cuentan
const RES_PRECIO_MES = 90;        // días para estimar cuánto se compra por mes
const RES_PRECIO_MAX = 3;         // subas sueltas en «Para mirar»; el resto, en una sola
const RES_OBRAS_MAX = 8;          // obras al costado antes de «Ver todas en Obras»
const RES_PAREJO = 0.05;          // variación de 30 días que se considera «casi lo mismo»

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
  module.exports = { fraseVariacion, subasDePrecio };
}

// ===================================================
//  Pestaña Resumen
// ===================================================
let SUBAS = [];   // las subas de precio de la última vez que se pintó (las ventanas las leen)

const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
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

  const sinF = tbSinFactura();
  if (sinF.length) A.push({ orden: 5, cls: 'info', imp: 0, attr: 'data-sinfact="1"',
    t: `${plural(sinF.length, 'OC', 'OC')} sin factura hace más de ${TB_SINFACT_DIAS} días`,
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
  const { vis, todas } = obrasVisibles();
  calcularSubas();
  const fin = finHoy();
  const l30 = FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 30 * DIA);
  const lp30 = FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 60 * DIA && (oc.timestamp || 0) < fin - 30 * DIA);
  const t30 = sumARS(l30), tp30 = sumARS(lp30);
  const porObra = new Map();
  const sumar = (l, campo) => l.forEach(oc => {
    const k = obraKey(oc);
    if (!porObra.has(k)) porObra.set(k, { n: obraLabel(k), d: 0, p: 0 });
    porObra.get(k)[campo] += ars(oc) || 0;
  });
  sumar(l30, 'd'); sumar(lp30, 'p');
  const fr = fraseVariacion(t30, tp30, [...porObra.values()]);
  const monto = t30 ? t30 : tp30;
  const frase = esc(fr.cuerpo).replace('{M}', `<em>${esc(money(monto))}</em>`) + (fr.explica ? ' ' + esc(fr.explica) : '');

  const hoy = new Date();
  const fecha = mayus(`${DIAS_SEM[hoy.getDay()]} ${hoy.getDate()} de ${MESES_LG[hoy.getMonth()]}`);

  const A = alertasResumen(todas);
  const alertas = A.length
    ? `<div class="rx-list">${A.map(x => `
        <button type="button" class="rx-alert" ${x.attr}><span class="rx-dot rx-dot-${x.cls}" aria-hidden="true"></span>
          <span class="rx-l"><span class="t">${esc(x.t)}</span><span class="s">${esc(x.s)}</span></span></button>`).join('')}</div>`
    : `<div class="rx-empty">Nada fuera de lo normal: ningún presupuesto pasado ni gasto adelantado, ninguna suba de precio de ${Math.round(RES_PRECIO_SUBA * 100)}% o más, ni OC viejas sin factura u OC sin rubro.</div>`;

  const obra = a => `
      <button type="button" class="rx-tbo" data-ficha="${esc(a.o.key)}">
        <span class="rx-row"><b class="rx-ell">${esc(a.o.nombre)}</b><span class="rx-pill ${a.estado.cls}">${esc(a.estado.txt)}</span></span>
        ${a.pres ? `<span class="rx-muted">${esc(money(a.gast, a.cur))} de ${esc(money(a.pres, a.cur))}</span>${ritmoBar(a)}`
          : `<span class="rx-muted">${a.d30 ? `${esc(money(a.d30, a.cur))} en 30 días${a.p30 ? ` · ${varTxt(a.d30, a.p30)} vs. 30 días anteriores` : ''}` : 'Sin compras en los últimos 30 días'}</span>`}
      </button>`;
  const obras = vis.length ? `<div class="rx-list">${vis.slice(0, RES_OBRAS_MAX).map(obra).join('')}</div>
      ${vis.length > RES_OBRAS_MAX ? `<button type="button" class="rx-mas" data-tbtab="obras">Ver todas las obras en Obras (${vis.length})</button>` : ''}`
    : `<div class="rx-empty">${esc('Todavía no hay obras cargadas. Se dan de alta en Administración → Obras.')}</div>`;

  $('rx-app').innerHTML = `
    <div class="rx-grid">
      <div class="rx-col rx-c7">
        <div class="rx-intro"><span class="rx-muted">${esc(fecha)}</span><p class="rx-lead">${frase}</p></div>
        <section class="rx-card" aria-label="Para mirar"><h3>Para mirar</h3>${alertas}</section>
      </div>
      <section class="rx-card rx-c5" aria-label="${esc('Así vienen las obras')}">
        <h3>${esc('Así vienen las obras')}</h3>${obras}
      </section>
    </div>`;
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
  const b = e.target.closest('[data-precio],[data-precios]');
  if (!b) return false;
  if (b.dataset.precios) pintarModalPrecios();
  else pintarModalPrecio(Number(b.dataset.precio));
  return true;
}
