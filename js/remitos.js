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
let viewerCode    = '';
let viewerName    = '';
let viewerIsAdmin = false;
let filtroOC      = 'pendientes';
let modalOC       = null; // OC abierta en el modal de carga
let modalFile     = null; // foto elegida para el remito en curso

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

// ---- Cálculo de entregas ----

// Estado de entrega de una OC contra TODOS sus remitos, los haya cargado quien
// los haya cargado. El cálculo vive en entregas.js: es el mismo que arma las
// planillas, y tener dos copias sería tener dos verdades.
function entregasDeOC(oc) {
  return calcEntrega(oc, allRemitos.filter(r => r.nroOC === oc.nroOC));
}

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

// ---- Render: lista de OC ----

function badgeEntrega(estado) {
  const txt = { sin: 'Sin entregas', parcial: 'Entrega parcial', completa: 'Entregada' };
  return `<span class="rem-badge rem-badge--${estado}">${txt[estado] || ''}</span>`;
}

function renderOCList() {
  const q    = ($('rem-search').value || '').toLowerCase().trim();
  const box  = $('rem-oc-list');

  let list = ocsElegibles().map(oc => ({ oc, e: entregasDeOC(oc) }));
  if (filtroOC === 'pendientes') list = list.filter(({ e }) => e.estado !== 'completa');
  if (q) {
    list = list.filter(({ oc }) =>
      (oc.proveedor?.nombre || '').toLowerCase().includes(q) ||
      (oc.obra || '').toLowerCase().includes(q) ||
      (oc.nroOC || '').toLowerCase().includes(q));
  }

  if (!list.length) {
    box.innerHTML = `<div class="hist-empty">${
      filtroOC === 'pendientes' && !q
        ? 'No hay OC pendientes de entrega.'
        : 'No se encontraron OC.'}</div>`;
    return;
  }

  box.innerHTML = pager.take('remoc', list).map(({ oc, e }) => `
    <div class="adj-oc-card">
      <div class="adj-oc-top">
        <span class="hist-nro">${escHtml(oc.nroOC)}</span>
        <span class="hist-fecha">${escHtml(oc.fecha || '')}</span>
      </div>
      <div class="hist-proveedor">${escHtml(oc.proveedor?.nombre || '—')}</div>
      <div class="hist-obra">${escHtml(oc.obra || '—')}</div>
      <div class="rem-prog-wrap">
        <div class="rem-prog"><div class="rem-prog-fill rem-prog-fill--${e.estado}" style="width:${Math.min(100, e.pct)}%"></div></div>
        <span class="rem-prog-pct">${e.pct}%</span>
      </div>
      <div class="adj-oc-bottom">
        ${badgeEntrega(e.estado)}
        <button class="btn btn-sm btn-primary btn-cargar-remito" data-nro="${escHtml(oc.nroOC)}">
          ${icSvg('plus')} Remito
        </button>
      </div>
    </div>`).join('');

  box.querySelectorAll('.btn-cargar-remito').forEach(btn => {
    btn.addEventListener('click', () => {
      const oc = allOCs.find(o => o.nroOC === btn.dataset.nro);
      if (oc) abrirModal(oc);
    });
  });

  pager.footer('remoc', box, list, renderOCList);
}

// ---- Render: remitos cargados ----

function remitosVisibles() {
  return viewerIsAdmin
    ? allRemitos
    : allRemitos.filter(r => r.recibidoPor?.codigo === viewerCode);
}

function renderRemitosList() {
  const list = remitosVisibles();
  const box  = $('rem-list');

  $('rem-count').textContent = list.length ? `${list.length} remito${list.length !== 1 ? 's' : ''}` : '';

  if (!list.length) {
    box.innerHTML = '<div class="hist-empty">Todavía no cargaste ningún remito.</div>';
    return;
  }

  box.innerHTML = pager.take('remlist', list).map(r => {
    const nItems = (r.items || []).length;
    return `<div class="adj-oc-card">
      <div class="adj-oc-top">
        <span class="hist-nro">Remito ${escHtml(r.nro || '—')}</span>
        <span class="hist-fecha">${escHtml(isoToDisplay(r.fecha))}</span>
      </div>
      <div class="hist-proveedor">${escHtml(r.proveedor?.nombre || '—')}</div>
      <div class="hist-obra">OC ${escHtml(r.nroOC || '—')} · ${escHtml(r.obra || 'Sin obra')}</div>
      ${viewerIsAdmin && r.recibidoPor?.nombre
        ? `<div class="hist-obra" style="color:var(--gray-500);font-size:.78rem;">recibió ${escHtml(r.recibidoPor.nombre)}</div>` : ''}
      ${r.observaciones ? `<div class="rem-obs">${escHtml(r.observaciones)}</div>` : ''}
      <div class="adj-oc-bottom">
        <span class="hist-obra">${nItems} ítem${nItems !== 1 ? 's' : ''} · ${r.entrega === 'total' ? 'completó la OC' : 'entrega parcial'}</span>
        <div class="hist-actions">
          ${r.drive?.url
            ? `<a class="btn btn-sm btn-outline" href="${escHtml(r.drive.url)}" target="_blank" rel="noopener">${icSvg('folder')} Drive</a>`
            : ''}
          ${puedeBorrar(r)
            ? `<button class="btn btn-sm btn-danger btn-borrar-remito" data-key="${escHtml(r.key)}">Borrar</button>`
            : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.btn-borrar-remito').forEach(btn =>
    btn.addEventListener('click', () => borrarRemito(btn.dataset.key)));

  pager.footer('remlist', box, list, renderRemitosList);
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
    'Borrar')) return;

  try {
    await deleteRemito(key);
  } catch (e) {
    console.error('deleteRemito:', e);
    toast('No se pudo borrar el remito.', 'error');
    return;
  }

  allRemitos = allRemitos.filter(r => r.key !== key);
  const oc = allOCs.find(o => o.nroOC === rem.nroOC);
  if (oc) {
    actualizarEntregaOC(oc);
    sincronizarPlanillas(oc);
  }
  renderTodo();
  toast(`Remito ${rem.nro} borrado.`, 'success');
}

function renderTodo() {
  renderOCList();
  renderRemitosList();
}

// ---- Modal de carga ----

function abrirModal(oc) {
  modalOC   = oc;
  modalFile = null;

  const e = entregasDeOC(oc);

  $('rem-oc-ref').innerHTML = `
    <div class="rem-oc-ref-nro">${escHtml(oc.nroOC)} · ${escHtml(oc.fecha || '')}</div>
    <div class="rem-oc-ref-prov">${escHtml(oc.proveedor?.nombre || '—')}</div>
    <div class="rem-oc-ref-obra">${escHtml(oc.obra || 'Sin obra')}</div>`;

  const items = oc.items || [];
  $('rem-items').innerHTML = items.length
    ? items.map((it, i) => {
        const completo = e.pendiente[i] <= 0;
        return `<div class="rem-item${completo ? ' is-completo' : ''}" data-idx="${i}">
          <div class="rem-item-desc">${escHtml(it.desc || '—')}</div>
          <div class="rem-item-row">
            <div class="rem-item-meta">
              <span>Pedido <b>${fmtQty(e.pedido[i])}</b> ${escHtml(it.unidad || '')}</span>
              ${e.recibido[i] > 0 ? `<span>Entregado <b>${fmtQty(e.recibido[i])}</b></span>` : ''}
              <span class="rem-item-pend">${completo ? 'Completo' : `Falta <b>${fmtQty(e.pendiente[i])}</b>`}</span>
            </div>
            <input type="text" class="rem-item-input" inputmode="decimal"
                   data-idx="${i}" data-pend="${e.pendiente[i]}"
                   value="${completo ? '0' : fmtInput(e.pendiente[i])}">
          </div>
        </div>`;
      }).join('')
    : '<div class="hist-empty" style="padding:1.25rem;">Esta OC no tiene ítems cargados.</div>';

  $('rem-nro').value   = '';
  $('rem-fecha').value = hoyISO();
  $('rem-obs').value   = '';
  $('rem-file').value  = '';
  $('rem-camera').value = '';
  $('rem-file-name').classList.add('hidden');
  $('rem-error').classList.add('hidden');
  $('btn-rem-guardar').disabled = false;

  $('modal-remito').classList.remove('hidden');
  $('rem-nro').focus();
}

function cerrarModal() {
  $('modal-remito').classList.add('hidden');
  modalOC   = null;
  modalFile = null;
}

// "Llegó todo" / "Vaciar": el input arranca en lo que falta, así guardar sin
// tocar nada equivale a la entrega completa (el caso normal).
function setCantidades(modo) {
  document.querySelectorAll('.rem-item-input').forEach(inp => {
    inp.value = modo === 'todo' ? fmtInput(inp.dataset.pend) : '0';
  });
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

function mostrarError(msg) {
  const box = $('rem-error');
  box.textContent = msg;
  box.classList.remove('hidden');
}

function showConfirm(title, msg, okLabel = 'Aceptar') {
  return new Promise(resolve => {
    $('modal-confirm-title').textContent = title;
    $('modal-confirm-msg').textContent   = msg;
    const yes = $('modal-confirm-yes'), no = $('modal-confirm-no'), modal = $('modal-confirm');
    yes.textContent = okLabel;
    modal.classList.remove('hidden');
    const close = val => { modal.classList.add('hidden'); yes.onclick = no.onclick = null; resolve(val); };
    no.onclick  = () => close(false);
    yes.onclick = () => close(true);
  });
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

  const nro   = $('rem-nro').value.trim();
  const fecha = $('rem-fecha').value;

  if (!nro)   { mostrarError('Cargá el número de remito.'); return; }
  if (!fecha) { mostrarError('Cargá la fecha del remito.'); return; }
  // La foto es el comprobante: sin ella el remito queda sin respaldo en Drive y
  // no hay con qué verificar lo que se declaró recibido.
  if (!modalFile) { mostrarError('Sacá o adjuntá la foto del remito.'); return; }

  // Una OC sin ítems cargados no tiene cantidades que pedir: se admite el
  // remito vacío (si no, el formulario no se puede guardar nunca).
  const sinItems = !(modalOC.items || []).length;
  const items    = leerItemsDelModal();
  if (!items.length && !sinItems) { mostrarError('Cargá al menos una cantidad recibida.'); return; }

  // Sobre-entrega: se avisa, no se bloquea (pasa, y hay que poder registrarlo).
  const excedidos = items.filter(it => {
    const inp = document.querySelector(`.rem-item-input[data-idx="${it.idx}"]`);
    return it.cantidad > (parseFloat(inp?.dataset.pend) || 0);
  });
  if (excedidos.length && !await showConfirm(
    'Más de lo pendiente',
    `${excedidos.length} renglón(es) supera(n) lo que falta entregar en esta OC.\n\n¿Guardar igual?`,
    'Guardar')) return;

  // Mismo número y mismo proveedor = casi seguro el mismo remito cargado dos
  // veces, y eso duplicaría las cantidades recibidas.
  const dup = allRemitos.find(r =>
    (r.nro || '').trim().toLowerCase() === nro.toLowerCase() &&
    (r.proveedor?.nombre || '') === (modalOC.proveedor?.nombre || ''));
  if (dup && !await showConfirm(
    'Remito repetido',
    `Ya hay un remito ${nro} de ${modalOC.proveedor?.nombre || 'este proveedor'} (OC ${dup.nroOC}).\n\n¿Cargarlo igual?`,
    'Cargar igual')) return;

  const e        = entregasDeOC(modalOC);
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
  const upFile = modalFile
    ? new File([modalFile], nombreArchivoDrive('Remito', modalFile.name, nro), { type: modalFile.type })
    : null;

  try {
    await persistirRemito(record, upFile, oc);
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `${icSvg('checkSm')} Guardar remito`;
  }

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
  } catch (_) {}
}

// ---- Carga de datos ----

async function cargarDatos() {
  // Todas las OC, no sólo las del usuario: quien recibe el material en obra
  // casi nunca es quien emitió la orden.
  const [ocs, rems] = await Promise.all([
    getHistorial(viewerCode, true),
    getRemitos()
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

  viewerIsAdmin = code === '0000';
  if (!viewerIsAdmin) {
    try { const u = await getUsuario(code); viewerIsAdmin = !!(u && u.admin); } catch (_) {}
  }

  // Filtro Pendientes / Todas
  $('rem-filtro').addEventListener('click', ev => {
    const btn = ev.target.closest('.rem-tab');
    if (!btn) return;
    filtroOC = btn.dataset.filtro;
    $('rem-filtro').querySelectorAll('.rem-tab').forEach(b => b.classList.toggle('active', b === btn));
    pager.reset('remoc');
    renderOCList();
  });

  $('rem-search').addEventListener('input', () => { pager.reset('remoc'); renderOCList(); });

  // Modal
  $('modal-remito-close').addEventListener('click', cerrarModal);
  $('btn-rem-cancelar').addEventListener('click', cerrarModal);
  $('btn-rem-guardar').addEventListener('click', guardarRemito);
  $('btn-rem-todo').addEventListener('click',   () => setCantidades('todo'));
  $('btn-rem-vaciar').addEventListener('click', () => setCantidades('vaciar'));

  // Foto del remito
  if ('ontouchstart' in window || window.innerWidth <= 768)
    $('btn-rem-camera').style.display = '';
  $('btn-rem-archivo').addEventListener('click', () => $('rem-file').click());
  $('btn-rem-camera').addEventListener('click',  () => $('rem-camera').click());
  const onFile = f => {
    if (!f) return;
    modalFile = f;
    const el = $('rem-file-name');
    el.innerHTML = `${icSvg('checkSm')} ${escHtml(f.name)} (${(f.size / 1024).toFixed(0)} KB)`;
    el.classList.remove('hidden');
  };
  $('rem-file').addEventListener('change',   e => onFile(e.target.files[0]));
  $('rem-camera').addEventListener('change', e => onFile(e.target.files[0]));

  try {
    await cargarDatos();
    renderTodo();
  } catch (e) {
    console.error('cargarDatos:', e);
    $('rem-oc-list').innerHTML = '<div class="hist-empty">Sin conexión. Abrí Remitos con red al menos una vez.</div>';
    $('rem-list').innerHTML    = '<div class="hist-empty">—</div>';
  }

  retryRemitoQueue();
  window.addEventListener('online', retryRemitoQueue);
});
