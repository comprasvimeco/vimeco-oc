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
  // Pastilla del título y contador de la pestaña: se actualizan acá porque
  // firmar o rechazar vuelve a llamar a render() sin pasar por setTabCounts.
  const n = pendientes.length;
  $('aut-pend').textContent = `${n} para firmar`;
  $('aut-pend').classList.toggle('hidden', !n);
  $('n-firmar').textContent = n;
  $('n-firmar').classList.toggle('hidden', !n);

  if (!n) {
    list.innerHTML = vacioHtml('No tenés OC para firmar.');
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
        <span class="aut-nro">${esc(oc.nroOC)}${oc.fecha ? ' · ' + esc(oc.fecha) : ''}</span>
      </div>
      <div class="aut-prov">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="aut-obra">${esc(oc.obra || '—')}</div>
      <div class="aut-bottom">
        <span class="aut-total">${total}</span>
        <span class="aut-meta">Pide ${esc(solicitante)}</span>
      </div>
      <div class="aut-actions">
        ${oc.fuenteUrl ? `<a class="foc-btn foc-btn--drive" href="${esc(oc.fuenteUrl)}" target="_blank" rel="noopener">${icSvg('clip')}Presupuesto</a>` : ''}
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
  if (oc.estado === 'autorizada') return ['aprob',  'Aprobada',  'checkSm'];
  if (oc.estado === 'rechazada')  return ['rech',   'Rechazada', 'x'];
  if (oc.estado === 'cancelada')  return ['canc',   'Cancelada', 'slash'];
  return ['espera', 'En espera', 'clock'];
}

function estadoHtml(oc) {
  const [cls, txt, icono] = estadoPedido(oc);
  return `<span class="aut-estado aut-estado-${cls}">${icSvg(icono)}${txt}</span>`;
}

function vacioHtml(msg) {
  return `<div class="aut-empty"><div class="aut-empty-ic">${icSvg('inbox')}</div>${esc(msg)}</div>`;
}

const BTN_VER = `<button class="foc-btn foc-btn--edit btn-ver" title="Ver la OC">${icSvg('eye')}Ver OC</button>`;

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
  if (!misPedidos.length) {
    list.innerHTML = vacioHtml('No mandaste ninguna OC a autorizar.');
    return;
  }

  list.innerHTML = '';
  misPedidos.forEach(oc => {
    const a     = oc.autorizacion || {};
    const total = oc.total != null ? `$ ${fmtMoney(oc.total)}` : '—';
    const quien = a.solicitadoA?.nombre || '—';
    let extra = '';
    if (oc.estado === 'rechazada' && a.motivoRechazo) {
      extra = `<div class="aut-motivo">Motivo: ${esc(a.motivoRechazo)}</div>`;
    } else if (oc.estado === 'autorizada' && a.firmante) {
      extra = `<div class="aut-card-note">Firmó ${esc(a.firmante)}</div>`;
    } else if (oc.estado === 'cancelada' && a.canceladoEn) {
      extra = `<div class="aut-card-note">Cancelaste el pedido el ${esc(new Date(a.canceladoEn).toLocaleDateString('es-AR'))}</div>`;
    }
    const acciones = `<div class="aut-actions">
           ${BTN_VER}
           ${btnPdfHtml(oc)}
           ${oc.estado === 'rechazada' ? `<button class="foc-btn foc-btn--gen btn-rehacer" title="Cargar en el formulario para corregirla">${icSvg('undo')}Rehacer</button>` : ''}
           ${oc.estado === 'pendiente' ? `<button class="foc-btn foc-btn--vio btn-reasignar" title="Pasarle el pedido a otra persona">${icSvg('users')}Reasignar</button>` : ''}
           ${oc.estado === 'pendiente' ? `<button class="foc-btn foc-btn--clear btn-cancelar-pedido" title="Cancelar el pedido de autorización">${icSvg('x')}Cancelar</button>` : ''}
         </div>`;
    const card = document.createElement('div');
    card.className = 'hist-card';
    card.innerHTML = `
      <div class="aut-card-top">
        <span class="aut-nro">${esc(oc.nroOC)}${oc.fecha ? ' · ' + esc(oc.fecha) : ''}</span>
        ${estadoHtml(oc)}
      </div>
      <div class="aut-prov">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="aut-obra">${esc(oc.obra || '—')}</div>
      <div class="aut-bottom">
        <span class="aut-total">${total}</span>
        <span class="aut-meta">A ${esc(quien)}</span>
      </div>
      ${extra}
      ${acciones}`;
    card.querySelector('.btn-ver').addEventListener('click', () => abrirPreview(oc, true));
    bindPdf(card, oc);
    const btnRehacer = card.querySelector('.btn-rehacer');
    if (btnRehacer) btnRehacer.addEventListener('click', () => rehacerOC(oc));
    const btnCanc = card.querySelector('.btn-cancelar-pedido');
    if (btnCanc) btnCanc.addEventListener('click', () => cancelarPedido(oc, btnCanc));
    const btnReasig = card.querySelector('.btn-reasignar');
    if (btnReasig) btnReasig.addEventListener('click', () => reasignarPedido(oc, btnReasig));
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
  if (!await showConfirm('Cancelar pedido',
      `¿Cancelar el pedido de autorización de la OC ${oc.nroOC}?\n\n` +
      `${quien} ya no la va a ver para firmar y el número de OC queda anulado.`,
      { boton: 'Cancelar pedido', tono: 'del', icono: 'x', cancelar: 'Volver' })) return;
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

// ---- Cambiar autorizador ----
// El solicitante le pasa el pedido pendiente a otra persona (el autorizador
// está de viaje, no contesta, se eligió mal). La OC sale de la bandeja del
// anterior y entra en la del nuevo, con el mismo número. Si el pedido fue por
// monto (`montoRequerido`), sólo se ofrecen quienes hoy pueden firmar ese monto.
function iniciales(nombre) {
  const p = String(nombre || '').split(/\s+/).filter(w => w && !/\.$/.test(w));
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

// Resuelve {codigo,nombre} o null si cancela.
function elegirNuevoAutorizador(oc) {
  return new Promise(resolve => {
    const modal  = $('modal-reasignar');
    const lista  = $('reasignar-lista');
    const btnOk  = $('btn-reasignar-confirm');
    const a      = oc.autorizacion || {};
    const actual = a.solicitadoA?.codigo;
    const monto  = a.montoRequerido > 0 ? a.montoRequerido : null;
    let elegido  = null;

    btnOk.disabled = true;
    lista.innerHTML = '<div class="pedir-estado">Cargando usuarios…</div>';
    $('reasignar-texto').textContent =
      `La OC ${oc.nroOC} hoy la tiene ${a.solicitadoA?.nombre || 'otra persona'}. ` +
      (monto ? `Por el monto, sólo se la podés pasar a quien firme OC de más de $ ${Math.round(monto).toLocaleString('es-AR')}.`
             : 'Elegí a quién le pasás el pedido; le va a aparecer en su bandeja.');
    modal.classList.remove('hidden');

    const elegir = u => {
      elegido = u;
      lista.querySelectorAll('.pedir-who').forEach(b => b.setAttribute('aria-checked', b.dataset.codigo === u.codigo));
      btnOk.disabled = false;
    };
    getUsuariosActivos().then(list => {
      const opts = (list || []).filter(u => u.codigo !== myCode && u.codigo !== actual &&
                                            (!monto || u.autorizaDesde >= monto));
      if (!opts.length) {
        lista.innerHTML = `<div class="pedir-estado">${monto
          ? 'No hay otra persona que pueda firmar este monto.'
          : 'No hay otros usuarios activos disponibles.'}</div>`;
        return;
      }
      lista.innerHTML = opts.map(u => `
        <button type="button" class="pedir-who" role="radio" aria-checked="false" data-codigo="${esc(u.codigo)}">
          <span class="pedir-who-av">${esc(iniciales(u.nombre))}</span><b>${esc(u.nombre)}</b><span class="pedir-who-rad"></span>
        </button>`).join('');
      lista.querySelectorAll('.pedir-who').forEach((b, i) => b.addEventListener('click', () => elegir(opts[i])));
      if (opts.length === 1) elegir(opts[0]);
    }).catch(() => {
      lista.innerHTML = '<div class="pedir-estado">No se pudieron cargar los usuarios. Revisá tu conexión.</div>';
    });

    const close = val => {
      modal.classList.add('hidden');
      modal.onclick = null;
      resolve(val);
    };
    $('btn-reasignar-cancel').onclick = () => close(null);
    modal.onclick = e => { if (e.target === modal) close(null); };
    btnOk.onclick = () => { if (elegido) close({ codigo: elegido.codigo, nombre: elegido.nombre || '' }); };
  });
}

async function reasignarPedido(oc, btn) {
  const nuevo = await elegirNuevoAutorizador(oc);
  if (!nuevo) return;
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
    const prev = oc.autorizacion || {};
    // Se guarda a quién se le había pedido antes, por si hay que rastrearlo.
    const nuevaAut = {
      ...prev,
      solicitadoA:  { codigo: nuevo.codigo, nombre: nuevo.nombre },
      reasignaciones: [...(prev.reasignaciones || []),
        { de: prev.solicitadoA || null, a: { codigo: nuevo.codigo, nombre: nuevo.nombre }, en: Date.now() }]
    };
    await patchHistorialEntry(histKey, { autorizacion: nuevaAut });
    oc.autorizacion = nuevaAut;
    renderPedidos();
    toast(`OC ${oc.nroOC} pasada a ${nuevo.nombre}.`, 'success');
    if (nuevo.codigo !== myCode && typeof notificarUsuario === 'function') {
      notificarUsuario(nuevo.codigo, {
        title: 'Autorización pendiente',
        body:  `OC ${oc.nroOC} · ${oc.proveedor?.nombre || 'Sin proveedor'} · ${oc.obra || 'Sin obra'}\n` +
               `$ ${fmtMoney(oc.total)} — pide ${myName}`,
        url:   'autorizaciones.html?tab=firmar',
        tag:   'aut-' + histKey
      });
    }
  } catch (e) {
    toast('No se pudo cambiar el autorizador. Revisá tu conexión.', 'error');
    console.error('reasignarPedido:', e);
  } finally {
    btn.disabled = false;
  }
}

// Antes de firmar o rechazar: si el solicitante canceló el pedido, se lo pasó
// a otra persona o ya lo resolvió otro, no pisarlo. Si no se puede leer, se
// sigue como antes.
async function siguePendiente(oc) {
  const key = oc.nroOC.replace(/-/g, '');
  let actual, autorizador;
  try {
    [actual, autorizador] = await Promise.all([
      getHistorialEstado(key),
      typeof getHistorialAutorizador === 'function' ? getHistorialAutorizador(key) : myCode
    ]);
  } catch (_) { return true; }
  if (actual === 'pendiente' && (!autorizador || autorizador === myCode)) return true;
  toast(actual === 'cancelada' ? `El solicitante canceló el pedido de la OC ${oc.nroOC}.`
      : actual === 'pendiente' ? `El solicitante le pasó la OC ${oc.nroOC} a otra persona.`
                               : `La OC ${oc.nroOC} ya no está pendiente.`, 'warning');
  quitarDeLista(oc);
  cerrarRechazo();
  cerrarPreview();
  return false;
}

// ---- "Autorizadas": OC que YA resolví (firmé o rechacé) ----
function renderResueltas() {
  const list = $('res-list');
  if (!resueltas.length) {
    list.innerHTML = vacioHtml('Todavía no autorizaste ninguna OC.');
    return;
  }

  list.innerHTML = '';
  resueltas.forEach(oc => {
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
        <span class="aut-nro">${esc(oc.nroOC)}${oc.fecha ? ' · ' + esc(oc.fecha) : ''}</span>
        ${estadoHtml(oc)}
      </div>
      <div class="aut-prov">${esc(oc.proveedor?.nombre || '—')}</div>
      <div class="aut-obra">${esc(oc.obra || '—')}</div>
      <div class="aut-bottom">
        <span class="aut-total">${total}</span>
        <span class="aut-meta">Pidió ${esc(quien)}${cuando ? ' · ' + esc(cuando) : ''}</span>
      </div>
      ${extra}
      <div class="aut-actions">
        ${BTN_VER}
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
  const np = $('n-pedidos');
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

  // Link al presupuesto si el solicitante lo adjuntó. Si no vino con la lista,
  // se pregunta al servidor: puede haber terminado de subirse después.
  const fuente = $('preview-fuente');
  const ponerFuente = url => {
    if (url) { fuente.href = url; fuente.classList.remove('hidden'); }
    else { fuente.removeAttribute('href'); fuente.classList.add('hidden'); }
  };
  ponerFuente(oc.fuenteUrl);
  if (!oc.fuenteUrl && !soloLectura && typeof getHistorialFuente === 'function') {
    getHistorialFuente(oc.nroOC.replace(/-/g, '')).then(url => {
      if (!url) return;
      oc.fuenteUrl = url;
      if (vigente()) ponerFuente(url);
      render();
    }).catch(() => {});
  }

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

    // Si corrige a otra OC, la anterior queda anulada recién ahora (app.js).
    if (oc.reemplazaA?.length && typeof anularReemplazadasDe === 'function') {
      anularReemplazadasDe(oc).catch(e => {
        console.warn('firmarOC/anular:', e);
        toast(`No se pudo anular la OC ${oc.reemplazaA.join(', ')}, que esta reemplaza.`, 'warning');
      });
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
  const oc    = currentOC;
  const quien = oc?.autorizacion?.solicitadoPor?.nombre || oc?.responsable?.nombre || '';
  $('rechazo-title').textContent = oc ? `Rechazar OC ${oc.nroOC}` : 'Rechazar OC';
  $('rechazo-msg').textContent   = `Contale ${quien ? 'a ' + quien : 'al solicitante'} por qué la rechazás (opcional).`;
  $('rechazo-motivo').value = '';
  $('btn-rechazo-confirm').disabled = false;
  $('modal-rechazo').classList.remove('hidden');
  $('rechazo-motivo').focus();
}
function cerrarRechazo() { $('modal-rechazo').classList.add('hidden'); }

async function rechazarOC(oc, motivo) {
  if (!(await siguePendiente(oc))) return;
  $('btn-rechazo-confirm').disabled = true;   // evita el doble rechazo con la conexión lenta
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
    $('btn-rechazo-confirm').disabled = false;
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
  $('firma-msg').textContent = (pendingSign ? `Dibujala para autorizar la OC ${pendingSign.nroOC}.` : 'Dibujala para autorizar.')
    + ' Queda guardada para las próximas OC.';
  $('modal-firma').classList.remove('hidden');
}

const BTN_FIRMA = () => icSvg('edit') + 'Guardar y firmar';
function cerrarFirma() { $('modal-firma').classList.add('hidden'); pendingSign = null; }

function setupFirmaModal() {
  $('btn-firma-guardar').innerHTML = BTN_FIRMA();
  $('modal-firma-close').addEventListener('click', cerrarFirma);
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
      btn.disabled = false; btn.innerHTML = BTN_FIRMA();
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
  $('btn-rechazo-cancel').addEventListener('click', cerrarRechazo);
  // Firma y Rechazar se cierran como la confirmación común: tocando afuera o con Escape.
  $('modal-rechazo').addEventListener('click', e => { if (e.target === e.currentTarget) cerrarRechazo(); });
  $('modal-firma').addEventListener('click', e => { if (e.target === e.currentTarget) cerrarFirma(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('modal-reasignar').classList.contains('hidden')) $('btn-reasignar-cancel').click();
    else if (!$('modal-rechazo').classList.contains('hidden')) cerrarRechazo();
    else if (!$('modal-firma').classList.contains('hidden')) cerrarFirma();
  });
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
    $('aut-list').innerHTML = vacioHtml('No se pudieron cargar las autorizaciones. Revisá tu conexión.');
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
