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
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);

  $('hdr-name').textContent = name;
  $('date-display').textContent = formatDateDisplay(new Date());
  refreshOCNumberDisplay();

  $('btn-new-oc').addEventListener('click', resetForm);
  $('btn-clear-form').addEventListener('click', resetForm);
  $('btn-add-row').addEventListener('click', addEmptyRow);
  $('btn-generate').addEventListener('click', handleGenerate);
  $('btn-extract').addEventListener('click', handleExtract);
  $('btn-clear-file').addEventListener('click', clearFile);
  $('btn-add-impuesto').addEventListener('click', addImpuestoRow);
  $('verif-banner-close').addEventListener('click', hideVerifBanner);
  setupMenu();
  setupIVAToggle();

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

  setupFirmaModalButtons();
  setupImportButtons();
  setupObraCombo();
  setupProveedorCombo();
  setupOCNumberEdit();
  renderTable();
  renderImpuestos();
  recalcTotales();

  await loadLogo();
  loadProveedoresCache();
  checkSharedFile();
  retryDriveQueue().catch(() => {});
  window.addEventListener('online', () => retryDriveQueue().catch(() => {}));

  getFirma(code).then(f => { firmaBase64 = f || null; }).catch(() => {});

  const ocBaseRaw = sessionStorage.getItem('oc_base');
  if (ocBaseRaw) {
    try { loadOCBase(JSON.parse(ocBaseRaw)); } catch (e) { console.warn('loadOCBase:', e); }
    sessionStorage.removeItem('oc_base');
  }
});

// ---- Auth ----
function logout() {
  sessionStorage.clear();
  localStorage.removeItem('responsable_code');
  localStorage.removeItem('responsable_name');
  localStorage.removeItem('vimeco_session');
  window.location.href = 'index.html';
}

// ---- IVA Toggle ----
function setupIVAToggle() {
  const checkbox = $('iva-toggle');
  const pctWrap  = $('iva-pct-wrap');
  const pctInput = $('iva-pct');

  checkbox.addEventListener('change', () => {
    ivaActive = checkbox.checked;
    pctWrap.classList.toggle('hidden', !ivaActive);
    if (ivaActive) {
      ivaPct = parseFloat(pctInput.value) || 21;
      applyIVAToggle();
    } else {
      revertIVAToggle();
    }
    renderTable();
    recalcTotales();
  });

  pctInput.addEventListener('change', () => {
    if (!ivaActive) return;
    revertIVAToggle();
    ivaPct = parseFloat(pctInput.value) || 21;
    applyIVAToggle();
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

  const code = sessionStorage.getItem('responsable_code');
  if (code === '0000') {
    $('btn-usuarios').classList.remove('hidden');
    $('btn-obras').classList.remove('hidden');
  }

  $('btn-usuarios').addEventListener('click',  () => { window.location.href = 'usuarios.html'; });
  $('btn-obras').addEventListener('click',     () => { window.location.href = 'obras.html'; });
  $('btn-logout').addEventListener('click', logout);
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

function setupFirmaModalButtons() {
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
      btn.disabled = false; btn.textContent = 'Guardar firma';
    }
  });
}

// ---- Cola offline Drive ----
async function retryDriveQueue() {
  if (typeof driveQueue === 'undefined' || typeof uploadToDrive !== 'function') return;
  let items;
  try { items = await driveQueue.getAll(); } catch { return; }
  if (!items.length) return;

  for (const item of items) {
    try {
      const pdfBlob = new Blob([item.pdfBuf], { type: 'application/pdf' });
      const srcFile = item.srcBuf
        ? new File([item.srcBuf], item.srcName || 'archivo', { type: item.srcType || 'application/octet-stream' })
        : null;
      const { obrasFolderId, proveedoresFolderId } = await uploadToDrive(pdfBlob, item.pdfName,
        { obra: item.obra, fecha: item.fecha, proveedor: item.proveedor, nroOC: item.nroOC },
        srcFile
      );
      await driveQueue.dequeue(item.histKey);
      if (obrasFolderId || proveedoresFolderId)
        patchHistorialEntry(item.histKey, { drive_folder_obras_id: obrasFolderId, drive_folder_proveedores_id: proveedoresFolderId }).catch(() => {});
      toast(`OC ${item.nroOC} subida a Drive.`, 'success');
    } catch (_) {
      // Sigue sin conexión o error — se mantiene en la cola
    }
  }
}

// ---- Web Share Target: recibe archivo compartido desde otra app ----
async function checkSharedFile() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('share-target');
    const match = await cache.match('shared-file');
    if (!match) return;
    // No borrar todavía: el modal decide qué hacer con él
    const blob     = await match.blob();
    const origName = match.headers.get('X-File-Name') || '';
    const ext      = blob.type === 'application/pdf' ? '.pdf' : blob.type.startsWith('image/') ? '.jpg' : '';
    const filename = origName || ('compartido' + ext);
    const file     = new File([blob], filename, { type: blob.type });
    showShareChoiceModal(file);
  } catch (e) {
    console.warn('checkSharedFile:', e);
  }
}

async function deleteSharedFile() {
  try { const c = await caches.open('share-target'); await c.delete('shared-file'); } catch (_) {}
}

function showShareChoiceModal(file) {
  $('share-choice-filename').textContent = file.name;
  $('modal-share-choice').classList.remove('hidden');

  $('btn-share-generar').onclick = () => {
    $('modal-share-choice').classList.add('hidden');
    deleteSharedFile();
    handleFileSelected(file);
    toast('Archivo cargado. Usá "Extraer con IA" para procesar.', 'success');
  };

  $('btn-share-adjuntar').onclick = () => {
    $('modal-share-choice').classList.add('hidden');
    // El archivo queda en cache como 'shared-file'; adjuntar.js lo leerá
    window.location.href = 'adjuntar.html';
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
async function setupObraCombo() {
  const input    = $('obra');
  const arrow    = $('obra-arrow');
  const dropdown = $('obra-dropdown');

  let obrasActivas = [];
  let todasObras   = [];

  try {
    [obrasActivas, todasObras] = await Promise.all([getObrasActivas(), getAllObras()]);
  } catch (e) {
    console.warn('setupObraCombo:', e);
  }

  function selectObra(obra) {
    input.value = obra.nombre;
    dropdown.classList.add('hidden');
    const lugarInput = $('lugar-entrega');
    if (obra.lugar_entrega && (!lugarInput.value.trim() || lugarInput.dataset.autoFilled === '1')) {
      lugarInput.value = obra.lugar_entrega;
      lugarInput.dataset.autoFilled = '1';
    }
  }

  function buildOptions(list) {
    dropdown.innerHTML = '';
    list.forEach(obra => {
      const div = document.createElement('div');
      div.className = 'combo-option';
      div.textContent = obra.nombre;
      if (!obra.activa) {
        div.style.color = 'var(--gray-400)';
        div.style.fontStyle = 'italic';
      }
      div.addEventListener('mousedown', e => { e.preventDefault(); selectObra(obra); });
      dropdown.appendChild(div);
    });
  }

  arrow.addEventListener('click', e => {
    e.stopPropagation();
    if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); return; }
    buildOptions(obrasActivas);
    if (dropdown.children.length) dropdown.classList.remove('hidden');
    input.focus();
  });

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    if (!q) { dropdown.classList.add('hidden'); return; }
    const filtered = todasObras.filter(o => o.nombre.toLowerCase().includes(q));
    buildOptions(filtered);
    dropdown.classList.toggle('hidden', !dropdown.children.length);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
  });

  $('lugar-entrega').addEventListener('input', () => {
    delete $('lugar-entrega').dataset.autoFilled;
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.combo-wrap')) dropdown.classList.add('hidden');
  });
}

// ---- Caché y autocompletado de proveedores ----
async function loadProveedoresCache() {
  try {
    const lista = await getProveedores();
    sessionStorage.setItem('proveedores_cache', JSON.stringify(lista));
  } catch (e) {
    console.warn('loadProveedoresCache:', e);
  }
}

async function updateProveedoresCache() {
  try {
    const lista = await getProveedores();
    sessionStorage.setItem('proveedores_cache', JSON.stringify(lista));
  } catch (_) {}
}

function getCachedProveedores() {
  try { return JSON.parse(sessionStorage.getItem('proveedores_cache') || '[]'); }
  catch { return []; }
}

function setupProveedorCombo() {
  const input    = $('proveedor');
  const dropdown = $('proveedor-dropdown');

  function fillProveedor(p) {
    $('proveedor').value               = p.nombre          || '';
    $('cuit-proveedor').value          = p.cuit            || '';
    $('nombre-proveedor').value        = p.nombre_contacto || '';
    $('contacto-proveedor').value      = p.contacto        || '';
    $('domicilio-proveedor').value     = p.domicilio       || '';
    $('telefonos-proveedor').value     = p.telefonos       || '';
    $('condicion-iva-proveedor').value = p.condicionIVA    || '';
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
}

// ---- Import buttons ----
function setupImportButtons() {
  const fileInput   = $('file-input');
  const cameraInput = $('camera-input');
  const btnUpload   = $('btn-upload-file');
  const btnCamera   = $('btn-camera');
  const btnVoice    = $('btn-voice');

  if ('ontouchstart' in window || window.innerWidth <= 768) {
    btnCamera.style.display = '';
  }

  btnUpload.addEventListener('click', () => fileInput.click());
  btnCamera.addEventListener('click', () => cameraInput.click());
  btnVoice.addEventListener('click',  () => window.toggleVoiceRecording(btnVoice));

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
  nameEl.textContent = `${file.name} (${formatBytes(file.size)})`;
  nameEl.classList.remove('hidden');
  $('btn-extract').disabled = false;
  $('btn-clear-file').classList.remove('hidden');
  clearExtractStatus();
}

function clearFile() {
  selectedFile = null;
  $('file-input').value   = '';
  $('camera-input').value = '';
  $('upload-filename').classList.add('hidden');
  $('btn-extract').disabled = true;
  $('btn-clear-file').classList.add('hidden');
  clearExtractStatus();
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
  fillIfEmpty('obra',                    r.ubicacion);
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
      toast('⚠️ Los precios podrían incluir IVA — revisá el toggle "Precios con IVA incluido".', 'warning');
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
    const impMsg = impuestos.length ? ` y ${impuestos.length} impuesto(s)` : '';
    if (r.items?.length) {
      setExtractStatus('success', `✓ Se extrajeron ${r.items.length} ítem(s)${impMsg}.`);
      toast(`IA extrajo ${r.items.length} ítem(s)${impMsg}.`, 'success');
    } else {
      setExtractStatus('success', '✓ Datos del proveedor completados. No se detectaron ítems.');
      toast('Datos extraídos. No se detectaron ítems — podés agregarlos manualmente.', 'warning');
    }
  } catch (err) {
    setExtractStatus('error', `Error: ${err.message}`);
    toast(err.message, 'error');
    $('btn-extract').disabled = false;
  }
}

// ---- Voice callbacks (called from voice.js) ----
window.onVoiceRecorded = function(result) {
  applyExtractionResult(result);
  const itemsMsg = result.items?.length ? ` con ${result.items.length} ítem(s)` : '';
  toast(`Voz procesada exitosamente${itemsMsg}.`, 'success');
};

window.showVoiceError = function(msg) {
  toast(`Error de voz: ${msg}`, 'error');
};

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
function validateOCForm() {
  const proveedor     = $('proveedor').value.trim();
  const cuit          = $('cuit-proveedor').value.trim();
  const condicionPago = $('condicion-pago').value.trim();
  const obra          = $('obra').value.trim();
  if (!proveedor)     { toast('Ingresá la razón social del proveedor.', 'error'); $('proveedor').focus(); return false; }
  if (!cuit)          { toast('Ingresá el CUIT del proveedor.', 'error'); $('cuit-proveedor').focus(); return false; }
  if (!condicionPago) { toast('Ingresá la condición de pago.', 'error'); $('condicion-pago').focus(); return false; }
  if (!obra)          { toast('Ingresá la obra / proyecto.', 'error'); $('obra').focus(); return false; }
  if (!items.length)  { toast('Agregá al menos un ítem a la orden.', 'error'); return false; }
  if (items.some(it => !it.descripcion.trim())) { toast('Completá la descripción de todos los ítems.', 'error'); return false; }
  return true;
}

function buildOCData(numero, firma = null) {
  const proveedor = $('proveedor').value.trim();
  const obra      = $('obra').value.trim();
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
    ejecutor: sessionStorage.getItem('responsable_name'),
    proveedor: {
      nombre:           proveedor,
      cuit:             $('cuit-proveedor').value.trim()          || '—',
      nombre_contacto:  $('nombre-proveedor').value.trim()        || '—',
      contacto:         $('contacto-proveedor').value.trim()      || '—',
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

function confirmarFirma() {
  return new Promise(resolve => {
    const modal = $('modal-firma-confirm');
    modal.classList.remove('hidden');
    $('btn-firma-sin').onclick = () => { modal.classList.add('hidden'); resolve(false); };
    $('btn-firma-con').onclick = () => { modal.classList.add('hidden'); resolve(true); };
  });
}

async function handleGenerate() {
  if (!validateOCForm()) return;

  // Preguntar si incluir firma antes de bloquear el botón
  let usarFirma = false;
  if (firmaBase64) {
    usarFirma = await confirmarFirma();
  }

  const btn = $('btn-generate');
  btn.disabled = true;
  btn.innerHTML = '⏳ Asignando número…';

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
  const histSaved = saveOCToHistory(ocData, ocData._total)
    .then(() => { updateProveedoresCache(); return true; })
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
  toast(shared ? `OC ${numero} compartida.` : `OC ${numero} generada.`, 'success');
  btn.disabled = false;
  btn.innerHTML = icSvg('print') + ' Generar PDF — Orden de Compra';
  $('btn-same-provider').classList.remove('hidden');

  // Subir a Drive en background (espera historial para evitar race condition en PATCH)
  if (typeof uploadToDrive === 'function') {
    const driveObra  = ($('obra').value || '').trim() || 'Sin obra';
    const driveFecha = new Date().toISOString().slice(0, 10);
    const driveProv  = ocData.proveedor.nombre || 'Sin proveedor';
    histSaved.then(saved =>
      uploadToDrive(blob, fname, { obra: driveObra, fecha: driveFecha, proveedor: driveProv, nroOC: numero }, selectedFile)
        .then(({ obrasFolderId, proveedoresFolderId }) => {
          if (saved && (obrasFolderId || proveedoresFolderId))
            patchHistorialEntry(histKey, { drive_folder_obras_id: obrasFolderId, drive_folder_proveedores_id: proveedoresFolderId }).catch(() => {});
        })
        .catch(async () => {
          if (!navigator.onLine && typeof driveQueue !== 'undefined') {
            toast('Sin conexión. Se subirá a Drive cuando haya red.', 'warning');
            try {
              await driveQueue.enqueue({
                histKey, pdfBlob: blob, pdfName: fname,
                obra: driveObra, fecha: driveFecha, proveedor: driveProv,
                nroOC: numero, sourceFile: selectedFile
              });
            } catch (_) {}
          } else {
            toast('No se pudo subir a Drive. Se registró el error.', 'warning');
          }
        })
    );
  }
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
  openPreview(blob, numero);
}

function openPreview(blob, numero) {
  const blobUrl = URL.createObjectURL(blob);
  const modal   = $('modal-preview');
  const isMobile = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

  $('preview-title').textContent = `Vista previa — OC N° ${numero}`;
  const body = $('preview-body');
  body.innerHTML = '';

  if (isMobile) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:2rem;text-align:center;';
    wrap.innerHTML = `
      <p style="margin-bottom:1.25rem;color:var(--gray-600);">
        Los PDF no se pueden previsualizar en el navegador mobile.
      </p>
      <a href="${blobUrl}" target="_blank" class="btn btn-primary">Abrir PDF en nueva pestaña</a>`;
    body.appendChild(wrap);
  } else {
    const iframe = document.createElement('iframe');
    iframe.src   = blobUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    body.appendChild(iframe);
  }

  modal.dataset.blobUrl = blobUrl;
  modal.classList.remove('hidden');
}

function closePreview() {
  const modal = $('modal-preview');
  const blobUrl = modal.dataset.blobUrl;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); delete modal.dataset.blobUrl; }
  $('preview-body').innerHTML = '';
  modal.classList.add('hidden');
}

// ---- Cargar OC como base (desde historial) ----
function loadOCBase(oc) {
  const prov = oc.proveedor || {};
  $('proveedor').value               = prov.nombre          || '';
  $('cuit-proveedor').value          = prov.cuit            || '';
  $('nombre-proveedor').value        = prov.nombre_contacto || '';
  $('contacto-proveedor').value      = prov.contacto        || '';
  $('domicilio-proveedor').value     = prov.domicilio       || '';
  $('telefonos-proveedor').value     = prov.telefonos       || '';
  $('condicion-iva-proveedor').value = prov.condicionIVA    || 'Resp. Inscripto';
  $('ref-presupuesto').value         = '';
  $('obra').value                    = oc.obra           || '';
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

  clearFile();
  renderTable();
  renderImpuestos();
  recalcTotales();
  clearExtractStatus();
  toast(`Base cargada: OC ${oc.nroOC}`, 'info');
}

// ---- Nueva OC mismo proveedor ----
function resetFormKeepProvider() {
  $('ref-presupuesto').value  = '';
  $('obra').value             = '';
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
  hideVerifBanner();
  clearFile();
  renderTable();
  renderImpuestos();
  recalcTotales();
  clearExtractStatus();
  $('btn-same-provider').classList.add('hidden');
  toast('Nueva OC — proveedor conservado.', 'info');
  $('obra').focus();
}

// ---- Reset ----
function resetForm() {
  ['proveedor','cuit-proveedor','nombre-proveedor','contacto-proveedor',
   'domicilio-proveedor','telefonos-proveedor',
   'ref-presupuesto','obra','condicion-pago','plazo-entrega','lugar-entrega','observaciones']
    .forEach(id => { $(id).value = ''; });
  $('condicion-iva-proveedor').value = 'Resp. Inscripto';

  items     = [];
  descuento = { pct: null, monto: 0 };
  noGravado = { pct: null, monto: 0 };
  impuestos = [];

  $('pct-descuento').value    = '';
  $('monto-descuento').value  = fmtMoneyDisplay(0);
  $('pct-nogravado').value    = '';
  $('monto-nogravado').value  = fmtMoneyDisplay(0);

  resetIVAToggle();
  hideVerifBanner();
  clearFile();
  clearManualOCNumber();
  renderTable();
  renderImpuestos();
  recalcTotales();
  clearExtractStatus();
  $('btn-same-provider').classList.add('hidden');
  toast('Formulario limpiado.', 'info');
}

// ---- Toast ----
function toast(msg, type = 'info') {
  const c  = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

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
