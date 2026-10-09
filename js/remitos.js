/* VIMECO S.A. — Remitos: control de entregas sobre las OC
 *
 * Un remito es un evento de recepción atado a una OC: qué llegó, cuánto y
 * cuándo. Con eso la OC pasa a tener estado de entrega (sin entregas / parcial
 * / completa) y se puede saber qué falta recibir.
 *
 * Requiere: icons.js, ui.js, config.js, firebase.js, drive.js, driveQueue.js,
 * driveBackup.js (de ahí salen esObraPrueba/esProveedorPrueba/histKeyOf).
 */

const $ = id => document.getElementById(id);

let allOCs        = [];   // todas las OC, no sólo las del usuario (ver cargarDatos)
let allRemitos    = [];   // todos los remitos: las cantidades se calculan sobre todos
let colaRemitos   = [];   // remitos guardados en este navegador que esperan señal (driveQueue)
let viewerCode    = '';
let viewerName    = '';
let viewerIsAdmin = false;
let viewerObras   = null;    // obras a cargo si es Jefe de Obra (ver alcanceOC)
let filtroOC      = 'pendientes';   // pendientes | entregadas | todas | remitos
let modalOC       = null; // OC abierta en el formulario de carga
let modalFile     = null; // foto elegida para el remito en curso (la que se sube)
let modalRawFile  = null; // la misma foto sin escanear, para volver a pasarla por el escáner
let modalPrevUrl  = null; // objectURL del preview, a revocar al cambiarla
const recientes   = new Set();   // OC con un remito cargado en esta visita: quedan a la vista, en verde

// ---- Formato ----

// Misma regla que parseArgFloat en app.js (coma decimal sólo si cierra el
// número): mantenerlas iguales o el mismo tipeo daría cantidades distintas
// según la pantalla.
function parseQty(val) {
  if (typeof val === 'number') return val;
  const s = String(val || '').trim();
  const n = /,\d{1,2}$/.test(s)
    ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
    : parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function fmtQty(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

// Valor para meter DENTRO de un input: sin separador de miles. fmtQty formatea
// 1000 como "1.000" y parseQty lo leería como 1 (el punto es separador de miles
// sólo cuando hay coma decimal). Mismo par fmtInput/parseArgFloat que app.js.
function fmtInput(n) {
  const v = parseFloat(n) || 0;
  return v === 0 ? '0' : String(v);
}

function displayToISODate(d) {
  const p = (d || '').split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (d || '');
}

function isoToDisplay(d) {
  const p = (d || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (d || '');
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// ---- Cola offline (lo que se ve en pantalla) ----

// Remitos que quedaron en este navegador sin poder crearse en Firebase. Los que
// ya tienen key existen en /remitos y sólo les falta la foto: esos ya están en
// allRemitos y no se cuentan dos veces.
const colaSinGuardar = () => colaRemitos.filter(p => !p.remitoKey && p.record);
const colaDeOC       = nro => colaRemitos.filter(p => p.record?.nroOC === nro);

async function refrescarCola() {
  if (typeof driveQueue === 'undefined') { colaRemitos = []; return; }
  try { colaRemitos = await driveQueue.getAllRemitos(); } catch (_) { colaRemitos = []; }
}

// ---- Cálculo de entregas ----

// Estado de entrega de una OC contra TODOS sus remitos, los haya cargado quien
// los haya cargado. El cálculo vive en entregas.js: es el mismo que arma las
// planillas, y tener dos copias sería tener dos verdades.
// `conCola` suma los remitos que esperan señal en este navegador: para la
// pantalla y el formulario cuentan (si no, lo ya cargado figura como pendiente
// e invita a cargarlo otra vez), pero no para lo que se escribe en la OC.
function entregasDeOC(oc, conCola) {
  const rems = allRemitos.filter(r => r.nroOC === oc.nroOC);
  if (conCola) colaSinGuardar().forEach(p => { if (p.record.nroOC === oc.nroOC) rems.push(p.record); });
  return calcEntrega(oc, rems);
}

const renglonesCompletos = e => e.pedido.filter((p, i) => e.recibido[i] >= p).length;

// OC contra las que tiene sentido cargar un remito: las que realmente se
// emitieron (una pendiente de autorización todavía no es una compra, y una
// rechazada no va a llegar nunca) y que no son pruebas.
// El super-admin (0000) sí ve las de prueba: es quien las crea (obra "X" del
// desplegable) y las necesita para probar el circuito de entregas.
function ocsElegibles() {
  const verPruebas = viewerCode === '0000';
  return allOCs.filter(oc =>
    !SIN_PDF.has(oc.estado) &&
    (verPruebas || (!esObraPrueba(oc) && !esProveedorPrueba(oc))));
}

// Remitos de una OC, del más nuevo al más viejo (para la pastilla "N remitos").
function remitosDeOC(nro) {
  return allRemitos.filter(r => r.nroOC === nro).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// ---- Render: lista de OC ----
// La búsqueda (normTxt, coincideOC, itemsCoincidentes…) vive en buscarOC.js.

const ESTADO_TXT = { sin: 'Sin entregas', parcial: 'Parcial', completa: 'Entregada' };

function pillEstado(e) {
  return `<span class="rv-pill rv-pill--${e.estado}">${e.estado === 'completa' ? icSvg('checkSm') : ''}${
    ESTADO_TXT[e.estado]}${e.estado === 'parcial' ? ` ${e.pct}%` : ''}</span>`;
}

function barraAvance(e, cls) {
  const w = e.estado === 'sin' ? 0 : Math.max(4, Math.min(100, e.pct));
  return `<div class="rv-prog${cls ? ' ' + cls : ''}"><div class="rv-bar"><i class="f-${e.estado}" style="width:${w}%"></i></div><b>${e.pct}%</b></div>`;
}

function botonCargar(oc, chico) {
  const nro = escHtml(oc.nroOC);
  return chico
    ? `<button type="button" class="foc-btn foc-btn--ambl rv-ib btn-cargar-remito" data-nro="${nro}" title="Cargar otro remito" aria-label="Cargar otro remito">${icSvg('plus')}</button>`
    : `<button type="button" class="foc-btn foc-btn--amb rv-add btn-cargar-remito" data-nro="${nro}" title="Cargar remito" aria-label="Cargar remito">${icSvg('plus')}<span class="rv-largo">Remito</span></button>`;
}

function accionesOC(oc) {
  // Anulada: se ven sus remitos, pero no se le cargan más (primero se desanula).
  if (oc.estado === 'anulada')
    return `<span class="rv-cola" title="Para cargarle un remito, primero desanulala desde Historial o Novedades">${icSvg('slash')}Anulada</span>`;
  if (colaDeOC(oc.nroOC).length)
    return `<span class="rv-cola" title="El remito quedó guardado en este dispositivo y se sube solo cuando haya señal">${icSvg('wifi0')}<span class="rv-largo">Esperando señal</span><span class="rv-corto">En cola</span></span>${botonCargar(oc, true)}`;
  if (recientes.has(oc.nroOC))
    return `<span class="rv-ok">${icSvg('checkSm')}Cargado</span>${botonCargar(oc, true)}`;
  return botonCargar(oc);
}

function filaOC(oc, e, terms) {
  const hl    = t => resaltarTxt(t, terms, escHtml);
  const rems  = remitosDeOC(oc.nroOC);
  const cola  = colaDeOC(oc.nroOC).length > 0;
  const n     = (oc.items || []).length;
  const icono = e.estado === 'completa' ? icSvg('checkSm') : icSvg(cola ? 'wifi0' : 'truck');
  return `<div class="rv-row${recientes.has(oc.nroOC) ? ' rv-row--ok' : ''}" data-nro="${escHtml(oc.nroOC)}">
    <span class="rv-sq rv-sq--${cola ? 'cola' : e.estado}" title="${ESTADO_TXT[e.estado]}">${icono}</span>
    <div style="min-width:0">
      <div class="rv-prov">${hl(oc.proveedor?.nombre || '—')}</div>
      <div class="rv-sub">${hl(oc.nroOC)} · <span class="rv-desk">${escHtml(oc.fecha || '')}</span><span class="rv-ph">${hl(oc.obra || '—')}</span></div>
      ${barraAvance(e, 'rv-ph')}
    </div>
    <div class="rv-mid"><div>${hl(oc.obra || '—')}</div><small>${n ? `${renglonesCompletos(e)} de ${plural(n, 'renglón completo', 'renglones completos')}` : 'Sin ítems cargados'}</small></div>
    <div class="rv-est">${pillEstado(e)}${rems.length
      ? `<button type="button" class="rv-pill" data-doc="rem" aria-expanded="false" title="${rems.length > 1 ? 'Ver los remitos' : 'Ver el remito'}">${icSvg('file')}${plural(rems.length, 'remito', 'remitos')}</button>` : ''}</div>
    <div class="rv-acts">${accionesOC(oc)}</div>
    ${hitsHtml(oc, itemsCoincidentes(oc, terms), escHtml, terms).replace('class="rem-hits"', 'class="rem-hits rv-hits"')}
    ${docsListasHtml([], rems)}
  </div>`;
}

function listaOCs(filtro) {
  // Las anuladas sólo aparecen si ya tienen remitos.
  let list = ocsElegibles()
    .filter(oc => oc.estado !== 'anulada' || remitosDeOC(oc.nroOC).length)
    .map(oc => ({ oc, e: entregasDeOC(oc, true) }));
  if (filtro === 'pendientes') list = list.filter(({ oc, e }) => e.estado !== 'completa' || recientes.has(oc.nroOC));
  if (filtro === 'entregadas') list = list.filter(({ e }) => e.estado === 'completa');
  return list;
}

function renderOCList() {
  const terms = terminosBusqueda($('rem-search').value);
  const box   = $('rem-oc-list');

  let list = listaOCs(filtroOC);
  if (terms.length) list = list.filter(({ oc }) => coincideOC(oc, terms));

  if (!list.length) {
    const vacio = terms.length ? 'No se encontraron OC.'
      : filtroOC === 'pendientes' ? 'No hay OC pendientes de entrega.'
      : filtroOC === 'entregadas' ? 'Todavía no hay OC entregadas.' : 'No hay OC.';
    box.innerHTML = `<div class="rv-panel"><div class="rv-vacio">${vacio}</div></div>`;
    return;
  }

  box.innerHTML = `<div class="rv-panel">${pager.take('remoc', list).map(({ oc, e }) => filaOC(oc, e, terms)).join('')}</div>`;

  box.querySelectorAll('.rv-row').forEach(row => {
    const oc = allOCs.find(o => o.nroOC === row.dataset.nro);
    if (oc) bindDocsOC(row, oc, [], remitosDeOC(oc.nroOC));
  });
  box.querySelectorAll('.btn-cargar-remito').forEach(btn => {
    btn.addEventListener('click', () => {
      const oc = allOCs.find(o => o.nroOC === btn.dataset.nro);
      if (oc) abrirModal(oc);
    });
  });

  pager.footer('remoc', box, list, renderOCList);
}

// ---- Render: remitos cargados ----

// El Jefe de Obra ve también los que cargaron otros en las OC de sus obras.
function remitosVisibles() {
  if (viewerIsAdmin) return allRemitos;
  const deSusObras = viewerObras
    ? new Set(allOCs.filter(oc => esDeObrasJefe(oc, viewerObras)).map(oc => oc.nroOC))
    : new Set();
  return allRemitos.filter(r => r.recibidoPor?.codigo === viewerCode || deSusObras.has(r.nroOC));
}

// Los cargados más los que esperan señal en este dispositivo, del más nuevo al
// más viejo. `_cola` marca los que todavía no subieron (o les falta la foto).
function remitosParaListar() {
  const conFotoPend = new Set(colaRemitos.map(p => p.remitoKey).filter(Boolean));
  return [
    ...colaSinGuardar().map(p => ({ ...p.record, _cola: true })),
    ...remitosVisibles().map(r => conFotoPend.has(r.key) ? { ...r, _cola: true } : r)
  ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function coincideRemito(r, terms) {
  const hay = normTxt([r.nro, r.proveedor?.nombre, r.obra, r.nroOC, r.recibidoPor?.nombre,
                       ...(r.items || []).map(it => it.desc)].join(' '));
  return terms.every(t => hay.includes(t));
}

function filaRemito(r, terms) {
  const hl = t => resaltarTxt(t, terms, escHtml);
  const n  = (r.items || []).length;
  const estado = r._cola
    ? `<span class="rv-pill rv-pill--cola">${icSvg('wifi0')}Esperando señal</span>`
    : `<span class="rv-pill rv-pill--${r.entrega === 'total' ? 'completa' : 'parcial'}">${r.entrega === 'total' ? 'Completó la OC' : 'Entrega parcial'}</span>`;
  const quien = r.recibidoPor?.nombre && r.recibidoPor.codigo !== viewerCode ? ` · recibió ${hl(r.recibidoPor.nombre)}` : '';
  return `<div class="rv-row">
    <span class="rv-sq rv-sq--${r._cola ? 'cola' : 'rem'}">${icSvg(r._cola ? 'wifi0' : 'file')}</span>
    <div style="min-width:0">
      <div class="rv-prov">Remito ${hl(r.nro || '—')}</div>
      <div class="rv-sub">${escHtml(isoToDisplay(r.fecha))} · ${hl(r.proveedor?.nombre || '—')}</div>
      <div class="rv-sub rv-ph">OC ${hl(r.nroOC || '—')} · ${plural(n, 'ítem', 'ítems')}${r._cola ? ' · esperando señal' : ''}</div>
    </div>
    <div class="rv-mid"><div>OC ${hl(r.nroOC || '—')}</div><small>${hl(r.obra || 'Sin obra')}${quien}</small></div>
    <div class="rv-est">${estado}<span class="rv-n-items">${plural(n, 'ítem', 'ítems')}</span></div>
    <div class="rv-acts">
      ${r.key ? `<button type="button" class="foc-btn foc-btn--clear rv-ib btn-ver-remito" data-key="${escHtml(r.key)}" title="Ver el remito" aria-label="Ver el remito">${icSvg('eye')}</button>` : ''}
      ${r.drive?.url ? `<a class="foc-btn foc-btn--drive rv-ib rv-desk" href="${escHtml(r.drive.url)}" target="_blank" rel="noopener" title="Abrir la carpeta en Drive" aria-label="Abrir la carpeta en Drive">${icSvg('folder')}</a>` : ''}
    </div>
  </div>`;
}

function renderRemitosList() {
  const terms = terminosBusqueda($('rem-search').value);
  const box   = $('rem-oc-list');
  let list = remitosParaListar();
  if (terms.length) list = list.filter(r => coincideRemito(r, terms));

  if (!list.length) {
    box.innerHTML = `<div class="rv-panel"><div class="rv-vacio">${
      terms.length ? 'No se encontraron remitos.' : 'Todavía no cargaste ningún remito.'}</div></div>`;
    return;
  }

  box.innerHTML = `<div class="rv-panel">${pager.take('remlist', list).map(r => filaRemito(r, terms)).join('')}</div>`;
  box.querySelectorAll('.btn-ver-remito').forEach(btn =>
    btn.addEventListener('click', () => verRemito(btn.dataset.key)));

  pager.footer('remlist', box, list, renderRemitosList);
}

// ---- Cabecera, pestañas y columna del costado ----

function renderResumen() {
  const ocs   = listaOCs('todas');
  const pend  = ocs.filter(({ e }) => e.estado !== 'completa');
  const sin   = pend.filter(({ e }) => e.estado === 'sin').length;
  const rems  = remitosParaListar();

  const cuenta = { pendientes: pend.length, entregadas: ocs.length - pend.length, todas: ocs.length, remitos: rems.length };
  $('rem-filtro').querySelectorAll('.rv-tab').forEach(b => { b.querySelector('b').textContent = cuenta[b.dataset.filtro] ?? ''; });

  const pill = $('rv-pend');
  pill.textContent = `${pend.length} por recibir`;
  pill.classList.toggle('hidden', !pend.length);

  $('rv-hero-n').textContent = plural(pend.length, 'OC', 'OC');
  $('rv-hero-s').textContent = pend.length
    ? `${sin} sin ninguna entrega · ${pend.length - sin} con entrega parcial`
    : 'Todo lo comprado está recibido.';
  const mes = hoyISO().slice(0, 7);
  $('rv-hero-mes').textContent  = rems.filter(r => (r.fecha || '').startsWith(mes)).length;
  $('rv-hero-mes-l').textContent = `remitos en ${new Date().toLocaleDateString('es-AR', { month: 'long' })}`;
  $('rv-hero-cola').textContent = colaRemitos.length;

  const ult = rems.slice(0, 5);
  $('rv-ult').innerHTML = ult.length ? ult.map(r => `
    <button type="button" class="rv-mini"${r.key ? ` data-key="${escHtml(r.key)}"` : ' disabled'}>
      <span class="rv-sq rv-sq--${r._cola ? 'cola' : 'rem'}">${icSvg(r._cola ? 'wifi0' : 'file')}</span>
      <span><b>${escHtml(r.proveedor?.nombre || '—')}</b><small>Remito ${escHtml(r.nro || '—')} · ${r._cola ? 'esperando señal' : escHtml(isoToDisplay(r.fecha))}</small></span>
    </button>`).join('') : '<div class="rv-vacio-s">Todavía no hay remitos cargados.</div>';
  $('rv-ult').querySelectorAll('.rv-mini[data-key]').forEach(b =>
    b.addEventListener('click', () => verRemito(b.dataset.key)));
}

function setFiltro(filtro) {
  filtroOC = filtro;
  $('rem-filtro').querySelectorAll('.rv-tab').forEach(b => b.classList.toggle('active', b.dataset.filtro === filtro));
  $('rem-search').placeholder = filtro === 'remitos'
    ? 'Buscar por N° de remito, proveedor, obra, artículo u OC…'
    : 'Buscar por artículo, proveedor, obra, responsable o N° OC…';
  pager.reset('remoc');
  pager.reset('remlist');
  renderLista();
}

function renderLista() {
  if (filtroOC === 'remitos') renderRemitosList();
  else renderOCList();
}

function renderTodo() {
  renderResumen();
  renderLista();
}

// ---- Ficha del remito (js/fichaRemito.js) ----

function verRemito(key) {
  const r = allRemitos.find(x => x.key === key);
  if (!r) return;
  const oc = allOCs.find(o => o.nroOC === r.nroOC);
  abrirFichaRemito(r, oc, allRemitos.filter(x => x.nroOC === r.nroOC),
    { onBorrar: puedeBorrar(r) ? borrarRemito : null });
}

// Un remito cargado de más infla lo recibido y puede dar una OC por entregada
// sin estarlo. Lo puede deshacer quien lo cargó (el caso típico: me equivoqué
// recién) o un admin.
function puedeBorrar(r) {
  return viewerIsAdmin || r.recibidoPor?.codigo === viewerCode;
}

async function borrarRemito(key) {
  const rem = allRemitos.find(r => r.key === key);
  if (!rem) return;

  if (!await showConfirm(
    'Borrar remito',
    `Se va a borrar el remito ${rem.nro} de la OC ${rem.nroOC}.\n\n` +
    'Las cantidades vuelven a figurar como pendientes. La foto queda archivada en Drive.',
    { boton: 'Borrar', tono: 'del', icono: 'trash' })) return;

  try {
    await deleteRemito(key);
  } catch (e) {
    console.error('deleteRemito:', e);
    toast('No se pudo borrar el remito.', 'error');
    return;
  }

  allRemitos = allRemitos.filter(r => r.key !== key);
  if (fichaRemitoAbierta() === key) cerrarFichaRemito();
  const oc = allOCs.find(o => o.nroOC === rem.nroOC);
  if (oc) {
    actualizarEntregaOC(oc);
    sincronizarPlanillas(oc);
  }
  renderTodo();
  toast(`Remito ${rem.nro} borrado.`, 'success');
}

// ---- Formulario de carga ----

function abrirModal(oc) {
  modalOC = oc;

  const e = entregasDeOC(oc, true);

  $('rem-oc-ref').innerHTML = `<div class="rv-ocref">
    <span class="rv-sq rv-sq--${e.estado}">${icSvg('truck')}</span>
    <div><div class="rv-prov">${escHtml(oc.proveedor?.nombre || '—')}</div>
      <div class="rv-sub">OC ${escHtml(oc.nroOC)} · ${escHtml(oc.obra || 'Sin obra')}</div></div>
    ${pillEstado(e)}</div>`;

  const items = oc.items || [];
  $('rem-items').innerHTML = items.length
    ? items.map((it, i) => {
        const completo = e.pendiente[i] <= 0;
        const stp = (d, n) => `<button type="button" class="rv-stp" data-step="${d}" data-idx="${i}" aria-label="${n}">${icSvg(d > 0 ? 'plus' : 'minus')}</button>`;
        return `<div class="rv-it${completo ? ' is-completo' : ''}" data-idx="${i}">
          <div class="rv-it-d">${escHtml(it.desc || '—')}</div>
          <div class="rv-it-q">
            ${completo ? '' : stp(-1, 'Uno menos')}
            <input type="text" class="rem-item-input rv-qv" inputmode="decimal" aria-label="Cantidad recibida de ${escHtml(it.desc || 'este renglón')}"
                   data-idx="${i}" data-pend="${e.pendiente[i]}"
                   value="${completo ? '0' : fmtInput(e.pendiente[i])}">
            ${completo ? '' : stp(1, 'Uno más')}
          </div>
          <div class="rv-it-m">
            <span>Pedido <b>${fmtQty(e.pedido[i])}</b> ${escHtml(it.unidad || '')}</span>
            ${e.recibido[i] > 0 ? `<span>Recibido <b>${fmtQty(e.recibido[i])}</b></span>` : ''}
            <span class="rv-mk"></span>
          </div>
        </div>`;
      }).join('')
    : '<div class="rv-vacio-s">Esta OC no tiene ítems cargados: el remito se guarda sin cantidades.</div>';

  $('rem-nro').value   = '';
  $('rem-fecha').value = hoyISO();
  $('rem-obs').value   = '';
  limpiarFoto();
  document.querySelectorAll('#modal-remito .rv-sec.is-falta').forEach(s => s.classList.remove('is-falta'));
  $('btn-rem-guardar').disabled = false;
  $('rv-sh-body').scrollTop = 0;
  refrescarForm();

  // Sin foco en el N° de remito: lo primero es la foto, y en el celular el
  // teclado tapaba el formulario apenas se abría.
  $('modal-remito').classList.remove('hidden');
  $('modal-remito').querySelector('.rv-sheet').focus();
}

function cerrarModal() {
  $('modal-remito').classList.add('hidden');
  limpiarFoto();
  modalOC = null;
}

// ---- Estado del formulario: pasos, marcas por renglón y pie ----

const FALTA_SEC = { foto: 'rv-sec-foto', nro: 'rv-sec-datos', fecha: 'rv-sec-datos', items: 'rv-sec-items' };

function faltantesRemito() {
  const f = [];
  if (!modalFile)                  f.push({ id: 'foto',  txt: 'La foto del remito', sub: 'Paso 1 · es el comprobante que queda en Drive', corto: 'la foto' });
  if (!$('rem-nro').value.trim())  f.push({ id: 'nro',   txt: 'El N° de remito',    sub: 'Paso 2 · datos del remito', corto: 'el N° de remito' });
  if (!$('rem-fecha').value)       f.push({ id: 'fecha', txt: 'La fecha',            sub: 'Paso 2 · datos del remito', corto: 'la fecha' });
  // Una OC sin ítems cargados no tiene cantidades que pedir: se admite el
  // remito vacío (si no, el formulario no se puede guardar nunca).
  if ((modalOC?.items || []).length && !leerItemsDelModal().length)
    f.push({ id: 'items', txt: 'Al menos una cantidad recibida', sub: 'Paso 3 · qué llegó', corto: 'las cantidades' });
  return f;
}

function marcaRenglon(q, pend) {
  if (pend <= 0) return q > 0 ? ['mas', 'De más'] : ['done', 'Ya completo'];
  if (q <= 0)    return ['no', 'No llegó'];
  if (q === pend) return ['ok', 'Completa'];
  if (q > pend)  return ['mas', `${fmtQty(q - pend)} de más`];
  return ['par', `Quedan ${fmtQty(pend - q)}`];
}

function refrescarForm() {
  if (!modalOC) return;
  const inputs = [...document.querySelectorAll('.rem-item-input')];
  let todo = inputs.length > 0, nada = inputs.length > 0, quedan = 0;
  inputs.forEach(inp => {
    const q = parseQty(inp.value), pend = parseFloat(inp.dataset.pend) || 0;
    const [cls, txt] = marcaRenglon(q, pend);
    const mk = inp.closest('.rv-it').querySelector('.rv-mk');
    mk.className = `rv-mk rv-mk--${cls}`;
    mk.textContent = txt;
    inp.classList.toggle('is-cero', q <= 0);
    if (q !== pend) todo = false;
    if (q !== 0) nada = false;
    if (q < pend) quedan++;
  });
  $('btn-rem-todo').classList.toggle('on', todo);
  $('btn-rem-vaciar').classList.toggle('on', nada && !todo);

  const faltan = faltantesRemito();
  const tilde = (id, ok, n) => { const el = $(id); el.classList.toggle('ok', ok); el.innerHTML = ok ? icSvg('check') : n; };
  tilde('rv-n-foto',  !!modalFile, '1');
  tilde('rv-n-datos', !faltan.some(f => f.id === 'nro' || f.id === 'fecha'), '2');
  tilde('rv-n-items', !faltan.some(f => f.id === 'items') && inputs.length > 0, '3');
  $('rv-req-foto').classList.toggle('hidden', !!modalFile);
  // Lo que se completó deja de estar marcado en rojo.
  Object.values(FALTA_SEC).forEach(sec => {
    if (!faltan.some(f => FALTA_SEC[f.id] === sec)) $(sec).classList.remove('is-falta');
  });

  const st = $('rv-estado');
  if (faltan.length) {
    const partes = faltan.map(f => f.corto);
    st.className = 'rv-st rv-st--falta';
    st.textContent = 'Falta ' + (partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes.at(-1) : partes[0]);
    st.title = 'Ver lo que falta';
  } else if (!inputs.length) {
    st.className = 'rv-st rv-st--ok'; st.textContent = 'Listo para guardar'; st.title = '';
  } else if (!quedan) {
    st.className = 'rv-st rv-st--ok'; st.textContent = 'Con este remito se completa la OC'; st.title = '';
  } else {
    st.className = 'rv-st rv-st--parcial';
    st.textContent = `Entrega parcial: ${quedan === 1 ? 'queda 1 renglón' : `quedan ${quedan} renglones`}`;
    st.title = '';
  }
  $('btn-rem-guardar').classList.toggle('is-incompleto', faltan.length > 0);
}

// "Faltan N datos" con todo junto, como en la OC: tocar uno lleva a completarlo.
function mostrarFaltantes(faltan) {
  let modal = $('modal-faltan');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay hidden';
    modal.id = 'modal-faltan';
    modal.innerHTML =
      '<div class="confirm-box confirm-box--warn confirm-box--wide" role="dialog" aria-modal="true" aria-labelledby="faltan-title" tabindex="-1">' +
        `<span class="confirm-ic">${icSvg('alert')}</span>` +
        '<div class="confirm-title" id="faltan-title"></div>' +
        '<p class="confirm-msg">Tocá uno para ir a completarlo.</p>' +
        '<div class="faltan-lista"></div>' +
        '<button type="button" class="foc-btn foc-btn--clear confirm-cancel faltan-cerrar">Seguir cargando</button>' +
      '</div>';
    document.body.appendChild(modal);
  }
  const close = () => {
    modal.classList.add('hidden');
    modal.onclick = null;
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  modal.querySelector('#faltan-title').textContent = faltan.length === 1 ? 'Falta un dato' : `Faltan ${faltan.length} datos`;
  modal.querySelector('.faltan-lista').innerHTML = faltan.map((f, i) => `
    <button type="button" class="faltan-item" data-i="${i}">
      <span class="faltan-dot"></span>
      <span class="faltan-t"><b>${escHtml(f.txt)}</b><small>${escHtml(f.sub)}</small></span>
      ${icSvg('chevR')}
    </button>`).join('');
  modal.onclick = e => {
    const it = e.target.closest('.faltan-item');
    if (it) { close(); irAFaltante(faltan[+it.dataset.i].id); }
    else if (e.target === modal || e.target.closest('.faltan-cerrar')) close();
  };
  document.addEventListener('keydown', onKey, true);
  modal.classList.remove('hidden');
  modal.querySelector('.confirm-box').focus();
}

function irAFaltante(id) {
  const sec = $(FALTA_SEC[id]);
  sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const foco = id === 'nro' ? $('rem-nro') : id === 'fecha' ? $('rem-fecha')
             : id === 'items' ? document.querySelector('.rem-item-input') : null;
  if (foco) setTimeout(() => foco.focus({ preventScroll: true }), 350);
}

// ---- Foto del remito ----

// La foto es el primer paso del formulario: es el comprobante que se archiva en
// Drive y, con "Leer con IA", de ella salen el número, la fecha y las cantidades.
function setFoto(file) {
  modalFile = file;
  if (modalPrevUrl) { URL.revokeObjectURL(modalPrevUrl); modalPrevUrl = null; }

  const img   = $('rem-preview-img');
  const thumb = $('rv-thumb');
  thumb.querySelector('.rv-pdf')?.remove();
  if (file.type.startsWith('image/')) {
    modalPrevUrl = URL.createObjectURL(file);
    img.src = modalPrevUrl;
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
    thumb.insertAdjacentHTML('beforeend', `<span class="rv-pdf">${icSvg('file')}</span>`);
  }
  $('rem-file-name').textContent = file.name;
  $('rem-file-size').textContent = `${(file.size / 1024).toFixed(0)} KB`;
  $('rv-drop').classList.add('hidden');
  $('rv-foto').classList.remove('hidden');

  $('btn-rem-rescan').classList.toggle('hidden', !modalRawFile);
  $('btn-rem-ia').classList.toggle('hidden', typeof extractFromRemito !== 'function');
  $('btn-rem-ia').disabled = false;
  $('btn-rem-ia-t').textContent = 'Leer con IA';
  ocultarIA();
  refrescarForm();
}

function limpiarFoto() {
  modalFile = modalRawFile = null;
  if (modalPrevUrl) { URL.revokeObjectURL(modalPrevUrl); modalPrevUrl = null; }
  $('rem-file').value   = '';
  $('rem-camera').value = '';
  $('rem-preview-img').removeAttribute('src');
  $('rv-thumb').querySelector('.rv-pdf')?.remove();
  $('rv-foto').classList.add('hidden');
  $('rv-drop').classList.remove('hidden');
  $('btn-rem-ia').classList.add('hidden');
  ocultarIA();
  refrescarForm();
}

// Foto de cámara: pasa por el escáner (recorte de perspectiva + filtro) antes
// de adjuntarse. Un remito enderezado se lee mucho mejor, en Drive y por la IA.
async function escanear(file) {
  if (!file || typeof openScanner !== 'function') { if (file) setFoto(file); return; }
  modalRawFile = file;
  try {
    const scan = await openScanner(file);
    if (scan) setFoto(scan);   // null = canceló: no cambia nada
  } catch (_) {
    // Escáner no disponible (p. ej. sin conexión la primera vez): va la original.
    setFoto(file);
    toast('Escáner no disponible; se adjuntó la foto original.', 'warning');
  }
}

// Archivo elegido a mano (o soltado en la bandeja): se adjunta tal cual (puede
// ser un PDF). Si es imagen queda disponible para escanearla.
function adjuntarArchivo(file) {
  if (!file) return;
  if (!/^image\/|application\/pdf/.test(file.type)) {
    toast('Elegí una foto o un PDF del remito.', 'warning');
    return;
  }
  modalRawFile = file.type.startsWith('image/') ? file : null;
  setFoto(file);
}

// ---- Lectura con IA ----

function setIA(tipo, icono, html) {
  const box = $('rem-ia-status');
  box.className = `rv-ia-st rv-ia-st--${tipo}`;
  box.innerHTML = `${icono}<span>${html}</span>`;
}

function ocultarIA() {
  const box = $('rem-ia-status');
  box.className = 'rv-ia-st hidden';
  box.innerHTML = '';
}

// La IA lee el remito CONTRA los ítems de la OC abierta: no devuelve una lista
// libre que después habría que matchear, sino cantidades atadas a cada renglón.
async function leerConIA() {
  if (!modalFile || !modalOC || typeof extractFromRemito !== 'function') return;

  const e     = entregasDeOC(modalOC, true);
  const items = (modalOC.items || []).map((it, i) => ({
    desc:      it.desc   || '',
    unidad:    it.unidad || '',
    pendiente: e.pendiente[i]
  }));

  const btn = $('btn-rem-ia');
  btn.disabled = true;
  setIA('loading', '<span class="spinner"></span>', 'Leyendo el remito con IA…');

  let r;
  try {
    r = await extractFromRemito(modalFile, items);
  } catch (err) {
    console.error('extractFromRemito:', err);
    setIA('error', icSvg('alert'),
      `${escHtml(err.message || 'No se pudo leer el remito.')} Cargalo a mano.`);
    btn.disabled = false;
    return;
  }
  btn.disabled = false;

  if (r.nro)   $('rem-nro').value   = r.nro;
  if (r.fecha) $('rem-fecha').value = r.fecha;
  // Lo que ya escribió el usuario vale más que lo que dedujo la IA.
  if (r.observaciones && !$('rem-obs').value.trim()) $('rem-obs').value = r.observaciones;

  // Los inputs arrancan en "lo que falta": si sólo se completaran los renglones
  // leídos, los que el remito no menciona quedarían declarados como recibidos.
  // Por eso se vacían todos antes de volcar lo leído.
  if (r.items.length) {
    setCantidades('vaciar');
    r.items.forEach(({ idx, cantidad }) => {
      const inp = document.querySelector(`.rem-item-input[data-idx="${idx}"]`);
      if (inp) inp.value = fmtInput(cantidad);
    });
  }
  refrescarForm();

  if (!r.nro && !r.items.length) {
    setIA('error', icSvg('alert'),
      'No se pudo leer el remito. Probá con otra foto o cargalo a mano.');
    return;
  }
  $('btn-rem-ia-t').textContent = 'Leer de nuevo';

  const aviso = r.sinMatch.length
    ? `<br>Figura(n) en el remito pero no en la OC: ${escHtml(r.sinMatch.join(', '))}.`
    : '';
  // Leyó el número pero ninguna cantidad: los renglones siguen en "lo que
  // falta", y guardar así declararía recibido todo sin que nadie lo mire.
  if (!r.items.length && (modalOC.items || []).length) {
    setIA('warn', icSvg('alert'),
      `Leído: N° ${escHtml(r.nro)}. No pude leer las cantidades: quedaron en lo que falta de cada renglón. Revisalas antes de guardar.${aviso}`);
    return;
  }

  const partes = [];
  if (r.nro) partes.push(`N° ${escHtml(r.nro)}`);
  if (r.fecha) partes.push(`fecha ${escHtml(isoToDisplay(r.fecha))}`);
  if (r.items.length) partes.push(plural(r.items.length, 'renglón', 'renglones'));
  setIA('success', icSvg('sparkles'),
    `Leído con IA: ${partes.join(', ')}. Revisá las cantidades antes de guardar.${aviso}`);
}

// "Llegó todo" / "Nada": el input arranca en lo que falta, así guardar sin
// tocar nada equivale a la entrega completa (el caso normal).
function setCantidades(modo) {
  document.querySelectorAll('.rem-item-input').forEach(inp => {
    inp.value = modo === 'todo' ? fmtInput(inp.dataset.pend) : '0';
  });
  refrescarForm();
}

function pasoCantidad(idx, d) {
  const inp = document.querySelector(`.rem-item-input[data-idx="${idx}"]`);
  if (!inp) return;
  inp.value = fmtInput(Math.max(0, parseQty(inp.value) + d));
  refrescarForm();
}

function leerItemsDelModal() {
  const items = [];
  document.querySelectorAll('.rem-item-input').forEach(inp => {
    const idx  = Number(inp.dataset.idx);
    const cant = parseQty(inp.value);
    if (cant > 0) {
      const src = modalOC.items?.[idx] || {};
      items.push({
        idx,
        desc:     src.desc   || '',
        unidad:   src.unidad || '',
        cantidad: cant
      });
    }
  });
  return items;
}

// ---- Guardar ----

function ocMetaDe(oc) {
  return {
    drive_folder_obras_id:       oc.drive_folder_obras_id       || null,
    drive_folder_proveedores_id: oc.drive_folder_proveedores_id || null,
    drive_folder_id:             oc.drive_folder_id             || null,
    obra:      oc.obra              || '',
    fecha:     displayToISODate(oc.fecha),
    proveedor: oc.proveedor?.nombre || '',
    nroOC:     oc.nroOC
  };
}

function logRemitoActivity(record, folderId) {
  if (typeof logActivity !== 'function') return;
  // Los remitos de prueba (obra o proveedor "X") no van al feed: mismo criterio
  // que el resto de la app. `record` tiene la misma forma que una OC (obra +
  // proveedor.nombre), así que sirven las mismas funciones.
  if (esObraPrueba(record) || esProveedorPrueba(record)) return;
  const n = (record.items || []).length;
  logActivity({
    tipo:    'remito',
    nroOC:   record.nroOC,
    usuario: record.recibidoPor,
    titulo:  `Remito ${record.nro} — ${record.proveedor?.nombre || 'Sin proveedor'}`,
    detalle: `OC ${record.nroOC} · ${record.obra || 'Sin obra'} · ${n} ítem${n !== 1 ? 's' : ''} · ${
      record.entrega === 'total' ? 'entrega completa' : 'entrega parcial'}`,
    driveUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : ''
  });
}

// `reintento` evita la copia duplicada: el intento anterior pudo llegar a Drive
// aunque el cliente lo viera fallar (es la razón de que el remito siga en cola).
async function subirRemitoADrive(file, meta, reintento) {
  const subir    = reintento ? attachToDriveOCIfMissing : attachToDriveOC;
  const res      = await subir(file, meta);
  const folderId = res?.folderId || null;
  return {
    folderId,
    fileId:  res?.fileId || null,
    url:     folderId ? `https://drive.google.com/drive/folders/${folderId}` : '',
    archivo: file.name
  };
}

// ---- Planillas de Drive ----

// OC cuyas planillas quedaron sin actualizar. Son datos derivados: se
// reconstruyen enteras a partir de /remitos + /historial, así que reintentar
// siempre es seguro.
let syncFallido = [];

function renderSyncBanner() {
  const box = $('rem-sync-warn');
  if (!syncFallido.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `${icSvg('alert')} ${syncFallido.length} planilla${syncFallido.length !== 1 ? 's' : ''} de Drive sin actualizar.
    <button class="btn btn-sm btn-outline" id="btn-resync" style="margin-left:.5rem;">Reintentar</button>`;
  $('btn-resync').addEventListener('click', async () => {
    const btn = $('btn-resync');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const pendientes = syncFallido;
    syncFallido = [];
    for (const oc of pendientes) await sincronizarPlanillas(oc);
    renderSyncBanner();
    if (!syncFallido.length) toast('Planillas actualizadas en Drive.', 'success');
  });
}

// Regenera las planillas de entregas (la de la obra y la de la OC). En segundo
// plano y best-effort: el remito ya está guardado, esto es sólo el espejo en
// Drive y se usa en obra, con mala señal.
async function sincronizarPlanillas(oc) {
  if (typeof sincronizarEntregas !== 'function') return;
  try {
    const r = await sincronizarEntregas({ oc, ocs: ocsElegibles(), remitos: allRemitos });
    if (!r.obra) throw new Error('planilla de obra');
  } catch (e) {
    console.error('sincronizarPlanillas:', e);
    if (!syncFallido.some(o => o.nroOC === oc.nroOC)) syncFallido.push(oc);
    renderSyncBanner();
  }
}

// Deja en la OC el resumen de entrega para que Historial y Reportes lo puedan
// pintar sin bajar /remitos entero. Best-effort: la fuente de verdad sigue
// siendo /remitos, esto es un espejo.
function actualizarEntregaOC(oc) {
  const e = entregasDeOC(oc);
  const resumen = {
    estado:      e.estado,
    remitos:     e.remitos.map(r => r.key).filter(Boolean),
    ultimaFecha: e.remitos[0]?.fecha || null
  };
  oc.entrega = resumen;
  if (typeof patchHistorialEntry === 'function')
    patchHistorialEntry(histKeyOf(oc), { entrega: resumen }).catch(() => {});
}

async function guardarRemito() {
  if (!modalOC) return;
  $('rem-error').classList.add('hidden');

  // Todo lo que falta de una vez, como en la OC (antes avisaba de a un dato).
  // La foto es el comprobante: sin ella el remito queda sin respaldo en Drive y
  // no hay con qué verificar lo que se declaró recibido.
  const faltan = faltantesRemito();
  if (faltan.length) {
    faltan.forEach(f => $(FALTA_SEC[f.id]).classList.add('is-falta'));
    mostrarFaltantes(faltan);
    return;
  }

  const nro   = $('rem-nro').value.trim();
  const fecha = $('rem-fecha').value;
  const items = leerItemsDelModal();

  // Sobre-entrega: se avisa, no se bloquea (pasa, y hay que poder registrarlo).
  const excedidos = items.filter(it => {
    const inp = document.querySelector(`.rem-item-input[data-idx="${it.idx}"]`);
    return it.cantidad > (parseFloat(inp?.dataset.pend) || 0);
  });
  if (excedidos.length && !await showConfirm(
    'Más de lo pendiente',
    `${excedidos.length} renglón(es) supera(n) lo que falta entregar en esta OC.\n\n¿Guardar igual?`,
    { boton: 'Guardar igual', tono: 'warn', icono: 'alert' })) return;

  // Mismo número y mismo proveedor = casi seguro el mismo remito cargado dos
  // veces, y eso duplicaría las cantidades recibidas. Cuentan también los que
  // esperan señal en este dispositivo.
  const dup = [...allRemitos, ...colaSinGuardar().map(p => p.record)].find(r =>
    (r.nro || '').trim().toLowerCase() === nro.toLowerCase() &&
    (r.proveedor?.nombre || '') === (modalOC.proveedor?.nombre || ''));
  if (dup && !await showConfirm(
    'Remito repetido',
    `Ya hay un remito ${nro} de ${modalOC.proveedor?.nombre || 'este proveedor'} (OC ${dup.nroOC}).\n\n¿Cargarlo igual?`,
    { boton: 'Cargar igual', tono: 'warn', icono: 'alert' })) return;

  const e        = entregasDeOC(modalOC, true);
  const completa = (modalOC.items || []).every((_, i) => {
    const cargado = items.find(it => it.idx === i);
    return e.recibido[i] + (cargado?.cantidad || 0) >= e.pedido[i];
  });

  const record = {
    tipo:      'remito',
    nro, fecha,
    timestamp: Date.now(),
    ocKey:     histKeyOf(modalOC),
    nroOC:     modalOC.nroOC,
    obra:      modalOC.obra || '',
    proveedor: {
      nombre: modalOC.proveedor?.nombre || '',
      cuit:   modalOC.proveedor?.cuit   || ''
    },
    recibidoPor:   { codigo: viewerCode, nombre: viewerName },
    items,
    entrega:       completa ? 'total' : 'parcial',
    observaciones: $('rem-obs').value.trim() || ''
  };

  const btn = $('btn-rem-guardar');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando…';

  const oc     = modalOC;
  const upFile = new File([modalFile], nombreArchivoDrive('Remito', modalFile.name, nro), { type: modalFile.type });

  try {
    await persistirRemito(record, upFile, oc);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `${icSvg('checkSm')} Guardar remito`;
  }

  recientes.add(oc.nroOC);
  await refrescarCola();
  cerrarModal();
  renderTodo();
}

// El remito se carga en obra: el registro (Firebase) y la foto (Drive) pueden
// fallar por separado, así que cada uno se encola por su cuenta y la pantalla
// nunca deja al usuario sin respuesta.
async function persistirRemito(record, upFile, oc) {
  const id     = 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const meta   = ocMetaDe(oc);
  const folder = meta.drive_folder_obras_id || meta.drive_folder_proveedores_id || meta.drive_folder_id;

  let key = null;
  try {
    key = await saveRemito(record);
  } catch (_) {
    await encolar({ id, remitoKey: null, record, file: upFile, meta });
    toast('Sin conexión: el remito quedó guardado y se sube solo.', 'warning');
    return;
  }

  allRemitos.unshift({ ...record, key });
  actualizarEntregaOC(oc);
  logRemitoActivity(record, folder);
  sincronizarPlanillas(oc);   // en segundo plano: no demora la confirmación

  if (!upFile) { toast(`Remito ${record.nro} cargado.`, 'success'); return; }

  try {
    const drive = await subirRemitoADrive(upFile, meta);
    await patchRemito(key, { drive });
    const local = allRemitos.find(r => r.key === key);
    if (local) local.drive = drive;
    toast(`Remito ${record.nro} cargado y archivado en Drive.`, 'success');
  } catch (err) {
    console.error('subirRemitoADrive:', err);
    await encolar({ id, remitoKey: key, record, file: upFile, meta });
    toast('Remito guardado. La foto se sube cuando vuelva la conexión.', 'warning');
  }
}

async function encolar(entry) {
  if (typeof driveQueue === 'undefined') return;
  try {
    await driveQueue.enqueueRemito({
      id:        entry.id,
      remitoKey: entry.remitoKey,
      record:    entry.record,
      file:      entry.file,
      fileName:  entry.file?.name || null,
      ocMeta:    entry.meta
    });
  } catch (e) {
    console.error('encolar remito:', e);
  }
}

// ---- Cola offline ----

let _reintentando = false;

async function retryRemitoQueue() {
  if (typeof driveQueue === 'undefined' || _reintentando) return;
  let pendientes;
  try { pendientes = await driveQueue.getAllRemitos(); } catch { return; }
  if (!pendientes.length) return;

  _reintentando = true;
  const subidas = new Set();   // OC cuyas planillas hay que regenerar
  try {
    for (const p of pendientes) {
      try {
        const file = p.fileBuf
          ? new File([p.fileBuf], p.fileName || 'Remito', { type: p.fileType || 'application/octet-stream' })
          : null;

        let key = p.remitoKey;
        if (!key) {
          key = await saveRemito(p.record);
          const folder = p.ocMeta?.drive_folder_obras_id || p.ocMeta?.drive_folder_proveedores_id;
          logRemitoActivity(p.record, folder);
          // Si ahora falla la foto, el próximo reintento no puede volver a
          // crear el remito: se re-encola ya con la key.
          await driveQueue.enqueueRemito({
            id: p.id, remitoKey: key, record: p.record, file, fileName: p.fileName, ocMeta: p.ocMeta
          });
        }

        if (file) {
          const drive = await subirRemitoADrive(file, p.ocMeta || {}, true);
          await patchRemito(key, { drive });
        }

        await driveQueue.dequeueRemito(p.id);
        if (p.record?.nroOC) subidas.add(p.record.nroOC);
        toast(`Remito ${p.record?.nro || ''} subido.`, 'success');
      } catch (_) {
        // Sigue sin conexión — queda en la cola
      }
    }
  } finally {
    _reintentando = false;
  }

  // Refresca contra el servidor lo que se haya podido subir. Si sigue sin red,
  // la pantalla se queda con lo que ya tenía en memoria.
  try {
    await cargarDatos();
    renderTodo();
    // Recién ahora las planillas pueden reflejar lo que estuvo encolado.
    for (const nro of subidas) {
      const oc = allOCs.find(o => o.nroOC === nro);
      if (!oc) continue;
      // Y el resumen de entrega de la OC: es el que leen Historial y Reportes,
      // que no bajan /remitos. Sin esto, un remito cargado sin señal dejaba la
      // OC figurando sin entregas aunque el remito ya estuviera guardado.
      actualizarEntregaOC(oc);
      await sincronizarPlanillas(oc);
    }
  } catch (_) {
    await refrescarCola();
    renderTodo();
  }
}

// ---- Carga de datos ----

async function cargarDatos() {
  // Todas las OC, no sólo las del usuario: quien recibe el material en obra
  // casi nunca es quien emitió la orden.
  const [ocs, rems] = await Promise.all([
    getHistorial(viewerCode, true),
    getRemitos(),
    refrescarCola()
  ]);
  allOCs     = ocs;
  allRemitos = rems;
}

// ---- Init ----

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  viewerCode = code;
  viewerName = name;
  $('hdr-name').textContent = name;
  $('btn-back').addEventListener('click', () => { window.location.href = 'compras.html'; });

  ({ isAdmin: viewerIsAdmin, obrasJefe: viewerObras } = await alcanceOC(code));

  // Pestañas: Pendientes / Entregadas / Todas / Remitos cargados
  $('rem-filtro').addEventListener('click', ev => {
    const btn = ev.target.closest('.rv-tab');
    if (btn) setFiltro(btn.dataset.filtro);
  });
  $('rv-ver-todos').addEventListener('click', () => setFiltro('remitos'));

  $('rem-search').addEventListener('input', () => { pager.reset('remoc'); pager.reset('remlist'); renderLista(); });

  // Formulario
  $('modal-remito-close').addEventListener('click', cerrarModal);
  $('btn-rem-cancelar').addEventListener('click', cerrarModal);
  $('btn-rem-guardar').addEventListener('click', guardarRemito);
  $('btn-rem-todo').addEventListener('click',   () => setCantidades('todo'));
  $('btn-rem-vaciar').addEventListener('click', () => setCantidades('vaciar'));
  $('rem-items').addEventListener('click', ev => {
    const b = ev.target.closest('.rv-stp');
    if (b) pasoCantidad(b.dataset.idx, Number(b.dataset.step));
  });
  $('rem-items').addEventListener('input', refrescarForm);
  $('rem-nro').addEventListener('input', refrescarForm);
  $('rem-fecha').addEventListener('input', refrescarForm);
  $('rv-estado').addEventListener('click', () => {
    const faltan = faltantesRemito();
    if (faltan.length) mostrarFaltantes(faltan);
  });

  // Foto del remito
  if ('ontouchstart' in window || window.innerWidth <= 768)
    $('btn-rem-camera').classList.remove('hidden');
  $('btn-rem-archivo').addEventListener('click', () => $('rem-file').click());
  $('btn-rem-camera').addEventListener('click',  () => $('rem-camera').click());
  $('rem-file').addEventListener('change',   e => adjuntarArchivo(e.target.files[0]));
  $('rem-camera').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';   // sacar dos veces la misma foto vuelve a disparar change
    if (f) escanear(f);
  });
  const drop = $('rv-drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('drag-over');
    adjuntarArchivo(e.dataTransfer.files[0]);
  });
  $('btn-rem-rescan').addEventListener('click', () => { if (modalRawFile) escanear(modalRawFile); });
  $('rv-thumb').addEventListener('click', () => verImagen(modalPrevUrl));
  $('btn-rem-quitar').addEventListener('click', limpiarFoto);
  $('btn-rem-ia').addEventListener('click', leerConIA);

  try {
    await cargarDatos();
    renderTodo();
  } catch (e) {
    console.error('cargarDatos:', e);
    $('rem-oc-list').innerHTML = '<div class="rv-panel"><div class="rv-vacio">Sin conexión. Abrí Remitos con red al menos una vez.</div></div>';
    $('rv-ult').innerHTML = '<div class="rv-vacio-s">—</div>';
  }

  retryRemitoQueue();
  window.addEventListener('online', retryRemitoQueue);
});
