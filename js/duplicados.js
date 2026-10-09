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

// La corrección que cambia mucho el monto: la OC rehecha repite los artículos
// de la otra (y suele sumar o sacar alguno). La 0006-00000511 de REYES HILDA
// JOSEFINA rehízo la 510 agregándole rejillas: +37%, y no se detectaba. Si
// todos los renglones de la OC con menos renglones están en la otra, y es la
// misma obra, el monto no se mira.
//
// No alcanzaba con que los números fueran seguidos: es muy común partir un
// presupuesto en varias OC al hilo (una por tanda o por obra), y eso traía
// 22 grupos falsos. La obra se exige acá porque comprar el mismo filtro para
// dos obras, una OC para cada una, también es común y no es un duplicado.
function _normDesc(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function _repiteArticulos(a, b) {
  if ((a.obra || '').trim().toLowerCase() !== (b.obra || '').trim().toLowerCase()) return false;
  const da = new Set((a.items || []).map(i => _normDesc(i.desc)).filter(Boolean));
  const db = new Set((b.items || []).map(i => _normDesc(i.desc)).filter(Boolean));
  const [menos, mas] = da.size <= db.size ? [da, db] : [db, da];
  return menos.size > 0 && [...menos].every(d => mas.has(d));
}

const _parejaDup = (a, b) => Math.abs(b.timestamp - a.timestamp) <= DUP_VENTANA_MS &&
  (Math.abs(montoDe(b) - montoDe(a)) <= DUP_TOLERANCIA * Math.max(montoDe(a), montoDe(b)) ||
   _repiteArticulos(a, b));

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
// aparecer sólo si se le suma una OC nueva sin revisar. Al Jefe de Obra
// (`obrasJefe`, de alcanceOC) le tocan también las de sus obras.
function duplicadosPorRevisar(list, codigo, obrasJefe = null) {
  const mias = list.filter(oc => (oc.responsable?.codigo === codigo || (obrasJefe && esDeObrasJefe(oc, obrasJefe))) &&
                                 esCompraFirme(oc));
  return grupoDuplicados(mias).filter(g => !g.every(oc => oc.noDuplicada));
}

// Antes de emitir: las compras firmes de quien emite que la OC nueva estaría
// repitiendo. `nueva` trae proveedor, moneda, total y responsable.codigo, y
// obra e items para reconocer la corrección que cambió el monto.
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

// ---- Anular una OC a mano, desde su tarjeta (Historial y Novedades) ----
// Para la que el detector no agarra (proveedor mal cargado, más de una hora,
// artículos distintos): el mismo resultado que resolver un grupo de duplicados.
// Se elige qué OC al mismo proveedor de `list` la reemplaza; por defecto la
// más cercana emitida después. Resuelve true si se anuló, false si no.
function _escDup(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _modalAnular() {
  let m = document.getElementById('modal-anular');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'modal-overlay hidden';
  m.id = 'modal-anular';
  m.innerHTML = `
    <div class="confirm-box confirm-box--warn confirm-box--wide" role="dialog" aria-modal="true" aria-labelledby="anular-title">
      <span class="confirm-ic">${icSvg('copy')}</span>
      <div class="confirm-title" id="anular-title">Anular OC</div>
      <p id="anular-texto" class="confirm-msg"></p>
      <p id="anular-pregunta" class="anular-pregunta">¿Fue reemplazada por alguna Orden de Compra?</p>
      <div id="anular-lista" class="dup-lista anular-lista" role="radiogroup" aria-label="OC que la reemplaza"></div>
      <div class="confirm-btns">
        <button type="button" class="foc-btn foc-btn--clear" id="btn-anular-cancel">Cancelar</button>
        <button type="button" class="foc-btn foc-btn--del" id="btn-anular-ok">${icSvg('x')}Anular</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  return m;
}

function anularOCManual(oc, list) {
  const m     = _modalAnular();
  const prov  = indiceProveedores(list);
  const k     = prov(oc);
  const cands = list
    .filter(o => o !== oc && o.nroOC !== oc.nroOC && esCompraFirme(o) && prov(o) === k)
    .sort((a, b) => Math.abs(a.timestamp - oc.timestamp) - Math.abs(b.timestamp - oc.timestamp))
    .slice(0, 8);
  // La propuesta: la más cercana de la misma persona, mejor si es posterior. Una
  // ajena al mismo proveedor (otra obra, otro día) rara vez es la corrección.
  const mismas  = cands.filter(o => o.responsable?.codigo === oc.responsable?.codigo);
  const elegida = mismas.find(o => o.timestamp > oc.timestamp) || mismas[0] || null;
  const money   = o => (o.moneda === 'USD' ? 'US$ ' : '$ ') +
    (parseFloat(o.total) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  m.querySelector('#anular-title').textContent = 'Anular la OC ' + oc.nroOC;
  m.querySelector('#anular-texto').textContent =
    'Sigue en el historial y en Novedades, tachada, pero deja de contar en Reportes.' + (cands.length
      ? ''
      : ' No hay otra OC vigente a ' + (oc.proveedor?.nombre || 'este proveedor') + ' que la reemplace.');
  m.querySelector('#anular-pregunta').classList.toggle('hidden', !cands.length);
  const lista = m.querySelector('#anular-lista');
  // "No, ninguna la reemplaza" va primero; queda marcada si no hay una OC propia para proponer.
  lista.innerHTML = (cands.length ? `
    <label class="dup-oc">
      <input type="radio" name="anular-por" value=""${elegida ? '' : ' checked'}>
      <span class="dup-oc-main"><span class="dup-oc-nro">No, ninguna la reemplaza</span>
        <span class="dup-oc-sub">Se anula sin reemplazo</span></span>
    </label>` : '') + cands.map((o, i) => `
    <label class="dup-oc">
      <input type="radio" name="anular-por" value="${i}"${o === elegida ? ' checked' : ''}>
      <span class="dup-oc-main">
        <span class="dup-oc-nro">${_escDup(o.nroOC)}</span>
        <span class="dup-oc-sub">${_escDup(o.fecha || '')} · ${_escDup(o.obra || 'Sin obra')}</span>
      </span>
      <span class="dup-oc-monto">${_escDup(money(o))}</span>
    </label>`).join('');
  lista.classList.toggle('hidden', !cands.length);

  const ok = m.querySelector('#btn-anular-ok'), cancel = m.querySelector('#btn-anular-cancel');
  ok.disabled = false;
  m.classList.remove('hidden');
  return new Promise(resolve => {
    const cerrar = r => { m.classList.add('hidden'); ok.onclick = cancel.onclick = null; resolve(r); };
    cancel.onclick = () => cerrar(false);
    ok.onclick = async () => {
      const v   = lista.querySelector('input:checked')?.value;
      const por = v ? cands[+v] : null;
      ok.disabled = true;
      try {
        await anularPorReemplazo([oc], por ? por.nroOC : null);
        toast(`OC ${oc.nroOC} anulada como duplicada${por ? ': la reemplaza la ' + por.nroOC : ''}.`, 'success');
        cerrar(true);
      } catch (e) {
        ok.disabled = false;
        toast('No se pudo guardar. ' + e.message, 'error');
      }
    };
  });
}

// Deshace la anulación: la OC vuelve al estado que tenía (anulacion.estadoAnterior;
// las viejas sin el dato, autorizada si tiene firma o emitida) y vuelve a contar
// en Reportes. La OC que la reemplazaba deja de decir "Reemplaza a OC …". Si el
// detector la sigue viendo duplicada de otra, vuelve al panel de duplicadas.
// `list` es donde buscar la que la reemplazaba. Resuelve true si se desanuló.
async function desanularOC(oc, list) {
  const estado = oc.anulacion?.estadoAnterior || (oc.autorizacion?.firmante ? 'autorizada' : 'emitida');
  const ok = await showConfirm('Desanular la OC ' + oc.nroOC,
    `Vuelve a estar ${estado === 'autorizada' ? 'Autorizada' : 'Emitida'} y a contar en Reportes.`,
    { boton: 'Desanular', tono: 'ok', icono: 'undo' });
  if (!ok) return false;
  try {
    await patchHistorialEntry(oc.nroOC.replace(/-/g, ''), { estado, anulacion: null });
    const por  = oc.anulacion?.reemplazadaPor;
    const reem = por && list.find(o => o.nroOC === por);
    if (reem?.reemplazaA?.includes(oc.nroOC)) {
      const resto = reem.reemplazaA.filter(n => n !== oc.nroOC);
      await patchHistorialEntry(reem.nroOC.replace(/-/g, ''), { reemplazaA: resto.length ? resto : null });
      if (resto.length) reem.reemplazaA = resto; else delete reem.reemplazaA;
    }
    oc.estado = estado;
    delete oc.anulacion;
    toast(`OC ${oc.nroOC} desanulada: vuelve a contar en Reportes.`, 'success');
    return true;
  } catch (e) {
    toast('No se pudo guardar. ' + e.message, 'error');
    return false;
  }
}

// Texto de la etiqueta de una OC anulada: "Duplicada" si la reemplazó otra OC,
// "Anulada" si se anuló sin reemplazo (desde su tarjeta, "No, ninguna la reemplaza").
function textoDuplicada(oc) {
  const nro = oc.anulacion?.reemplazadaPor;
  return nro ? `Duplicada, se reemplazó por OC ${nro}` : 'Anulada';
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

// La OC de otra persona que se usó como base, si la nueva le compra al mismo
// proveedor: quien la usa (típicamente el Jefe de Obra, que ve las OC de sus
// obras) puede estar corrigiéndola, aunque no haya sido en la última hora. Se
// lee del servidor si sigue existiendo y vale, por lo mismo que abajo.
// Devuelve la OC o null.
async function baseParaCorregir(baseOC, nueva) {
  if (!baseOC?.nroOC || !baseOC.responsable?.codigo ||
      baseOC.responsable.codigo === nueva.responsable?.codigo) return null;
  const prov = indiceProveedores([baseOC, nueva]);
  if (prov(baseOC) !== prov(nueva)) return null;
  const key  = baseOC.nroOC.replace(/-/g, '');
  const resp = await _fetchConTope(FIREBASE_CONFIG.databaseURL + '/historial/' + key + '/nroOC.json');
  if (!resp.ok || !(await resp.json())) return null;
  const estado = await getHistorialEstado(key);
  return esCompraFirme({ estado }) ? { ...baseOC, estado: estado || 'emitida' } : null;
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
