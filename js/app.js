/* ===================================================
   VIMECO S.A. — Generador de Órdenes de Compra
   app.js
   =================================================== */

// ---- OC Number (contador global en Firebase) ----
function getOCBranch()       { return sessionStorage.getItem('responsable_code') || '0001'; }
function formatOCNumber(seq) { return `${getOCBranch()}-${String(seq).padStart(8, '0')}`; }

async function refreshOCNumberDisplay() {
  try {
    const seq = await readNextOCSeq();
    $('oc-number-display').textContent = formatOCNumber(seq);
  } catch {
    $('oc-number-display').textContent = '—';
  }
}

// ---- State ----
let items        = [];
let selectedFile = null;
let descuento    = { pct: null, monto: 0 };
let noGravado    = { pct: null, monto: 0 };
let impuestos    = [];   // [{nombre, pct, monto}]

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

  $('btn-logout').addEventListener('click', logout);
  $('btn-new-oc').addEventListener('click', resetForm);
  $('btn-clear-form').addEventListener('click', resetForm);
  $('btn-add-row').addEventListener('click', addEmptyRow);
  $('btn-generate').addEventListener('click', handleGenerate);
  $('btn-extract').addEventListener('click', handleExtract);
  $('btn-clear-file').addEventListener('click', clearFile);
  $('btn-add-impuesto').addEventListener('click', addImpuestoRow);

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

  setupImportButtons();
  setupObraCombo();
  setupProveedorCombo();
  renderTable();
  renderImpuestos();
  recalcTotales();

  await loadLogo();
  loadProveedoresCache();
  checkSharedFile();
});

// ---- Auth ----
function logout() {
  sessionStorage.clear();
  localStorage.removeItem('responsable_code');
  localStorage.removeItem('responsable_name');
  window.location.href = 'index.html';
}

// ---- Web Share Target: recibe archivo compartido desde otra app ----
async function checkSharedFile() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('share-target');
    const match = await cache.match('shared-file');
    if (!match) return;
    await cache.delete('shared-file');
    const blob = await match.blob();
    const ext  = blob.type === 'application/pdf' ? '.pdf' : '.jpg';
    handleFileSelected(new File([blob], 'compartido' + ext, { type: blob.type }));
    toast('Archivo recibido. Usá "Extraer con Gemini" para cargar los datos.', 'success');
  } catch (e) {
    console.warn('checkSharedFile:', e);
  }
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
function setupObraCombo() {
  if (typeof OBRAS === 'undefined' || !OBRAS.length) return;

  const input    = $('obra');
  const arrow    = $('obra-arrow');
  const dropdown = $('obra-dropdown');

  function buildOptions(filter) {
    dropdown.innerHTML = '';
    const q = (filter || '').toLowerCase();
    OBRAS
      .filter(o => !q || o.toLowerCase().includes(q))
      .forEach(obra => {
        const div = document.createElement('div');
        div.className = 'combo-option';
        div.textContent = obra;
        div.addEventListener('mousedown', e => {
          e.preventDefault(); // evita que el input pierda el foco
          input.value = obra;
          dropdown.classList.add('hidden');
        });
        dropdown.appendChild(div);
      });
  }

  arrow.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) { dropdown.classList.add('hidden'); return; }
    buildOptions('');
    dropdown.classList.remove('hidden');
    input.focus();
  });

  input.addEventListener('input', () => {
    buildOptions(input.value);
    const hasOptions = dropdown.querySelector('.combo-option');
    dropdown.classList.toggle('hidden', !hasOptions);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
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
    $('proveedor').value               = p.nombre       || '';
    $('cuit-proveedor').value          = p.cuit         || '';
    $('domicilio-proveedor').value     = p.domicilio    || '';
    $('telefonos-proveedor').value     = p.telefonos    || '';
    $('condicion-iva-proveedor').value = p.condicionIVA || '';
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

  const warnings = [];
  if (r.items?.length) {
    r.items.forEach((it, idx) => {
      if (it.total_documento > 0) {
        const calc = (it.cantidad || 0) * (it.precio_unitario || 0);
        const diff = Math.abs(calc - it.total_documento) / it.total_documento;
        if (diff > 0.01) {
          warnings.push(`⚠️ Revisar ítem ${idx + 1}: total calculado ${fmtMoneyDisplay(calc)} ≠ documento ${fmtMoneyDisplay(it.total_documento)}`);
        }
      }
    });
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
  return warnings;
}

async function handleExtract() {
  if (!selectedFile) return;
  setExtractStatus('loading', 'Analizando documento con Gemini 2.5 Flash Lite…');
  $('btn-extract').disabled = true;

  try {
    const r = await extractFromFile(selectedFile);
    const warnings = applyExtractionResult(r);
    const impMsg = impuestos.length ? ` y ${impuestos.length} impuesto(s)` : '';
    if (r.items?.length) {
      setExtractStatus('success', `✓ Se extrajeron ${r.items.length} ítem(s)${impMsg}.`);
      toast(`Gemini extrajo ${r.items.length} ítem(s)${impMsg}.`, 'success');
      warnings.forEach(w => toast(w, 'warning'));
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

// ---- Items table ----
function normalizeItem(it) {
  return {
    descripcion:     String(it.descripcion || '').trim(),
    unidad:          String(it.unidad || 'u').trim(),
    cantidad:        parseFloat(it.cantidad) || 0,
    precio_unitario: parseFloat(it.precio_unitario) || 0
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
        <button class="btn btn-icon btn-danger btn-sm btn-del" title="Eliminar">✕</button>
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
    card.className   = 'item-card';
    card.dataset.idx = idx;
    card.innerHTML = `
      <div class="item-card-r1">
        <input type="text" class="item-card-desc" value="${esc(item.descripcion)}" placeholder="Descripción del ítem...">
        <button class="btn btn-icon btn-danger btn-sm btn-del" title="Eliminar">✕</button>
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
        <button class="btn btn-icon btn-danger btn-sm btn-del-imp" title="Eliminar">✕</button>
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
  const proveedor = $('proveedor').value.trim();
  const obra      = $('obra').value.trim();
  if (!proveedor) { toast('Ingresá el nombre del proveedor.', 'error'); $('proveedor').focus(); return false; }
  if (!obra)      { toast('Ingresá la obra / proyecto.', 'error'); $('obra').focus(); return false; }
  if (!items.length) { toast('Agregá al menos un ítem a la orden.', 'error'); return false; }
  if (items.some(it => !it.descripcion.trim())) { toast('Completá la descripción de todos los ítems.', 'error'); return false; }
  return true;
}

function buildOCData(numero) {
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
      nombre:    proveedor,
      cuit:      $('cuit-proveedor').value.trim()          || '—',
      domicilio: $('domicilio-proveedor').value.trim()     || '—',
      iva:       $('condicion-iva-proveedor').value.trim() || '—',
      telefonos: $('telefonos-proveedor').value.trim()     || '—',
      ref:       $('ref-presupuesto').value.trim()         || '—',
      ubicacion: obra,
      pago:      $('condicion-pago').value.trim()   || '—',
      plazo:     $('plazo-entrega').value.trim()    || '—',
      lugar:     $('lugar-entrega').value.trim()    || '—'
    },
    items: items.map(it => ({
      desc:     it.descripcion || '—',
      unidad:   it.unidad      || '—',
      cant:     it.cantidad,
      unitario: it.precio_unitario,
      total:    roundCents((parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0))
    })),
    impuestos:   pdfTotals,
    totalLetras: numberToWords(total),
    _total:      total
  };
}

async function handleGenerate() {
  if (!validateOCForm()) return;

  const btn = $('btn-generate');
  btn.disabled = true;
  btn.innerHTML = '⏳ Asignando número…';

  let numero;
  try {
    if (typeof window.claimNextOCSeq !== 'function')
      throw new Error('Firebase no cargó — recargá la página (F5).');
    numero = formatOCNumber(await window.claimNextOCSeq());
  } catch (err) {
    toast(`Error N° OC: ${err.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = '🖨 Generar PDF — Orden de Compra';
    return;
  }

  const ocData = buildOCData(numero);
  const fname  = `OC_${numero}_${sanitize(ocData.proveedor.nombre || 'SinProveedor')}.pdf`;

  let blob;
  try {
    blob = generateOCBlob(ocData);
  } catch (err) {
    toast(`Error al generar el PDF: ${err.message}`, 'error');
    console.error(err);
    btn.disabled = false;
    btn.innerHTML = '🖨 Generar PDF — Orden de Compra';
    return;
  }

  // Guardar en historial (no bloquea si falla)
  saveOCToHistory(ocData, ocData._total).then(() => {
    updateProveedoresCache();
  }).catch(e => console.warn('saveOCToHistory:', e));

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
  btn.innerHTML = '🖨 Generar PDF — Orden de Compra';
}

// ---- Vista previa ----
async function handlePreview() {
  if (!validateOCForm()) return;

  const btn = $('btn-preview');
  btn.disabled = true;

  let numero;
  try {
    const seq = await readNextOCSeq();
    numero = formatOCNumber(seq);
  } catch {
    numero = '????-????????';
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

// ---- Reset ----
function resetForm() {
  ['proveedor','cuit-proveedor','domicilio-proveedor','telefonos-proveedor',
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

  clearFile();
  renderTable();
  renderImpuestos();
  recalcTotales();
  clearExtractStatus();
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
