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
    .filter(it => { const d = normTxt(it.desc); return terms.every(t => d.includes(t)); });
}

// "m3 · $ 12.345,00": unidad y precio unitario del renglón, en la moneda de la
// OC. Lo que falte (OC viejas, ítems sin unidad) simplemente no se muestra.
function _precioItem(it, moneda) {
  const partes = [];
  if (it.unidad) partes.push(it.unidad);
  const u = parseFloat(it.unitario);
  if (u) partes.push((moneda === 'USD' ? 'US$ ' : '$ ') +
    u.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return partes.join(' · ');
}

// HTML de los renglones coincidentes de `oc` (clase .rem-hits). `escFn` escapa texto.
function hitsHtml(oc, hits, escFn) {
  if (!hits.length) return '';
  return `<div class="rem-hits">${
    hits.slice(0, 3).map(it => {
      const precio = _precioItem(it, oc.moneda);
      return `<span class="rem-hit"><span class="rem-hit-desc">${escFn(it.desc)}</span>${
        precio ? `<span class="rem-hit-precio">${escFn(precio)}</span>` : ''}</span>`;
    }).join('')
  }${hits.length > 3 ? `<span>y ${hits.length - 3} ítem(s) más</span>` : ''}</div>`;
}
