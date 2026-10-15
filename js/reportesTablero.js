/* ===================================================
   VIMECO OC — Reportes → Tablero
   reportesTablero.js

   Paso 4 del rediseño de Reportes, traído de Leva.
   Usa lo de reportes.js (FIRMES, ars, money…) y de reportesObras.js
   (analizarObra, obrasVisibles, la ventana de Sin rubro, irA…).

   - Números: últimos 30 días contra los 30 anteriores, presupuesto usado en
     las obras que lo tienen, OC sin factura hace más de 30 días y OC sin
     rubro (estas dos abren la lista).
   - Compras por mes: los últimos 6 meses apilados por obra, en pesos (las
     cuatro que más compraron con color; el resto, «Otras»). Tocar un mes lo
     abre en Explorar.
   - Obras · 30 días: cada obra en la moneda de su presupuesto, con su estado.
   - Presupuesto por rubro: cada obra con sus propios rubros y el % usado.
     No se comparan rubros entre obras.
   =================================================== */

const TB_MESES = 6;          // meses del gráfico de compras
const TB_SINFACT_DIAS = 30;  // sin factura pasados estos días
const TB_OBRAS_MAX = 8;      // obras en la lista antes de «Ver todas en Obras»

// La OC sin ningún archivo, pasados 30 días. Las que tienen archivos sin rotular
// no cuentan: no se puede afirmar que les falte (estadoFacturaOC, firebase.js).
function tbSinFactura() {
  const tope = finHoy() - TB_SINFACT_DIAS * DIA;
  return FIRMES.filter(oc => (oc.timestamp || 0) < tope && estadoFacturaOC(oc).estado === 'sin')
    .sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0));
}

// Presupuesto usado de la empresa: cada obra en pesos al dólar de hoy, así el
// porcentaje de cada una no cambia al sumarlas.
function tbPresUsado(todas) {
  const snap = typeof getDolarCached === 'function' ? getDolarCached() : null;
  const tc = snap?.oficial?.venta || snap?.oficial?.compra;
  const conPres = todas.filter(a => a.pres && (a.cur !== 'USD' || tc));
  const enPesos = (v, cur) => cur === 'USD' ? v * tc : v;
  const g = conPres.reduce((s, a) => s + enPesos(a.gast, a.cur), 0);
  const p = conPres.reduce((s, a) => s + enPesos(a.pres, a.cur), 0);
  return { n: conPres.length, p: p ? pct(g, p) : null };
}

function renderTablero() {
  const { vis, todas } = obrasVisibles();
  const fin = finHoy();
  const t30 = sumARS(FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 30 * DIA));
  const tp30 = sumARS(FIRMES.filter(oc => (oc.timestamp || 0) >= fin - 60 * DIA && (oc.timestamp || 0) < fin - 30 * DIA));
  const sinF = tbSinFactura();
  const sinR = todas.filter(a => a.conRubros).flatMap(a => a.sinRubro);
  const pu = tbPresUsado(todas);
  const centros = n => `${n} ${n === 1 ? 'obra' : 'obras'}`;

  const kpi = (k, v, sub, attr) => attr
    ? `<button type="button" class="rx-kpi rx-go" ${attr}><span class="rx-k">${k}</span><span class="v">${v}</span><span class="rx-muted">${sub}</span></button>`
    : `<div class="rx-kpi"><span class="rx-k">${k}</span><span class="v">${v}</span><span class="rx-muted">${sub}</span></div>`;
  const kpis = [
    kpi('Últimos 30 días', esc(money(t30)),
      tp30 ? `<span class="rx-pill ${t30 > tp30 ? 'rx-warn' : 'rx-ok'}">${varTxt(t30, tp30)}</span> vs. 30 días anteriores` : 'sin compras en los 30 anteriores'),
    pu.p !== null
      ? kpi('Presupuesto usado', pu.p + '%', `en ${esc(centros(pu.n))} con presupuesto`)
      : kpi('Presupuesto usado', '—', esc('Ninguna obra tiene presupuesto'), 'data-tbtab="obras"'),
    sinF.length
      ? kpi('Sin factura', esc(money(sumARS(sinF))), `${plural(sinF.length, 'OC', 'OC')}, más de ${TB_SINFACT_DIAS} días`, 'data-sinfact="1"')
      : kpi('Sin factura', '0', `ninguna OC de más de ${TB_SINFACT_DIAS} días`),
    sinR.length
      ? kpi('Sin rubro', esc(money(sumARS(sinR))), `${plural(sinR.length, 'OC', 'OC')} por asignar`, 'data-sinrubro="1"')
      : kpi('Sin rubro', '0', 'todas las OC tienen rubro'),
  ].join('');

  // Obras · 30 días: lo que más compró primero; lo que necesita atención, aunque no haya comprado.
  const lista = vis.filter(a => a.d30 || a.p30 || a.estado.nivel >= 2)
    .sort((x, y) => y.d30ars - x.d30ars || y.estado.nivel - x.estado.nivel);
  const obrasHtml = lista.length ? `<div class="rx-list">${lista.slice(0, TB_OBRAS_MAX).map(a => `
      <button type="button" class="rx-tbo" data-ficha="${esc(a.o.key)}">
        <span class="rx-row"><b class="rx-ell">${esc(a.o.nombre)}</b><span class="rx-num">${esc(money(a.d30, a.cur))}</span></span>
        <span class="rx-row"><span class="rx-pill ${a.estado.cls}">${esc(a.estado.txt)}</span>
          <span class="rx-muted">${a.p30 ? `${varTxt(a.d30, a.p30)} vs. 30 días ant.` : a.d30 ? 'nada en los 30 anteriores' : 'sin compras'}</span></span>
      </button>`).join('')}</div>
      ${lista.length > TB_OBRAS_MAX ? `<button type="button" class="rx-mas" data-tbtab="obras">Ver todas las obras en Obras (${lista.length})</button>` : ''}`
    : `<div class="rx-empty">Sin compras en los últimos 60 días.</div>`;

  // Presupuesto por rubro: sólo las obras con rubros presupuestados.
  const conRub = todas.filter(a => a.pres && a.rubros.some(r => r.p))
    .sort((x, y) => y.estado.nivel - x.estado.nivel || x.o.nombre.localeCompare(y.o.nombre));
  const celda = (a, r) => {
    const p = pctRubro(r), cls = p > 100 ? 'rx-bad' : p >= 85 ? 'rx-warn' : !r.g ? 'rx-off' : 'rx-ok';
    return `<button type="button" class="rx-cel ${cls}" data-ficha="${esc(a.o.key)}" data-rubro="${esc(r.id)}" title="${esc(r.n)}: ${esc(money(r.g, a.cur))} de ${esc(money(r.p, a.cur))}">
      <span class="cn">${esc(r.n)}</span><span class="rx-num">${p}%</span></button>`;
  };
  const rubrosHtml = conRub.length ? conRub.map(a => `
      <div class="rx-tbr">
        <button type="button" class="rx-mas rx-tbn" data-ficha="${esc(a.o.key)}">${esc(a.o.nombre)}</button>
        <div class="rx-mx">${a.rubros.filter(r => r.p).map(r => celda(a, r)).join('')}</div>
      </div>`).join('') + `<span class="rx-muted">${esc('Cada obra con sus propios rubros: no se comparan entre obras.')}</span>`
    : `<div class="rx-empty">${esc('Ninguna obra tiene el presupuesto repartido por rubro. Se carga desde la ficha de cada una.')}</div>`;

  $('rx-app').innerHTML = `
    <div class="rx-kpis">${kpis}</div>
    <div class="rx-grid">
      <section class="rx-card rx-c8" aria-label="Compras por mes">
        <div class="rx-row"><h3>Compras por mes</h3><span class="rx-muted" id="rx-tbm-u"></span></div>
        <div class="rx-chart" id="rx-tbm"></div>
        <div class="rx-ley" id="rx-tbm-ley"></div>
        <span class="rx-foot" id="rx-tbm-pie"></span>
      </section>
      <section class="rx-card rx-c4" aria-label="${esc('Obras')} en los últimos 30 días">
        <div class="rx-row"><h3>${esc('Obras')} · 30 días</h3></div>
        ${obrasHtml}
      </section>
      <section class="rx-card rx-c12" aria-label="Presupuesto por rubro">
        <div class="rx-row rx-tbh"><h3>Presupuesto por rubro</h3>${conRub.length ? '<span class="rx-cats"><span class="rx-pill rx-ok">menos de 85%</span><span class="rx-pill rx-warn">85–100%</span><span class="rx-pill rx-bad">pasado</span></span>' : ''}</div>
        ${rubrosHtml}
      </section>
    </div>`;
  dibujarMeses();
}

// ---- Compras por mes, apiladas por obra ----
// Se dibuja al ancho real (como el acumulado de Explorar): se redibuja al cambiar el tamaño.
function dibujarMeses() {
  const box = $('rx-tbm');
  if (!box) return;
  const hoy = new Date();
  const meses = [];
  for (let i = TB_MESES - 1; i >= 0; i--) {
    const a = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push({ ini: a.getTime(), fin: new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime(), m: a.getMonth(), off: -i });
  }
  const l = FIRMES.filter(oc => (oc.timestamp || 0) >= meses[0].ini);
  if (!l.length) {
    box.innerHTML = `<div class="rx-empty">No hay compras en los últimos ${TB_MESES} meses.</div>`;
    $('rx-tbm-u').textContent = ''; $('rx-tbm-ley').innerHTML = ''; $('rx-tbm-pie').textContent = '';
    return;
  }
  const g = agrupar(l, obraKey, (oc, k) => obraLabel(k));
  const ser = g.slice(0, 4).map((x, i) => ({ key: x.key, label: obraLabel(x.key), color: `var(--s${i + 1})` }));
  if (g.length > 4) ser.push({ key: null, label: `Otras (${g.length - 4})`, color: 'var(--otros)' });
  const idx = new Map(ser.filter(s => s.key !== null).map((s, i) => [s.key, i]));
  const val = meses.map(() => ser.map(() => 0));
  l.forEach(oc => {
    const t = oc.timestamp || 0, mi = meses.findIndex(m => t >= m.ini && t < m.fin);
    if (mi < 0) return;
    const s = idx.has(obraKey(oc)) ? idx.get(obraKey(oc)) : ser.length - 1;
    val[mi][s] += ars(oc) || 0;
  });
  const tot = val.map(v => v.reduce((s, x) => s + x, 0));

  const W = Math.max(280, box.clientWidth || 600), angosto = W < 520, H = angosto ? 180 : 240;
  const Lm = 36, B = 22, T = 20, Rm = 4;
  const maxT = Math.max(...tot, 1), div = maxT >= 1e6 ? 1e6 : 1e3, maxV = nice(maxT / div);
  $('rx-tbm-u').textContent = div === 1e6 ? 'millones de $' : 'miles de $';
  const y = v => H - B - v / div / maxV * (H - B - T);
  const paso = (W - Lm - Rm) / TB_MESES, bw = Math.min(56, paso * .62);
  const corto = v => nf(v / div, v / div < 10 && v ? 1 : 0);

  const ticks = [0, .5, 1].map(f => `<line x1="${Lm}" x2="${W - Rm}" y1="${y(maxV * f * div)}" y2="${y(maxV * f * div)}" stroke="var(--line)"/>` +
    `<text x="${Lm - 7}" y="${y(maxV * f * div) + 4}" text-anchor="end">${nf(maxV * f, Number.isInteger(maxV * f) ? 0 : 1)}</text>`).join('');
  const ult = meses.length - 1, alDia = hoy.getDate();
  let barras = '', cols = '';
  meses.forEach((m, i) => {
    const x = Lm + i * paso + (paso - bw) / 2;
    let acc = 0;
    ser.forEach((s, k) => {
      const v = val[i][k];
      if (!v) return;
      const y1 = y(acc), y2 = y(acc + v);
      barras += `<rect x="${x.toFixed(1)}" y="${y2.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(y1 - y2 - 1.5, .5).toFixed(1)}" rx="3" fill="${s.color}"${i === ult ? ' opacity=".5"' : ''}></rect>`;
      acc += v;
    });
    const nom = MESES_LG[m.m];
    barras += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${MESES[m.m]}${i === ult ? (angosto ? '*' : ` (al ${alDia})`) : ''}</text>`;
    if (tot[i]) barras += `<text x="${x + bw / 2}" y="${y(tot[i]) - 6}" text-anchor="middle" style="fill:var(--ink);font-weight:600">${corto(tot[i])}</text>`;
    // Toda la columna se toca: abre ese mes en Explorar. Va detrás de las barras,
    // que dejan pasar el puntero (reportes.html).
    cols += `<rect class="rx-tbcol" x="${(Lm + i * paso).toFixed(1)}" y="0" width="${paso.toFixed(1)}" height="${H}" fill="transparent" data-tbmes="${m.off}">
      <title>${esc(nom[0].toUpperCase() + nom.slice(1))}: ${esc(money(tot[i]))}${ser.map((s, k) => val[i][k] ? `\n${s.label}: ${money(val[i][k])}` : '').join('')}\nTocá para verlo en Explorar</title></rect>`;
  });

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Compras por mes y por ${esc('obra')}, últimos ${TB_MESES} meses">${ticks}${cols}${barras}</svg>`;
  $('rx-tbm-ley').innerHTML = ser.map(s => `<span><span class="rx-sw" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('');
  const usd = l.some(oc => oc.moneda === 'USD');
  $('rx-tbm-pie').textContent = `${angosto ? `* ${MESES_LG[meses[ult].m][0].toUpperCase() + MESES_LG[meses[ult].m].slice(1)} hasta hoy. ` : ''}Tocá un mes para verlo en Explorar.${usd ? ' Las OC en dólares, al oficial de su fecha.' : ''}`;
}

// ---- Sin factura: la lista, agrupada por obra ----
function pintarModalSinFactura() {
  const l = tbSinFactura();
  const grupos = agrupar(l, obraKey, (oc, k) => obraLabel(k));
  const enSuMoneda = oc => ({ val: x => Number(x.total) || 0, cur: oc.moneda === 'USD' ? 'USD' : 'ARS' });
  const cuerpo = l.length
    ? `<div class="rx-muted">${esc(`OC emitidas hace más de ${TB_SINFACT_DIAS} días sin ningún archivo cargado. La factura se carga en Compras → Facturas.`)}</div>` +
      grupos.map(gr => `<div class="rx-mgrp"><div class="rx-row"><h3>${esc(gr.label)}</h3><span class="rx-muted rx-num">${esc(money(gr.total))}</span></div><div class="rx-list">${
        l.filter(oc => obraKey(oc) === gr.key).map(oc => ocFila(oc, enSuMoneda(oc))).join('')}</div></div>`).join('')
    : '<div><b>Listo.</b> <span class="rx-muted">No quedan OC viejas sin factura.</span></div>';
  MODAL = 'sinfact';
  abrirModal('Sin factura', l.length ? `${plural(l.length, 'OC', 'OC')} · ${money(sumARS(l))}` : 'Todo al día', cuerpo,
    l.length ? '<span></span><div class="foc-foot-r"><a class="foc-btn foc-btn--fac" href="facturas.html">Ir a Facturas</a></div>' : '');
}

// Clicks del Tablero. Devuelve true si eran suyos.
function onClickTablero(e) {
  const b = e.target.closest('[data-sinfact],[data-tbtab],[data-tbmes],[data-rubro]');
  if (!b) return false;
  const d = b.dataset;
  if (d.sinfact) { pintarModalSinFactura(); return true; }
  if (d.tbtab)   { irA({ tab: d.tbtab, ficha: null, rsel: null }); return true; }
  if (d.rubro)   { irA({ ficha: d.ficha, rsel: d.rubro }); return true; }
  if (d.tbmes !== undefined) {
    const m = Number(d.tbmes);
    Object.assign(EX, { per: 'mes', mesOff: Math.max(m, MES_MIN), obra: null, resp: null, equipo: null, q: '', ver: VER_PASO });
    irA({ tab: 'explorar', ficha: null, rsel: null });
    return true;
  }
  return false;
}
