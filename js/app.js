/* ===================================================
   VIMECO S.A. — Generador de Órdenes de Compra
   app.js
   =================================================== */

// ---- OC Number (contador global en Firebase) ----
function getOCBranch()       { return sessionStorage.getItem('responsable_code') || '0001'; }
function formatOCNumber(seq) { return `${getOCBranch()}-${String(seq).padStart(8, '0')}`; }

async function refreshOCNumberDisplay() {
  if (manualOCNumber) return; // no sobreescribir si hay número manual
  try {
    const seq = await readNextOCSeq();
    $('oc-number-display').textContent = formatOCNumber(seq);
  } catch {
    $('oc-number-display').textContent = '—';
  }
}

function clearManualOCNumber() {
  manualOCNumber = null;
  $('oc-number-display').classList.remove('oc-number-manual');
  $('btn-clear-oc-number').classList.add('hidden');
  refreshOCNumberDisplay();
}

function setupOCNumberEdit() {
  const display  = $('oc-number-display');
  const input    = $('oc-number-input');
  const btnEdit  = $('btn-edit-oc-number');
  const btnClear = $('btn-clear-oc-number');
  let   editing  = false;

  function startEdit() {
    if (editing) return;
    editing = true;
    input.value = manualOCNumber || (display.textContent !== '—' ? display.textContent : '');
    display.classList.add('hidden');
    input.classList.remove('hidden');
    btnEdit.classList.add('hidden');
    btnClear.classList.add('hidden');
    input.focus();
    input.select();
  }

  function confirmEdit() {
    if (!editing) return;
    editing = false;
    const val = input.value.trim();
    input.classList.add('hidden');
    display.classList.remove('hidden');
    btnEdit.classList.remove('hidden');
    if (val) {
      manualOCNumber = val;
      display.textContent = val;
      display.classList.add('oc-number-manual');
      btnClear.classList.remove('hidden');
    } else {
      clearManualOCNumber();
    }
  }

  function cancelEdit() {
    if (!editing) return;
    editing = false;
    input.classList.add('hidden');
    display.classList.remove('hidden');
    btnEdit.classList.remove('hidden');
    if (manualOCNumber) btnClear.classList.remove('hidden');
  }

  btnEdit.addEventListener('click', startEdit);
  btnClear.addEventListener('click', clearManualOCNumber);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); confirmEdit(); }
    if (e.key === 'Escape') { cancelEdit(); }
  });
  input.addEventListener('blur', confirmEdit);
}

// ---- State ----
let items            = [];
let ivaActive        = false;
let ivaPct           = 21;
let monedaUSD        = false;
let selectedFile     = null;
let descuento        = { pct: null, monto: 0 };
let noGravado        = { pct: null, monto: 0 };
let impuestos        = [];   // [{nombre, pct, monto}]
let firmaBase64      = null; // firma del usuario activo (cargada desde Firebase)
let verifRowWarnings = {};   // {idx: true} ítems con discrepancia post-extracción
let manualOCNumber   = null; // número de OC ingresado manualmente

// ---- DOM shortcut ----
const $ = id => document.getElementById(id);

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  // Al compartir un archivo, Android abre la app en frío (sessionStorage vacío):
  // se toma la sesión recordada del dispositivo, como en el resto de las páginas.
  const sess = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')) || {}; } catch (_) { return {}; } })();
  const code = sessionStorage.getItem('responsable_code') || sess.codigo || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || sess.nombre || localStorage.getItem('responsable_name');
  if (!code || !name) {
    // Sin sesión se pasa por el login: el envío compartido se retoma después.
    if (location.search || !document.referrer) sessionStorage.setItem('vimeco_share_pendiente', '1');
    window.location.href = 'index.html'; return;
  }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  // Archivo compartido desde otra app: se revisa antes que nada, para que ningún
  // otro paso del arranque pueda impedir que aparezca el cartel.
  checkSharedFile();

  $('hdr-name').textContent = name;
  $('date-display').textContent = formatDateDisplay(new Date());
  refreshOCNumberDisplay();

  // Con algo cargado pide confirmación: borra también el borrador guardado.
  $('btn-clear-form').addEventListener('click', () => borradorTieneAlgo() ? empezarDeCero() : resetForm());
  $('btn-add-row').addEventListener('click', addEmptyRow);
  $('btn-generate').addEventListener('click', handleGenerate);
  $('btn-extract').addEventListener('click', handleExtract);
  $('btn-clear-file').addEventListener('click', clearFile);
  $('btn-add-impuesto').addEventListener('click', addImpuestoRow);
  $('verif-banner-close').addEventListener('click', hideVerifBanner);
  setupMenu();
  setupIVAToggle();
  setupMonedaToggle();

  // ---- Descuento ----
  $('pct-descuento').addEventListener('input', e => {
    const v = parseArgFloat(e.target.value);
    descuento.pct = v > 0 ? v : null;
    if (descuento.pct) {
      descuento.monto = roundCents(calcSubtotal() * v / 100);
      $('monto-descuento').value = fmtMoneyDisplay(descuento.monto);
    }
    recalcTotales();
  });
  $('monto-descuento').addEventListener('input', e => {
    descuento.monto = parseArgFloat(e.target.value);
    descuento.pct   = null;
    $('pct-descuento').value = '';
    recalcTotales();
  });
  $('monto-descuento').addEventListener('focus', onNumFocus);
  $('monto-descuento').addEventListener('blur', e => {
    descuento.monto = parseArgFloat(e.target.value);
    e.target.value  = fmtMoneyDisplay(descuento.monto);
    recalcTotales();
  });

  // ---- No gravado ----
  $('pct-nogravado').addEventListener('input', e => {
    const v = parseArgFloat(e.target.value);
    noGravado.pct = v > 0 ? v : null;
    if (noGravado.pct) {
      noGravado.monto = roundCents(calcSubtotal() * v / 100);
      $('monto-nogravado').value = fmtMoneyDisplay(noGravado.monto);
    }
    recalcTotales();
  });
  $('monto-nogravado').addEventListener('input', e => {
    noGravado.monto = parseArgFloat(e.target.value);
    noGravado.pct   = null;
    $('pct-nogravado').value = '';
    recalcTotales();
  });
  $('monto-nogravado').addEventListener('focus', onNumFocus);
  $('monto-nogravado').addEventListener('blur', e => {
    noGravado.monto = parseArgFloat(e.target.value);
    e.target.value  = fmtMoneyDisplay(noGravado.monto);
    recalcTotales();
  });

  $('btn-preview').addEventListener('click', handlePreview);
  $('modal-preview-close').addEventListener('click',  closePreview);
  $('modal-preview-close2').addEventListener('click', closePreview);
  $('modal-preview-generate').addEventListener('click', () => { closePreview(); handleGenerate(); });
  $('btn-same-provider').addEventListener('click', resetFormKeepProvider);
  $('btn-borrador-cero').addEventListener('click', empezarDeCero);
  $('btn-borrador-ok').addEventListener('click', ocultarAvisoBorrador);
  $('btn-prov-editar').addEventListener('click', editarProveedor);
  $('btn-prov-cambiar').addEventListener('click', cambiarProveedor);
  $('oc-check-list').addEventListener('click', e => {
    const r = e.target.closest('.oc-check-r--no');
    if (r) irAFaltante(r.dataset.id);
  });

  setupFirmaModalButtons();
  setupImportButtons();
  const obrasListas = setupObraCombo();
  setupRubroCombo();
  setupEquipoCombo();
  setupProveedorCombo();
  setupOCNumberEdit();
  setupSegs();
  setupCondChips();
  setupOCAccordion();
  setupOCDock();
  renderTable();
  renderImpuestos();
  recalcTotales();

  await loadLogo();
  loadProveedoresCache();
  retryDriveQueue().catch(() => {});
  window.addEventListener('online', () => retryDriveQueue().catch(() => {}));

  // Si la lectura tarda y el usuario dibujó su firma mientras tanto, no pisarla.
  getFirma(code).then(f => { if (!firmaBase64) firmaBase64 = f || null; }).catch(() => {});

  // Retoma la OC que quedó a medio cargar (o la base pedida desde el Historial).
  arrancarBorrador(obrasListas);
});

// ---- IVA Toggle ----
function setupIVAToggle() {
  const checkbox = $('iva-toggle');
  const pctWrap  = $('iva-pct-wrap');
  const pctInput = $('iva-pct');

  checkbox.addEventListener('change', () => {
    ivaActive = checkbox.checked;
    pctWrap.classList.toggle('hidden', !ivaActive);
    if (ivaActive) {
      ivaPct = parseArgFloat(pctInput.value) || 21;
      applyIVAToggle();
      ensureIVAImpuesto(null);
    } else {
      revertIVAToggle();
    }
    renderTable();
    recalcTotales();
  });

  pctInput.addEventListener('change', () => {
    if (!ivaActive) return;
    revertIVAToggle();
    const pctAnterior = ivaPct;
    ivaPct = parseArgFloat(pctInput.value) || 21;
    applyIVAToggle();
    ensureIVAImpuesto(pctAnterior);
    renderTable();
    recalcTotales();
  });
}

function applyIVAToggle() {
  const factor = 1 + ivaPct / 100;
  items.forEach(item => {
    if (item._precio_original === undefined) {
      item._precio_original = item.precio_unitario;
      item.precio_unitario  = Math.round((item.precio_unitario / factor) * 100) / 100;
    }
  });
}

// Precios con IVA incluido → el IVA se descuenta de los ítems, así que la OC
// tiene que sumarlo como impuesto. Si no hay fila de IVA se agrega; si hay una
// vacía (sin % ni monto) o con el % anterior del toggle, toma el % actual.
function ensureIVAImpuesto(pctAnterior) {
  const imp = impuestos.find(i => /i\.?\s?v\.?\s?a/i.test(i.nombre || ''));
  if (!imp) {
    impuestos.push({ nombre: 'IVA', pct: ivaPct, monto: 0 });
  } else if ((imp.pct == null && !(imp.monto || 0)) || (pctAnterior != null && imp.pct === pctAnterior)) {
    imp.pct = ivaPct;
  } else {
    return;
  }
  renderImpuestos();
}

function revertIVAToggle() {
  items.forEach(item => {
    if (item._precio_original !== undefined) {
      item.precio_unitario  = item._precio_original;
      delete item._precio_original;
    }
  });
}

function resetIVAToggle() {
  ivaActive = false;
  ivaPct    = 21;
  items.forEach(item => { delete item._precio_original; });
  const checkbox = $('iva-toggle');
  if (checkbox) {
    checkbox.checked = false;
    $('iva-pct-wrap').classList.add('hidden');
    $('iva-pct').value = '21';
  }
}

// ---- Toggle de moneda (USD) ----
// Solo cambia la presentación de la OC: símbolo ($ → USD) y el texto
// "Son PESOS…" → "Son DOLARES…". No altera los importes cargados.
function setupMonedaToggle() {
  const checkbox = $('moneda-toggle');
  if (!checkbox) return;
  checkbox.addEventListener('change', () => {
    monedaUSD = checkbox.checked;
    updateMonedaLabels();
  });
}

function resetMonedaToggle() {
  monedaUSD = false;
  const checkbox = $('moneda-toggle');
  if (checkbox) checkbox.checked = false;
  updateMonedaLabels();
}

// Refleja la moneda elegida en los encabezados de la app: ($) ↔ (USD).
function updateMonedaLabels() {
  const sym = monedaUSD ? 'USD' : '$';
  const set = (id, label) => { const el = $(id); if (el) el.textContent = `${label} (${sym})`; };
  set('th-precio-unit', 'Precio Unit.');
  set('th-importe',     'Importe');
  set('th-monto',       'Monto');
}

// ---- Menú de usuario ----
function setupMenu() {
  const btnMenu   = $('btn-menu');
  const dropdown  = $('hdr-dropdown');

  btnMenu.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', () => dropdown.classList.add('hidden'));
  dropdown.addEventListener('click', e => e.stopPropagation());

  $('btn-firma').addEventListener('click', () => {
    dropdown.classList.add('hidden');
    openFirmaModal();
  });
}

// ---- Firma ----
let _firmaDrawing = false, _firmaLX = 0, _firmaLY = 0;

function openFirmaModal() {
  const canvas = $('firma-canvas');
  const ctx    = canvas.getContext('2d');

  if (!canvas._ready) {
    canvas.width  = 560;
    canvas.height = 200;
    canvas._ready = true;

    function pos(e) {
      const r  = canvas.getBoundingClientRect();
      const sx = canvas.width  / r.width;
      const sy = canvas.height / r.height;
      const s  = e.touches ? e.touches[0] : e;
      return { x: (s.clientX - r.left) * sx, y: (s.clientY - r.top) * sy };
    }
    function stroke(e) {
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(_firmaLX, _firmaLY); ctx.lineTo(p.x, p.y); ctx.stroke();
      _firmaLX = p.x; _firmaLY = p.y;
    }

    canvas.addEventListener('mousedown',  e => { _firmaDrawing = true;  const p = pos(e); _firmaLX = p.x; _firmaLY = p.y; });
    canvas.addEventListener('mousemove',  e => { if (_firmaDrawing) stroke(e); });
    canvas.addEventListener('mouseup',    () => _firmaDrawing = false);
    canvas.addEventListener('mouseleave', () => _firmaDrawing = false);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); _firmaDrawing = true;  const p = pos(e); _firmaLX = p.x; _firmaLY = p.y; }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (_firmaDrawing) stroke(e); }, { passive: false });
    canvas.addEventListener('touchend',   () => _firmaDrawing = false);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#1a3a5c';
  ctx.lineWidth = 2.5;
  ctx.lineCap   = 'round';
  ctx.lineJoin  = 'round';

  if (firmaBase64) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = firmaBase64;
  }

  $('modal-firma').classList.remove('hidden');
}

const BTN_GUARDAR_FIRMA = () => icSvg('checkSm') + 'Guardar firma';

function setupFirmaModalButtons() {
  $('btn-firma-guardar').innerHTML = BTN_GUARDAR_FIRMA();
  $('modal-firma-close').addEventListener('click', () => $('modal-firma').classList.add('hidden'));
  $('btn-firma-limpiar').addEventListener('click', () => {
    const canvas = $('firma-canvas');
    const ctx    = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  $('btn-firma-guardar').addEventListener('click', async () => {
    const canvas = $('firma-canvas');
    const base64 = canvas.toDataURL('image/png');
    const btn    = $('btn-firma-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const code = sessionStorage.getItem('responsable_code');
      await saveFirma(code, base64);
      firmaBase64 = base64;
      $('modal-firma').classList.add('hidden');
      toast('Firma guardada.', 'success');
    } catch {
      toast('Error al guardar la firma.', 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = BTN_GUARDAR_FIRMA();
    }
  });
}

// logOCActivity vive en firebase.js (la usan también autorizaciones.js y la
// reconciliación de actividad.js).

// Guarda en el historial las carpetas de Drive de una OC. Si el PATCH falla, la
// OC queda figurando "sin respaldo" aunque el PDF esté subido (le pasó a la OC
// 0007-00000106), así que se reintenta y, si igual falla, se deja rastro.
async function saveDriveIds(histKey, obrasFolderId, proveedoresFolderId, nroOC) {
  const fields = {
    drive_folder_obras_id:       obrasFolderId       || null,
    drive_folder_proveedores_id: proveedoresFolderId || null
  };
  for (let intento = 0; intento < 3; intento++) {
    try { await patchHistorialEntry(histKey, fields); return true; }
    catch (_) { await new Promise(r => setTimeout(r, 600 * (intento + 1))); }
  }
  logDriveIdsError(nroOC, histKey);
  return false;
}

function logDriveIdsError(nroOC, histKey) {
  const key = (nroOC || 'unknown').replace(/[^a-z0-9]/gi, '');
  fetch(`${FIREBASE_CONFIG.databaseURL}/drive_errors/${key}.json`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      nroOC,
      error:     'PDF subido a Drive pero no se pudieron guardar las carpetas en el historial (' + histKey + ')',
      timestamp: Date.now()
    })
  }).catch(() => {});
}

// ---- Cola offline Drive ----
// El candado evita que dos disparos simultáneos (carga + 'online' + reintento
// programado) suban el mismo PDF dos veces.
let _reintentandoCola = false;

async function retryDriveQueue() {
  if (typeof driveQueue === 'undefined' || typeof uploadToDrive !== 'function') return;
  if (_reintentandoCola) return;
  let items;
  try { items = await driveQueue.getAll(); } catch { return; }
  if (!items.length) return;
  _reintentandoCola = true;
  try { await _procesarCola(items); } finally { _reintentandoCola = false; }
}

async function _procesarCola(items) {
  for (const item of items) {
    try {
      const pdfBlob = new Blob([item.pdfBuf], { type: 'application/pdf' });
      const srcFile = item.srcBuf
        ? new File([item.srcBuf], item.srcName || 'archivo', { type: item.srcType || 'application/octet-stream' })
        : null;
      // Idempotente: el intento anterior pudo llegar a Drive aunque el cliente
      // lo viera fallar (corte de red al leer la respuesta). Reintentar a ciegas
      // dejaba una segunda copia del PDF en la carpeta.
      const { obrasFolderId, proveedoresFolderId } = await uploadOCIfMissing(pdfBlob, item.pdfName,
        { obra: item.obra, fecha: item.fecha, proveedor: item.proveedor, nroOC: item.nroOC },
        srcFile
      );
      await driveQueue.dequeue(item.histKey);
      if (obrasFolderId || proveedoresFolderId)
        await saveDriveIds(item.histKey, obrasFolderId, proveedoresFolderId, item.nroOC);
      // Once: la novedad puede existir ya (la creó la reconciliación de
      // Novedades mientras la subida seguía en la cola); en ese caso sólo le
      // falta el link.
      logOCActivityOnce(item.nroOC, item.proveedor, item.obra, item.total, obrasFolderId || proveedoresFolderId);
      toast(`OC ${item.nroOC} subida a Drive.`, 'success');
    } catch (_) {
      // Sigue sin conexión o error — se mantiene en la cola
    }
  }
}

// ---- Web Share Target: recibe archivo compartido desde otra app ----
async function checkSharedFile() {
  // El SW redirige con ?compartido=1: si el archivo no aparece, se avisa en vez
  // de abrir el formulario como si nada.
  // Desde WhatsApp, Chrome 153 a veces ni siquiera hace el POST: abre app.html
  // como una navegación común (a lo sumo con title/text en la URL) y el SW no se
  // entera. Se reconoce porque llega sin referrer a la app instalada: adentro se
  // entra siempre desde compras.html o el historial, que sí lo dejan.
  const params     = new URLSearchParams(location.search);
  const nav        = performance.getEntriesByType?.('navigation')[0];
  const lanzada    = !document.referrer && nav?.type === 'navigate' &&
                     matchMedia('(display-mode: standalone)').matches;
  const compartido = params.has('compartido') || params.has('title') || params.has('text') || lanzada;
  // Nombre del archivo, si la app de origen lo mandó en la URL (mismo criterio que el SW).
  const nombreUrl  = [params.get('title'), params.get('text')].map(t => (t || '').trim())
    .find(t => t && !/\n/.test(t) && t.length <= 150 && /\.[a-z0-9]{2,5}$/i.test(t)) || '';
  if (location.search) history.replaceState(null, '', location.pathname);
  if (!('caches' in window)) {
    if (compartido) toast('Este navegador no permite recibir archivos compartidos.', 'error');
    return;
  }
  try {
    const cache = await caches.open('share-target');
    // El SW deja 'shared-info' cuando el envío llegó sin archivo: en ese caso
    // no tiene sentido esperarlo.
    const info = compartido ? await cache.match('shared-info') : null;
    let match = await cache.match('shared-file');
    // Sólo si pasó por el SW (?compartido=1) puede estar todavía escribiéndose.
    for (let i = 0; !match && params.has('compartido') && !info && i < 10; i++) {
      await new Promise(res => setTimeout(res, 300));
      match = await cache.match('shared-file');
    }
    if (!match) {
      if (compartido) {
        // Chrome 153 en Android entrega el envío sin el archivo (regresión de
        // Chrome, GoogleChromeLabs/squoosh#1503). Mismo cartel, pero cada opción
        // pide elegir el archivo a mano; si llegó el nombre, se indica cuál.
        let nombre = nombreUrl;
        try { if (info) nombre = (await info.json()).nombre || nombre; } catch (_) {}
        await cache.delete('shared-info');
        showShareChoiceModal(null, nombre);
      }
      return;
    }
    // No borrar todavía: el modal decide qué hacer con él
    const blob     = await match.blob();
    const origName = match.headers.get('X-File-Name') || '';
    const ext      = blob.type === 'application/pdf' ? '.pdf' : blob.type.startsWith('image/') ? '.jpg' : '';
    const filename = origName || ('compartido' + ext);
    const file     = new File([blob], filename, { type: blob.type });
    showShareChoiceModal(file);
  } catch (e) {
    console.warn('checkSharedFile:', e);
    toast('No se pudo abrir el archivo compartido: ' + (e && e.message || e), 'error');
  }
}

async function deleteSharedFile() {
  try { const c = await caches.open('share-target'); await c.delete('shared-file'); } catch (_) {}
}

// Selector de archivos (debe abrirse desde un toque del usuario).
function elegirArchivo() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type   = 'file';
    inp.accept = '.jpg,.jpeg,.png,.pdf,.webp';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

// file = null: el archivo compartido no llegó y cada opción lo pide a mano;
// nombreBuscado es el nombre que mandó la app de origen, si lo mandó.
function showShareChoiceModal(file, nombreBuscado = '') {
  $('share-choice-filename').textContent = file ? file.name : '';
  $('share-choice-file').classList.toggle('hidden', !file);
  $('share-choice-aviso').classList.toggle('hidden', !!file);
  $('share-choice-buscar-nombre').textContent = nombreBuscado;
  $('share-choice-buscar').classList.toggle('hidden', !!file || !nombreBuscado);
  $('modal-share-choice').classList.remove('hidden');

  $('btn-share-generar').onclick = async () => {
    const f = file || await elegirArchivo();
    if (!f) return;
    $('modal-share-choice').classList.add('hidden');
    deleteSharedFile();
    handleFileSelected(f);
    toast('Archivo cargado. Usá "Extraer con IA" para procesar.', 'success');
  };

  $('btn-share-facturas').onclick = async () => {
    if (!file) {
      const f = await elegirArchivo();
      if (!f) return;
      // facturas.js lo toma de la misma caché que un archivo compartido.
      const c = await caches.open('share-target');
      await c.put('shared-file', new Response(f, {
        headers: { 'X-File-Name': f.name, 'Content-Type': f.type || '' }
      }));
    }
    $('modal-share-choice').classList.add('hidden');
    // El archivo queda en cache como 'shared-file'; facturas.js lo leerá
    window.location.href = 'facturas.html';
  };

  $('btn-share-cancelar').onclick = () => {
    $('modal-share-choice').classList.add('hidden');
    deleteSharedFile();
  };
}

// ---- Logo loader ----
async function loadLogo() {
  if (typeof LOGO_BASE64 === 'undefined' || !LOGO_BASE64) return;
  window.__logoDataURL = LOGO_BASE64;
  await new Promise(resolve => {
    const img = new Image();
    img.onload = () => { window.__logoDims = { w: img.naturalWidth, h: img.naturalHeight }; resolve(); };
    img.onerror = resolve;
    img.src = LOGO_BASE64;
  });
}

// ---- Obra combo ----
// Lista cerrada a propósito: mientras el campo fue de texto libre el padrón se
// fue partiendo ("Dean Funes" vs "Colectora Dean Funes", "Polo 52 -L27"), y con
// él las carpetas de Drive, que se crean con el nombre de la obra.
let obrasDisponibles = [];

function normalizarObra(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// El super-admin (0000) puede escribir obras fuera del padrón (p. ej. "x" para
// pruebas). El resto sigue atado a la lista cerrada de /obras activas.
function isSuperAdmin() {
  return (sessionStorage.getItem('responsable_code') || '') === '0000';
}

// Devuelve la obra del padrón que corresponde a `nombre`, o null si no está.
// Tolera diferencias de mayúsculas y acentos para poder recuperar OC viejas.
function buscarObra(nombre) {
  const n = normalizarObra(nombre);
  if (!n) return null;
  return obrasDisponibles.find(o => normalizarObra(o.nombre) === n) || null;
}

// Asigna el campo sólo si el nombre existe en el padrón, y siempre con la
// escritura oficial. Devuelve true si quedó cargado.
function setObraValue(nombre) {
  const obra = buscarObra(nombre);
  $('obra').value = obra ? obra.nombre : '';
  syncRubroCombo();
  return !!obra;
}

// ---- Obra recordada ----
// Cada OC nueva arranca con la obra de la última OC del usuario. Se guarda en
// el dispositivo al generar; en uno nuevo (o sin nada guardado) sale del historial.
const obraRecordadaKey = () => `vimeco_ultima_obra_${sessionStorage.getItem('responsable_code') || ''}`;

function recordarObra(nombre) {
  try { if (nombre) localStorage.setItem(obraRecordadaKey(), nombre); } catch (_) {}
}

async function obraRecordada() {
  try {
    const local = localStorage.getItem(obraRecordadaKey());
    if (local) return local;
  } catch (_) {}
  const code = sessionStorage.getItem('responsable_code') || '';
  const ult = (await historialParaComparar()).find(h => h.responsable?.codigo === code && h.obra);
  return ult ? ult.obra : null;
}

// Carga la obra recordada sólo si el campo está vacío: nunca pisa una elección.
// Si ya no está en el padrón (cerrada o renombrada), el campo queda vacío.
async function aplicarObraRecordada() {
  let nombre;
  try { nombre = await obraRecordada(); } catch (_) { return; }
  if (!nombre || $('obra').value.trim()) return;
  const obra = buscarObra(nombre);
  if (obra) aplicarObra(obra);
}

// Carga la obra y, si tiene lugar de entrega, lo propone (sin pisar uno escrito a mano).
function aplicarObra(obra) {
  $('obra').value = obra.nombre;
  syncRubroCombo();
  const lugarInput = $('lugar-entrega');
  if (obra.lugar_entrega && (!lugarInput.value.trim() || lugarInput.dataset.autoFilled === '1')) {
    lugarInput.value = obra.lugar_entrega;
    lugarInput.dataset.autoFilled = '1';
  }
  // Se carga sin eventos (obra recordada): el resumen de la sección no se enteraba.
  updateOCSummaries();
}

async function setupObraCombo() {
  const input    = $('obra');
  const arrow    = $('obra-arrow');
  const dropdown = $('obra-dropdown');

  try {
    obrasDisponibles = await getObrasActivas();
  } catch (e) {
    console.warn('setupObraCombo:', e);
  }

  // Super-admin: obra "X" de prueba, elegible del listado aunque no esté en el
  // padrón. Normaliza a "x" → queda excluida de reportes/novedades (esObraPrueba).
  if (isSuperAdmin() && !obrasDisponibles.some(o => normalizarObra(o.nombre) === 'x')) {
    obrasDisponibles.push({ key: '__prueba_x', nombre: 'X', lugar_entrega: '' });
  }

  function selectObra(obra) {
    dropdown.classList.add('hidden');
    aplicarObra(obra);
  }

  function buildOptions() {
    dropdown.innerHTML = '';
    if (!obrasDisponibles.length) {
      const vacio = document.createElement('div');
      vacio.className = 'combo-option';
      vacio.style.color = 'var(--gray-500)';
      vacio.textContent = 'No hay obras activas — cargalas en Administración';
      dropdown.appendChild(vacio);
      return;
    }
    obrasDisponibles.forEach(obra => {
      const div = document.createElement('div');
      div.className = 'combo-option';
      div.textContent = obra.nombre;
      div.addEventListener('mousedown', e => { e.preventDefault(); selectObra(obra); });
      dropdown.appendChild(div);
    });
  }

  function toggleDropdown(e) {
    e.stopPropagation();
    if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); return; }
    buildOptions();
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('click', toggleDropdown);
  arrow.addEventListener('click', toggleDropdown);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') toggleDropdown(e);
    else if (e.key === 'Escape') dropdown.classList.add('hidden');
  });

  $('lugar-entrega').addEventListener('input', () => {
    delete $('lugar-entrega').dataset.autoFilled;
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.combo-wrap')) dropdown.classList.add('hidden');
  });

  aplicarObraRecordada();
}

// ---- Rubro de la obra ----
// Rubro elegido para esta OC: { id, nombre } o null. Sólo se pide cuando la
// obra tiene la lista de rubros cerrada en Administración; mientras la lista
// esté abierta el campo ni aparece y la OC sale sin rubro (como antes de v182).
let selectedRubro = null;

// Rubros elegibles de la obra que esté cargada en el campo Obra.
// [] si no hay obra, si su lista está abierta o si no tiene rubros.
function rubrosDeObraActual() {
  const obra = buscarObra($('obra').value);
  if (!obra || !obra.rubrosCerrados) return [];
  return obra.rubros || [];
}

function setRubro(r) {
  selectedRubro = r ? { id: r.id, nombre: r.nombre } : null;
  const input = $('rubro');
  if (input) input.value = selectedRubro ? selectedRubro.nombre : '';
}

// Muestra/oculta el campo según la obra cargada y descarta un rubro que no
// pertenezca a ella (pasa al cambiar de obra o al usar una OC vieja de base).
function syncRubroCombo() {
  const group = $('rubro-group');
  if (!group) return;
  const rubros = rubrosDeObraActual();
  group.classList.toggle('hidden', !rubros.length);
  if (selectedRubro && !rubros.some(r => r.id === selectedRubro.id)) setRubro(null);
}

function setupRubroCombo() {
  const input    = $('rubro');
  const arrow    = $('rubro-arrow');
  const dropdown = $('rubro-dropdown');
  if (!input) return;

  function buildOptions() {
    dropdown.innerHTML = '';
    rubrosDeObraActual().forEach(r => {
      const div = document.createElement('div');
      div.className = 'combo-option';
      div.textContent = r.nombre;
      div.addEventListener('mousedown', e => {
        e.preventDefault(); setRubro(r); dropdown.classList.add('hidden');
      });
      dropdown.appendChild(div);
    });
  }

  function toggleDropdown(e) {
    e.stopPropagation();
    if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); return; }
    buildOptions();
    if (dropdown.children.length) dropdown.classList.remove('hidden');
  }

  input.addEventListener('click', toggleDropdown);
  arrow.addEventListener('click', toggleDropdown);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') toggleDropdown(e);
    else if (e.key === 'Escape') dropdown.classList.add('hidden');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.combo-wrap')) dropdown.classList.add('hidden');
  });
}

// ---- Equipo combo (opcional) ----
// El equipo asignado a la OC. null = ninguno (no se muestra en el PDF).
let selectedEquipo = null;
// Categoría de la compra del equipo: 'Repuestos' | 'Mantenimiento' | null.
// Sólo aplica si hay equipo elegido.
let selectedCategoria = null;

function setEquipo(eq) {
  selectedEquipo = (eq && eq.codigo) ? { codigo: eq.codigo, tipo: eq.tipo || '' } : null;
  const input = $('equipo');
  if (input) input.value = selectedEquipo ? `${selectedEquipo.codigo} — ${selectedEquipo.tipo}` : '';
  const catGroup = $('equipo-cat-group');
  if (catGroup) catGroup.classList.toggle('hidden', !selectedEquipo);
  // Sin equipo no hay categoría: se limpia (cubre resetForm y "Sin equipo").
  if (!selectedEquipo) setCategoria(null);
}

function setCategoria(cat) {
  selectedCategoria = cat || null;
  document.querySelectorAll('#equipo-cat .cat-seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.val === selectedCategoria));
}

async function setupEquipoCombo() {
  const input    = $('equipo');
  const arrow    = $('equipo-arrow');
  const dropdown = $('equipo-dropdown');
  if (!input) return;

  let equipos = [];
  try {
    equipos = await getEquiposActivos();
  } catch (e) {
    console.warn('setupEquipoCombo:', e);
  }

  function buildOptions(list) {
    dropdown.innerHTML = '';
    // Opción para quitar el equipo asignado.
    if (selectedEquipo) {
      const clr = document.createElement('div');
      clr.className = 'combo-option';
      clr.style.color = 'var(--gray-400)';
      clr.style.fontStyle = 'italic';
      clr.textContent = 'Sin equipo';
      clr.addEventListener('mousedown', e => {
        e.preventDefault(); setEquipo(null); dropdown.classList.add('hidden');
      });
      dropdown.appendChild(clr);
    }
    list.forEach(eq => {
      const div = document.createElement('div');
      div.className = 'combo-option';
      div.innerHTML = `<span>${eq.codigo}</span><span class="combo-option-sub">${eq.tipo}${eq.patente ? ' · ' + eq.patente : ''}</span>`;
      div.addEventListener('mousedown', e => {
        // Equipo nuevo → se re-elige la categoría a propósito.
        e.preventDefault(); setEquipo(eq); setCategoria(null); dropdown.classList.add('hidden');
      });
      dropdown.appendChild(div);
    });
  }

  // El botón de la flecha no debe robar el foco del input: si lo hace, se dispara
  // el `blur` del input (abajo) y su timer esconde el desplegable apenas se abre.
  // Este era el bug de desktop "no anda si el cursor está en el buscador".
  arrow.addEventListener('mousedown', e => e.preventDefault());

  // Selector de categoría (Repuestos / Mantenimiento).
  const catBox = $('equipo-cat');
  if (catBox) catBox.addEventListener('click', e => {
    const btn = e.target.closest('.cat-seg-btn');
    if (btn) setCategoria(btn.dataset.val);
  });

  arrow.addEventListener('click', e => {
    e.stopPropagation();
    if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); return; }
    buildOptions(equipos);
    if (dropdown.children.length) dropdown.classList.remove('hidden');
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) input.focus();
  });

  input.addEventListener('input', () => {
    // Al escribir se descarta la selección: sólo se asigna eligiendo del desplegable.
    selectedEquipo = null;
    const q = input.value.toLowerCase().trim();
    const filtered = q
      ? equipos.filter(x => x.codigo.toLowerCase().includes(q) ||
                            (x.tipo    || '').toLowerCase().includes(q) ||
                            (x.patente || '').toLowerCase().includes(q))
      : equipos;
    buildOptions(filtered);
    dropdown.classList.toggle('hidden', !dropdown.children.length);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.classList.add('hidden');
      // Si no quedó un equipo válido seleccionado, limpiar el texto suelto.
      if (!selectedEquipo) input.value = '';
    }, 150);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.combo-wrap')) dropdown.classList.add('hidden');
  });
}

// ---- Caché y autocompletado de proveedores ----
// CUIT (solo dígitos) con el que se cargó el proveedor actual desde la caché/base.
// Sirve para detectar un cambio de CUIT al guardar en la base (migración de key).
let _loadedProvCuit = null;

// Campos del proveedor que se persisten a la base + snapshot del último estado
// "conocido" (cargado, guardado o vacío) para detectar ediciones reales.
const PROV_FIELDS = ['proveedor', 'cuit-proveedor', 'nombre-proveedor',
                     'domicilio-proveedor', 'telefonos-proveedor', 'condicion-iva-proveedor'];
let _provSnapshot = {};
let _provDirtyWarned = false;   // el aviso "editaste datos" ya se mostró en esta edición

// Une la base maestra (/proveedores_base, prioritaria) con los proveedores
// vistos en OC (/proveedores). Excluye inactivos de las sugerencias.
async function buildProveedoresCache() {
  const [seen, base] = await Promise.all([
    getProveedores().catch(() => []),
    (typeof getProveedoresBase === 'function' ? getProveedoresBase() : Promise.resolve([])).catch(() => [])
  ]);
  const keyOf = p => {
    const d = (p.cuit || '').replace(/\D/g, '');
    return d.length >= 10 ? 'c' + d : 'n' + (p.nombre || '').toLowerCase();
  };
  // Identidad de un proveedor de la base: la key del nodo (`cuit_<dígitos>`), no el
  // campo `cuit`. Si una edición manual desalineó el campo respecto de la key, así
  // el registro sigue matcheando al proveedor visto y no se parte en dos.
  const baseKeyOf = p => {
    const kd = (p._key || '').replace(/\D/g, '');
    return kd.length >= 10 ? 'c' + kd : keyOf(p);
  };
  const byKey = new Map();
  seen.forEach(p => { if (p && p.nombre) byKey.set(keyOf(p), p); });
  base.forEach(p => {                          // la base pisa
    if (!(p && p.nombre && !p.inactivo)) return;
    const bk = baseKeyOf(p);
    byKey.set(bk, p);
    const ck = keyOf(p);                        // limpia el duplicado visto si el campo
    if (ck !== bk) byKey.delete(ck);            // cuit no coincide con la key del nodo
  });
  return [...byKey.values()];
}

async function loadProveedoresCache() {
  try {
    const lista = await buildProveedoresCache();
    sessionStorage.setItem('proveedores_cache', JSON.stringify(lista));
  } catch (e) {
    console.warn('loadProveedoresCache:', e);
  }
}

async function updateProveedoresCache() {
  try {
    const lista = await buildProveedoresCache();
    sessionStorage.setItem('proveedores_cache', JSON.stringify(lista));
  } catch (_) {}
}

// Normaliza razón social para comparar (quita S.A./S.R.L., puntuación, etc.)
function normalizeProvName(s) {
  return (s || '').toLowerCase()
    .replace(/\b(s\.a\.|s\.r\.l\.|s\.a\.s\.|s\.a|s\.r\.l|sa|srl|sas)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Similitud de nombres 0..1. 1 = idéntico; 0.9 = uno contiene al otro
// (con largo mínimo para evitar falsos por nombres genéricos cortos).
function provSimilarity(a, b) {
  const na = normalizeProvName(a), nb = normalizeProvName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if ((na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) >= 5) return 0.9;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (!wa.length || !wb.length) return 0;
  const overlap = wa.filter(w => wb.some(x => x.includes(w) || w.includes(x)));
  return overlap.length / Math.max(wa.length, wb.length);
}

// Mejor coincidencia por nombre en la caché (base + vistos). Umbral 0.9 para
// auto-aplicar y no arrastrar un proveedor equivocado.
function findProveedorByName(nombre) {
  if (!nombre) return null;
  let best = null, bestScore = 0;
  for (const p of getCachedProveedores()) {
    const s = provSimilarity(nombre, p.nombre);
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return bestScore >= 0.9 ? best : null;
}

// Aplica los datos de la base al formulario (la base tiene prioridad).
function applyProveedorBase(p) {
  if (p.nombre)       $('proveedor').value               = p.nombre;
  if (p.cuit)         $('cuit-proveedor').value          = p.cuit;   // completa CUIT faltante
  $('codigo-interno-proveedor').value = p.codigoInterno || '';
  if (p.domicilio)    $('domicilio-proveedor').value     = p.domicilio;
  if (p.telefonos)    $('telefonos-proveedor').value     = p.telefonos;
  if (p.condicionIVA) $('condicion-iva-proveedor').value = p.condicionIVA;
  if (p.condicionPago && !$('condicion-pago').value) $('condicion-pago').value = p.condicionPago;
  // Identidad canónica: la key del nodo si la conocemos, si no el campo cuit.
  _loadedProvCuit = ((p._key || p.cuit || '').replace(/\D/g, '')) || null;
  snapshotProvider();
}

// Cruza con la base: 1°) por CUIT (confiable), 2°) por nombre (presupuestos
// sin CUIT). Si ninguno coincide, queda como "no cargado". Devuelve true si matcheó.
async function enrichFromBase(opts = {}) {
  if (typeof getProveedorBaseByCuit !== 'function') return false;
  const { notify = false, byName = true, quietMissing = false } = opts;
  const cuit   = $('cuit-proveedor').value.trim();
  const nombre = $('proveedor').value.trim();

  let p = null, via = '';
  if (cuit.replace(/\D/g, '').length >= 10) {
    try { p = await getProveedorBaseByCuit(cuit); } catch (_) {}
    if (p) via = 'cuit';
  }
  // El fallback por nombre solo se usa al importar (extracción): al editar el CUIT
  // a mano no debe pisar los datos con el proveedor viejo que matchea por nombre.
  if (!p && byName) {
    p = findProveedorByName(nombre);
    if (p) via = 'nombre';
  }

  if (!p) {
    if (notify && !quietMissing) toast('Proveedor no está en la base — sin código interno.', 'warning');
    return false;
  }

  applyProveedorBase(p);
  if (notify) {
    if (via === 'cuit')
      toast('Proveedor en base — código ' + (p.codigoInterno || '—') + '.', 'success');
    else
      toast('Coincidencia por nombre: ' + (p.nombre || '') + ' (código ' + (p.codigoInterno || '—') + '). Verificá que sea correcto.', 'warning');
  }
  return true;
}

function getCachedProveedores() {
  try { return JSON.parse(sessionStorage.getItem('proveedores_cache') || '[]'); }
  catch { return []; }
}

function setupProveedorCombo() {
  const input    = $('proveedor');
  const dropdown = $('proveedor-dropdown');

  function fillProveedor(p) {
    $('proveedor').value                = p.nombre          || '';
    $('cuit-proveedor').value           = p.cuit            || '';
    $('nombre-proveedor').value         = p.nombre_contacto || '';
    $('codigo-interno-proveedor').value = p.codigoInterno   || '';
    $('domicilio-proveedor').value      = p.domicilio       || '';
    $('telefonos-proveedor').value      = p.telefonos       || '';
    $('condicion-iva-proveedor').value  = p.condicionIVA    || '';
    if (p.condicionPago) $('condicion-pago').value = p.condicionPago;
    _loadedProvCuit = ((p._key || p.cuit || '').replace(/\D/g, '')) || null;
    snapshotProvider();
  }

  function buildOptions(query) {
    dropdown.innerHTML = '';
    const q = (query || '').toLowerCase().trim();
    if (!q) { dropdown.classList.add('hidden'); return; }

    const matches = getCachedProveedores()
      .filter(p => p.nombre.toLowerCase().includes(q) || (p.cuit || '').includes(q))
      .slice(0, 5);

    if (!matches.length) { dropdown.classList.add('hidden'); return; }

    matches.forEach(p => {
      const div = document.createElement('div');
      div.className = 'combo-option';
      div.innerHTML = `<span>${p.nombre}</span>${p.cuit ? `<span class="combo-option-sub">${p.cuit}</span>` : ''}`;
      div.addEventListener('mousedown', e => {
        e.preventDefault();
        fillProveedor(p);
        dropdown.classList.add('hidden');
      });
      dropdown.appendChild(div);
    });
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('input', () => buildOptions(input.value));
  input.addEventListener('blur',  () => setTimeout(() => dropdown.classList.add('hidden'), 150));
  document.addEventListener('click', e => {
    if (!e.target.closest('#proveedor-wrap')) dropdown.classList.add('hidden');
  });

  // Al tipear/pegar un CUIT, buscarlo en la base maestra (prioridad de base)
  $('cuit-proveedor').addEventListener('change', () => enrichFromBase({ notify: true, byName: false, quietMissing: true }));

  // Guardar/corregir el proveedor en la base maestra desde la app.
  const btnSave = $('btn-save-proveedor-base');
  if (btnSave) {
    btnSave.innerHTML = icSvg('checkSm') + 'Guardar<span class="oc-hd-l">&nbsp;en base</span>';
    btnSave.addEventListener('click', saveProveedorToBase);
    // El botón aparece solo cuando los datos difieren del snapshot (proveedor
    // cargado/guardado/vacío). Elegir uno del listado toma un snapshot nuevo, así
    // que no cuenta como edición. Tipear en Razón Social (que es la caja de
    // búsqueda) no lo muestra mientras el desplegable está abierto.
    PROV_FIELDS.forEach(id => $(id).addEventListener('input', refreshSaveProvBtn));
    $('proveedor').addEventListener('blur', () => setTimeout(refreshSaveProvBtn, 200));
    snapshotProvider();   // estado inicial (form vacío) = limpio
  }
}

// Fija el estado actual del proveedor como "limpio" (sin cambios pendientes).
function snapshotProvider() {
  _provSnapshot = {};
  PROV_FIELDS.forEach(id => { _provSnapshot[id] = ($(id).value || '').trim(); });
  _provDirtyWarned = false;
  hideSaveProvBtn();
  provFicha = !!_loadedProvCuit;
  pintarProvFicha();
  pintarCondChips();
}

// ¿Cambió algún dato del proveedor respecto del snapshot?
function provIsDirty() {
  return PROV_FIELDS.some(id => ($(id).value || '').trim() !== (_provSnapshot[id] || ''));
}

// Muestra el botón solo si hay cambios reales y no se está buscando en el desplegable.
// Si editaste un proveedor que ya venías usando, avisa (una vez) que la OC saldrá
// con lo cargado y que la base no se toca — sin forzar ninguna recarga.
function refreshSaveProvBtn() {
  const b = $('btn-save-proveedor-base');
  if (!b) return;
  const buscando = !$('proveedor-dropdown').classList.contains('hidden');
  const dirty    = provIsDirty();
  b.classList.toggle('hidden', buscando || !dirty);
  if (!dirty) { _provDirtyWarned = false; return; }
  // Solo avisa si había un proveedor cargado (snapshot con razón social), no al
  // tipear un proveedor nuevo desde cero.
  if (!buscando && !_provDirtyWarned && _provSnapshot['proveedor']) {
    _provDirtyWarned = true;
    toast('Editaste los datos del proveedor. La OC saldrá con lo que cargaste; la base no se modifica. Usá "Guardar en base" si querés actualizarla.', 'warning');
  }
}

// Oculta el botón "Guardar en base".
function hideSaveProvBtn() {
  const b = $('btn-save-proveedor-base');
  if (b) b.classList.add('hidden');
}

// Formatea 11 dígitos como XX-XXXXXXXX-X (para mostrar en el aviso).
function _fmtCuit(dig) {
  const d = (dig || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (dig || '');
}

// Guarda/corrige el proveedor del formulario en la base maestra (/proveedores_base),
// con confirmación. Si el CUIT cambió respecto del proveedor cargado, migra la key:
// crea el nodo bajo la key nueva (cuit_<dígitos>) y borra el viejo.
async function saveProveedorToBase() {
  if (typeof saveProveedorBase !== 'function') { toast('No disponible sin conexión.', 'error'); return; }

  const nombre  = $('proveedor').value.trim();
  const cuitRaw = $('cuit-proveedor').value.trim();
  const dig     = cuitRaw.replace(/\D/g, '');

  if (!nombre)         { toast('Falta la razón social.', 'error'); revealAndFocus('proveedor'); return; }
  if (dig.length !== 11) { toast('CUIT inválido (deben ser 11 dígitos): no se puede guardar en la base.', 'error'); revealAndFocus('cuit-proveedor'); return; }

  const newKey = 'cuit_' + dig;
  const oldDig = (_loadedProvCuit && _loadedProvCuit !== dig) ? _loadedProvCuit : null;

  const [existing, oldNode] = await Promise.all([
    getProveedorBaseByCuit(cuitRaw).catch(() => null),
    oldDig ? getProveedorBaseByCuit(oldDig).catch(() => null) : Promise.resolve(null)
  ]);
  const migrating = !!(oldDig && oldNode);

  const record = {
    nombre,
    cuit:          cuitRaw,
    codigoInterno: $('codigo-interno-proveedor').value.trim(),
    domicilio:     $('domicilio-proveedor').value.trim(),
    telefonos:     $('telefonos-proveedor').value.trim(),
    condicionIVA:  $('condicion-iva-proveedor').value.trim()
  };
  const contacto = $('nombre-proveedor').value.trim();
  if (contacto) record.nombre_contacto = contacto;
  const cpago = $('condicion-pago').value.trim();
  if (cpago) record.condicionPago = cpago;

  // Preservar campos que el formulario no edita (localidad, provincia, cp, inactivo).
  const prev = migrating ? oldNode : (existing || {});
  ['localidad', 'provincia', 'cp'].forEach(f => { if (prev[f]) record[f] = prev[f]; });
  if (prev.inactivo) record.inactivo = prev.inactivo;

  let msg;
  if (migrating)     msg = `Vas a cambiar el CUIT de "${nombre}".\nSe moverá el registro de ${_fmtCuit(oldDig)} a ${cuitRaw} en la base de proveedores.`;
  else if (existing) msg = `Vas a actualizar los datos de "${nombre}" (CUIT ${cuitRaw}) en la base de proveedores.`;
  else               msg = `Vas a agregar "${nombre}" (CUIT ${cuitRaw}) a la base de proveedores.`;

  if (!await showConfirm('Guardar proveedor en la base', msg, { boton: 'Guardar', tono: 'ok', icono: 'checkSm' })) return;

  try {
    await saveProveedorBase(newKey, record);
    if (migrating) {
      try { await deleteProveedorBase('cuit_' + oldDig); } catch (_) {}
      if (typeof deleteProveedorSeen === 'function') { try { await deleteProveedorSeen('cuit_' + oldDig); } catch (_) {} }
    }
    _loadedProvCuit = dig;
    snapshotProvider();
    await updateProveedoresCache();
    toast(migrating ? 'Proveedor guardado y CUIT migrado en la base.' : 'Proveedor guardado en la base.', 'success');
  } catch (e) {
    console.warn('saveProveedorToBase:', e);
    toast('No se pudo guardar en la base. Reintentá.', 'error');
  }
}

// ---- Acordeón de secciones (solo mobile) ----
let _ocSections   = [];
let _ocWasMobile  = null;

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function setupOCAccordion() {
  _ocSections = [...document.querySelectorAll('.oc-section')];
  _ocSections.forEach(sec => {
    const header = sec.querySelector('.card-header');
    const title  = sec.querySelector('.card-title');
    if (title && !header.querySelector('.oc-st')) {
      const st = document.createElement('span');
      st.className = 'oc-st';
      title.after(st);
    }
    if (title && !header.querySelector('.oc-chevron')) {
      const chev = document.createElement('span');
      chev.className = 'oc-chevron';
      chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      header.appendChild(chev);
    }
    if (!header.querySelector('.oc-sum')) {
      const sum = document.createElement('div');
      sum.className = 'oc-sum';
      header.appendChild(sum);
    }
    header.addEventListener('click', e => {
      if (!isMobileViewport()) return;
      if (e.target.closest('button, input, a, label')) return; // no togglear con controles
      if (sec.classList.contains('collapsed')) openOCSection(sec);
      else { sec.classList.add('collapsed'); updateOCSummaries(); }
    });
  });
  // Los combos y la IA cargan valores sin disparar `input`: el click y el
  // recálculo de totales también refrescan el resumen.
  ['input', 'change', 'click'].forEach(ev =>
    document.querySelector('.app-main').addEventListener(ev, updateOCSummaries));
  applyOCViewport();
  updateOCSummaries();
  window.addEventListener('resize', applyOCViewport);
}

// Acordeón: abre la indicada y cierra las demás.
function openOCSection(sec) {
  _ocSections.forEach(s => s.classList.add('collapsed'));
  sec.classList.remove('collapsed');
  updateOCSummaries();
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Resumen de las secciones cerradas (mobile) ----
// Debajo del título de cada sección colapsada: lo cargado en una línea y, en
// rojo, los obligatorios que faltan. Así no hace falta abrirlas para revisar.
function ocSectionSummary(i) {
  const v   = id => $(id).value.trim();
  const cur = monedaUSD ? 'US$ ' : '$ ';
  switch (i) {
    case 0:
      return { txt: selectedFile ? selectedFile.name : '', falta: [] };
    case 1: {
      const falta = [];
      if (!v('obra')) falta.push('obra');
      if (rubrosDeObraActual().length && !selectedRubro) falta.push('rubro');
      if (!v('condicion-pago')) falta.push('cond. de pago');
      if (selectedEquipo && !selectedCategoria) falta.push('categoría');
      return { txt: [v('obra'), selectedRubro?.nombre, v('condicion-pago'), selectedEquipo?.codigo].filter(Boolean).join(' · '), falta };
    }
    case 2: {
      const falta = [];
      if (!v('proveedor')) falta.push('razón social');
      if (!v('cuit-proveedor')) falta.push('CUIT');
      return { txt: [v('proveedor'), v('cuit-proveedor')].filter(Boolean).join(' · '), falta };
    }
    case 3: {
      const falta = [];
      if (!items.length) falta.push('ítems');
      else if (items.some(it => !String(it.descripcion || '').trim())) falta.push('descripción de ítems');
      const txt = items.length
        ? `${items.length} ${items.length === 1 ? 'ítem' : 'ítems'} · ${cur}${fmtMoneyDisplay(calcSubtotal())}`
        : '';
      return { txt, falta };
    }
    case 4:
      return { txt: items.length ? `Total ${cur}${fmtMoneyDisplay(calcTotal())}` : '', falta: [] };
  }
  return { txt: '', falta: [] };
}

let _ocSumRaf = 0;
function updateOCSummaries() {
  cancelAnimationFrame(_ocSumRaf);
  _ocSumRaf = requestAnimationFrame(() => {
    _ocSections.forEach((sec, i) => {
      const el = sec.querySelector('.oc-sum');
      if (!el) return;
      const { txt, falta } = ocSectionSummary(i);
      // Con un solo dato faltante lo dice la pastilla; con varios, el detalle va abajo.
      el.innerHTML = (txt ? `<span class="oc-sum-t">${esc(txt)}</span>` : '')
        + (falta.length > 1 ? `<span class="oc-sum-f">Falta: ${esc(falta.join(', '))}</span>` : '');
      const st = sec.querySelector('.oc-st');
      if (st) {
        const [cls, t] = i === 0 ? ['opc', 'Opcional']
          : falta.length === 1 ? ['falta', 'Falta ' + falta[0]]
          : falta.length ? ['falta', `Faltan ${falta.length}`]
          : txt ? ['ok', 'Listo'] : ['', ''];
        st.className = 'oc-st' + (cls ? ' oc-st--' + cls : '');
        st.innerHTML = cls === 'ok' ? icSvg('checkSm') + t : esc(t);
      }
      sec.classList.toggle('oc-incompleta', falta.length > 0);
      sec.classList.toggle('oc-completa', !falta.length && !!txt && i > 0);
    });
    updateOCDock();
    pintarCheck();
    pintarProvFicha();
    syncSegs();
    desmarcarCompletos();
    programarBorrador();
  });
}

// Re-aplica el estado solo al cruzar el breakpoint (no en cada resize de mobile).
function applyOCViewport() {
  const m = isMobileViewport();
  if (m === _ocWasMobile) return;
  _ocWasMobile = m;
  if (m) _ocSections.forEach((s, i) => s.classList.toggle('collapsed', i !== 0));
  else   _ocSections.forEach(s => s.classList.remove('collapsed'));
}

// Abre la sección que contiene un campo y lo enfoca (para la validación).
function revealAndFocus(id) {
  const el = $(id);
  if (!el) return;
  if (el.closest('.prov-dato') && provFichaVisible()) { provFicha = false; pintarProvFicha(); }
  const sec = el.closest('.oc-section');
  if (sec && isMobileViewport() && sec.classList.contains('collapsed')) openOCSection(sec);
  el.focus();
}

// ---- Import buttons ----
function setupImportButtons() {
  const fileInput   = $('file-input');
  const cameraInput = $('camera-input');
  const btnUpload   = $('btn-upload-file');
  const btnCamera   = $('btn-camera');

  if ('ontouchstart' in window || window.innerWidth <= 768) {
    btnCamera.style.display = '';
  }

  btnUpload.addEventListener('click', () => fileInput.click());
  btnCamera.addEventListener('click', () => cameraInput.click());

  fileInput.addEventListener('change',   () => { if (fileInput.files[0])   handleFileSelected(fileInput.files[0]); });
  cameraInput.addEventListener('change', () => { if (cameraInput.files[0]) handleFileSelected(cameraInput.files[0]); });

  // Drag & drop (desktop)
  const dropZone = $('drop-zone');
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });
}

function handleFileSelected(file) {
  const ok = /\.(jpg|jpeg|png|webp|pdf)$/i.test(file.name) ||
    ['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type);
  if (!ok) { toast('Formato no soportado. Usá JPG, PNG, PDF o WEBP.', 'error'); return; }
  selectedFile = file;
  const nameEl = $('upload-filename');
  $('upload-filename-txt').textContent = `${file.name} (${formatBytes(file.size)})`;
  nameEl.classList.remove('hidden');
  $('btn-extract').disabled = false;
  clearExtractStatus();
  borradorArchivo(file);
}

function clearFile() {
  selectedFile = null;
  $('file-input').value   = '';
  $('camera-input').value = '';
  $('upload-filename').classList.add('hidden');
  $('btn-extract').disabled = true;
  clearExtractStatus();
  borradorArchivo(null);
}

// ---- Gemini extraction ----
function applyExtractionResult(r) {
  fillIfEmpty('proveedor',               r.proveedor);
  fillIfEmpty('cuit-proveedor',          r.cuit_proveedor);
  fillIfEmpty('domicilio-proveedor',     r.domicilio_proveedor);
  fillIfEmpty('telefonos-proveedor',     r.telefonos_proveedor);
  fillIfEmpty('condicion-iva-proveedor', r.condicion_iva_proveedor);
  fillIfEmpty('ref-presupuesto',         r.ref_presupuesto);
  fillIfEmpty('condicion-pago',          r.condicion_pago);
  // La ubicación que saca la IA del presupuesto es texto libre: sólo sirve si
  // coincide con una obra del padrón. Si no, el campo queda para elegir a mano.
  if (!$('obra').value.trim() && r.ubicacion) setObraValue(r.ubicacion);
  fillIfEmpty('plazo-entrega',           r.plazo_entrega);
  fillIfEmpty('lugar-entrega',           r.lugar_entrega);

  if (r.items?.length) {
    items = r.items.map(normalizeItem);
    renderTable();
  }

  if (r.descuento) {
    if (r.descuento.porcentaje > 0) {
      descuento = { pct: r.descuento.porcentaje, monto: 0 };
      $('pct-descuento').value   = String(r.descuento.porcentaje);
      $('monto-descuento').value = fmtMoneyDisplay(0);
    } else if (r.descuento.monto > 0) {
      descuento = { pct: null, monto: r.descuento.monto };
      $('pct-descuento').value   = '';
      $('monto-descuento').value = fmtMoneyDisplay(r.descuento.monto);
    }
  }

  if (r.noGravado?.monto > 0) {
    noGravado = { pct: null, monto: r.noGravado.monto };
    $('pct-nogravado').value   = '';
    $('monto-nogravado').value = fmtMoneyDisplay(r.noGravado.monto);
  }

  if (r.impuestos?.length) {
    impuestos = r.impuestos.map(imp => ({
      nombre: imp.nombre,
      pct:    imp.porcentaje || null,
      monto:  imp.monto
    }));
    renderImpuestos();
  }

  recalcTotales();

  const { issues, rowWarn } = verificarExtraccion(r);
  if (issues.length) {
    verifRowWarnings = rowWarn;
    renderTable();
    showVerifBanner(issues);
  }

  // Sugerir toggle IVA si Gemini detectó precios con IVA incluido,
  // o si el subtotal calculado es ~21% mayor al declarado en el documento
  if (!ivaActive) {
    const sugerirIva = r.precios_incluyen_iva === true ||
      (r.subtotal_documento && (() => {
        const ratio = roundCents(calcSubtotal()) / r.subtotal_documento;
        return ratio > 1.17 && ratio < 1.25;
      })());
    if (sugerirIva) {
      toast('Los precios podrían incluir IVA — revisá el toggle "Precios con IVA incluido".', 'warning');
    }
  }

  return issues;
}

async function handleExtract() {
  if (!selectedFile) return;
  setExtractStatus('loading', 'Analizando documento con IA…');
  $('btn-extract').disabled = true;

  try {
    const r = await extractFromFile(selectedFile);
    applyExtractionResult(r);
    await enrichFromBase({ notify: true });   // la base maestra tiene prioridad
    const impMsg = impuestos.length ? ` y ${impuestos.length} impuesto(s)` : '';
    if (r.items?.length) {
      setExtractStatus('success', `${icSvg('checkSm')} Se extrajeron ${r.items.length} ítem(s)${impMsg}.`);
      toast(`IA extrajo ${r.items.length} ítem(s)${impMsg}.`, 'success');
    } else {
      setExtractStatus('success', `${icSvg('checkSm')} Datos del proveedor completados. No se detectaron ítems.`);
      toast('Datos extraídos. No se detectaron ítems — podés agregarlos manualmente.', 'warning');
    }
  } catch (err) {
    setExtractStatus('error', `Error: ${err.message}`);
    toast(err.message, 'error');
    $('btn-extract').disabled = false;
  }
}

function fillIfEmpty(id, value) {
  const el = $(id);
  if (el && value && !el.value.trim()) el.value = value;
}
function setExtractStatus(type, text) {
  const el = $('extract-status');
  el.className = `extract-status ${type}`;
  el.classList.remove('hidden');
  el.innerHTML = type === 'loading'
    ? `<div class="spinner"></div><span>${text}</span>`
    : text;
}
function clearExtractStatus() {
  const el = $('extract-status');
  el.className = 'extract-status hidden';
  el.textContent = '';
}

// ---- Verificación post-extracción ----
function verificarExtraccion(r) {
  const issues  = [];
  const rowWarn = {};

  items.forEach((it, idx) => {
    if (!it.total_documento) return;
    const calc = roundCents((it.cantidad || 0) * (it.precio_unitario || 0));
    const diff = Math.abs(calc - it.total_documento);
    if (diff / it.total_documento > 0.005) {
      const desc = it.descripcion.length > 28 ? it.descripcion.substring(0, 26) + '…' : it.descripcion;
      issues.push(`Ítem ${idx + 1} "${desc}": calculado ${fmtMoneyDisplay(calc)} ≠ documento ${fmtMoneyDisplay(it.total_documento)}`);
      rowWarn[idx] = true;
    }
  });

  if (r.subtotal_documento) {
    const calc = roundCents(calcSubtotal());
    const diff = Math.abs(calc - r.subtotal_documento);
    if (diff / r.subtotal_documento > 0.005) {
      issues.push(`Subtotal: calculado ${fmtMoneyDisplay(calc)} ≠ documento ${fmtMoneyDisplay(r.subtotal_documento)}`);
    }
  }

  impuestos.forEach(imp => {
    if (!imp.pct || !imp.monto) return;
    const calc = roundCents(calcGravado() * imp.pct / 100);
    const diff = Math.abs(calc - imp.monto);
    if (diff / imp.monto > 0.01) {
      issues.push(`${imp.nombre}: calculado ${fmtMoneyDisplay(calc)} ≠ documento ${fmtMoneyDisplay(imp.monto)}`);
    }
  });

  if (r.total_documento) {
    const calc = roundCents(calcTotal());
    const diff = Math.abs(calc - r.total_documento);
    if (diff / r.total_documento > 0.005) {
      issues.push(`Total: calculado ${fmtMoneyDisplay(calc)} ≠ documento ${fmtMoneyDisplay(r.total_documento)}`);
    }
  }

  return { issues, rowWarn };
}

function showVerifBanner(issues) {
  $('verif-banner-list').innerHTML = issues.map(i => `<li>${i}</li>`).join('');
  $('verif-banner').classList.remove('hidden');
}

function hideVerifBanner() {
  $('verif-banner').classList.add('hidden');
  verifRowWarnings = {};
  renderTable();
}

// ---- Items table ----
function normalizeItem(it) {
  return {
    descripcion:     String(it.descripcion || '').trim(),
    unidad:          String(it.unidad || 'u').trim(),
    cantidad:        parseFloat(it.cantidad) || 0,
    precio_unitario: parseFloat(it.precio_unitario) || 0,
    total_documento: parseFloat(it.total_documento) || 0
  };
}

function calcSubtotal() {
  return items.reduce((s, it) =>
    s + (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0), 0);
}

function calcGravado() {
  return roundCents(Math.max(0,
    calcSubtotal() - roundCents(descuento.monto || 0) - roundCents(noGravado.monto || 0)
  ));
}

function calcTotal() {
  const sumImp = impuestos.reduce((s, imp) => s + (imp.monto || 0), 0);
  return roundCents(calcGravado() + sumImp);
}

function renderTable() {
  if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
    renderTableMobile();
  } else {
    renderTableDesktop();
  }
}

function renderTableDesktop() {
  const tbody = $('items-tbody');
  const empty = $('empty-state');
  $('items-cards').style.display = 'none';
  tbody.innerHTML = '';

  if (!items.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  items.forEach((item, idx) => {
    const sub = (parseFloat(item.cantidad) || 0) * (parseFloat(item.precio_unitario) || 0);
    const tr  = document.createElement('tr');
    tr.dataset.idx = idx;
    if (verifRowWarnings[idx]) tr.classList.add('item-row-warn');
    tr.innerHTML = `
      <td class="col-num text-center">${idx + 1}</td>
      <td class="col-desc">
        <input type="text" value="${esc(item.descripcion)}" placeholder="Descripción" data-field="descripcion">
      </td>
      <td class="col-unit">
        <input type="text" value="${esc(item.unidad)}" placeholder="u" data-field="unidad" style="text-align:center">
      </td>
      <td class="col-qty">
        <input type="text" value="${fmtInput(item.cantidad)}" data-field="cantidad" class="text-right num-input">
      </td>
      <td class="col-price">
        <input type="text" value="${fmtInput(item.precio_unitario)}" data-field="precio_unitario" class="text-right num-input">
      </td>
      <td class="col-subtotal text-right">${fmtMoneyDisplay(sub)}</td>
      <td class="col-actions text-center">
        <button class="btn btn-icon btn-danger btn-sm btn-del" title="Eliminar">${icSvg('x')}</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', onItemInput);
    input.addEventListener('focus', onNumFocus);
    input.addEventListener('blur',  onNumBlur);
  });
  tbody.querySelectorAll('.btn-del').forEach(btn =>
    btn.addEventListener('click', () => {
      items.splice(parseInt(btn.closest('tr').dataset.idx, 10), 1);
      renderTable();
      recalcTotales();
    })
  );
}

function renderTableMobile() {
  const container = $('items-cards');
  const empty     = $('empty-state');
  $('items-tbody').innerHTML = '';
  container.innerHTML = '';

  if (!items.length) {
    container.style.display = 'none';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  container.style.display = 'block';

  items.forEach((item, idx) => {
    const sub  = (parseFloat(item.cantidad) || 0) * (parseFloat(item.precio_unitario) || 0);
    const card = document.createElement('div');
    card.className   = verifRowWarnings[idx] ? 'item-card item-row-warn' : 'item-card';
    card.dataset.idx = idx;
    card.innerHTML = `
      <div class="item-card-r1">
        <input type="text" class="item-card-desc" value="${esc(item.descripcion)}" placeholder="Descripción del ítem...">
        <button class="btn btn-icon btn-danger btn-sm btn-del" title="Eliminar">${icSvg('x')}</button>
      </div>
      <div class="item-card-fields">
        <div class="item-card-col item-card-col--unit">
          <span class="item-card-lbl">Unidad</span>
          <input type="text" class="item-card-unit" value="${esc(item.unidad)}">
        </div>
        <div class="item-card-col item-card-col--qty">
          <span class="item-card-lbl">Cantidad</span>
          <input type="text" class="item-card-qty num-input" value="${fmtInput(item.cantidad)}">
        </div>
        <div class="item-card-col item-card-col--price">
          <span class="item-card-lbl">P.Unit</span>
          <input type="text" class="item-card-price num-input" value="${fmtInput(item.precio_unitario)}">
        </div>
      </div>
      <div class="item-card-r3">
        <span class="item-card-total-lbl">Total</span>
        <span class="item-card-total-val">${fmtMoneyDisplay(sub)}</span>
      </div>`;
    container.appendChild(card);

    const totalVal   = card.querySelector('.item-card-total-val');
    const qtyInput   = card.querySelector('.item-card-qty');
    const priceInput = card.querySelector('.item-card-price');

    function updateCardTotal() {
      const s = (parseFloat(items[idx].cantidad) || 0) * (parseFloat(items[idx].precio_unitario) || 0);
      totalVal.textContent = fmtMoneyDisplay(s);
      recalcTotales();
    }

    card.querySelector('.item-card-desc').addEventListener('input', e => {
      items[idx].descripcion = e.target.value;
    });
    card.querySelector('.item-card-unit').addEventListener('input', e => {
      items[idx].unidad = e.target.value;
    });

    qtyInput.addEventListener('input', e => {
      items[idx].cantidad = parseArgFloat(e.target.value);
      updateCardTotal();
    });
    qtyInput.addEventListener('focus', onNumFocus);
    qtyInput.addEventListener('blur', e => {
      if (e.target.value.trim() === '') { items[idx].cantidad = 0; e.target.value = '0'; updateCardTotal(); }
    });

    priceInput.addEventListener('input', e => {
      items[idx].precio_unitario = parseArgFloat(e.target.value);
      if (ivaActive) delete items[idx]._precio_original;
      updateCardTotal();
    });
    priceInput.addEventListener('focus', onNumFocus);
    priceInput.addEventListener('blur', e => {
      if (e.target.value.trim() === '') { items[idx].precio_unitario = 0; e.target.value = '0'; updateCardTotal(); }
    });

    card.querySelector('.btn-del').addEventListener('click', () => {
      items.splice(parseInt(card.dataset.idx, 10), 1);
      renderTable();
      recalcTotales();
    });
  });
}

function onItemInput(e) {
  const input = e.target;
  const tr    = input.closest('tr');
  const idx   = parseInt(tr.dataset.idx, 10);
  const field = input.dataset.field;
  if (field === 'cantidad' || field === 'precio_unitario') {
    items[idx][field] = parseArgFloat(input.value);
    if (ivaActive && field === 'precio_unitario') delete items[idx]._precio_original;
    const sub = (parseFloat(items[idx].cantidad) || 0) * (parseFloat(items[idx].precio_unitario) || 0);
    tr.querySelector('.col-subtotal').textContent = fmtMoneyDisplay(sub);
    recalcTotales();
  } else {
    items[idx][field] = input.value;
  }
}

function onNumFocus(e) {
  const input = e.target;
  if (!input.classList.contains('num-input')) return;
  if (parseArgFloat(input.value) === 0) input.value = '';
  input.select();
}

function onNumBlur(e) {
  const input = e.target;
  if (!input.classList.contains('num-input')) return;
  const tr = input.closest('tr');
  if (!tr?.dataset?.idx) return;
  if (input.value.trim() !== '') return;
  const idx   = parseInt(tr.dataset.idx, 10);
  const field = input.dataset.field;
  items[idx][field] = 0;
  input.value = '0';
  const sub = (parseFloat(items[idx].cantidad) || 0) * (parseFloat(items[idx].precio_unitario) || 0);
  tr.querySelector('.col-subtotal').textContent = fmtMoneyDisplay(sub);
  recalcTotales();
}

function addEmptyRow() {
  items.push({ descripcion: '', unidad: 'u', cantidad: 1, precio_unitario: 0 });
  renderTable();
  recalcTotales();
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  const inputs = isMobile
    ? $('items-cards').querySelectorAll('.item-card-desc')
    : $('items-tbody').querySelectorAll('input[data-field="descripcion"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

// ---- Totales ----
function roundCents(n) { return Math.round(n * 100) / 100; }

function recalcTotales() {
  const subtotal = calcSubtotal();
  const gravado  = calcGravado();

  $('val-subtotal').textContent = fmtMoneyDisplay(subtotal);

  if (descuento.pct != null && descuento.pct > 0) {
    descuento.monto = roundCents(subtotal * descuento.pct / 100);
    $('monto-descuento').value = fmtMoneyDisplay(descuento.monto);
  }
  if (noGravado.pct != null && noGravado.pct > 0) {
    noGravado.monto = roundCents(subtotal * noGravado.pct / 100);
    $('monto-nogravado').value = fmtMoneyDisplay(noGravado.monto);
  }

  $('val-gravado').textContent = fmtMoneyDisplay(gravado);

  const rows = $('impuestos-tbody').querySelectorAll('tr[data-idx]');
  impuestos.forEach((imp, idx) => {
    if (imp.pct != null && imp.pct > 0) {
      imp.monto = roundCents(gravado * imp.pct / 100);
      const montoInput = rows[idx]?.querySelector('.imp-monto');
      if (montoInput) montoInput.value = fmtMoneyDisplay(imp.monto);
    }
  });

  $('imp-total-value').textContent = fmtMoneyDisplay(calcTotal());
  updateOCSummaries();
}

// ---- Barra fija inferior (mobile): total + Vista previa + Generar ----
// Se esconde cuando la barra de generar del final ya está a la vista (no
// duplicar botones) y mientras se escribe (el teclado la empujaría encima).
let _dockBarVisible = false, _dockTyping = false;
function setupOCDock() {
  $('oc-dock-preview').addEventListener('click', () => $('btn-preview').click());
  $('oc-dock-generate').addEventListener('click', () => $('btn-generate').click());
  // Tocar el estado muestra lo que falta (lo mismo que Generar con datos incompletos).
  $('oc-dock-estado').addEventListener('click', () => {
    const faltan = faltantesOC();
    if (faltan.length) { marcarFaltantes(faltan); mostrarFaltantes(faltan); }
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { _dockBarVisible = e.isIntersecting; updateOCDock(); })
      .observe(document.querySelector('.generate-bar'));
  }
  const main = document.querySelector('.app-main');
  main.addEventListener('focusin', e => {
    if (e.target.matches('input, textarea, select')) { _dockTyping = true; updateOCDock(); }
  });
  main.addEventListener('focusout', () => { _dockTyping = false; updateOCDock(); });
  updateOCDock();
}

// Refresca el total del hero y de la barra fija.
function updateOCDock() {
  const dock = $('oc-dock');
  if (!dock) return;
  const total = (monedaUSD ? 'US$ ' : '$ ') + fmtMoneyDisplay(calcTotal());
  const cnt   = items.length ? `${items.length} ${items.length === 1 ? 'ítem' : 'ítems'}` : 'Sin ítems';
  $('oc-hero-total').textContent = total;
  $('oc-hero-sub').textContent = items.length
    ? [cnt, $('proveedor').value.trim(), $('obra').value.trim()].filter(Boolean).join(' · ')
    : 'Sin ítems todavía';
  $('oc-dock-total').textContent = total;
  // Avance: los tres pasos obligatorios (datos, proveedor, ítems) sin faltantes.
  const faltan = faltantesOC();
  const pasosConFalta = new Set(faltan.map(f => SECCION_FALTA[f.id])).size;
  const lista = !faltan.length;
  $('oc-dock-prog').style.width = `${Math.round((3 - pasosConFalta) / 3 * 100)}%`;
  $('oc-dock-cnt').innerHTML = lista
    ? `<b class="ok">Lista para generar</b> · ${cnt}`
    : `<b>${faltan.length === 1 ? 'Falta 1 dato' : `Faltan ${faltan.length} datos`}</b> · ${3 - pasosConFalta} de 3 pasos`;
  dock.classList.toggle('oc-dock--lista', lista);
  $('oc-dock-generate').disabled = $('btn-generate').disabled;
  dock.classList.toggle('oc-dock--off', _dockBarVisible || _dockTyping);
}

function renderImpuestos() {
  const tbody = $('impuestos-tbody');
  tbody.innerHTML = '';

  impuestos.forEach((imp, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;
    tr.innerHTML = `
      <td>
        <input type="text" class="imp-nombre" value="${esc(imp.nombre)}" placeholder="Concepto (ej: I.V.A. 21%)">
      </td>
      <td>
        <input type="text" class="text-right imp-pct" value="${imp.pct != null ? imp.pct : ''}" placeholder="">
      </td>
      <td class="text-right">
        <input type="text" class="text-right num-input imp-monto" value="${fmtMoneyDisplay(imp.monto)}" placeholder="0,00">
      </td>
      <td class="text-center">
        <button class="btn btn-icon btn-danger btn-sm btn-del-imp" title="Eliminar">${icSvg('x')}</button>
      </td>`;
    tbody.appendChild(tr);

    tr.querySelector('.imp-nombre').addEventListener('input', e => { impuestos[idx].nombre = e.target.value; });

    tr.querySelector('.imp-pct').addEventListener('input', e => {
      const v = parseArgFloat(e.target.value);
      if (v > 0) {
        impuestos[idx].pct   = v;
        impuestos[idx].monto = roundCents(calcGravado() * v / 100);
        tr.querySelector('.imp-monto').value = fmtMoneyDisplay(impuestos[idx].monto);
      } else {
        impuestos[idx].pct = null;
      }
      recalcTotales();
    });

    tr.querySelector('.imp-monto').addEventListener('input', e => {
      impuestos[idx].monto = parseArgFloat(e.target.value);
      impuestos[idx].pct   = null;
      tr.querySelector('.imp-pct').value = '';
      recalcTotales();
    });
    tr.querySelector('.imp-monto').addEventListener('focus', onNumFocus);
    tr.querySelector('.imp-monto').addEventListener('blur', e => {
      if (e.target.value.trim() === '') {
        impuestos[idx].monto = 0;
        e.target.value = fmtMoneyDisplay(0);
        recalcTotales();
      }
    });

    tr.querySelector('.btn-del-imp').addEventListener('click', () => {
      impuestos.splice(idx, 1);
      renderImpuestos();
      recalcTotales();
    });
  });
}

function addImpuestoRow() {
  impuestos.push({ nombre: '', pct: null, monto: 0 });
  renderImpuestos();
  recalcTotales();
  const inputs = $('impuestos-tbody').querySelectorAll('.imp-nombre');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

// ---- PDF Generation ----
// ---- Validación: todo lo que falta, de una vez ----
// Hasta v259 se avisaba de a un dato por vez (un toast por cada intento de
// Generar). Ahora se juntan todos en un diálogo; cada renglón lleva a su campo,
// y los campos quedan marcados en rojo hasta que se completan.
const SECCION_FALTA = { obra: 'Datos de la Orden', rubro: 'Datos de la Orden', 'condicion-pago': 'Datos de la Orden',
  'equipo-cat': 'Datos de la Orden', proveedor: 'Datos del Proveedor', 'cuit-proveedor': 'Datos del Proveedor',
  'btn-add-row': 'Ítems de la Orden', 'item-desc': 'Ítems de la Orden' };

// Lo que falta para generar, en el orden del formulario: [{ id, txt }].
function faltantesOC() {
  const v = id => $(id).value.trim();
  const f = [];
  const obra = v('obra');
  if (!obra) f.push({ id: 'obra', txt: 'Obra / motivo' });
  else if (!buscarObra(obra)) f.push({ id: 'obra', txt: `"${obra}" no está en el padrón de obras` });
  if (rubrosDeObraActual().length && !selectedRubro) f.push({ id: 'rubro', txt: 'Rubro de la obra' });
  if (!v('condicion-pago')) f.push({ id: 'condicion-pago', txt: 'Condición de pago' });
  if (selectedEquipo && !selectedCategoria) f.push({ id: 'equipo-cat', txt: 'Categoría de la compra (Repuestos o Mantenimiento)' });
  if (!v('proveedor')) f.push({ id: 'proveedor', txt: 'Razón social del proveedor' });
  if (!v('cuit-proveedor')) f.push({ id: 'cuit-proveedor', txt: 'CUIT del proveedor' });
  if (!items.length) f.push({ id: 'btn-add-row', txt: 'Al menos un ítem' });
  else {
    const n = items.filter(it => !String(it.descripcion || '').trim()).length;
    if (n) f.push({ id: 'item-desc', txt: n === 1 ? 'Descripción de un ítem' : `Descripción de ${n} ítems` });
  }
  return f;
}

// Descripciones de ítems vacías, en la vista que se esté usando (tabla o tarjetas).
const descVacias = () => [...document.querySelectorAll('#items-tbody input[data-field="descripcion"], #items-cards .item-card-desc')]
  .filter(el => el.offsetParent && !el.value.trim());

function marcarFaltantes(faltan) {
  document.querySelectorAll('.is-falta').forEach(el => el.classList.remove('is-falta'));
  faltan.forEach(({ id }) => {
    if (id === 'item-desc') descVacias().forEach(el => el.classList.add('is-falta'));
    else if (id !== 'btn-add-row') $(id)?.classList.add('is-falta');
  });
}

// La marca roja se va sola cuando el dato aparece (se llama con cada cambio).
function desmarcarCompletos() {
  document.querySelectorAll('.is-falta').forEach(el => {
    const ok = el.id === 'equipo-cat' ? !!selectedCategoria || !selectedEquipo : !!el.value?.trim();
    if (ok) el.classList.remove('is-falta');
  });
}

function irAFaltante(id) {
  if (id === 'item-desc') {
    const el = descVacias()[0];
    if (el) { const sec = el.closest('.oc-section'); if (sec && sec.classList.contains('collapsed')) openOCSection(sec); el.focus(); }
    return;
  }
  if (id === 'equipo-cat') {
    revealAndFocus('equipo');
    $('equipo-cat-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  revealAndFocus(id);
}

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
      <span class="faltan-t"><b>${esc(f.txt)}</b><small>${esc(SECCION_FALTA[f.id] || '')}</small></span>
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

function validateOCForm() {
  const faltan = faltantesOC();
  marcarFaltantes(faltan);
  if (!faltan.length) return true;
  mostrarFaltantes(faltan);
  return false;
}

// ---- Panel "Para generar" (al costado, en escritorio) ----
// Lo mismo que valida Generar, a la vista todo el tiempo: en verde lo que ya
// está, en rojo lo que falta (tocarlo lleva al campo).
function pintarCheck() {
  const box = $('oc-check-list');
  if (!box) return;
  const faltan = faltantesOC();
  const grupos = [
    [['obra'], 'Obra'],
    rubrosDeObraActual().length ? [['rubro'], 'Rubro'] : null,
    [['condicion-pago'], 'Condición de pago'],
    selectedEquipo ? [['equipo-cat'], 'Categoría del equipo'] : null,
    [['proveedor', 'cuit-proveedor'], 'Proveedor y CUIT'],
    [['btn-add-row', 'item-desc'], `${items.length} ${items.length === 1 ? 'ítem' : 'ítems'} con descripción`],
  ].filter(Boolean);
  // Lo que falta, dicho como falta (el texto del diálogo es el nombre del dato).
  const textoFalta = f => {
    const ids = f.map(x => x.id);
    if (ids.includes('proveedor')) return ids.includes('cuit-proveedor') ? 'Falta el proveedor' : 'Falta la razón social';
    const x = f[0];
    return { 'obra': x.txt === 'Obra / motivo' ? 'Falta la obra' : x.txt, 'rubro': 'Falta el rubro', 'condicion-pago': 'Falta la condición de pago',
      'equipo-cat': 'Falta la categoría del equipo', 'cuit-proveedor': 'Falta el CUIT del proveedor', 'btn-add-row': 'Falta al menos un ítem',
      'item-desc': 'Falta la ' + x.txt.charAt(0).toLowerCase() + x.txt.slice(1) }[x.id] || x.txt;
  };
  box.innerHTML = grupos.map(([ids, ok]) => {
    const f = faltan.filter(x => ids.includes(x.id));
    return f.length
      ? `<button type="button" class="oc-check-r oc-check-r--no" data-id="${f[0].id}"><span class="d">${icSvg('x')}</span>${esc(textoFalta(f))}</button>`
      : `<div class="oc-check-r"><span class="d">${icSvg('checkSm')}</span>${esc(ok)}</div>`;
  }).join('');
}

// ---- Proveedor de la base: ficha compacta ----
// Elegido de la base (o reconocido al importar), el proveedor se ve como una
// ficha; "Editar datos" abre los campos de siempre. Uno nuevo, o uno cuyos datos
// cambiaron (p. ej. al importar otro presupuesto), se ve con los campos.
let provFicha = false;

function provFichaVisible() {
  return provFicha && !provIsDirty() && !!$('proveedor').value.trim() && !!$('cuit-proveedor').value.trim();
}

function pintarProvFicha() {
  const ver = provFichaVisible();
  $('prov-ficha').closest('.oc-section').classList.toggle('prov-compacto', ver);
  if (!ver) return;
  const v = id => $(id).value.trim();
  const nombre = v('proveedor');
  $('prov-f-av').textContent = nombre.split(/\s+/).filter(w => /[a-z0-9]/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  $('prov-f-nombre').textContent = nombre;
  const cod = v('codigo-interno-proveedor');
  $('prov-f-tag').textContent = cod ? 'En la base · ' + cod : 'En la base';
  $('prov-f-l1').textContent = ['CUIT ' + v('cuit-proveedor'), v('condicion-iva-proveedor')].filter(Boolean).join(' · ');
  $('prov-f-l2').textContent = [v('domicilio-proveedor'), v('telefonos-proveedor'), v('nombre-proveedor')].filter(Boolean).join(' · ');
}

function editarProveedor() {
  provFicha = false;
  pintarProvFicha();
  $('proveedor').focus();
}

function cambiarProveedor() {
  PROV_FIELDS.forEach(id => { $(id).value = ''; });
  $('codigo-interno-proveedor').value = '';
  $('condicion-iva-proveedor').value  = 'Resp. Inscripto';
  _loadedProvCuit = null;
  snapshotProvider();
  updateOCSummaries();
  $('proveedor').focus();
}

// ---- Atajos de Condición de pago ----
// Primero la última que se usó con este proveedor; después las que más usa
// quien está cargando. Tocar una la escribe en el campo (se puede seguir
// escribiendo a mano como siempre).
async function pintarCondChips() {
  const box = $('cp-chips');
  if (!box) return;
  let hist = [];
  try { hist = await historialParaComparar(); } catch (_) { return; }
  const code = sessionStorage.getItem('responsable_code') || '';
  const cuit = $('cuit-proveedor').value.replace(/\D/g, '');
  const nom  = normalizeProvName($('proveedor').value);
  const conPago = hist.filter(h => String(h.condicionPago || '').trim());
  const ultima = (cuit.length >= 10 || nom) ? conPago.find(h =>
    (cuit.length >= 10 && String(h.proveedor?.cuit || '').replace(/\D/g, '') === cuit) ||
    (nom && normalizeProvName(h.proveedor?.nombre) === nom)) : null;

  const cuenta = new Map();
  conPago.filter(h => h.responsable?.codigo === code).forEach(h => {
    const t = h.condicionPago.trim(), k = t.toLowerCase();
    const c = cuenta.get(k) || { t, n: 0 };
    c.n++;
    cuenta.set(k, c);
  });
  const chips = ultima ? [{ t: ultima.condicionPago.trim(), ult: true }] : [];
  [...cuenta.values()].sort((a, b) => b.n - a.n).forEach(({ t }) => {
    if (chips.length < 4 && !chips.some(c => c.t.toLowerCase() === t.toLowerCase())) chips.push({ t });
  });

  const actual = $('condicion-pago').value.trim().toLowerCase();
  box.innerHTML = chips.map(c => `<button type="button" class="cp-chip${c.ult ? ' cp-chip--ult' : ''}" data-v="${esc(c.t)}" aria-pressed="${c.t.toLowerCase() === actual}">${esc(c.t)}${
    c.ult ? '<small> · la última con este proveedor</small>' : ''}</button>`).join('');
  box.classList.toggle('hidden', !chips.length);
}

function setupCondChips() {
  $('cp-chips').addEventListener('click', e => {
    const b = e.target.closest('.cp-chip');
    if (!b) return;
    const input = $('condicion-pago');
    input.value = b.dataset.v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('condicion-pago').addEventListener('input', pintarCondChips);
  ['proveedor', 'cuit-proveedor'].forEach(id => $(id).addEventListener('change', pintarCondChips));
  pintarCondChips();
}

// ---- IVA y moneda como interruptores-pastilla ----
// Mueven los checkbox de siempre (ocultos), que tienen la lógica de cada uno.
function setupSegs() {
  document.querySelectorAll('.oc-seg button').forEach(b => b.addEventListener('click', () => {
    const chk = $(b.dataset.chk), on = b.dataset.v === '1';
    if (chk.checked !== on) {
      chk.checked = on;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncSegs();
  }));
  syncSegs();
}

function syncSegs() {
  document.querySelectorAll('.oc-seg button').forEach(b =>
    b.setAttribute('aria-pressed', String($(b.dataset.chk).checked === (b.dataset.v === '1'))));
}

// ---- Borrador automático ----
// La OC a medio cargar se guarda en el dispositivo con cada cambio: si Android
// cierra la app mientras se mira el presupuesto en WhatsApp, o se toca la flecha
// de volver, al entrar de nuevo sigue ahí. Los datos van en localStorage y el
// archivo del presupuesto en IndexedDB (en localStorage no entra). Es por usuario:
// en un teléfono compartido cada uno ve el suyo. Se borra al generar la OC (o
// pedir su autorización) y al limpiar el formulario.
const BORRADOR_CAMPOS = ['obra', 'condicion-pago', 'plazo-entrega', 'lugar-entrega', 'observaciones',
  'proveedor', 'cuit-proveedor', 'nombre-proveedor', 'codigo-interno-proveedor', 'domicilio-proveedor',
  'telefonos-proveedor', 'condicion-iva-proveedor', 'ref-presupuesto'];
// Lo que se completa solo (la obra recordada, su lugar de entrega, la condición
// de IVA por defecto) no cuenta como trabajo: sin nada de esto no hay borrador.
const BORRADOR_PROPIOS = ['condicion-pago', 'plazo-entrega', 'observaciones', 'proveedor', 'cuit-proveedor',
  'nombre-proveedor', 'domicilio-proveedor', 'telefonos-proveedor', 'ref-presupuesto'];
const borradorKey = () => 'vimeco_borrador_oc_' + (sessionStorage.getItem('responsable_code') || '');
let _borradorListo = false;   // no se guarda nada hasta terminar de arrancar (y restaurar)
let _borradorPausa = false;   // después de generar, hasta que se vuelva a editar algo
let _borradorTimer = 0;

function leerBorrador() {
  try { return JSON.parse(localStorage.getItem(borradorKey())); } catch (_) { return null; }
}

function borradorTieneAlgo() {
  return items.length > 0 || !!selectedFile || !!selectedEquipo ||
    BORRADOR_PROPIOS.some(id => $(id).value.trim());
}

function guardarBorrador() {
  clearTimeout(_borradorTimer);
  if (!_borradorListo || _borradorPausa) return;
  try {
    if (!borradorTieneAlgo()) { localStorage.removeItem(borradorKey()); return; }
    const campos = {};
    BORRADOR_CAMPOS.forEach(id => { campos[id] = $(id).value; });
    localStorage.setItem(borradorKey(), JSON.stringify({
      ts: Date.now(), campos,
      rubro: selectedRubro, equipo: selectedEquipo, categoria: selectedCategoria,
      items, descuento, noGravado, impuestos, ivaActive, ivaPct, monedaUSD,
      provCuit: _loadedProvCuit, provSnapshot: _provSnapshot, provFicha
    }));
  } catch (e) {
    console.warn('guardarBorrador:', e);
  }
}

function programarBorrador() {
  if (!_borradorListo || _borradorPausa) return;
  clearTimeout(_borradorTimer);
  _borradorTimer = setTimeout(guardarBorrador, 500);
}

function borrarBorrador() {
  clearTimeout(_borradorTimer);
  try { localStorage.removeItem(borradorKey()); } catch (_) {}
  borradorArchivo(null);
  ocultarAvisoBorrador();
}

// La OC salió: el borrador se borra y no se vuelve a guardar hasta que se edite
// algo (el formulario queda cargado para "Mismo proveedor").
function terminarBorrador() {
  borrarBorrador();
  _borradorPausa = true;
}

function _borradorDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('vimeco-borrador-oc', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('archivo');
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

// Guarda el archivo del presupuesto del borrador; con null, lo borra.
async function borradorArchivo(file) {
  try {
    const db = await _borradorDB();
    const tx = db.transaction('archivo', 'readwrite');
    if (file) tx.objectStore('archivo').put(file, borradorKey());
    else      tx.objectStore('archivo').delete(borradorKey());
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch (e) {
    console.warn('borradorArchivo:', e);
  }
}

async function leerBorradorArchivo() {
  try {
    const db  = await _borradorDB();
    const req = db.transaction('archivo', 'readonly').objectStore('archivo').get(borradorKey());
    const file = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    db.close();
    return file || null;
  } catch (e) {
    console.warn('leerBorradorArchivo:', e);
    return null;
  }
}

// "XL S.A. · 3 ítems · hoy 10:42"
function resumenBorrador(b) {
  const n = (b.items || []).length;
  const d = new Date(b.ts);
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dia  = d.toDateString() === new Date().toDateString() ? 'hoy'
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  return [b.campos?.proveedor?.trim() || 'Sin proveedor',
          n ? `${n} ${n === 1 ? 'ítem' : 'ítems'}` : 'sin ítems',
          `${dia} ${hora}`].join(' · ');
}

async function restaurarBorrador(b) {
  const c = b.campos || {};
  BORRADOR_CAMPOS.forEach(id => { if (id !== 'obra' && c[id] != null) $(id).value = c[id]; });
  // La obra sólo si sigue en el padrón; si el borrador no tenía, queda la recordada.
  if (c.obra) setObraValue(c.obra);
  const rubros = rubrosDeObraActual();
  setRubro(b.rubro ? rubros.find(r => r.id === b.rubro.id) || null : null);
  setEquipo(b.equipo || null);
  setCategoria(b.categoria || null);
  _loadedProvCuit = b.provCuit || null;
  _provSnapshot   = b.provSnapshot || {};
  provFicha       = !!b.provFicha;
  $('btn-save-proveedor-base').classList.toggle('hidden', !provIsDirty());

  items     = Array.isArray(b.items) ? b.items : [];
  descuento = b.descuento || { pct: null, monto: 0 };
  noGravado = b.noGravado || { pct: null, monto: 0 };
  impuestos = Array.isArray(b.impuestos) ? b.impuestos : [];
  $('pct-descuento').value   = descuento.pct ? String(descuento.pct) : '';
  $('monto-descuento').value = fmtMoneyDisplay(descuento.monto);
  $('pct-nogravado').value   = noGravado.pct ? String(noGravado.pct) : '';
  $('monto-nogravado').value = fmtMoneyDisplay(noGravado.monto);

  // Los precios de los ítems ya vienen netos (con su _precio_original): sólo se
  // repone el interruptor, sin volver a descontar el IVA.
  ivaActive = !!b.ivaActive;
  ivaPct    = b.ivaPct || 21;
  $('iva-toggle').checked = ivaActive;
  $('iva-pct').value = String(ivaPct);
  $('iva-pct-wrap').classList.toggle('hidden', !ivaActive);
  monedaUSD = !!b.monedaUSD;
  $('moneda-toggle').checked = monedaUSD;
  updateMonedaLabels();

  renderTable();
  renderImpuestos();
  recalcTotales();

  // Un archivo recién compartido desde otra app gana sobre el del borrador.
  if (!selectedFile) {
    const file = await leerBorradorArchivo();
    if (file) handleFileSelected(file);
  }
}

function mostrarAvisoBorrador(b) {
  $('borrador-aviso-sub').textContent = resumenBorrador(b);
  $('borrador-aviso').classList.remove('hidden');
}

function ocultarAvisoBorrador() {
  $('borrador-aviso')?.classList.add('hidden');
}

async function empezarDeCero() {
  const b = leerBorrador();
  const ok = await showConfirm('Empezar de cero',
    `Se borra la OC que estabas cargando${b ? ` (${resumenBorrador(b)})` : ''}.`,
    { boton: 'Borrar y empezar', tono: 'del', icono: 'trash' });
  if (ok) resetForm();
}

// Al arrancar: retoma el borrador, salvo que se haya pedido "Usar como base"
// desde el Historial o una OC con artículos desde Proveedores; en ese caso se
// pregunta cuál de las dos sigue.
async function arrancarBorrador(obrasListas) {
  const b = leerBorrador();
  const baseRaw = sessionStorage.getItem('oc_base');
  sessionStorage.removeItem('oc_base');
  let base = null;
  try { base = baseRaw ? JSON.parse(baseRaw) : null; } catch (e) { console.warn('oc_base:', e); }
  const provRaw = sessionStorage.getItem('oc_desde_proveedor');
  sessionStorage.removeItem('oc_desde_proveedor');
  let desdeProv = null;
  try { desdeProv = provRaw ? JSON.parse(provRaw) : null; } catch (e) { console.warn('oc_desde_proveedor:', e); }
  await obrasListas;

  if (desdeProv) {
    const usarla = !b || await showConfirm('Tenés una OC sin terminar',
      `${resumenBorrador(b)}.\nSi abrís la OC a ${desdeProv.proveedor?.nombre || 'este proveedor'}, la que estabas cargando se borra.`,
      { boton: 'Abrir la nueva', tono: 'warn', icono: 'undo', cancelar: 'Seguir con la mía' });
    if (usarla) {
      if (b) borrarBorrador();
      try { loadOCDesdeProveedor(desdeProv); } catch (e) { console.warn('loadOCDesdeProveedor:', e); }
    } else {
      await restaurarBorrador(b);
      mostrarAvisoBorrador(b);
    }
  } else if (base) {
    const usarBase = !b || await showConfirm('Tenés una OC sin terminar',
      `${resumenBorrador(b)}.\nSi usás la OC ${base.nroOC} como base, la que estabas cargando se borra.`,
      { boton: 'Usar como base', tono: 'warn', icono: 'undo', cancelar: 'Seguir con la mía' });
    if (usarBase) {
      if (b) borrarBorrador();
      try { loadOCBase(base); } catch (e) { console.warn('loadOCBase:', e); }
    } else {
      await restaurarBorrador(b);
      mostrarAvisoBorrador(b);
    }
  } else if (b) {
    try {
      await restaurarBorrador(b);
      mostrarAvisoBorrador(b);
    } catch (e) {
      console.warn('restaurarBorrador:', e);
    }
  }

  _borradorListo = true;
  // Con la app en segundo plano Android puede cerrarla sin aviso: se guarda ya.
  document.addEventListener('visibilitychange', () => { if (document.hidden) guardarBorrador(); });
  window.addEventListener('pagehide', guardarBorrador);
  // Después de generar, se vuelve a guardar recién cuando se edita algo.
  ['input', 'change'].forEach(ev => document.querySelector('.app-main').addEventListener(ev, e => {
    if (e.isTrusted && _borradorPausa) { _borradorPausa = false; programarBorrador(); }
  }));
}

function buildOCData(numero, firma = null) {
  const proveedor = $('proveedor').value.trim();
  // Siempre la escritura oficial del padrón: es la que termina nombrando la
  // carpeta de Drive, y una variante de mayúsculas crea una carpeta paralela.
  const obraSel   = buscarObra($('obra').value);
  const obra      = obraSel ? obraSel.nombre : $('obra').value.trim();
  const total     = calcTotal();
  const descMonto = roundCents(descuento.monto || 0);
  const ngMonto   = roundCents(noGravado.monto || 0);
  const subtotal  = calcSubtotal();
  const gravado   = calcGravado();

  const pdfTotals = [];
  if (descMonto > 0 || ngMonto > 0) pdfTotals.push({ nombre: 'Subtotal', monto: subtotal });
  if (descMonto > 0) pdfTotals.push({ nombre: descuento.pct ? `Descuento ${descuento.pct}%` : 'Descuento', monto: -descMonto });
  if (ngMonto   > 0) pdfTotals.push({ nombre: 'No gravado', monto: ngMonto });
  pdfTotals.push({ nombre: 'Gravado', monto: gravado });
  impuestos.forEach(imp => {
    if ((imp.monto || 0) !== 0)
      pdfTotals.push({ nombre: (imp.pct != null && imp.pct > 0) ? `${imp.nombre} ${imp.pct}%` : imp.nombre, monto: imp.monto });
  });
  pdfTotals.push({ nombre: 'TOTAL', monto: total });

  return {
    nroOC:    numero,
    fecha:    formatDateDisplay(new Date()),
    moneda:   monedaUSD ? 'USD' : 'ARS',
    ejecutor: sessionStorage.getItem('responsable_name'),
    proveedor: {
      nombre:           proveedor,
      cuit:             $('cuit-proveedor').value.trim()          || '—',
      codigoInterno:    $('codigo-interno-proveedor').value.trim() || '',
      nombre_contacto:  $('nombre-proveedor').value.trim()        || '—',
      domicilio:        $('domicilio-proveedor').value.trim()     || '—',
      iva:              $('condicion-iva-proveedor').value.trim() || '—',
      telefonos:        $('telefonos-proveedor').value.trim()     || '—',
      ref:              $('ref-presupuesto').value.trim()         || '—',
      ubicacion:        obra,
      pago:             $('condicion-pago').value.trim()   || '—',
      plazo:            $('plazo-entrega').value.trim()    || '—',
      lugar:            $('lugar-entrega').value.trim()    || '—'
    },
    items: items.map(it => ({
      desc:     it.descripcion || '—',
      unidad:   it.unidad      || '—',
      cant:     it.cantidad,
      unitario: it.precio_unitario,
      total:    roundCents((parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0))
    })),
    observaciones: $('observaciones').value.trim() || '',
    // El rubro no se concatena a `ubicacion`: ese campo es el nombre de obra que
    // termina nombrando la carpeta de Drive y el `obra` del historial. El PDF los
    // junta al renderizar (igual que la categoría del equipo con Observaciones).
    rubro:       selectedRubro ? { id: selectedRubro.id, nombre: selectedRubro.nombre } : null,
    equipo:      selectedEquipo ? { codigo: selectedEquipo.codigo, tipo: selectedEquipo.tipo, patente: selectedEquipo.patente || '', categoria: selectedCategoria || null } : null,
    impuestos:   pdfTotals,
    totalLetras: numberToWords(total),
    _total:      total,
    // Datos crudos para restaurar en historial → Usar como base
    _descuento:      { pct: descuento.pct, monto: descuento.monto },
    _noGravado:      { pct: noGravado.pct, monto: noGravado.monto },
    _impuestosExtra: impuestos.map(imp => ({ nombre: imp.nombre, pct: imp.pct, monto: imp.monto })),
    _firma:          firma
  };
}

// ---- Autorización por monto ----
// Cada usuario puede tener `autorizaDesde` (en pesos, se carga en Usuarios →
// Permisos). Una OC que supera uno o más de esos montos cae en el escalón más
// alto que supera, y la puede firmar quien tenga ese monto o uno mayor: con
// 2M para A y 10M para B y C, una OC de 5M la firma A (o B o C) y una de 12M,
// B o C. Nadie más puede generarla: sólo pedir autorización a uno de ellos.
function totalEnPesos(total) {
  if (!monedaUSD) return total;
  const d  = typeof getDolarCached === 'function' ? getDolarCached() : null;
  const tc = d?.oficial?.venta || d?.blue?.venta;
  // Sin cotización no se puede ubicar la OC: se exige el escalón más alto.
  return tc ? total * tc : Infinity;
}

// null si la OC no requiere autorización por monto; si no, el escalón y la
// lista de quienes pueden firmarla. Lanza si no se pudo leer el padrón.
async function reglaDeMonto(total) {
  const usuarios = await getUsuariosActivos();
  const pesos    = totalEnPesos(total);
  const superados = usuarios.map(u => u.autorizaDesde).filter(m => m > 0 && pesos > m);
  if (!superados.length) return null;
  const escalon = Math.max(...superados);
  const autorizadores = usuarios
    .filter(u => u.autorizaDesde >= escalon)
    .sort((a, b) => a.autorizaDesde - b.autorizaDesde || a.codigo.localeCompare(b.codigo));
  return { escalon, autorizadores };
}

function nombresEnLista(us) {
  const n = us.map(u => u.nombre);
  return n.length > 1 ? n.slice(0, -1).join(', ') + ' o ' + n[n.length - 1] : (n[0] || '');
}

// Modal de autorización: devuelve la acción elegida.
//   'con'   → firmar yo y generar        'sin'   → generar sin firma
//   'pedir' → pedir autorización a otro   'cancel'→ no hacer nada
// Con `regla` (la OC supera un monto) y sin ser uno de sus autorizadores, sólo
// queda pedir autorización.
function elegirAutorizacion(regla) {
  return new Promise(resolve => {
    const modal  = $('modal-firma-confirm');
    const myCode = sessionStorage.getItem('responsable_code');
    const soloPedir = !!regla && !regla.autorizadores.some(u => u.codigo === myCode);
    const aviso  = $('firma-monto-aviso');
    if (soloPedir) {
      $('firma-monto-texto').textContent = `Esta OC supera $ ${Math.round(regla.escalon).toLocaleString('es-AR')}: ` +
        `la tiene que autorizar ${nombresEnLista(regla.autorizadores)}.`;
    }
    $('firma-pedir-sub').textContent = !soloPedir ? 'Le llega a otro usuario para que la firme'
      : regla.autorizadores.length > 1 ? 'Elegís a cuál de ellos se la mandás'
      : `Se la mandás a ${regla.autorizadores[0]?.nombre || 'quien la autoriza'}`;
    aviso.classList.toggle('hidden', !soloPedir);
    $('firma-confirm-pregunta').classList.toggle('hidden', soloPedir);
    // "Firmar yo" solo tiene sentido si el usuario tiene firma guardada.
    $('btn-firma-con').classList.toggle('hidden', !firmaBase64 || soloPedir);
    $('btn-firma-sin').classList.toggle('hidden', soloPedir);
    modal.classList.remove('hidden');
    const close = val => { modal.classList.add('hidden'); resolve(val); };
    $('btn-firma-con').onclick    = () => close('con');
    $('btn-firma-sin').onclick    = () => close('sin');
    $('btn-firma-pedir').onclick  = () => close('pedir');
    $('btn-firma-cancel').onclick = () => close('cancel');
  });
}

// Modal de selección de autorizador. Resuelve {codigo,nombre} o null si cancela.
// Con `regla`, sólo se ofrecen quienes pueden firmar ese monto.
function elegirAutorizador(regla) {
  return new Promise(resolve => {
    const modal  = $('modal-pedir-autorizacion');
    const lista  = $('pedir-lista');
    const btnOk  = $('btn-pedir-confirm');
    let elegido  = null;

    btnOk.disabled = true;
    lista.innerHTML = '<div class="pedir-estado">Cargando usuarios…</div>';
    $('pedir-texto').textContent = regla
      ? `Por el monto, esta OC sólo la puede firmar ${nombresEnLista(regla.autorizadores)}. Le va a aparecer en su bandeja de Autorizaciones.`
      : 'Elegí a quién le pedís que firme esta OC. Le va a aparecer en su bandeja de Autorizaciones.';
    // Por monto, la OC queda frenada hasta que la firmen: que no dependa de
    // que el autorizador abra la bandeja por su cuenta.
    $('pedir-comunicate').classList.toggle('hidden', !regla);
    modal.classList.remove('hidden');

    const myCode = sessionStorage.getItem('responsable_code');
    const loader = regla ? Promise.resolve(regla.autorizadores)
      : typeof getUsuariosActivos === 'function' ? getUsuariosActivos() : Promise.resolve([]);
    // Iniciales para el circulito: primera letra del primer y último nombre,
    // salteando el título ("Ing.", "Arq.").
    const iniciales = nombre => {
      const p = String(nombre || '').split(/\s+/).filter(w => w && !/\.$/.test(w));
      return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
    };
    const elegir = u => {
      elegido = u;
      lista.querySelectorAll('.pedir-who').forEach(b => b.setAttribute('aria-checked', b.dataset.codigo === u.codigo));
      btnOk.disabled = false;
    };
    loader.then(list => {
      const opts = (list || []).filter(u => u.codigo !== myCode);
      if (!opts.length) {
        lista.innerHTML = '<div class="pedir-estado">No hay otros usuarios activos disponibles.</div>';
        return;
      }
      lista.innerHTML = opts.map(u => `
        <button type="button" class="pedir-who" role="radio" aria-checked="false" data-codigo="${esc(u.codigo)}">
          <span class="pedir-who-av">${esc(iniciales(u.nombre))}</span><b>${esc(u.nombre)}</b><span class="pedir-who-rad"></span>
        </button>`).join('');
      lista.querySelectorAll('.pedir-who').forEach((b, i) => b.addEventListener('click', () => elegir(opts[i])));
      if (opts.length === 1) elegir(opts[0]);   // una sola persona posible: ya queda elegida
    }).catch(() => {
      lista.innerHTML = '<div class="pedir-estado">No se pudieron cargar los usuarios. Revisá tu conexión.</div>';
    });

    const close = val => { modal.classList.add('hidden'); resolve(val); };
    $('btn-pedir-cancel').onclick = () => close(null);
    btnOk.onclick = () => {
      if (!elegido) return;
      close({ codigo: elegido.codigo, nombre: elegido.nombre || '' });
    };
  });
}

// ---- OC que repite otra reciente ----
// Antes de generar se mira si quien emite ya le hizo, en la última hora, una OC
// al mismo proveedor por un monto parecido o con los mismos artículos (el criterio está en js/duplicados.js).
// Si la hay, decide qué es la nueva:
//   'otra'       → otra compra: valen las dos y no se vuelven a marcar.
//   'correccion' → corrige a las marcadas, que quedan anuladas ("Duplicada, se
//                  reemplazó por OC …") y salen de Reportes.
// Resuelve { tipo, ocs }, null si no hay ninguna parecida, o 'volver' si cerró
// el aviso para seguir editando. Sin red no se frena la emisión: se sigue.
async function revisarRepetida() {
  if (typeof duplicadosDeNueva !== 'function') return null;
  const code = sessionStorage.getItem('responsable_code') || '';
  let hist;
  try {
    // Se pide de nuevo (no el de historialParaComparar): la OC que se acaba de
    // emitir en esta misma visita tiene que estar.
    hist = await Promise.race([
      getHistorial(code),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
    ]);
  } catch (e) {
    console.warn('revisarRepetida:', e);
    return null;
  }
  const nueva = {
    proveedor:   { nombre: $('proveedor').value.trim(), cuit: $('cuit-proveedor').value.trim() },
    responsable: { codigo: code },
    moneda:      monedaUSD ? 'USD' : 'ARS',
    total:       calcTotal()
  };
  // Obra y artículos: reconocen la corrección que cambió mucho el monto.
  try {
    const d = buildOCData('');
    nueva.obra  = d.proveedor.ubicacion;
    nueva.items = d.items;
  } catch (e) { console.warn('revisarRepetida items:', e); }
  const previas = duplicadosDeNueva(nueva, hist);
  // La OC de otra persona usada como base (ver baseParaCorregir) también se
  // ofrece para anular. Si no se puede leer, se sigue sin ella.
  let base = null;
  try { base = _ocBase ? await baseParaCorregir(_ocBase, nueva) : null; } catch (e) { console.warn('baseParaCorregir:', e); }
  const lista = base ? [...previas, base] : previas;
  return lista.length ? elegirRepetida(lista, base) : null;
}

function elegirRepetida(previas, base = null) {
  return new Promise(resolve => {
    const modal  = $('modal-dup');
    const varias = previas.length > 1;
    const prov   = previas[0].proveedor?.nombre || 'este proveedor';
    const quien  = base?.responsable?.nombre || 'otra persona';
    if (base) {
      $('dup-texto').textContent = varias
        ? `Usaste como base la OC ${base.nroOC} de ${quien}, y en la última hora ya le emitiste otras OC a ${prov}:`
        : `Usaste como base la OC ${base.nroOC} de ${quien}, también a ${prov}:`;
    } else {
      const min = Math.max(1, Math.round((Date.now() - previas[previas.length - 1].timestamp) / 60000));
      $('dup-texto').textContent = varias
        ? `En la última hora ya le emitiste ${previas.length} OC parecidas a ${prov}:`
        : `Hace ${min} min ya le emitiste a ${prov} una OC parecida:`;
    }
    const nueva = calcTotal();
    $('dup-lista').innerHTML = previas.map((oc, i) => {
      const dif = difDup({ total: nueva }, oc);
      return `
      <label class="dup-oc dup-oc--anular">
        <input type="checkbox" value="${i}" checked${varias ? '' : ' hidden'}>
        <span class="dup-oc-main">
          <span class="dup-oc-nro">${esc(oc.nroOC)}</span>
          <span class="dup-oc-sub">${oc === base
            ? `${esc(oc.fecha || '')} · ${esc(oc.obra || 'Sin obra')} · ${esc(quien)}`
            : `${esc(horaDe(oc.timestamp))} · ${esc(oc.obra || 'Sin obra')}`}</span>
        </span>
        <span class="dup-oc-monto">${oc.moneda === 'USD' ? 'USD' : '$'} ${esc(fmtMoneyDisplay(oc.total))}
          <small>${dif ? 'la nueva ' + esc(dif) : 'mismo monto'}</small></span>
      </label>`;
    }).join('');
    $('dup-nota').textContent = (varias ? 'Si es una corrección, las marcadas quedan anuladas' : 'Si es una corrección, la anterior queda anulada')
      + ': siguen en el historial como "Duplicada" pero no cuentan en Reportes.';
    const lista = $('dup-lista');
    lista.onchange = e => e.target.closest('.dup-oc')?.classList.toggle('dup-oc--anular', e.target.checked);
    modal.classList.remove('hidden');

    const close = val => { modal.classList.add('hidden'); lista.onchange = null; resolve(val); };
    $('btn-dup-correccion').onclick = () => {
      const ocs = [...lista.querySelectorAll('input:checked')].map(c => previas[+c.value]);
      if (!ocs.length) { toast('Marcá cuál corrige esta OC, o elegí "Es otra compra".', 'error'); return; }
      close({ tipo: 'correccion', ocs });
    };
    $('btn-dup-otra').onclick    = () => close({ tipo: 'otra', ocs: previas });
    $('modal-dup-close').onclick = () => close('volver');
  });
}

// Campos que la OC nueva guarda según lo que se decidió en el aviso.
function extraRepetida(rep) {
  if (!rep) return {};
  if (rep.tipo === 'otra')
    return { noDuplicada: { ts: Date.now(), por: sessionStorage.getItem('responsable_name') || '' } };
  return { reemplazaA: rep.ocs.map(oc => oc.nroOC) };
}

// Ya guardada la OC nueva, marcar las anteriores. Si falla no se pierde nada:
// el grupo sigue apareciendo en Historial para resolverlo desde ahí.
async function aplicarRepetida(rep, numero) {
  if (!rep) return;
  try {
    if (rep.tipo === 'otra') await marcarComprasDistintas(rep.ocs);
    else {
      await anularPorReemplazo(rep.ocs, numero);
      toast(`${rep.ocs.map(oc => 'OC ' + oc.nroOC).join(', ')} anulada${rep.ocs.length > 1 ? 's' : ''}: la reemplaza la ${numero}.`, 'info');
    }
  } catch (e) {
    console.warn('aplicarRepetida:', e);
    if (rep.tipo === 'correccion')
      toast('No se pudo anular la OC anterior. Anulala desde Historial.', 'warning');
  }
}

async function handleGenerate() {
  if (!validateOCForm()) return;

  // ¿Repite una OC que la misma persona acaba de emitir?
  const repetida = await revisarRepetida();
  if (repetida === 'volver') return;

  // Si el total supera un monto con autorizador asignado, sólo ellos la firman.
  let regla;
  try {
    regla = await reglaDeMonto(calcTotal());
  } catch (e) {
    console.warn('reglaDeMonto:', e);
    toast('No se pudo verificar quién autoriza este monto. Revisá tu conexión.', 'error');
    return;
  }

  // Elegir cómo se autoriza la OC antes de bloquear el botón.
  const accion = await elegirAutorizacion(regla);
  if (accion === 'cancel') return;

  // Pedir autorización a otro usuario → flujo aparte (no genera PDF ahora).
  if (accion === 'pedir') {
    const autorizador = await elegirAutorizador(regla);
    if (!autorizador) return;
    return solicitarAutorizacion(autorizador, regla, repetida);
  }

  const usarFirma = accion === 'con';

  const btn = $('btn-generate');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Asignando número…';

  let numero;
  try {
    if (manualOCNumber) {
      numero = manualOCNumber;
      manualOCNumber = null;
      $('oc-number-display').classList.remove('oc-number-manual');
      $('btn-clear-oc-number').classList.add('hidden');
    } else {
      if (typeof window.claimNextOCSeq !== 'function')
        throw new Error('Firebase no cargó — recargá la página (F5).');
      numero = formatOCNumber(await window.claimNextOCSeq());
    }
  } catch (err) {
    toast(`Error N° OC: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = icSvg('print') + ' Generar PDF — Orden de Compra';
    return;
  }

  const ocData = buildOCData(numero, usarFirma ? firmaBase64 : null);
  const fname  = `OC_${numero}_${sanitize(ocData.proveedor.nombre || 'SinProveedor')}.pdf`;

  let blob;
  try {
    blob = generateOCBlob(ocData);
  } catch (err) {
    toast(`Error al generar el PDF: ${err.message}`, 'error');
    console.error(err);
    btn.disabled = false;
    btn.innerHTML = icSvg('print') + ' Generar PDF — Orden de Compra';
    return;
  }

  // Guardar en historial; una vez guardado, subir a Drive y salvar folder_id
  const histKey   = numero.replace(/-/g, '');
  recordarObra(ocData.proveedor.ubicacion);
  const histSaved = saveOCToHistory(ocData, ocData._total, { estado: 'emitida', ...extraRepetida(repetida) })
    .then(() => { updateProveedoresCache(); aplicarRepetida(repetida, numero); return true; })
    .catch(e => { console.warn('saveOCToHistory:', e); return false; });

  // Compartir (solo mobile/táctil) o descargar
  const isMobile = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  let shared = false;
  if (isMobile && navigator.canShare) {
    const file = new File([blob], fname, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: `OC ${numero} — VIMECO S.A.`, files: [file] });
        shared = true;
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('Web Share:', e);
      }
    }
  }
  if (!shared) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  refreshOCNumberDisplay();
  terminarBorrador();
  toast(shared ? `OC ${numero} compartida.` : `OC ${numero} generada.`, 'success');
  btn.disabled = false;
  btn.innerHTML = icSvg('print') + ' Generar PDF — Orden de Compra';
  $('btn-same-provider').classList.remove('hidden');

  // Subir a Drive en background (espera historial para evitar race condition en PATCH)
  if (typeof uploadToDrive === 'function') {
    const driveObra  = (buscarObra($('obra').value)?.nombre || '').trim() || 'Sin obra';
    const driveFecha = new Date().toISOString().slice(0, 10);
    const driveProv  = ocData.proveedor.nombre || 'Sin proveedor';
    histSaved.then(saved =>
      uploadToDrive(blob, fname, { obra: driveObra, fecha: driveFecha, proveedor: driveProv, nroOC: numero }, selectedFile)
        .then(({ obrasFolderId, proveedoresFolderId }) => {
          if (saved && (obrasFolderId || proveedoresFolderId))
            saveDriveIds(histKey, obrasFolderId, proveedoresFolderId, numero);
          logOCActivity(numero, driveProv, driveObra, ocData._total, obrasFolderId || proveedoresFolderId, { moneda: ocData.moneda });
        })
        .catch(async () => {
          // Encolar ante CUALQUIER fallo, no sólo sin conexión: los errores de
          // Drive con red (token vencido, 5xx, carpeta perdida) quedaban sin
          // reintento y la OC sin respaldo.
          let encolada = false;
          if (typeof driveQueue !== 'undefined') {
            try {
              await driveQueue.enqueue({
                histKey, pdfBlob: blob, pdfName: fname,
                obra: driveObra, fecha: driveFecha, proveedor: driveProv,
                nroOC: numero, total: ocData._total, sourceFile: selectedFile
              });
              encolada = true;
            } catch (_) {}
          }
          if (!encolada) toast('No se pudo subir a Drive. Se registró el error.', 'warning');
          else if (!navigator.onLine) toast('Sin conexión. Se subirá a Drive cuando haya red.', 'warning');
          else {
            toast('Falló la subida a Drive. Se reintentará automáticamente.', 'warning');
            // Con red, esperar al próximo 'online' o a recargar la página sería
            // dejarla colgada: reintentar dentro de la misma sesión.
            setTimeout(() => retryDriveQueue().catch(() => {}), 60000);
          }
        })
    );
  }
}

// ---- Pedir autorización a otro usuario ----
// Reserva número, guarda la OC como 'pendiente' con su payload completo (para
// regenerar el PDF idéntico al firmar), sube el archivo fuente a Drive para que
// el autorizador lo pueda ver, y le manda una novedad dirigida. No genera PDF.
// Si corrige a otra OC (`repetida`), la anterior se anula recién cuando la firman
// (autorizaciones.js): si la rechazan, la anterior sigue valiendo.
async function solicitarAutorizacion(autorizador, regla = null, repetida = null) {
  const btn = $('btn-generate');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Reservando número…';

  let numero;
  try {
    if (manualOCNumber) {
      numero = manualOCNumber;
      manualOCNumber = null;
      $('oc-number-display').classList.remove('oc-number-manual');
      $('btn-clear-oc-number').classList.add('hidden');
    } else {
      if (typeof window.claimNextOCSeq !== 'function')
        throw new Error('Firebase no cargó — recargá la página (F5).');
      numero = formatOCNumber(await window.claimNextOCSeq());
    }
  } catch (err) {
    toast(`Error N° OC: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = icSvg('print') + ' Generar PDF — Orden de Compra';
    return;
  }

  const ocData      = buildOCData(numero);   // sin firma
  const solicitante = {
    codigo: sessionStorage.getItem('responsable_code') || '',
    nombre: sessionStorage.getItem('responsable_name') || ''
  };
  const autorizacion = {
    solicitadoPor: solicitante,
    solicitadoA:   { codigo: autorizador.codigo, nombre: autorizador.nombre },
    solicitadoEn:  Date.now(),
    resueltoEn:    null,
    firmaCodigo:   null,
    motivoRechazo: null,
    // Escalón de monto que obligó a pedirla (null si se pidió por elección).
    montoRequerido: regla ? regla.escalon : null
  };

  const histKey = numero.replace(/-/g, '');
  // El presupuesto se toma ahora: terminarBorrador() y la próxima OC lo pisan.
  const fuente = selectedFile;
  recordarObra(ocData.proveedor.ubicacion);
  try {
    await saveOCToHistory(ocData, ocData._total, {
      estado:       'pendiente',
      autorizacion,
      _payload:     ocData,
      // Avisa en la bandeja que hay presupuesto aunque la subida no haya llegado.
      ...(fuente ? { tieneFuente: true } : {}),
      ...extraRepetida(repetida)
    });
    updateProveedoresCache();
    if (repetida?.tipo === 'otra') aplicarRepetida(repetida, numero);
  } catch (e) {
    console.warn('saveOCToHistory (pendiente):', e);
    toast('No se pudo registrar la solicitud. Revisá tu conexión.', 'error');
    btn.disabled = false;
    btn.innerHTML = icSvg('print') + ' Generar PDF — Orden de Compra';
    return;
  }

  const driveObra  = (buscarObra($('obra').value)?.nombre || '').trim() || 'Sin obra';
  const driveFecha = new Date().toISOString().slice(0, 10);
  const driveProv  = ocData.proveedor.nombre || 'Sin proveedor';

  // Subir el presupuesto a Drive (si hay) para que el autorizador lo revise.
  // Se espera a que llegue antes de avisarle: con la subida en segundo plano la
  // notificación salía primero, y quien la abría enseguida veía la OC sin el
  // presupuesto; y si el solicitante cambiaba de app a mitad de camino, la
  // subida se cortaba sin aviso.
  let fuenteFallo = !!fuente;
  if (fuente) btn.innerHTML = '<span class="spinner"></span> Subiendo presupuesto…';
  if (typeof uploadSourceToDrive === 'function') {
    try {
      const { obrasFolderId, proveedoresFolderId, sourceLink } = await uploadSourceToDrive(
        { obra: driveObra, fecha: driveFecha, proveedor: driveProv, nroOC: numero }, fuente);
      fuenteFallo = !!fuente && !sourceLink;
      await patchHistorialEntry(histKey, {
        drive_folder_obras_id:       obrasFolderId || null,
        drive_folder_proveedores_id: proveedoresFolderId || null,
        fuenteUrl:                   sourceLink || ''
      }).catch(() => {});
    } catch (_) {}
  }

  if (typeof notificarUsuario === 'function' && autorizador.codigo !== solicitante.codigo) {
    notificarUsuario(autorizador.codigo, {
      title: 'Autorización pendiente',
      body:  `OC ${numero} · ${driveProv} · ${driveObra}\n${monedaUSD ? 'USD' : '$'} ${fmtMoneyDisplay(ocData._total)} — pide ${solicitante.nombre}` +
             (fuente && !fuenteFallo ? '\nCon presupuesto adjunto' : ''),
      url:   'autorizaciones.html?tab=firmar',
      tag:   'aut-' + histKey
    });
  }

  refreshOCNumberDisplay();
  terminarBorrador();
  toast(`OC ${numero} enviada a ${autorizador.nombre} para autorización.` +
    (repetida?.tipo === 'correccion' ? ' La anterior se anula cuando la firme.' : ''), 'success');
  if (fuenteFallo)
    toast(`No se pudo subir el presupuesto: ${autorizador.nombre} va a ver la OC sin él. Mandáselo por otro medio.`, 'error');
  btn.disabled = false;
  btn.innerHTML = icSvg('print') + ' Generar PDF — Orden de Compra';
  $('btn-same-provider').classList.remove('hidden');
}

// ---- Vista previa ----
async function handlePreview() {
  if (!validateOCForm()) return;

  const btn = $('btn-preview');
  btn.disabled = true;

  let numero;
  if (manualOCNumber) {
    numero = manualOCNumber;
  } else {
    try {
      const seq = await readNextOCSeq();
      numero = formatOCNumber(seq);
    } catch {
      numero = '????-????????';
    }
  }

  const ocData = buildOCData(numero);
  let blob;
  try {
    blob = generateOCBlob(ocData);
  } catch (err) {
    toast(`Error al generar vista previa: ${err.message}`, 'error');
    btn.disabled = false;
    return;
  }

  btn.disabled = false;
  openPreview(blob, ocData);
}

// La vista previa es la misma ficha que muestra reportes (js/fichaOC.js),
// armada con los datos del formulario. El PDF real queda a un toque ("Ver PDF").
function openPreview(blob, oc) {
  const blobUrl = URL.createObjectURL(blob);
  const modal   = $('modal-preview');

  pintarFichaOC(oc, `<span class="foc-chip">${manualOCNumber ? 'N° manual' : 'N° provisorio'}</span>`,
    previewWarningsHtml(checkOCLocal(oc)));

  $('preview-pdf').href = blobUrl;
  modal.dataset.blobUrl = blobUrl;
  modal.classList.remove('hidden');

  // La comparación con OC anteriores necesita el historial: llega después y se
  // agrega debajo de los avisos, si la vista previa sigue abierta.
  const token = blobUrl;
  historialParaComparar().then(hist => {
    if (modal.dataset.blobUrl !== token) return;
    const res = checkOCHistorial(oc, hist);
    $('preview-warn').innerHTML = previewWarningsHtml(checkOCLocal(oc), res.info) + comparacionHtml(res.cambios);
  }).catch(() => {});
}

// ---- Avisos de la vista previa ----
// Revisión antes de firmar: no bloquean, sólo llaman la atención.
function checkOCLocal(oc) {
  const avisos = [];
  const n = oc.items.map((it, i) => ({ i: i + 1, cant: parseFloat(it.cant) || 0, pu: parseFloat(it.unitario) || 0 }));
  const lista = xs => xs.map(x => x.i).join(', ');
  const sinCant   = n.filter(x => !x.cant);
  const sinPrecio = n.filter(x => !x.pu);
  if (sinCant.length)   avisos.push(`${sinCant.length === 1 ? 'El ítem' : 'Los ítems'} ${lista(sinCant)} ${sinCant.length === 1 ? 'tiene' : 'tienen'} cantidad 0.`);
  if (sinPrecio.length) avisos.push(`${sinPrecio.length === 1 ? 'El ítem' : 'Los ítems'} ${lista(sinPrecio)} ${sinPrecio.length === 1 ? 'no tiene' : 'no tienen'} precio.`);

  // Sin IVA: salvo que el proveedor no lo discrimine (monotributo / exento).
  const tieneIVA = impuestos.some(imp => /i\.?\s?v\.?\s?a/i.test(imp.nombre || '') && (imp.monto || 0) !== 0);
  const noDiscrimina = /monotrib|exent|no\s+resp|consumidor/i.test(oc.proveedor.iva || '');
  if (!tieneIVA && !noDiscrimina) {
    avisos.push(ivaActive
      ? 'Los precios se cargaron con IVA incluido, pero la OC no suma IVA: el total queda neto.'
      : 'La OC no tiene IVA. Si el proveedor lo factura, agregalo en Impuestos y Totales.');
  }
  return avisos;
}

// Historial completo (una vez por visita a la página).
let _histPromise = null;
function historialParaComparar() {
  if (!_histPromise) {
    _histPromise = getHistorial('0000').catch(err => { _histPromise = null; throw err; });
  }
  return _histPromise;
}

function previewWarningsHtml(avisos, info) {
  return (avisos.length ? `
    <div class="foc-warn">
      <div class="foc-warn-t">${icSvg('alert')} Revisá antes de generar</div>
      <ul>${avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    </div>` : '')
    + fichaInfoHtml(info);
}

function closePreview() {
  const modal = $('modal-preview');
  const blobUrl = modal.dataset.blobUrl;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); delete modal.dataset.blobUrl; }
  $('preview-body').innerHTML = '';
  modal.classList.add('hidden');
}

// ---- Cargar OC como base (desde historial) ----
// La OC cargada con "Usar como base", hasta que se genera o se limpia el
// formulario: si es de otra persona, al emitir se ofrece anularla (revisarRepetida).
let _ocBase = null;

function loadOCBase(oc) {
  _ocBase = oc;
  const prov = oc.proveedor || {};
  $('proveedor').value                = prov.nombre          || '';
  $('cuit-proveedor').value           = prov.cuit            || '';
  $('nombre-proveedor').value         = prov.nombre_contacto || '';
  $('codigo-interno-proveedor').value = prov.codigoInterno   || '';
  $('domicilio-proveedor').value      = prov.domicilio       || '';
  $('telefonos-proveedor').value     = prov.telefonos       || '';
  $('condicion-iva-proveedor').value = prov.condicionIVA    || 'Resp. Inscripto';
  $('ref-presupuesto').value         = '';
  // Una OC vieja puede traer un nombre de obra que ya no está en el padrón
  // (renombrada o unificada): en ese caso el campo queda vacío para reelegir.
  setObraValue(oc.obra);
  // El rubro se recupera sólo si sigue vigente en esa obra (id o nombre: una OC
  // vieja puede traer un rubro que después se quitó o se recargó con otro id).
  const rubrosObra = rubrosDeObraActual();
  const rubroPrev  = oc.rubro || null;
  setRubro(rubroPrev
    ? rubrosObra.find(r => r.id === rubroPrev.id) ||
      rubrosObra.find(r => r.nombre === rubroPrev.nombre) || null
    : null);
  setEquipo(oc.equipo || null);
  setCategoria(oc.equipo?.categoria || null);
  $('condicion-pago').value          = oc.condicionPago  || '';
  $('plazo-entrega').value           = '';
  $('lugar-entrega').value           = '';
  $('observaciones').value           = '';

  items = (oc.items || []).map(it => ({
    descripcion:      it.desc     || '',
    unidad:           it.unidad   || '',
    cantidad:         it.cant     || 0,
    precio_unitario:  it.unitario || 0
  }));

  descuento = { pct: oc.descuento?.pct ?? null, monto: oc.descuento?.monto || 0 };
  noGravado = { pct: oc.noGravado?.pct ?? null, monto: oc.noGravado?.monto || 0 };
  impuestos = (oc.impuestosExtra || []).map(imp => ({
    nombre: imp.nombre || '', pct: imp.pct ?? null, monto: imp.monto || 0
  }));

  $('pct-descuento').value   = descuento.pct  ? String(descuento.pct)  : '';
  $('monto-descuento').value = fmtMoneyDisplay(descuento.monto);
  $('pct-nogravado').value   = noGravado.pct  ? String(noGravado.pct)  : '';
  $('monto-nogravado').value = fmtMoneyDisplay(noGravado.monto);

  monedaUSD = (oc.moneda === 'USD');
  const monedaChk = $('moneda-toggle');
  if (monedaChk) monedaChk.checked = monedaUSD;
  updateMonedaLabels();

  clearFile();
  renderTable();
  renderImpuestos();
  recalcTotales();
  clearExtractStatus();
  toast(`Base cargada: OC ${oc.nroOC}`, 'info');
}

// ---- OC armada desde Proveedores ----
// Trae el proveedor (con sus datos de la base), la condición de pago habitual,
// los artículos tildados con el último precio y los impuestos en % de su última
// OC. La obra queda para elegir.
function loadOCDesdeProveedor(d) {
  _ocBase = null;
  const p = d.proveedor || {};
  $('proveedor').value                = p.nombre          || '';
  $('cuit-proveedor').value           = p.cuit            || '';
  $('nombre-proveedor').value         = p.nombre_contacto || '';
  $('codigo-interno-proveedor').value = p.codigoInterno   || '';
  $('domicilio-proveedor').value      = p.domicilio       || '';
  $('telefonos-proveedor').value      = p.telefonos       || '';
  $('condicion-iva-proveedor').value  = p.condicionIVA    || 'Resp. Inscripto';
  $('ref-presupuesto').value          = '';
  if (d.condicionPago) $('condicion-pago').value = d.condicionPago;
  _loadedProvCuit = p.enBase ? (p.enBase.replace(/\D/g, '') || null) : null;
  snapshotProvider();

  items = (d.items || []).map(it => ({
    descripcion:     it.descripcion     || '',
    unidad:          it.unidad          || 'u',
    cantidad:        it.cantidad        || 1,
    precio_unitario: it.precio_unitario || 0
  }));
  impuestos = (d.impuestos || []).map(imp => ({ nombre: imp.nombre || '', pct: imp.pct ?? null, monto: 0 }));
  monedaUSD = d.moneda === 'USD';
  const monedaChk = $('moneda-toggle');
  if (monedaChk) monedaChk.checked = monedaUSD;
  updateMonedaLabels();

  renderTable();
  renderImpuestos();
  recalcTotales();
  if (typeof updateOCSummaries === 'function') updateOCSummaries();
  const n = items.length;
  toast(n ? `${n} ${n === 1 ? 'artículo' : 'artículos'} de ${p.nombre} con el último precio. Revisá la obra.`
          : `OC a ${p.nombre}. Revisá la obra y cargá los ítems.`, 'info');
}

// ---- Nueva OC mismo proveedor ----
function resetFormKeepProvider() {
  _ocBase = null;
  $('ref-presupuesto').value  = '';
  $('obra').value             = '';
  setRubro(null);
  syncRubroCombo();
  setEquipo(null);
  $('condicion-pago').value   = '';
  $('plazo-entrega').value    = '';
  $('lugar-entrega').value    = '';
  $('observaciones').value    = '';

  items     = [];
  descuento = { pct: null, monto: 0 };
  noGravado = { pct: null, monto: 0 };
  impuestos = [];

  $('pct-descuento').value   = '';
  $('monto-descuento').value = fmtMoneyDisplay(0);
  $('pct-nogravado').value   = '';
  $('monto-nogravado').value = fmtMoneyDisplay(0);

  resetIVAToggle();
  resetMonedaToggle();
  hideVerifBanner();
  clearFile();
  renderTable();
  renderImpuestos();
  recalcTotales();
  clearExtractStatus();
  $('btn-same-provider').classList.add('hidden');
  borrarBorrador();
  toast('Nueva OC — proveedor conservado.', 'info');
  aplicarObraRecordada();
  $('obra').focus();
}

// ---- Reset ----
function resetForm() {
  _ocBase = null;
  ['proveedor','cuit-proveedor','nombre-proveedor','codigo-interno-proveedor',
   'domicilio-proveedor','telefonos-proveedor',
   'ref-presupuesto','obra','condicion-pago','plazo-entrega','lugar-entrega','observaciones']
    .forEach(id => { $(id).value = ''; });
  setRubro(null);
  syncRubroCombo();
  setEquipo(null);
  _loadedProvCuit = null;
  $('condicion-iva-proveedor').value = 'Resp. Inscripto';
  snapshotProvider();

  items     = [];
  descuento = { pct: null, monto: 0 };
  noGravado = { pct: null, monto: 0 };
  impuestos = [];

  $('pct-descuento').value    = '';
  $('monto-descuento').value  = fmtMoneyDisplay(0);
  $('pct-nogravado').value    = '';
  $('monto-nogravado').value  = fmtMoneyDisplay(0);

  resetIVAToggle();
  resetMonedaToggle();
  hideVerifBanner();
  clearFile();
  clearManualOCNumber();
  renderTable();
  renderImpuestos();
  recalcTotales();
  clearExtractStatus();
  $('btn-same-provider').classList.add('hidden');
  borrarBorrador();
  toast('Formulario limpiado.', 'info');
  aplicarObraRecordada();
}

// ---- Toast ----


// ---- Utils ----
function formatDateDisplay(date) {
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoneyDisplay(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInput(n) {
  const v = parseFloat(n) || 0;
  return v === 0 ? '0' : String(v);
}
function parseArgFloat(val) {
  if (typeof val === 'number') return val;
  const s = String(val || '').trim();
  const hasCommaDecimal = /,\d{1,2}$/.test(s);
  const n = hasCommaDecimal
    ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
    : parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function formatBytes(bytes) {
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
