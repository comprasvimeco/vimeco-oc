/* VIMECO S.A. — Búsqueda de OC por texto (Remitos, Historial, Novedades) */

// Sin acentos ni mayúsculas: en obra se escribe "caneria" y el ítem dice
// "Cañería". Se normaliza igual el texto buscado y el buscado adentro.
function normTxt(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Lo tipeado, partido en términos ya normalizados.
function terminosBusqueda(q) {
  return normTxt(q).trim().split(/\s+/).filter(Boolean);
}

// Todo lo buscable de una OC en un solo texto: proveedor, obra, número y la
// descripción de cada ítem. Así "hierro" encuentra la OC por su renglón aunque
// el proveedor no se llame así.
const _hayCacheOC = new WeakMap();
function haystackOC(oc) {
  let h = _hayCacheOC.get(oc);
  if (h === undefined) {
    h = normTxt([oc.proveedor?.nombre, oc.obra, oc.nroOC,
                 ...(oc.items || []).map(it => it.desc)].join(' '));
    _hayCacheOC.set(oc, h);
  }
  return h;
}

// Todos los términos tienen que aparecer, pero no juntos ni en orden: "cemento
// norte" encuentra la OC de cemento de la obra Norte.
function coincideOC(oc, terms) {
  const hay = haystackOC(oc);
  return terms.every(t => hay.includes(t));
}

// Renglones que explican la coincidencia, para mostrarlos en la tarjeta: si se
// buscó un artículo, sin esto no se ve por qué apareció esa OC.
function itemsCoincidentes(oc, terms) {
  if (!oc || !terms.length) return [];
  return (oc.items || [])
    .filter(it => { const d = normTxt(it.desc); return terms.every(t => d.includes(t)); })
    .map(it => it.desc);
}

// HTML de los renglones coincidentes (clase .rem-hits). `escFn` escapa texto.
function hitsHtml(hits, escFn) {
  if (!hits.length) return '';
  return `<div class="rem-hits">${
    hits.slice(0, 3).map(d => `<span>${escFn(d)}</span>`).join('')
  }${hits.length > 3 ? `<span>y ${hits.length - 3} ítem(s) más</span>` : ''}</div>`;
}
