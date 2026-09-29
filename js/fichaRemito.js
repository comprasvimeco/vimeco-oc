/* VIMECO S.A. — Ficha del remito
   Misma estética que la ficha de la OC (js/fichaOC.js): encabezado en degradé,
   burbuja del proveedor, grilla de datos y tabla de ítems, más cómo quedó la
   entrega de la OC con todos sus remitos. La usan Remitos y el Historial.

   A diferencia de la ficha de la OC, el modal lo arma este archivo: así las dos
   páginas no repiten el markup.

   Requiere: ui.js (escHtml, toast), fichaOC.js (fichaRow, inicialesProv),
   entregas.js (calcEntrega) y drive.js (findFileInFolder) para abrir archivos. */

const _frQty  = n => (parseFloat(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const _frFecha = d => {
  const p = String(d || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (d || '');
};
const _frUn = u => u ? `<span class="foc-un">${escHtml(u)}</span>` : '';
const _FR_ESTADO = { sin: 'Sin entregas', parcial: 'Entrega parcial', completa: 'Entregada' };

let _frActual = null;   // { r, onBorrar } del remito abierto

function _frModal() {
  let m = document.getElementById('modal-ficha-rem');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'modal-overlay hidden';
  m.id = 'modal-ficha-rem';
  m.innerHTML = `
  <div class="modal foc-modal">
    <div class="foc-head">
      <div class="foc-head-l">
        <span class="foc-kicker">Remito</span>
        <span class="foc-nro" id="frem-nro">—</span>
        <div class="foc-chips" id="frem-chips"></div>
      </div>
      <div class="foc-head-r">
        <span class="foc-kicker">Orden de compra</span>
        <span class="foc-nro" id="frem-oc">—</span>
      </div>
      <button class="foc-x" id="frem-close" aria-label="Cerrar">${icSvg('x')}</button>
    </div>
    <div class="modal-body" id="frem-body"></div>
    <div class="modal-footer foc-foot">
      <div class="foc-foot-r">
        <button class="foc-btn foc-btn--pdf" id="frem-archivo" title="Abrir la foto del remito">${icSvg('file')}Ver archivo</button>
        <a class="foc-btn foc-btn--drive" id="frem-drive" target="_blank" rel="noopener" title="Abrir la carpeta de la OC en Drive">${icSvg('folder')}Carpeta</a>
      </div>
      <button class="foc-btn foc-btn--del" id="frem-borrar" title="Borrar el remito">${icSvg('trash')}Borrar</button>
    </div>
  </div>`;
  // Al principio del body: con el mismo z-index, los demás modales (el de
  // confirmar el borrado) tienen que quedar por encima de la ficha.
  document.body.prepend(m);

  m.querySelector('#frem-close').addEventListener('click', cerrarFichaRemito);
  m.querySelector('#frem-archivo').addEventListener('click', () => {
    if (_frActual) abrirArchivoDrive(_frActual.r.drive, 'la foto del remito');
  });
  m.querySelector('#frem-borrar').addEventListener('click', () => {
    if (_frActual?.onBorrar) _frActual.onBorrar(_frActual.r.key);
  });
  return m;
}

// `oc` y `remitosDeOC` pueden faltar (OC que el usuario no ve): la ficha se
// arma igual, sin la columna de lo pedido ni la sección de entrega.
// `onBorrar(key)`, si viene, muestra el botón Borrar.
function abrirFichaRemito(r, oc, remitosDeOC, { onBorrar } = {}) {
  const modal = _frModal();
  _frActual = { r, onBorrar };

  document.getElementById('frem-nro').textContent = r.nro || '—';
  document.getElementById('frem-oc').textContent  = r.nroOC || '—';
  document.getElementById('frem-chips').innerHTML =
    `<span class="foc-chip">${r.entrega === 'total' ? 'Completó la OC' : 'Entrega parcial'}</span>` +
    (r.recibidoPor?.nombre ? `<span class="foc-chip">Recibió: ${escHtml(r.recibidoPor.nombre)}</span>` : '');

  const prov  = r.proveedor || oc?.proveedor || {};
  const tags  = [prov.cuit && `CUIT ${prov.cuit}`].filter(Boolean);
  const items = r.items || [];
  const cargado = r.timestamp
    ? new Date(r.timestamp).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';

  const itemsHtml = items.length ? `
    <div class="foc-items-w"><table class="foc-items">
      <thead><tr>
        <th>Descripción</th><th class="foc-n">Recibido</th><th>Un.</th>${oc ? '<th class="foc-n">Pedido OC</th>' : ''}
      </tr></thead>
      <tbody>
        ${items.map(it => {
          const ped = oc?.items?.[Number(it.idx)]?.cant;
          return `<tr>
            <td>${escHtml(it.desc)}</td>
            <td class="foc-n">${escHtml(_frQty(it.cantidad))}</td>
            <td>${_frUn(it.unidad)}</td>
            ${oc ? `<td class="foc-n">${ped != null ? escHtml(_frQty(ped)) : '—'}</td>` : ''}
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>` : '';

  // Cómo quedó la OC con todos sus remitos (no sólo con éste).
  let entregaHtml = '';
  if (oc) {
    const e = calcEntrega(oc, remitosDeOC || [r]);
    const pend = (oc.items || [])
      .map((it, i) => ({ it, falta: e.pendiente[i] }))
      .filter(x => x.falta > 0);
    entregaHtml = `
      <div class="foc-sec">Entrega de la OC <span class="foc-cnt">${e.remitos.length} remito${e.remitos.length !== 1 ? 's' : ''}</span></div>
      <div class="rem-prog-wrap">
        <div class="rem-prog"><div class="rem-prog-fill rem-prog-fill--${e.estado}" style="width:${Math.min(100, e.pct)}%"></div></div>
        <span class="rem-prog-pct">${e.pct}%</span>
        <span class="rem-badge rem-badge--${e.estado}">${_FR_ESTADO[e.estado] || ''}</span>
      </div>
      ${pend.length ? `
        <div class="foc-items-w" style="margin-top:.6rem;"><table class="foc-items">
          <thead><tr><th>Falta entregar</th><th class="foc-n">Cant.</th><th>Un.</th></tr></thead>
          <tbody>
            ${pend.map(({ it, falta }) => `<tr>
              <td>${escHtml(it.desc)}</td>
              <td class="foc-n">${escHtml(_frQty(falta))}</td>
              <td>${_frUn(it.unidad)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : ''}`;
  }

  const body = document.getElementById('frem-body');
  body.innerHTML = `
    <div class="foc-prov">
      <span class="foc-prov-ic" aria-hidden="true">${escHtml(inicialesProv(prov.nombre))}</span>
      <div style="min-width:0">
        <div class="foc-prov-n">${escHtml(prov.nombre || 'Proveedor sin nombre')}</div>
        ${tags.length ? `<div class="foc-prov-s">${tags.map(t => `<span class="foc-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="foc-grid">
      ${fichaRow('Fecha', _frFecha(r.fecha))}
      ${fichaRow('Obra', r.obra || 'Sin obra')}
      ${fichaRow('Fecha OC', oc?.fecha)}
      ${fichaRow('Recibió', r.recibidoPor?.nombre)}
      ${fichaRow('Cargado', cargado)}
      ${fichaRow('Observaciones', r.observaciones)}
    </div>
    <div class="foc-sec">Ítems recibidos <span class="foc-cnt">${items.length}</span></div>
    ${itemsHtml}
    ${entregaHtml}`;
  body.scrollTop = 0;

  const d = r.drive || {};
  document.getElementById('frem-archivo').classList.toggle('hidden', !d.fileId && !(d.folderId && d.archivo));
  const carpeta = document.getElementById('frem-drive');
  carpeta.classList.toggle('hidden', !d.url);
  if (d.url) carpeta.href = d.url; else carpeta.removeAttribute('href');
  document.getElementById('frem-borrar').classList.toggle('hidden', !onBorrar);

  modal.classList.remove('hidden');
}

function cerrarFichaRemito() {
  const m = document.getElementById('modal-ficha-rem');
  if (!m) return;
  m.classList.add('hidden');
  document.getElementById('frem-body').innerHTML = '';
  _frActual = null;
}

// Key del remito abierto en la ficha (o null).
const fichaRemitoAbierta = () => _frActual?.r.key || null;

// Abre un archivo de Drive. `ref` = { fileId, folderId, archivo | nombre }: con
// el id va directo; las cargas anteriores a que se guardara el id sólo tienen
// carpeta y nombre, y ahí se lo busca (y se lo recuerda en `ref`). Si no
// aparece, se abre la carpeta. La pestaña se abre ANTES de la búsqueda: abierta
// después de un await, el navegador la bloquea como popup.
async function abrirArchivoDrive(ref, que) {
  ref = ref || {};
  const nombre = ref.archivo || ref.nombre;
  const carpeta = ref.folderId ? `https://drive.google.com/drive/folders/${ref.folderId}` : '';
  const verArchivo = id => `https://drive.google.com/file/d/${id}/view`;

  if (ref.fileId) { window.open(verArchivo(ref.fileId), '_blank', 'noopener'); return; }
  if (!ref.folderId || !nombre) { toast(`No hay registro de dónde está ${que || 'el archivo'}.`, 'warning'); return; }

  const w = window.open('', '_blank');
  try {
    const id = typeof findFileInFolder === 'function' ? await findFileInFolder(ref.folderId, nombre) : null;
    if (id) ref.fileId = id;
    else toast(`No se encontró ${que || 'el archivo'}: se abre la carpeta de la OC.`, 'warning');
    const url = id ? verArchivo(id) : carpeta;
    if (w) w.location.href = url; else window.open(url, '_blank', 'noopener');
  } catch (e) {
    console.error('abrirArchivoDrive:', e);
    toast('No se pudo buscar el archivo en Drive: se abre la carpeta de la OC.', 'warning');
    if (w) w.location.href = carpeta; else window.open(carpeta, '_blank', 'noopener');
  }
}
