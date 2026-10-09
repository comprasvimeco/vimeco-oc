/* VIMECO S.A. — Facturas: cargar la factura (u otro archivo) de una OC existente */

let currentFile = null;
let allOCs      = [];
let pendingOC   = null;   // OC elegida para cargar manualmente (vista principal)
let viewerIsAdmin = false; // 0000 o usuario con permiso admin
let viewerCode    = '';
let tipoCarga   = null;   // 'factura' | 'otro' — arranca sin elegir (ver elegirTipo)
let rawFile     = null;   // imagen original (sin escanear), para volver a pasarla por el escáner
let filePrevUrl = null;   // objectURL del preview actual
let filtroOC    = 'sin';  // 'sin' | 'con' | 'todas' — arranca en lo que falta cargar

// Momento de cada OC mientras se le carga algo: 'subiendo' | 'ok' (recién cargada).
// Vive aparte de la OC para que el renglón se repinte igual en la lista y en el
// resultado de la IA.
const cargaOC = new Map();

const ES_MOBILE = 'ontouchstart' in window || window.innerWidth <= 768;

// En la carpeta de una compra conviven la OC, el presupuesto, la factura y los
// remitos: el prefijo es lo único que los distingue. "Otro archivo" va con su
// nombre original, para no rotular de factura algo que no lo es.
function archivoParaDrive(file) {
  if (tipoCarga !== 'factura') return file;
  return new File([file], nombreArchivoDrive('Factura', file.name), { type: file.type });
}

const $ = id => document.getElementById(id);



function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const moneyOC = oc => oc.total != null ? (oc.moneda === 'USD' ? 'US$ ' : '$ ') + fmtMoney(oc.total) : '—';

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function displayToISODate(d) {
  const p = (d || '').split('/');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : (d || '');
}

// ---- Estado de facturación de la OC ----

// Qué se le cargó ya a esta OC ('con' | 'otros' | 'sin'). El criterio vive en
// firebase.js —junto al escritor del nodo `adjuntos`— porque también lo lee el
// resumen del período en Reportes.
function estadoFactura(oc) {
  return estadoFacturaOC(oc);
}

// 'otros' cae del lado de "sin": que haya un archivo viejo sin rotular no
// prueba que la factura esté cargada.
const tieneFactura = oc => estadoFactura(oc).estado === 'con';

// dd/mm a mano: toLocaleDateString('es-AR') con 2-digit igual devuelve "10/8".
function fmtFechaCorta(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Pastilla del estado. Con factura es un botón que la abre (una sola) o
// despliega la lista (varias), igual que en el Historial.
function estadoHtml(oc) {
  const f = estadoFactura(oc);
  if (f.estado === 'con') {
    const n   = facturasDeOC(oc).length;
    const tip = (n > 1 ? 'Ver las facturas' : 'Abrir la factura') + (f.por ? ` · cargada por ${f.por}` : '');
    return `<button type="button" class="fac-est" data-doc="fact" aria-expanded="false" title="${esc(tip)}">${icSvg('file')}${
      n > 1 ? `Facturas · ${n}` : `Factura ${fmtFechaCorta(f.ts)}`}</button>`;
  }
  if (f.estado === 'otros') {
    return `<span class="fac-est fac-est--otros" title="Archivos cargados antes de que la pantalla distinguiera la factura de otro archivo">${f.n} archivo${f.n > 1 ? 's' : ''}</span>`;
  }
  return '<span class="fac-est fac-est--sin">Sin factura</span>';
}

// Cuadradito del renglón: en el teléfono es lo único que muestra el estado, y
// con factura también la abre.
function cuadroHtml(oc) {
  const e = estadoFactura(oc).estado;
  if (e === 'con') return `<button type="button" class="fac-sq" data-doc="fact" aria-label="Abrir la factura" title="Abrir la factura">${icSvg('file')}</button>`;
  if (e === 'otros') return `<span class="fac-sq fac-sq--otros" title="Tiene archivos sin rotular">${icSvg('clip')}</span>`;
  return `<span class="fac-sq fac-sq--sin" title="Sin factura">${icSvg('alert')}</span>`;
}

// Cargar una factura sobre una OC que ya la tiene suele ser el mismo archivo
// subido dos veces. Cargar "otro archivo" es legítimo y no se pregunta nada.
async function confirmarDuplicado(oc) {
  if (tipoCarga !== 'factura') return true;
  const f = estadoFactura(oc);
  if (f.estado !== 'con') return true;
  const cuando = f.ts ? ' el ' + new Date(f.ts).toLocaleDateString('es-AR') : '';
  const quien  = f.por ? ' por ' + f.por : '';
  return showConfirm('Ya tiene factura',
    `La OC ${oc.nroOC} ya tiene una factura cargada${cuando}${quien}.\n\n¿Cargar otra igual?`,
    { boton: 'Cargar igual', tono: 'warn', icono: 'alert' });
}

// Deja registrado el archivo en el historial para que la lista pueda mostrar el
// estado sin consultar Drive. Best-effort: si falla, el archivo ya está subido.
// Se refleja primero en memoria, así el sello cambia sin recargar la pantalla.
// Con `fileId` el Historial abre el archivo directo; sin él (cargas viejas) lo
// busca por nombre en `folderId`.
async function registrarAdjunto(oc, file, res) {
  const registro = {
    tipo:     tipoCarga === 'factura' ? 'factura' : 'otro',
    nombre:   file.name,
    ts:       Date.now(),
    por:      sessionStorage.getItem('responsable_name') || '',
    fileId:   res?.fileId   || null,
    folderId: res?.folderId || null
  };
  oc.adjuntos = oc.adjuntos || {};
  oc.adjuntos['local_' + registro.ts] = registro;
  try { await registrarAdjuntoOC(oc.nroOC, registro); }
  catch (e) { console.warn('registrarAdjunto:', e); }
}

// ---- Qué se carga ----

// Con "Factura" elegida de entrada se subían remitos y fotos como factura sin
// mirar: la pantalla arranca sin elegir y se elige una vez por visita.
function elegirTipo(tipo) {
  tipoCarga = tipo;
  $('adj-tipo').querySelectorAll('.fac-tipo-opt').forEach(b => b.setAttribute('aria-checked', String(b.dataset.tipo === tipo)));
  $('adj-tipo').classList.remove('is-falta');
  $('adj-tipo-falta').classList.add('hidden');
  renderPrimaryList($('adj-search-main').value);   // el botón de cargar dice qué carga
}

// Se tocó cargar sin haber elegido: se pregunta en el momento, y la respuesta
// queda elegida para el resto de la visita. Devuelve false si se canceló.
function asegurarTipo(oc) {
  if (tipoCarga) return Promise.resolve(true);
  $('adj-tipo').classList.add('is-falta');
  const modal = $('modal-tipo');
  $('modal-tipo-oc').textContent = oc ? `OC ${oc.nroOC} · ${oc.proveedor?.nombre || ''}` : '';
  return new Promise(resolve => {
    const close = tipo => {
      modal.classList.add('hidden');
      modal.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      if (tipo) elegirTipo(tipo);
      resolve(!!tipo);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    modal.onclick = e => {
      const opt = e.target.closest('[data-tipo]');
      if (opt) close(opt.dataset.tipo);
      else if (e.target === modal || e.target.closest('#modal-tipo-cancel')) close(null);
    };
    document.addEventListener('keydown', onKey, true);
    modal.classList.remove('hidden');
    modal.querySelector('.confirm-box').focus();
  });
}

// ---- Archivo ----

function setFile(file) {
  currentFile = file;
  $('fac-drop-main').classList.add('hidden');
  $('file-name').textContent = file.name;
  $('file-size').textContent = `${(file.size / 1024).toFixed(0)} KB`;
  $('file-info').classList.remove('hidden');
  mostrarPreview(file);
}

// El preview (con su botón de escanear) solo tiene sentido con imágenes: un PDF
// ya viene derecho y no pasa por el escáner.
function mostrarPreview(file) {
  if (filePrevUrl) { URL.revokeObjectURL(filePrevUrl); filePrevUrl = null; }
  const box = $('file-preview');
  if (!file.type.startsWith('image/') || typeof openScanner !== 'function') {
    box.classList.add('hidden');
    $('file-preview-img').removeAttribute('src');
    return;
  }
  filePrevUrl = URL.createObjectURL(file);
  $('file-preview-img').src = filePrevUrl;
  box.classList.remove('hidden');
}

function resetZone() {
  currentFile = null;
  rawFile     = null;
  if (filePrevUrl) { URL.revokeObjectURL(filePrevUrl); filePrevUrl = null; }
  $('fac-drop-main').classList.remove('hidden');
  $('file-info').classList.add('hidden');
  $('file-preview').classList.add('hidden');
  $('file-preview-img').removeAttribute('src');
  $('file-input').value     = '';
  $('camera-input').value   = '';
  $('manual-camera').value  = '';
}

// Pasa una foto por el escáner (recorte de perspectiva + filtro). Una factura
// enderezada se archiva mejor en Drive y la IA la lee mucho mejor.
// Devuelve el archivo a usar, o null si el usuario canceló el escaneo.
async function escanear(file) {
  if (!file || typeof openScanner !== 'function') return file || null;
  try {
    return await openScanner(file);
  } catch (_) {
    // Escáner no disponible (p. ej. sin conexión la primera vez): va la original.
    toast('Escáner no disponible; se usó la foto original.', 'warning');
    return file;
  }
}

async function checkShareFile() {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open('share-target');
    const match = await cache.match('shared-file');
    if (!match) return null;
    const blob     = await match.blob();
    const filename = match.headers.get('X-File-Name') || 'archivo';
    const filetype = match.headers.get('Content-Type') || blob.type;
    return new File([blob], filename, { type: filetype });
  } catch (_) { return null; }
}

async function clearShareFile() {
  try {
    const cache = await caches.open('share-target');
    await cache.delete('shared-file');
  } catch (_) {}
}

// ---- Scoring ----

function normalizeProvName(s) {
  return (s || '').toLowerCase()
    .replace(/\b(s\.a\.|s\.r\.l\.|s\.a\.s\.|s\.a|s\.r\.l|sa|srl|sas)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function provSimilarity(a, b) {
  const na = normalizeProvName(a);
  const nb = normalizeProvName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (!wa.length || !wb.length) return 0;
  const overlap = wa.filter(w => wb.some(x => x.includes(w) || w.includes(x)));
  return overlap.length / Math.max(wa.length, wb.length);
}

function scoreMatch(extracted, oc) {
  let score = 0;

  // Total: factor principal
  if (extracted.total_documento && oc.total && oc.total > 0) {
    const ratio = Math.abs(extracted.total_documento - oc.total) / oc.total;
    if (ratio <= 0.01)      score += 6;
    else if (ratio <= 0.05) score += 4;
    else if (ratio <= 0.15) score += 2;
    else if (ratio <= 0.30) score += 1;
  }

  // Proveedor
  const sim = provSimilarity(extracted.proveedor, oc.proveedor?.nombre);
  if (sim >= 0.65)      score += 2;
  else if (sim >= 0.3)  score += 1;

  // Fecha reciente
  if (oc.timestamp) {
    const diffDays = Math.abs(Date.now() - oc.timestamp) / 86400000;
    if (diffDays <= 45) score += 1;
  }

  return score;
}

function getTopMatches(extracted, ocs) {
  return ocs
    .map(oc => ({ oc, score: scoreMatch(extracted, oc) }))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// ---- Renglón de una OC ----

// `modo`: 'lista' (vista principal: foto + cargar, elige el archivo al tocar) o
// 'archivo' (ya hay un archivo elegido en la bandeja: "Cargar acá").
function accionesHtml(oc, modo) {
  const st  = cargaOC.get(oc.nroOC);
  const nro = esc(oc.nroOC);
  if (st === 'subiendo') return '<span class="fac-subiendo"><span class="spinner"></span>Subiendo…</span>';
  if (st === 'ok')       return `<span class="fac-ok">${icSvg('checkSm')}Cargada</span>`;
  if (modo === 'archivo') {
    return `<button type="button" class="foc-btn foc-btn--vios btn-adj-attach" data-nro="${nro}" title="Cargar acá">${icSvg('clip')}<span class="fac-largo">Cargar acá</span></button>`;
  }
  const que = { factura: 'Cargar factura', otro: 'Cargar archivo' }[tipoCarga] || 'Cargar';
  return (ES_MOBILE ? `<button type="button" class="foc-btn foc-btn--clear fac-ib btn-attach-cam" data-nro="${nro}" title="Sacar foto" aria-label="Sacar foto">${icSvg('camera')}</button>` : '') +
    `<button type="button" class="foc-btn foc-btn--vio fac-ib btn-attach-pick" data-nro="${nro}" title="${que}" aria-label="${que}">${icSvg('clip')}</button>`;
}

function filaHtml(oc, modo, terms = [], score = null) {
  const hl   = t => resaltarTxt(t, terms, esc);
  const por  = oc.responsable?.nombre && (viewerIsAdmin || oc.responsable.codigo !== viewerCode) ? `<div class="fac-por">por ${hl(oc.responsable.nombre)}</div>` : '';
  const dots = score == null ? '' : `<span class="fac-score" title="Nivel de coincidencia">${score >= 7 ? '●●●' : score >= 4 ? '●●○' : '●○○'}</span>`;
  const fact = facturasDeOC(oc);
  return `<div class="fac-row${cargaOC.get(oc.nroOC) === 'ok' ? ' fac-row--ok' : ''}" data-nro="${esc(oc.nroOC)}" data-modo="${modo}"${
      score == null ? '' : ` data-score="${score}"`}>
    ${cuadroHtml(oc)}
    <div style="min-width:0">
      <div class="fac-prov">${hl(oc.proveedor?.nombre || '—')}</div>
      <div class="fac-sub">${hl(oc.nroOC)} · <span class="fac-sub-f">${esc(oc.fecha || '')}</span><span class="fac-sub-tot">${moneyOC(oc)}</span></div>
      <div class="fac-sub fac-sub-obra">${hl(oc.obra || '—')}</div>
    </div>
    <div class="fac-mid"><div>${hl(oc.obra || '—')}</div>${por}</div>
    <div class="fac-tot">${moneyOC(oc)}<small>${esc(oc.fecha || '')}</small></div>
    <div class="fac-acts">${dots}${estadoHtml(oc)}${accionesHtml(oc, modo)}</div>
    ${hitsHtml(oc, itemsCoincidentes(oc, terms), esc, terms).replace('class="rem-hits"', 'class="rem-hits fac-hits"')}
    ${docsListasHtml(fact, [])}
  </div>`;
}

// Pinta los renglones en un panel y engancha las pastillas de factura.
function pintarPanel(box, ocs, modo, terms, vacio) {
  box.innerHTML = `<div class="fac-panel">${ocs.length
    ? ocs.map(x => x.oc ? filaHtml(x.oc, modo, terms, x.score) : filaHtml(x, modo, terms)).join('')
    : `<div class="fac-vacio">${vacio}</div>`}</div>`;
  box.querySelectorAll('.fac-row').forEach(bindFila);
}

function bindFila(row) {
  const oc = allOCs.find(o => o.nroOC === row.dataset.nro);
  if (oc) bindDocsOC(row, oc, facturasDeOC(oc), []);
}

// Repinta el renglón de una OC donde esté (lista y resultado de la IA), sin
// rearmar la lista: rearmarla sacaría la OC de la vista justo cuando el usuario
// mira si funcionó.
function repintarFila(oc) {
  document.querySelectorAll(`.fac-row[data-nro="${CSS.escape(oc.nroOC)}"]`).forEach(row => {
    const score = row.dataset.score != null ? +row.dataset.score : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = filaHtml(oc, row.dataset.modo, terminosBusqueda($('adj-search-main').value), score);
    const nueva = tmp.firstElementChild;
    row.replaceWith(nueva);
    bindFila(nueva);
  });
}

// ---- Vista principal: lista de OC (se elige el archivo al tocar Cargar) ----

function actualizarContadores() {
  const con = allOCs.filter(tieneFactura).length;
  const sin = allOCs.length - con;
  const pend = $('fac-pend');
  pend.textContent = sin === 1 ? '1 sin factura' : `${sin} sin factura`;
  pend.classList.toggle('hidden', !sin);
  const n = { sin, con, todas: allOCs.length };
  $('adj-filtro').querySelectorAll('.fac-tab').forEach(b => { b.querySelector('b').textContent = n[b.dataset.filtro]; });
}

function renderPrimaryList(filter = '') {
  const terms = terminosBusqueda(filter);
  let list = filtroOC === 'todas'
    ? allOCs
    : allOCs.filter(oc => tieneFactura(oc) === (filtroOC === 'con'));
  if (terms.length) list = list.filter(oc => coincideOC(oc, terms));
  const vacio = terms.length ? 'No se encontraron OC.' :
    filtroOC === 'sin' ? 'No queda ninguna OC sin factura.' :
    filtroOC === 'con' ? 'Todavía no hay ninguna OC con factura cargada.' :
                         'No hay OC en el historial.';
  const box = $('adj-oc-list-main');
  pintarPanel(box, pager.take('adj', list), 'lista', terms, vacio);
  pager.footer('adj', box, list, () => renderPrimaryList(filter));
}

// Registra la carga en el feed de Novedades (best-effort). Los eventos viejos
// siguen siendo 'adjunto' (podían ser cualquier cosa); los nuevos distinguen la
// factura, que es lo que la pantalla carga por defecto.
function logAdjuntoActivity(oc, file, folderId) {
  if (typeof logActivity !== 'function') return;
  const fid = folderId || oc.drive_folder_obras_id || oc.drive_folder_proveedores_id || oc.drive_folder_id || '';
  const esFactura = tipoCarga === 'factura';
  logActivity({
    tipo:    esFactura ? 'factura' : 'adjunto',
    nroOC:   oc.nroOC,
    usuario: {
      codigo: sessionStorage.getItem('responsable_code') || '',
      nombre: sessionStorage.getItem('responsable_name') || ''
    },
    titulo:   `${esFactura ? 'Factura' : 'Adjunto'} en OC ${oc.nroOC} — ${oc.proveedor?.nombre || 'Sin proveedor'}`,
    detalle:  `${file.name} · ${oc.obra || 'Sin obra'}`,
    driveUrl: fid ? `https://drive.google.com/drive/folders/${fid}` : ''
  });
}

// Sube el archivo a la carpeta de la OC y lo registra. El renglón muestra
// "Subiendo…" y después "Cargada"; si falla vuelve a sus botones.
// Devuelve el archivo subido, o null si falló.
async function subirAOC(file, oc) {
  cargaOC.set(oc.nroOC, 'subiendo');
  repintarFila(oc);
  try {
    const subida = archivoParaDrive(file);
    const res = await attachToDriveOC(subida, {
      drive_folder_obras_id:       oc.drive_folder_obras_id       || null,
      drive_folder_proveedores_id: oc.drive_folder_proveedores_id || null,
      drive_folder_id:             oc.drive_folder_id             || null,
      obra:      oc.obra              || '',
      fecha:     displayToISODate(oc.fecha),
      proveedor: oc.proveedor?.nombre || '',
      nroOC:     oc.nroOC
    });
    logAdjuntoActivity(oc, subida, res?.folderId);
    await registrarAdjunto(oc, subida, res);
    await clearShareFile();
    cargaOC.set(oc.nroOC, 'ok');
    repintarFila(oc);
    actualizarContadores();
    return subida;
  } catch (e) {
    console.error('subirAOC:', e);
    toast('Error al subir el archivo a Drive.', 'error');
    cargaOC.delete(oc.nroOC);
    repintarFila(oc);
    return null;
  }
}

async function doAttachPick(file, oc) {
  if (!file || !oc) return;
  pendingOC = null;
  if (await subirAOC(file, oc)) {
    toast(`${tipoCarga === 'factura' ? 'Factura cargada' : 'Archivo cargado'} en OC ${oc.nroOC}`, 'success');
  }
}

// ---- Resultado de la IA / elegir a mano ----

function renderManualList(q = '') {
  const terms = terminosBusqueda(q);
  const list  = terms.length ? allOCs.filter(oc => coincideOC(oc, terms)) : allOCs;
  pintarPanel($('adj-oc-list'), list, 'archivo', terms, list.length ? '' : 'No se encontraron OC.');
}

function showManualList(intro = '') {
  $('result-body').innerHTML = `${intro}
    <input type="search" class="hist-search fac-search" id="adj-search" placeholder="Buscar por artículo, proveedor, obra, responsable o N° OC…">
    <div id="adj-oc-list"></div>`;
  renderManualList();
  $('adj-search').addEventListener('input', e => renderManualList(e.target.value));
}

function showAIResults(extracted, matches) {
  $('result-title').textContent = 'Resultado de la búsqueda';

  let tags = '';
  if (extracted.proveedor)       tags += `<span class="fac-tag">${icSvg('building')} ${esc(extracted.proveedor)}</span>`;
  if (extracted.total_documento) tags += `<span class="fac-tag">${icSvg('dollar')} $ ${fmtMoney(extracted.total_documento)}</span>`;
  tags = tags ? `<div class="fac-tags">${tags}</div>` : '';

  if (matches.length === 0) {
    $('result-title').textContent = 'No encontramos la OC';
    showManualList(tags + '<p class="fac-res-l">Elegila de la lista</p>');
    return;
  }

  $('result-body').innerHTML = `${tags}<p class="fac-res-l">OC que coinciden</p><div id="adj-match-list"></div>
    <div class="fac-res-foot"><button type="button" class="foc-btn foc-btn--clear" id="btn-show-manual">${icSvg('eye')}Ver todas las OC</button></div>`;
  pintarPanel($('adj-match-list'), matches, 'archivo', [], '');

  $('btn-show-manual').addEventListener('click', () => {
    $('result-title').textContent = 'Elegir la OC';
    showManualList();
  });
}

// ---- Carga desde la bandeja ----

async function doAttach(file, oc) {
  const subida = await subirAOC(file, oc);
  if (!subida) return;
  $('card-result').classList.add('hidden');
  $('success-detail').textContent = `${subida.name} → OC ${oc.nroOC} (${oc.proveedor?.nombre || ''})`;
  $('card-success').classList.remove('hidden');
}

// ---- Reset ----

function resetToStart() {
  resetZone();
  $('import-zone').classList.remove('hidden');
  $('card-result').classList.add('hidden');
  $('card-success').classList.add('hidden');
}

// ---- Init ----

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  $('hdr-name').textContent = name;
  $('btn-back').addEventListener('click', () => { window.location.href = 'compras.html'; });
  $('btn-restart').addEventListener('click', resetToStart);
  $('btn-another').addEventListener('click', resetToStart);

  // Cargar historial y renderizar la lista principal.
  // El super-admin (0000) y los usuarios admin ven todas las OC; el Jefe de
  // Obra, además de las suyas, las de sus obras (ver alcanceOC).
  const { isAdmin, obrasJefe } = await alcanceOC(code);
  viewerIsAdmin = isAdmin;
  viewerCode    = code;
  const pintarTodo = () => { actualizarContadores(); renderPrimaryList($('adj-search-main').value); };
  getHistorial(code, isAdmin, false, obrasJefe)
    .then(async ocs => {
      allOCs = ocs;
      pintarTodo();
      // Primera vez tras el deploy: reconstruir el estado de las OC viejas a
      // partir del feed de Novedades. Después de eso ya viene en el historial.
      const sembrado = await sembrarAdjuntosDesdeActividad(ocs);
      if (sembrado) {
        allOCs.forEach(oc => {
          const reg = sembrado[String(oc.nroOC).replace(/-/g, '')];
          if (reg) oc.adjuntos = { ...reg, ...(oc.adjuntos || {}) };
        });
        pintarTodo();
      }
    })
    .catch(() => {
      const cached = typeof getHistorialCached === 'function' ? getHistorialCached(code) : null;
      if (cached) allOCs = cached;
      pintarTodo();
    });

  // Qué se está cargando (define el prefijo del archivo en Drive). Vale para la
  // lista y para la bandeja.
  $('adj-tipo').addEventListener('click', ev => {
    const btn = ev.target.closest('button[data-tipo]');
    if (btn) elegirTipo(btn.dataset.tipo);
  });

  // Filtro por estado de factura
  $('adj-filtro').addEventListener('click', ev => {
    const btn = ev.target.closest('.fac-tab');
    if (!btn) return;
    filtroOC = btn.dataset.filtro;
    $('adj-filtro').querySelectorAll('.fac-tab').forEach(b => b.classList.toggle('active', b === btn));
    pager.reset('adj');
    renderPrimaryList($('adj-search-main').value);
  });

  // Buscador de la lista principal
  $('adj-search-main').addEventListener('input', e => {
    pager.reset('adj');   // búsqueda nueva → volver a la primera página
    renderPrimaryList(e.target.value);
  });

  // Botones de los renglones (delegado: los renglones se repintan solos)
  document.querySelector('.fac-page').addEventListener('click', async ev => {
    const btn = ev.target.closest('.btn-attach-pick, .btn-attach-cam, .btn-adj-attach');
    if (!btn) return;
    const oc = allOCs.find(o => o.nroOC === btn.dataset.nro) || null;
    if (!oc || !await asegurarTipo(oc) || !await confirmarDuplicado(oc)) return;
    if (btn.classList.contains('btn-adj-attach')) { await doAttach(currentFile, oc); return; }
    pendingOC = oc;
    // Sacar foto: la factura pasa por el escáner y se sube apenas se toca "Listo".
    const input = $(btn.classList.contains('btn-attach-cam') ? 'manual-camera' : 'manual-file');
    input.value = '';
    input.click();
  });

  // Adjuntar manual: archivo elegido tras tocar "Cargar" en una OC
  $('manual-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f && pendingOC) doAttachPick(f, pendingOC);
  });

  // Foto sacada desde una OC de la lista: escáner y, si no se cancela, sube
  $('manual-camera').addEventListener('change', async e => {
    const f  = e.target.files[0];
    const oc = pendingOC;
    e.target.value = '';   // sacar dos veces la misma foto vuelve a disparar change
    if (!f || !oc) return;
    const scan = await escanear(f);
    if (scan) doAttachPick(scan, oc);
    else pendingOC = null;   // canceló el escaneo: no se sube nada
  });

  // Archivo compartido por share target → queda cargado en la bandeja
  const sharedFile = await checkShareFile();
  if (sharedFile) setFile(sharedFile);

  // Botones de selección
  const fileInput   = $('file-input');
  const cameraInput = $('camera-input');

  if (ES_MOBILE) {
    $('btn-camera').classList.remove('hidden');
  }

  $('btn-select-file').addEventListener('click', () => fileInput.click());
  $('btn-camera').addEventListener('click', () => cameraInput.click());

  // Archivo elegido a mano: se usa tal cual (puede ser un PDF). Si es imagen,
  // queda disponible para escanearla desde el preview.
  function elegirArchivo(file) {
    if (!file) return;
    rawFile = file.type.startsWith('image/') ? file : null;
    setFile(file);
  }

  fileInput.addEventListener('change', () => elegirArchivo(fileInput.files[0]));

  // Foto de cámara: pasa por el escáner antes de quedar cargada
  cameraInput.addEventListener('change', async () => {
    const f = cameraInput.files[0];
    cameraInput.value = '';
    if (!f) return;
    rawFile = f;
    const scan = await escanear(f);
    if (scan) setFile(scan);   // null = canceló: no cambia nada
  });

  $('file-preview-img').addEventListener('click', () => verImagen(filePrevUrl));
  $('btn-file-rescan').addEventListener('click', async () => {
    const base = rawFile || currentFile;
    if (!base) return;
    const scan = await escanear(base);
    if (scan) setFile(scan);
  });

  // Drag & drop (desktop)
  const importZone = $('import-zone');
  importZone.addEventListener('dragover', e => { e.preventDefault(); importZone.classList.add('drag-over'); });
  importZone.addEventListener('dragleave', () => importZone.classList.remove('drag-over'));
  importZone.addEventListener('drop', e => {
    e.preventDefault();
    importZone.classList.remove('drag-over');
    elegirArchivo(e.dataTransfer.files[0]);
  });

  $('btn-change-file').addEventListener('click', resetZone);

  $('btn-use-ai').addEventListener('click', async () => {
    if (!currentFile) return;
    $('import-zone').classList.add('hidden');
    $('card-result').classList.remove('hidden');
    $('result-title').textContent = 'Buscando la OC…';
    $('result-body').innerHTML    = `<div class="extract-status loading"><div class="spinner"></div> Analizando el documento…</div>`;
    try {
      const extracted = await extractBasicFromFile(currentFile);
      showAIResults(extracted, getTopMatches(extracted, allOCs));
    } catch (e) {
      $('result-title').textContent = 'No se pudo analizar';
      showManualList(`<div class="extract-status error" style="margin-bottom:.75rem;">${esc(e.message)}</div>`);
    }
  });

  $('btn-use-manual').addEventListener('click', () => {
    if (!currentFile) return;
    $('import-zone').classList.add('hidden');
    $('card-result').classList.remove('hidden');
    $('result-title').textContent = 'Elegir la OC';
    showManualList();
  });
});
