/* VIMECO S.A. — Bandeja de Autorizaciones
   OC que otros usuarios enviaron para que este usuario las firme. */

const $ = id => document.getElementById(id);

let pendientes  = [];      // OC en estado 'pendiente' dirigidas a mí (para firmar)
let misPedidos  = [];      // OC cuya autorización pedí yo (para ver el estado)
let resueltas   = [];      // OC que ya autoricé o rechacé yo
let myCode      = '';
let myName      = '';
let myFirma     = null;    // base64 de mi firma (o null si no tengo)
let currentOC   = null;    // OC abierta en la vista previa
let pendingSign = null;    // OC a firmar tras dibujar firma en el momento



function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeStr(str) {
  return (str || '').replace(/[^\w\s\-\.]/g, '_').substring(0, 60).trim();
}

function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- Render de la lista ----
function render() {
  const list = $('aut-list');
  if (typeof ponerBadge === 'function') ponerBadge(pendientes.length);
  $('aut-count').textContent = pendientes.length
    ? `${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''}` : '';

  if (!pendientes.length) {
    list.innerHTML = '<div class="hist-empty">No tenés OC pendientes de autorización.</div>';
    return;
  }

  list.innerHTML = '';
  pendientes.forEach(oc => {
    const card = document.createElement('div');
    card.className = 'hist-card';
    const solicitante = oc.autorizacion?.solicitadoPor?.nombre || oc.responsable?.nombre || '—';
    const total = oc.total != null ? `$ ${fmtMoney(oc.total)}` : '—';
    card.innerHTML = `
      <div class="aut-card-top">
        <span class="aut-nro">${esc(oc.nroOC)}</span>
        <span class="aut-fecha">${esc(oc.fecha || '')}</span>
      </div>
      <div class="aut-prov">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="aut-obra">${esc(oc.obra || '—')}</div>
      <div class="aut-bottom">
        <span class="aut-total">${total}</span>
        <span class="aut-meta">Pide: ${esc(solicitante)}</span>
      </div>
      <div class="aut-actions">
        <button class="foc-btn foc-btn--gen btn-revisar">${icSvg('edit')}Revisar y firmar</button>
        <button class="foc-btn foc-btn--del btn-rechazar-rapido">${icSvg('x')}Rechazar</button>
      </div>`;
    card.querySelector('.btn-revisar').addEventListener('click', () => abrirPreview(oc));
    card.querySelector('.btn-rechazar-rapido').addEventListener('click', () => { currentOC = oc; abrirRechazo(); });
    list.appendChild(card);
  });
}

// Botón "PDF" (compartir/descargar) como en Historial. Sólo las autorizadas:
// las pendientes no tienen PDF definitivo y una rechazada no se manda a nadie.
function btnPdfHtml(oc) {
  return oc.estado === 'autorizada'
    ? `<button class="foc-btn foc-btn--pdf btn-pdf" title="Descargar o compartir el PDF">${icSvg('share')}PDF</button>`
    : '';
}
function bindPdf(card, oc) {
  const btn = card.querySelector('.btn-pdf');
  if (btn) btn.addEventListener('click', () => compartirPdfOC(oc, btn));
}

// ---- "Mis pedidos": estado de las OC que YO mandé a autorizar ----
const SEEN_KEY = () => 'vimeco_solicitudes_vistas_' + myCode;

function estadoPedido(oc) {
  if (oc.estado === 'autorizada') return ['aprob',  'Aprobada'];
  if (oc.estado === 'rechazada')  return ['rech',   'Rechazada'];
  if (oc.estado === 'cancelada')  return ['canc',   'Cancelada'];
  return ['espera', 'En espera'];
}

// Resueltas (aprobada/rechazada) que todavía no vi — alimenta el globito.
function pedidosSinVer() {
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY()) || '[]'); } catch (_) {}
  return misPedidos.filter(oc =>
    (oc.estado === 'autorizada' || oc.estado === 'rechazada') && !seen.includes(oc._key)).length;
}

// Al abrir la bandeja se dan por vistas: el globito del menú se limpia.
function marcarPedidosVistos() {
  const resueltas = misPedidos
    .filter(oc => oc.estado === 'autorizada' || oc.estado === 'rechazada')
    .map(oc => oc._key);
  try {
    const prev   = JSON.parse(localStorage.getItem(SEEN_KEY()) || '[]');
    const merged = [...new Set([...prev, ...resueltas])];
    localStorage.setItem(SEEN_KEY(), JSON.stringify(merged));
  } catch (_) {}
}

function renderPedidos() {
  const list = $('ped-list');
  $('ped-count').textContent = misPedidos.length
    ? `${misPedidos.length} pedido${misPedidos.length !== 1 ? 's' : ''}` : '';

  if (!misPedidos.length) {
    list.innerHTML = '<div class="hist-empty">No mandaste ninguna OC a autorizar.</div>';
    return;
  }

  list.innerHTML = '';
  misPedidos.forEach(oc => {
    const [cls, txt] = estadoPedido(oc);
    const a     = oc.autorizacion || {};
    const total = oc.total != null ? `$ ${fmtMoney(oc.total)}` : '—';
    const quien = a.solicitadoA?.nombre || '—';
    let extra = '';
    if (oc.estado === 'rechazada' && a.motivoRechazo) {
      extra = `<div class="aut-motivo">Motivo: ${esc(a.motivoRechazo)}</div>`;
    } else if (oc.estado === 'autorizada' && a.firmante) {
      extra = `<div class="aut-meta">Firmó: ${esc(a.firmante)}</div>`;
    } else if (oc.estado === 'cancelada' && a.canceladoEn) {
      extra = `<div class="aut-meta">Cancelaste el pedido el ${esc(new Date(a.canceladoEn).toLocaleDateString('es-AR'))}</div>`;
    }
    const acciones = `<div class="aut-actions">
           <button class="foc-btn foc-btn--edit btn-ver">${icSvg('eye')}Vista previa</button>
           ${btnPdfHtml(oc)}
           ${oc.estado === 'rechazada' ? `<button class="foc-btn foc-btn--gen btn-rehacer" title="Cargar en el formulario para corregirla">${icSvg('undo')}Rehacer</button>` : ''}
           ${oc.estado === 'pendiente' ? '<button class="foc-btn foc-btn--clear btn-cancelar-pedido">Cancelar pedido</button>' : ''}
         </div>`;
    const card = document.createElement('div');
    card.className = 'hist-card';
    card.innerHTML = `
      <div class="aut-card-top">
        <span class="aut-nro">${esc(oc.nroOC)}</span>
        <span class="aut-estado aut-estado-${cls}">${txt}</span>
      </div>
      <div class="aut-prov">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="aut-obra">${esc(oc.obra || '—')}</div>
      <div class="aut-bottom">
        <span class="aut-total">${total}</span>
        <span class="aut-meta">A: ${esc(quien)}</span>
      </div>
      ${extra}
      ${acciones}`;
    card.querySelector('.btn-ver').addEventListener('click', () => abrirPreview(oc, true));
    bindPdf(card, oc);
    const btnRehacer = card.querySelector('.btn-rehacer');
    if (btnRehacer) btnRehacer.addEventListener('click', () => rehacerOC(oc));
    const btnCanc = card.querySelector('.btn-cancelar-pedido');
    if (btnCanc) btnCanc.addEventListener('click', () => cancelarPedido(oc, btnCanc));
    list.appendChild(card);
  });
}

// Rechazada → se carga en el formulario como "Usar como base" de Historial,
// para corregirla y mandarla de nuevo (sale con número nuevo).
function rehacerOC(oc) {
  sessionStorage.setItem('oc_base', JSON.stringify(oc));
  window.location.href = 'app.html';
}

// El solicitante se arrepiente antes de que la firmen: la OC queda 'cancelada'
// (el número ya se consumió, no se reutiliza) y sale de la bandeja del
// autorizador. Se relee el estado del servidor por si justo la resolvieron.
async function cancelarPedido(oc, btn) {
  const quien = oc.autorizacion?.solicitadoA?.nombre || 'El autorizador';
  if (!confirm(`¿Cancelar el pedido de autorización de la OC ${oc.nroOC}?\n\n` +
               `${quien} ya no la va a ver para firmar y el número de OC queda anulado.`)) return;
  const histKey = oc.nroOC.replace(/-/g, '');
  btn.disabled = true;
  try {
    const actual = await getHistorialEstado(histKey);
    if (actual !== 'pendiente') {
      toast(actual === 'autorizada' ? `La OC ${oc.nroOC} ya fue autorizada.`
          : actual === 'rechazada'  ? `La OC ${oc.nroOC} ya fue rechazada.`
          : `La OC ${oc.nroOC} ya no está pendiente.`, 'warning');
      if (actual) oc.estado = actual;
      renderPedidos();
      return;
    }
    const nuevaAut = { ...(oc.autorizacion || {}), canceladoEn: Date.now() };
    await patchHistorialEntry(histKey, { estado: 'cancelada', autorizacion: nuevaAut });
    oc.estado = 'cancelada';
    oc.autorizacion = nuevaAut;
    renderPedidos();
    toast(`Pedido de la OC ${oc.nroOC} cancelado.`, 'info');
  } catch (e) {
    toast('No se pudo cancelar el pedido. Revisá tu conexión.', 'error');
    console.error('cancelarPedido:', e);
    btn.disabled = false;
  }
}

// Antes de firmar o rechazar: si el solicitante canceló el pedido (o ya lo
// resolvió otro), no pisarlo. Si no se puede leer, se sigue como antes.
async function siguePendiente(oc) {
  let actual;
  try { actual = await getHistorialEstado(oc.nroOC.replace(/-/g, '')); } catch (_) { return true; }
  if (actual === 'pendiente') return true;
  toast(actual === 'cancelada' ? `El solicitante canceló el pedido de la OC ${oc.nroOC}.`
                               : `La OC ${oc.nroOC} ya no está pendiente.`, 'warning');
  quitarDeLista(oc);
  cerrarRechazo();
  cerrarPreview();
  return false;
}

// ---- "Autorizadas": OC que YA resolví (firmé o rechacé) ----
function renderResueltas() {
  const list = $('res-list');
  const firmadas = resueltas.filter(oc => oc.estado === 'autorizada').length;
  $('res-count').textContent = firmadas
    ? `${firmadas} autorizada${firmadas !== 1 ? 's' : ''}` : '';

  if (!resueltas.length) {
    list.innerHTML = '<div class="hist-empty">Todavía no autorizaste ninguna OC.</div>';
    return;
  }

  list.innerHTML = '';
  resueltas.forEach(oc => {
    const [cls, txt] = estadoPedido(oc);
    const a       = oc.autorizacion || {};
    const total   = oc.total != null ? `$ ${fmtMoney(oc.total)}` : '—';
    const quien   = a.solicitadoPor?.nombre || oc.responsable?.nombre || '—';
    const cuando  = a.resueltoEn ? new Date(a.resueltoEn).toLocaleDateString('es-AR') : (oc.fecha || '');
    let extra = '';
    if (oc.estado === 'rechazada' && a.motivoRechazo) {
      extra = `<div class="aut-motivo">Motivo: ${esc(a.motivoRechazo)}</div>`;
    }
    const card = document.createElement('div');
    card.className = 'hist-card';
    card.innerHTML = `
      <div class="aut-card-top">
        <span class="aut-nro">${esc(oc.nroOC)}</span>
        <span class="aut-estado aut-estado-${cls}">${txt}</span>
      </div>
      <div class="aut-prov">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="aut-obra">${esc(oc.obra || '—')}</div>
      <div class="aut-bottom">
        <span class="aut-total">${total}</span>
        <span class="aut-meta">Pidió: ${esc(quien)}${cuando ? ' · ' + esc(cuando) : ''}</span>
      </div>
      ${extra}
      <div class="aut-actions">
        <button class="foc-btn foc-btn--edit btn-ver">${icSvg('eye')}Vista previa</button>
        ${btnPdfHtml(oc)}
      </div>`;
    card.querySelector('.btn-ver').addEventListener('click', () => abrirPreview(oc, true));
    bindPdf(card, oc);
    list.appendChild(card);
  });
}

// Al resolver una OC pasa de "Para firmar" a "Autorizadas" sin recargar.
function agregarAResueltas(oc, estado, aut) {
  resueltas.unshift({ ...oc, estado, autorizacion: aut });
  renderResueltas();
}

// ---- Tabs ----
function showTab(tab) {
  ['firmar', 'pedidos', 'resueltas'].forEach(t => {
    $('pane-' + t).classList.toggle('hidden', t !== tab);
    $('tab-' + t).classList.toggle('active', t === tab);
  });
}

function setTabCounts(sinVer) {
  const nf = $('n-firmar'), np = $('n-pedidos');
  if (pendientes.length) { nf.textContent = pendientes.length; nf.classList.remove('hidden'); }
  else nf.classList.add('hidden');
  if (sinVer) { np.textContent = sinVer; np.classList.remove('hidden'); }
  else np.classList.add('hidden');
}

// ---- Vista previa ----
// La misma ficha que la vista previa de la OC nueva (js/fichaOC.js), con el PDF
// a un toque. Las autorizadas se ven con la firma de quien las autorizó.
let _histPromise = null;
function historialParaComparar() {
  if (!_histPromise) {
    _histPromise = getHistorial('0000').catch(err => { _histPromise = null; throw err; });
  }
  return _histPromise;
}

function abrirPreview(oc, soloLectura) {
  cerrarPreview();
  currentOC = soloLectura ? null : oc;
  const modal = $('modal-preview');
  const data  = ocDataFromRecord(oc);
  const token = String(Math.random());
  modal.dataset.token = token;
  const vigente = () => modal.dataset.token === token;

  const quien = oc.autorizacion?.solicitadoPor?.nombre || oc.responsable?.nombre;
  pintarFichaOC(data, estadoChipFicha(oc) + (quien ? `<span class="foc-chip">Pide: ${esc(quien)}</span>` : ''));

  // Link al archivo fuente (presupuesto/factura) si el solicitante lo adjuntó.
  const fuente = $('preview-fuente');
  if (oc.fuenteUrl) { fuente.href = oc.fuenteUrl; fuente.classList.remove('hidden'); }
  else { fuente.removeAttribute('href'); fuente.classList.add('hidden'); }

  // Las ya resueltas y los pedidos propios se abren solo para mirarlos.
  $('preview-firmar').classList.toggle('hidden', !!soloLectura);
  $('preview-rechazar').classList.toggle('hidden', !!soloLectura);

  const pdf = $('preview-pdf');
  pdf.removeAttribute('href');
  pdf.setAttribute('aria-disabled', 'true');
  modal.classList.remove('hidden');

  ocDataParaPdf(oc).then(d => {
    if (!vigente()) return;
    const url = URL.createObjectURL(generateOCBlob(d));
    modal.dataset.blobUrl = url;
    pdf.href = url;
    pdf.removeAttribute('aria-disabled');
  }).catch(e => {
    if (vigente()) toast('No se pudo generar el PDF.', 'error');
    console.error('preview/pdf:', e);
  });

  // Comparación con las OC anteriores al mismo proveedor (llega después).
  historialParaComparar().then(hist => {
    if (!vigente()) return;
    const res = checkOCHistorial(data, hist, oc.timestamp);
    $('preview-warn').innerHTML = fichaInfoHtml(res.info) + comparacionHtml(res.cambios);
  }).catch(() => {});
}

function cerrarPreview() {
  const modal   = $('modal-preview');
  const blobUrl = modal.dataset.blobUrl;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); delete modal.dataset.blobUrl; }
  delete modal.dataset.token;
  $('preview-body').innerHTML = '';
  modal.classList.add('hidden');
}

// ---- Firmar y autorizar ----
// El estado se registra ANTES de subir el PDF. Firmar es el acto; archivarlo en
// Drive es el respaldo, y Novedades sabe resubir lo que quedó sin archivar. Con
// el orden al revés, cualquier demora de Drive se llevaba puesta la autorización
// entera: la firma estaba hecha, el botón seguía girando y la OC figuraba
// pendiente (le pasó a la 0000-00000323).
async function firmarOC(oc) {
  if (!oc) return;
  if (!myFirma) { pendingSign = oc; openFirmaModal(); return; }

  const btn = $('preview-firmar');
  if (btn && btn.disabled) return;   // ya hay una autorización en curso
  const btnHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Autorizando…'; }

  // El botón se repone pase lo que pase: si algo revienta después de arrancar,
  // dejarlo con el spinner puesto simula un trabajo que ya no existe.
  try {
    if (!(await siguePendiente(oc))) return;
    const ocData = ocDataFromRecord(oc);
    ocData._firma    = myFirma;   // firma del autorizador
    ocData._firmante = myName;    // nombre del autorizador bajo la firma
    // ocData.ejecutor queda igual = creador de la OC

    let blob;
    try {
      blob = generateOCBlob(ocData);
    } catch (e) {
      toast('Error al generar el PDF.', 'error');
      console.error('firmarOC/pdf:', e);
      return;
    }

    const histKey  = oc.nroOC.replace(/-/g, '');
    const nuevaAut = {
      ...(oc.autorizacion || {}),
      resueltoEn:  Date.now(),
      firmaCodigo: myCode,
      firmante:    myName,
      motivoRechazo: null
    };

    try {
      await patchHistorialEntry(histKey, { estado: 'autorizada', autorizacion: nuevaAut });
    } catch (e) {
      toast('No se pudo autorizar la OC. Revisá tu conexión.', 'error');
      console.error('firmarOC/patch:', e);
      return;
    }

    quitarDeLista(oc);
    agregarAResueltas(oc, 'autorizada', nuevaAut);
    cerrarPreview();
    toast(`OC ${oc.nroOC} autorizada.`, 'success');
    avisarSolicitante(oc, `OC ${oc.nroOC} autorizada`,
      `${myName} firmó la OC a ${ocData.proveedor.nombre || 'el proveedor'}.`);

    // Respaldo en Drive. Ya no condiciona la autorización, pero se espera igual
    // para poder avisar si el PDF no quedó archivado.
    const fname = `OC_${oc.nroOC}_${sanitizeStr(ocData.proveedor.nombre || 'SinProveedor')}.pdf`;
    const meta  = {
      obra:      oc.obra || ocData.proveedor.ubicacion || 'Sin obra',
      fecha:     (oc.timestamp ? new Date(oc.timestamp) : new Date()).toISOString().slice(0, 10),
      proveedor: ocData.proveedor.nombre || 'Sin proveedor',
      nroOC:     oc.nroOC,
      obrasFolderId:       oc.drive_folder_obras_id       || null,
      proveedoresFolderId: oc.drive_folder_proveedores_id || null
    };

    let folderIds = {};
    try {
      if (typeof uploadPdfToDrive === 'function') folderIds = await uploadPdfToDrive(blob, fname, meta);
    } catch (e) {
      console.warn('uploadPdfToDrive:', e);
      toast('OC autorizada, pero no se pudo subir el PDF a Drive.', 'warning');
    }

    const obrasId = folderIds.obrasFolderId       || oc.drive_folder_obras_id       || null;
    const provId  = folderIds.proveedoresFolderId || oc.drive_folder_proveedores_id || null;
    // Sólo si Drive devolvió carpetas: si no, el registro que ya tenía la OC vale.
    if (folderIds.obrasFolderId || folderIds.proveedoresFolderId) {
      patchHistorialEntry(histKey, {
        drive_folder_obras_id:       obrasId,
        drive_folder_proveedores_id: provId
      }).catch(e => console.warn('firmarOC/carpetas:', e));
    }

    if (typeof logOCActivity === 'function')
      logOCActivity(oc.nroOC, ocData.proveedor.nombre, oc.obra, oc.total, obrasId || provId);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
  }
}

// ---- Rechazar ----
function abrirRechazo() {
  $('rechazo-motivo').value = '';
  $('modal-rechazo').classList.remove('hidden');
}
function cerrarRechazo() { $('modal-rechazo').classList.add('hidden'); }

async function rechazarOC(oc, motivo) {
  if (!(await siguePendiente(oc))) return;
  const nuevaAut = {
    ...(oc.autorizacion || {}),
    resueltoEn:    Date.now(),
    motivoRechazo: motivo || ''
  };
  try {
    await patchHistorialEntry(oc.nroOC.replace(/-/g, ''), { estado: 'rechazada', autorizacion: nuevaAut });
  } catch (e) {
    toast('No se pudo rechazar la OC.', 'error');
    console.error('rechazarOC:', e);
    return;
  }
  quitarDeLista(oc);
  agregarAResueltas(oc, 'rechazada', nuevaAut);
  cerrarRechazo();
  cerrarPreview();
  toast(`OC ${oc.nroOC} rechazada.`, 'info');
  avisarSolicitante(oc, `OC ${oc.nroOC} rechazada`, motivo
    ? `${myName}: ${motivo}`
    : `${myName} rechazó la OC a ${oc.proveedor?.nombre || 'el proveedor'}.`);
}

// Push al que pidió la autorización (js/push.js), salvo que sea yo mismo.
function avisarSolicitante(oc, title, body) {
  const codigo = oc.autorizacion?.solicitadoPor?.codigo;
  if (!codigo || codigo === myCode || typeof notificarUsuario !== 'function') return;
  notificarUsuario(codigo, {
    title, body,
    url: 'autorizaciones.html?tab=pedidos',
    tag: 'aut-' + oc.nroOC.replace(/-/g, '')
  });
}

function quitarDeLista(oc) {
  pendientes = pendientes.filter(p => p.nroOC !== oc.nroOC);
  render();
}

// ---- Firma (canvas) ----
let _firmaDrawing = false, _firmaLX = 0, _firmaLY = 0;

function openFirmaModal() {
  const canvas = $('firma-canvas');
  const ctx    = canvas.getContext('2d');
  if (!canvas._ready) {
    canvas.width = 560; canvas.height = 200; canvas._ready = true;
    function pos(e) {
      const r  = canvas.getBoundingClientRect();
      const sx = canvas.width / r.width, sy = canvas.height / r.height;
      const s  = e.touches ? e.touches[0] : e;
      return { x: (s.clientX - r.left) * sx, y: (s.clientY - r.top) * sy };
    }
    function stroke(e) {
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(_firmaLX, _firmaLY); ctx.lineTo(p.x, p.y); ctx.stroke();
      _firmaLX = p.x; _firmaLY = p.y;
    }
    canvas.addEventListener('mousedown',  e => { _firmaDrawing = true; const p = pos(e); _firmaLX = p.x; _firmaLY = p.y; });
    canvas.addEventListener('mousemove',  e => { if (_firmaDrawing) stroke(e); });
    canvas.addEventListener('mouseup',    () => _firmaDrawing = false);
    canvas.addEventListener('mouseleave', () => _firmaDrawing = false);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); _firmaDrawing = true; const p = pos(e); _firmaLX = p.x; _firmaLY = p.y; }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (_firmaDrawing) stroke(e); }, { passive: false });
    canvas.addEventListener('touchend',   () => _firmaDrawing = false);
  }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#1a3a5c'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (myFirma) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = myFirma;
  }
  $('modal-firma').classList.remove('hidden');
}

function setupFirmaModal() {
  $('modal-firma-close').addEventListener('click', () => { $('modal-firma').classList.add('hidden'); pendingSign = null; });
  $('btn-firma-limpiar').addEventListener('click', () => {
    const canvas = $('firma-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  $('btn-firma-guardar').addEventListener('click', async () => {
    const canvas = $('firma-canvas');
    const base64 = canvas.toDataURL('image/png');
    const btn = $('btn-firma-guardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await saveFirma(myCode, base64);
      myFirma = base64;
      $('modal-firma').classList.add('hidden');
      toast('Firma guardada.', 'success');
      const oc = pendingSign; pendingSign = null;
      if (oc) firmarOC(oc);   // continúa con la autorización
    } catch {
      toast('Error al guardar la firma.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar y autorizar';
    }
  });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) {}
  myCode = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code') || sess?.codigo || '';
  myName = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name') || sess?.nombre || '';
  if (!myCode) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', myCode);
  sessionStorage.setItem('responsable_name', myName);

  $('hdr-name').textContent = myName || '';
  $('btn-back').addEventListener('click', () => { window.location.href = 'menu.html'; });
  // Modales
  $('modal-preview-close').addEventListener('click', cerrarPreview);
  $('preview-firmar').addEventListener('click', () => firmarOC(currentOC));
  $('preview-rechazar').addEventListener('click', abrirRechazo);
  $('modal-rechazo-close').addEventListener('click', cerrarRechazo);
  $('btn-rechazo-cancel').addEventListener('click', cerrarRechazo);
  $('btn-rechazo-confirm').addEventListener('click', () => {
    if (currentOC) rechazarOC(currentOC, $('rechazo-motivo').value.trim());
  });
  setupFirmaModal();

  // Tabs
  $('tab-firmar').addEventListener('click', () => showTab('firmar'));
  $('tab-pedidos').addEventListener('click', () => showTab('pedidos'));
  $('tab-resueltas').addEventListener('click', () => showTab('resueltas'));

  // Mi firma (para autorizar sin volver a dibujarla). Si la lectura tarda y
  // mientras tanto el usuario dibujó la suya, no pisarla: con la conexión lenta
  // esta respuesta llegaba después de guardarla y volvía a pedirla.
  getFirma(myCode).then(f => { if (!myFirma) myFirma = f || null; }).catch(() => {});

  // Cargar ambas bandejas: lo que me piden firmar y lo que yo pedí.
  try {
    [pendientes, misPedidos, resueltas] = await Promise.all([
      getAutorizacionesPendientes(myCode),
      (typeof getMisSolicitudes === 'function' ? getMisSolicitudes(myCode) : Promise.resolve([])).catch(() => []),
      (typeof getAutorizacionesResueltas === 'function' ? getAutorizacionesResueltas(myCode) : Promise.resolve([])).catch(() => [])
    ]);
  } catch (e) {
    $('aut-list').innerHTML = '<div class="hist-empty">No se pudieron cargar las autorizaciones. Revisá tu conexión.</div>';
    console.error('getAutorizacionesPendientes:', e);
    return;
  }

  const sinVer = pedidosSinVer();   // antes de marcarlos vistos
  render();
  renderPedidos();
  renderResueltas();
  setTabCounts(sinVer);
  // Abre en la pestaña pedida (las notificaciones push traen ?tab=) o en la que
  // tenga algo para hacer: firmar si tengo pendientes, si no mis pedidos.
  const tabPedida = new URLSearchParams(location.search).get('tab');
  showTab(['firmar', 'pedidos', 'resueltas'].includes(tabPedida) ? tabPedida
    : (pendientes.length ? 'firmar' : (misPedidos.length ? 'pedidos' : 'firmar')));
  marcarPedidosVistos();
});
