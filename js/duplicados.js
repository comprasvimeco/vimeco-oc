/* VIMECO S.A. — OC duplicadas: detección y anulación por reemplazo */

// La misma persona emite al mismo proveedor, dentro de una hora, una OC por un
// monto parecido (±25%): es la misma compra hecha dos veces (doble clic, "parecía
// que falló y la hice de nuevo", o rehecha corrigiendo un precio). La huella es
// que los números suelen salir consecutivos: 0004-00000157 y 158.
//
// Hasta v201 bastaba mismo proveedor + mismo día + mismo monto exacto, sin mirar
// quién ni a qué hora: marcaba en falso dos obras que le compraban lo mismo al
// mismo corralón en el día, y se le escapaba la OC rehecha con un ajuste.
//
// La obra NO se exige: rehacerla por haber elegido mal la obra también es un
// duplicado (la obra se ve en cada renglón). Las OC sin hora no se comparan.
//
// El monto se compara en su moneda original, no en la de visualización: el toggle
// ARS/USD de Reportes no puede cambiar qué es un duplicado.
//
// Lo usan Reportes (tarjeta de duplicados), la emisión (aviso antes de generar),
// Historial (el responsable resuelve las suyas) y Autorizaciones (anular la
// reemplazada cuando se firma la corrección).
const DUP_VENTANA_MS = 60 * 60 * 1000;
const DUP_TOLERANCIA = 0.25;

function montoDe(oc) { return parseFloat(oc.total) || 0; }

// Lo que se compró: las pendientes, rechazadas y canceladas nunca fueron una
// compra, y una anulada dejó de serlo (la reemplazó otra OC).
const ESTADOS_SIN_COMPRA = new Set(['pendiente', 'rechazada', 'cancelada', 'anulada']);
function esCompraFirme(oc) { return !ESTADOS_SIN_COMPRA.has(oc.estado || 'emitida'); }

// ---- Identidad del proveedor ----
// El CUIT es la identidad real; `proveedor.nombre` es un snapshot de texto libre
// que varía entre OC del mismo proveedor ("MARCU SA" vs "MARCU S.A", "SOPPE
// INGENIERIA S.R.L." vs "...S.R.L"). Gemelo de normalizeProvName() en app.js.
function normProvName(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(s\.a\.s\.|s\.r\.l\.|s\.a\.|s\.a\.s|s\.r\.l|s\.a|sas|srl|sa)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Un CUIT de menos de 10 dígitos no es un CUIT: el OCR a veces mete el código
// interno del proveedor en ese campo (una OC de GER-VIAL guardó "00003658").
function cuitDigits(oc) {
  const d = String(oc.proveedor?.cuit || '').replace(/\D/g, '');
  return d.length >= 10 ? d : '';
}

// Átomos de una OC: su CUIT (si es válido) y su nombre normalizado.
function _provAtoms(oc) {
  const d = cuitDigits(oc);
  const n = normProvName(oc.proveedor?.nombre);
  return { cuit: d ? 'c' + d : null, nombre: n ? 'n' + n : null };
}

// El CUIT solo no alcanza como identidad: se tipea a mano (o lo saca la IA de
// un presupuesto) y un dígito de más parte al proveedor en dos. Pasó con
// INDUTERM INGENIERIA S.R.L., que salía dos veces en el ranking —#6 y #7, una OC
// cada una— y cuyas dos órdenes del mismo día por el mismo importe no se
// detectaban como duplicadas porque el detector agrupa por proveedor.
//
// Así que la identidad se arma con las DOS señales, CUIT y nombre normalizado,
// y es transitiva: dos OC son del mismo proveedor si comparten cualquiera de
// las dos. Eso une "mismo nombre, CUIT mal tipeado" (el caso de arriba) y
// "mismo CUIT, nombre escrito distinto" (el que ya resolvía el CUIT).
//
// El precio: dos proveedores realmente distintos que compartan nombre
// normalizado quedan en un solo grupo aunque tengan CUIT distinto. Con nombres
// de empresa completos es mucho menos probable que el error de tipeo inverso.
//
// Devuelve la función clave-de-proveedor para las OC de `list`.
function indiceProveedores(list) {
  const union = new Map();   // átomo → átomo padre
  const find = (atom, crear) => {
    if (!union.has(atom)) {
      if (!crear) return atom;          // fuera del índice: vale por sí mismo
      union.set(atom, atom);
    }
    let raiz = atom;
    while (union.get(raiz) !== raiz) raiz = union.get(raiz);
    // Compresión de camino: las próximas búsquedas son directas.
    let k = atom;
    while (union.get(k) !== raiz) { const sig = union.get(k); union.set(k, raiz); k = sig; }
    return raiz;
  };
  list.forEach(oc => {
    const { cuit, nombre } = _provAtoms(oc);
    if (!cuit && !nombre) return;
    const a = find(cuit || nombre, true);
    const b = find(nombre || cuit, true);
    // La raíz del CUIT gana cuando hay uno: es la clave más estable.
    if (a !== b) union.set(b, a);
  });
  return oc => {
    const { cuit, nombre } = _provAtoms(oc);
    if (!cuit && !nombre) return '—';
    return find(cuit || nombre, false);
  };
}

const _parejaDup = (a, b) => Math.abs(b.timestamp - a.timestamp) <= DUP_VENTANA_MS &&
  Math.abs(montoDe(b) - montoDe(a)) <= DUP_TOLERANCIA * Math.max(montoDe(a), montoDe(b));

// Grupos de OC duplicadas de `list`, cada uno en orden de emisión (la primera
// adelante). `provKeyFn` agrupa por proveedor; por defecto, uno armado sobre la lista.
function grupoDuplicados(list, provKeyFn = indiceProveedores(list)) {
  const map = new Map();
  list.forEach(oc => {
    if (!montoDe(oc) || !oc.timestamp) return;   // una OC en $0 no es un duplicado
    const k = [provKeyFn(oc), oc.responsable?.codigo || '—', oc.moneda || 'ARS'].join('|');
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(oc);
  });

  // Dentro de cada proveedor+persona+moneda, en orden de emisión, cada OC se
  // suma al grupo cuya última OC cae dentro de la ventana y de la tolerancia.
  // Se busca entre todos los grupos (no sólo el último) para que otra compra
  // distinta emitida en el medio no corte el duplicado.
  const grupos = [];
  map.forEach(ocs => {
    const abiertos = [];
    ocs.sort((a, b) => a.timestamp - b.timestamp).forEach(oc => {
      const g = abiertos.find(g => _parejaDup(g[g.length - 1], oc));
      if (g) g.push(oc); else abiertos.push([oc]);
    });
    grupos.push(...abiertos);
  });
  return grupos
    .filter(g => g.length > 1)
    .sort((a, b) => montoDe(b[0]) - montoDe(a[0]));
}

// Grupos que `codigo` tiene que resolver: sus propias compras firmes que se
// parecen, salvo que ya haya dicho que son compras distintas. Un grupo vuelve a
// aparecer sólo si se le suma una OC nueva sin revisar.
function duplicadosPorRevisar(list, codigo) {
  const mias = list.filter(oc => oc.responsable?.codigo === codigo && esCompraFirme(oc));
  return grupoDuplicados(mias).filter(g => !g.every(oc => oc.noDuplicada));
}

// Antes de emitir: las compras firmes de quien emite que la OC nueva estaría
// repitiendo. `nueva` trae proveedor, moneda, total y responsable.codigo.
function duplicadosDeNueva(nueva, list) {
  const ahora = Date.now();
  const yo    = { ...nueva, timestamp: ahora };
  if (!montoDe(yo)) return [];
  const cands = list.filter(oc =>
    oc.responsable?.codigo === yo.responsable?.codigo && esCompraFirme(oc) &&
    oc.timestamp && ahora - oc.timestamp <= DUP_VENTANA_MS &&
    (oc.moneda || 'ARS') === (yo.moneda || 'ARS') && _parejaDup(oc, yo));
  if (!cands.length) return [];
  const prov = indiceProveedores([...cands, yo]);
  const k    = prov(yo);
  return cands.filter(oc => prov(oc) === k).sort((a, b) => a.timestamp - b.timestamp);
}

function _quienSoy() {
  return {
    codigo: sessionStorage.getItem('responsable_code') || '',
    nombre: sessionStorage.getItem('responsable_name') || ''
  };
}

// Deja sin validez las OC `viejas`, reemplazadas por la OC `nroNuevo`. No se
// borran: siguen en el historial y en Novedades con la etiqueta "Duplicada",
// pero salen de Reportes y de las comparaciones de precio. El PDF que ya se le
// haya mandado al proveedor no se toca.
async function anularPorReemplazo(viejas, nroNuevo, por = _quienSoy()) {
  const ts = Date.now();
  await Promise.all(viejas.map(oc => {
    const anulacion = { ts, por, reemplazadaPor: nroNuevo, estadoAnterior: oc.estado || 'emitida' };
    return patchHistorialEntry(oc.nroOC.replace(/-/g, ''), { estado: 'anulada', anulacion })
      .then(() => { oc.estado = 'anulada'; oc.anulacion = anulacion; });
  }));
}

// "Son compras distintas": la marca queda en cada OC, así nadie más las vuelve
// a ver como duplicadas.
async function marcarComprasDistintas(ocs, por = _quienSoy()) {
  const marca = { ts: Date.now(), por: por.nombre || '' };
  await Promise.all(ocs.map(oc =>
    patchHistorialEntry(oc.nroOC.replace(/-/g, ''), { noDuplicada: marca })
      .then(() => { oc.noDuplicada = marca; })));
}

// Texto de la etiqueta de una OC anulada por duplicada.
function textoDuplicada(oc) {
  const nro = oc.anulacion?.reemplazadaPor;
  return nro ? `Duplicada, se reemplazó por OC ${nro}` : 'Duplicada';
}

function horaDe(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Leyenda bajo el monto de cada OC de un grupo de duplicados.
function etiquetaDup(oc, head) {
  if (oc === head) return 'primera';
  const d = difDup(oc, head);
  return d ? d + ' vs. la primera' : 'mismo monto';
}

// Diferencia de una OC contra la primera del grupo, o '' si es idéntica.
function difDup(oc, head) {
  const base = montoDe(head);
  const pct = base ? (montoDe(oc) - base) / base * 100 : 0;
  if (Math.abs(pct) < 0.05) return '';
  return (pct > 0 ? '+' : '−') + Math.abs(pct).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
}

// Una corrección que tuvo que pedir autorización anula a las que reemplaza
// recién cuando la firman: si la rechazan, la anterior sigue valiendo. Se lee
// el estado del servidor porque entre el pedido y la firma la anterior pudo
// haberse anulado, cancelado o borrado (un PATCH a un registro borrado lo
// resucitaría como un esqueleto sin datos).
async function anularReemplazadasDe(nueva) {
  const base   = FIREBASE_CONFIG.databaseURL;
  const viejas = [];
  for (const nro of nueva.reemplazaA || []) {
    const key  = nro.replace(/-/g, '');
    const resp = await _fetchConTope(base + '/historial/' + key + '/nroOC.json');
    if (!resp.ok || !(await resp.json())) continue;
    const estado = await getHistorialEstado(key);
    if (esCompraFirme({ estado })) viejas.push({ nroOC: nro, estado: estado || 'emitida' });
  }
  if (viejas.length) await anularPorReemplazo(viejas, nueva.nroOC, nueva.responsable || _quienSoy());
  return viejas;
}
