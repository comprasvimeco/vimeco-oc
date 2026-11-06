/* ===================================================
   Leva — Reportes → Explorar: precios de lo que se busca
   reportesPrecios.js

   Buscando un artículo, una tarjeta por artículo con lo que le cobró cada
   proveedor y cómo cambió en el tiempo. Mira todas las compras, no sólo las del
   período: con una sola compra por mes no habría nada que comparar. Respeta los
   filtros de Explorar y compara sólo en la misma moneda y unidad.
   =================================================== */

const PRECIOS_ARTICULOS = 4;   // artículos antes de «Ver todos»
const PRECIOS_PROVS = 4;       // proveedores de cada artículo antes de «Ver todos»
const PRECIOS_COMPRAS = 5;     // compras del proveedor elegido
const PRECIOS_COINCIDENCIAS = 3;   // por tipo, en «proveedor, obra, responsable»

// ===================================================
//  Lógica (sin DOM; tests/precios.test.js)
// ===================================================

// De qué tamaño son los cortes del acumulado, según los días que hay para mostrar.
function granoPara(dias) {
  if (dias <= 21) return 'dia';
  if (dias <= 91) return 'semana';
  if (dias <= 200) return 'quincena';
  return 'mes';
}

// Los renglones que explican la búsqueda: algún término tiene que estar en el artículo y el
// resto, en el artículo o en la OC («cemento corralon» es el cemento de Corralón; «corralon»
// solo no es un artículo).
function renglonCoincide(oc, it, terms, normTxt) {
  const d = normTxt(it.desc);
  if (!terms.some(t => d.includes(t))) return false;
  const oc2 = normTxt([oc.proveedor?.nombre, oc.obra, oc.nroOC, oc.responsable?.nombre].join(' '));
  return terms.every(t => d.includes(t) || oc2.includes(t));
}

// Un resultado por artículo, moneda y unidad, del más comprado al menos.
// deps: { norm: normDesc, normTxt, prov: oc → clave del proveedor }
// provs: del más barato al más caro, por el último precio de cada uno.
function preciosArticulos(ocs, terms, deps) {
  const { norm, normTxt, prov } = deps;
  const porArt = new Map();
  ocs.forEach(oc => {
    const cur = oc.moneda === 'USD' ? 'USD' : 'ARS';
    (oc.items || []).forEach(it => {
      const pu = parseFloat(it.unitario) || 0;
      if (pu <= 0 || !it.desc || !renglonCoincide(oc, it, terms, normTxt)) return;
      const k = norm(it.desc) + '|' + cur;
      if (!porArt.has(k)) porArt.set(k, []);
      porArt.get(k).push({ oc, t: oc.timestamp || 0, pu, cant: parseFloat(it.cant) || 0, cur, desc: it.desc,
        un: norm(it.unidad || ''), unidad: it.unidad || '', p: prov(oc), pn: oc.proveedor?.nombre || 'Sin proveedor' });
    });
  });

  const res = [];
  porArt.forEach(l => {
    // Un renglón sin unidad va con la unidad más usada de ese artículo.
    const cuenta = new Map();
    l.forEach(c => { if (c.un) cuenta.set(c.un, (cuenta.get(c.un) || 0) + 1); });
    const usual = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const porUn = new Map();
    l.forEach(c => { const u = c.un || usual; if (!porUn.has(u)) porUn.set(u, []); porUn.get(u).push(c); });
    porUn.forEach(compras => {
      compras.sort((a, b) => a.t - b.t);
      const m = new Map();
      compras.forEach(c => { if (!m.has(c.p)) m.set(c.p, []); m.get(c.p).push(c); });
      const provs = [...m.values()].map(cs => {
        const ult = cs[cs.length - 1], prev = cs.length > 1 ? cs[cs.length - 2] : null;
        return { p: ult.p, pn: ult.pn, compras: cs, ult, dif: prev ? (ult.pu - prev.pu) / prev.pu : null };
      }).sort((a, b) => a.ult.pu - b.ult.pu);
      const ult = compras[compras.length - 1];
      res.push({ key: norm(ult.desc) + '|' + ult.cur + '|' + (ult.un || usual), desc: ult.desc, unidad: compras.find(c => c.unidad)?.unidad || '', cur: ult.cur, compras, provs });
    });
  });
  return res.sort((a, b) => b.compras.length - a.compras.length || b.compras[b.compras.length - 1].t - a.compras[a.compras.length - 1].t);
}

// Lo primero que hay que saber de un artículo. `fmt`: precio → texto; `fecha`: timestamp → texto.
function frasePrecio(a, fmt, fecha) {
  const u = a.compras[a.compras.length - 1], barato = a.provs[0];
  if (a.compras.length < 2) return `Una sola compra, a ${fmt(u.pu)} el ${fecha(u.t)}.`;
  if (a.provs.length < 2) {
    const c0 = a.compras[0], v = Math.round((u.pu / c0.pu - 1) * 100);
    if (!v) return `A ${u.pn} le pagás lo mismo desde el ${fecha(c0.t)}: ${fmt(u.pu)}.`;
    return `A ${u.pn} le pagabas ${fmt(c0.pu)} el ${fecha(c0.t)}; ahora, ${fmt(u.pu)} (${v > 0 ? '+' : '−'}${Math.abs(v)}%).`;
  }
  if (u.pu <= barato.ult.pu) return `Lo último que compraste, a ${u.pn}, es el mejor precio que tenés: ${fmt(u.pu)}.`;
  const menos = Math.round((1 - barato.ult.pu / u.pu) * 100);
  return `Lo último se lo compraste a ${u.pn} a ${fmt(u.pu)}. ${barato.pn} te lo vendió a ${fmt(barato.ult.pu)} el ${fecha(barato.ult.t)}: ${menos}% menos.`;
}

if (typeof module !== 'undefined') {
  module.exports = { granoPara, renglonCoincide, preciosArticulos, frasePrecio };
}

// ===================================================
//  Tarjetas
// ===================================================
// El gráfico resalta al proveedor elegido; los demás quedan de fondo, en gris. Un color por
// proveedor se confundiría con los de las obras, y no alcanzarían.
function precioGraf(a, foco) {
  if (a.compras.length < 2) return '';
  const ts = a.compras.map(c => c.t), vals = a.compras.map(c => c.pu);
  const minT = Math.min(...ts), maxT = Math.max(...ts), mn0 = Math.min(...vals), mx0 = Math.max(...vals);
  const pad = (mx0 - mn0) * .15 || mx0 * .1;
  const mn = Math.max(0, mn0 - pad), mx = mx0 + pad;
  const x = t => maxT > minT ? 3 + (t - minT) / (maxT - minT) * 94 : 50;
  const y = v => (v - mn) / (mx - mn) * 100;
  const fx = v => v.toFixed(2);
  const orden = [...a.provs.filter(p => p !== foco), foco];
  const lineas = orden.filter(p => p.compras.length > 1).map(p =>
    `<path class="rx-pr-l${p === foco ? ' on' : ''}" d="M${p.compras.map(c => fx(x(c.t)) + ' ' + fx(100 - y(c.pu))).join(' L')}"/>`).join('');
  const puntos = orden.flatMap(p => p.compras.map(c =>
    `<span class="rx-pr-dot${p === foco ? ' on' : ''}" style="left:${fx(x(c.t))}%;bottom:${fx(y(c.pu))}%"></span>`)).join('');
  const marca = (v, arriba) => `<span class="rx-gr-g" style="bottom:${fx(y(v))}%"></span><span class="rx-gr-top" style="bottom:${fx(y(v))}%;${arriba ? '' : 'transform:translateY(100%)'}">${esc(precioTxt(v, a.cur))}</span>`;
  return `<div class="rx-pr-plot" role="img" aria-label="${esc(`Precio de ${a.desc} en cada compra, del ${dmy(minT)} al ${dmy(maxT)}`)}">
      ${marca(mx0, true)}${mn0 < mx0 ? marca(mn0, false) : ''}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lineas}</svg>${puntos}
    </div>
    <div class="rx-legend"><span>${dm(minT)}</span><span>${dm(maxT)}</span></div>`;
}

function articuloHtml(a, terms) {
  const un = a.unidad ? a.unidad.toLowerCase() : 'unidad';
  const barato = a.provs[0], ultimaCompra = a.compras[a.compras.length - 1];
  // Elegido: el que tocó la persona; si no, a quien se le compró por última vez.
  const foco = a.provs.find(p => p.p === EX.artFoco[a.key]) || a.provs.find(p => p.p === ultimaCompra.p);
  const abierto = EX.artProvs[a.key];
  const vis = abierto ? a.provs : a.provs.filter((p, i) => i < PRECIOS_PROVS || p === foco);
  const fila = p => {
    const sobre = Math.round((p.ult.pu / barato.ult.pu - 1) * 100);
    const tag = a.provs.length < 2 ? '' : !sobre ? '<span class="rx-pill rx-ok">Más barato</span>' : `<span class="rx-pill rx-off">+${sobre}%</span>`;
    const cambio = p.dif === null || !Math.round(p.dif * 100) ? '' : ` · ${p.dif > 0 ? '↑' : '↓'} ${Math.abs(Math.round(p.dif * 100))}%`;
    return `<button type="button" class="rx-prr${p === foco ? ' sel' : ''}" data-art="${esc(a.key)}" data-foco="${esc(p.p)}" aria-pressed="${p === foco}">
      <span class="rx-l"><b class="rx-ell2">${esc(p.pn)}</b><span class="rx-muted">${dm(p.ult.t)} · ${plural(p.compras.length, 'compra', 'compras')}${cambio}</span></span>
      <span class="rx-ocf-r"><b class="rx-num">${esc(precioTxt(p.ult.pu, a.cur))}</b>${tag}</span></button>`;
  };
  const trayecto = () => {
    const c = foco.compras, u = c[c.length - 1];
    if (c.length < 2) return `${foco.pn}: una sola compra, el ${dmy(u.t)}.`;
    const v = Math.round((u.pu / c[0].pu - 1) * 100);
    return `${foco.pn}: de ${precioTxt(c[0].pu, a.cur)} a ${precioTxt(u.pu, a.cur)} desde el ${dm(c[0].t)}${v ? ` (${v > 0 ? '+' : '−'}${Math.abs(v)}%)` : ''}.`;
  };
  const compras = [...foco.compras].reverse().slice(0, PRECIOS_COMPRAS);
  return `<section class="rx-card" aria-label="${esc(a.desc)}">
      <div class="rx-l"><h3>${resaltarTxt(a.desc, terms, esc)}</h3><span class="rx-muted">Por ${esc(un)}${a.cur === 'USD' ? ', en dólares' : ''}</span></div>
      <p class="rx-pr-f">${esc(frasePrecio(a, v => precioTxt(v, a.cur), dm))}</p>
      ${a.provs.length > 1 ? `<div class="rx-pr-ps">${vis.map(fila).join('')}</div>
        ${a.provs.length > PRECIOS_PROVS ? `<button type="button" class="rx-mas" data-art-provs="${esc(a.key)}">${abierto ? 'Ver menos' : `Ver los ${a.provs.length} proveedores`}</button>` : ''}` : ''}
      ${a.compras.length > 1 ? `${precioGraf(a, foco)}<span class="rx-muted">${esc(trayecto())}</span>` : ''}
      <div class="rx-mgrp"><span class="rx-k">Compras a ${esc(foco.pn)}</span>
        <div class="rx-list">${compras.map(c => `<button type="button" class="rx-ocb rx-prc" data-oc="${esc(c.oc.nroOC)}">
          <span class="rx-l"><span class="rx-ell2">${dmy(c.t)}</span><span class="rx-muted rx-ell2">${swObra(obraKey(c.oc))}${esc(obraLabel(obraKey(c.oc)))}</span></span>
          <span class="rx-num">${esc(precioTxt(c.pu, c.cur))}</span></button>`).join('')}</div>
      </div>
    </section>`;
}

// Las tarjetas de lo buscado. Vacío si no se buscó un artículo.
function preciosHtml(ocs, terms) {
  const arts = preciosArticulos(ocs, terms, { norm: normDesc, normTxt, prov: PROV_KEY });
  if (!arts.length) return '';
  const vis = EX.artTodos ? arts : arts.slice(0, PRECIOS_ARTICULOS);
  return `<div class="rx-row rx-pr-h"><h3>Precios</h3><span class="rx-muted">de todas las compras, sin importar el período</span></div>
    ${vis.map(a => articuloHtml(a, terms)).join('')}
    ${arts.length > PRECIOS_ARTICULOS ? `<button type="button" class="rx-mas" data-art-todos="1">${EX.artTodos ? 'Ver menos artículos' : `Ver los ${arts.length} artículos`}</button>` : ''}`;
}

// Lo buscado como proveedor, obra, persona o equipo: tocarlo filtra toda la pestaña.
function coincidenciasHtml(terms) {
  const dice = t => { const n = normTxt(t); return terms.every(x => n.includes(x)); };
  const tipos = [
    ['prov', 'Proveedor', PROV_KEY, oc => oc.proveedor?.nombre || ''],
    ['obra', voc('Centro'), obraKey, oc => obraLabel(obraKey(oc))],
    ['resp', 'Responsable', respKey, respLabel],
  ];
  if (vocActivos()) tipos.push(['equipo', voc('Activo'), oc => oc.equipo?.codigo || '—', oc => equipoLabel(oc.equipo)]);
  const filas = tipos.flatMap(([campo, tipo, key, label]) =>
    agrupar(FIRMES, key, label).filter(g => g.key !== '—' && g.label && dice(g.label)).slice(0, PRECIOS_COINCIDENCIAS).map(g => `
      <button type="button" class="rx-ocf" data-ir-f="${campo}" data-ir-k="${esc(g.key)}">
        ${campo === 'prov' ? avatarHtml(g.label) : campo === 'obra' ? `<span class="rx-co-sw">${swObra(g.key)}</span>` : ''}
        <span class="rx-l"><span class="rx-k">${esc(tipo)}</span><b class="rx-ell2">${resaltarTxt(g.label, terms, esc)}</b></span>
        <span class="rx-ocf-r"><b class="rx-num">${esc(money(g.total))}</b><span class="rx-muted">${plural(g.n, 'OC', 'OC')}</span></span></button>`));
  return filas.length ? `<section class="rx-card" aria-label="Coincidencias"><div class="rx-list">${filas.join('')}</div></section>` : '';
}
