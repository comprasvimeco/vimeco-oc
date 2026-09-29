/* VIMECO S.A. — Ficha de la OC
   La misma ficha (estética de reportes) en la vista previa de la OC nueva,
   en Autorizaciones y en el Historial. Cada página trae su modal con los mismos
   ids (modal-preview, preview-title, preview-chips, preview-total, preview-body,
   preview-pdf); acá se arma el contenido y la comparación de precios. */

const _fEsc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _fNum = n => (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMonto = (n, cur) => (cur === 'USD' ? 'US$ ' : '$ ') + _fNum(n);

// Fila de la ficha: se omite si el campo quedó vacío ('—' es el vacío del PDF).
function fichaRow(lbl, val) {
  if (!val || val === '—') return '';
  return `<div class="foc-f"><span class="foc-k">${_fEsc(lbl)}</span><span class="foc-v">${_fEsc(val)}</span></div>`;
}

// Iniciales del proveedor para la burbuja de la ficha (mismo criterio que reportes):
// dos primeras palabras sin forma societaria ni conectores; con una sola, dos letras.
const FORMAS_SOC = /(^|\s)(s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?(s|c\.?i\.?f?\.?i?\.?a?)?|s\.?\s?h)\.?(?=\s|$|-)/gi;
const CONECTORES = new Set(['y', 'e', 'de', 'del', 'la', 'los', 'las', 'el', 'cia', 'hijos', 'hnos']);
function inicialesProv(nombre) {
  const pal = String(nombre || '').replace(FORMAS_SOC, ' ')
    .split(/[^\p{L}\p{N}]+/u).filter(p => p && !CONECTORES.has(p.toLowerCase()));
  if (!pal.length) return '?';
  const ini = pal.length === 1 ? pal[0].slice(0, 2) : pal[0][0] + pal[1][0];
  return ini.toUpperCase();
}

// Datos de la OC con la forma que usa el PDF. Los registros guardan el payload
// completo (_payload); si faltara (registros viejos), se reconstruye desde los
// campos sueltos.
function ocDataFromRecord(oc) {
  if (oc._payload) return { ...oc._payload };
  const prov = oc.proveedor || {};
  return {
    nroOC:    oc.nroOC,
    fecha:    oc.fecha,
    moneda:   oc.moneda || 'ARS',
    ejecutor: oc.responsable?.nombre || '',
    proveedor: {
      nombre:    prov.nombre       || '',
      cuit:      prov.cuit         || '',
      codigoInterno: prov.codigoInterno || '',
      domicilio: prov.domicilio    || '',
      telefonos: prov.telefonos    || '',
      iva:       prov.condicionIVA || '',
      pago:      oc.condicionPago  || '',
      plazo:     '',
      lugar:     '',
      ref:       prov.ref          || '',
      ubicacion: oc.obra           || ''
    },
    rubro:  oc.rubro  || null,
    equipo: oc.equipo || null,
    items: (oc.items || []).map(it => ({
      desc: it.desc || '', unidad: it.unidad || '', cant: it.cant || 0,
      unitario: it.unitario || 0, total: it.total || 0
    })),
    impuestos:       oc.impuestos      || [],
    totalLetras:     numberToWords(oc.total || 0),
    _total:          oc.total          || 0,
    _firma:          null,
    _descuento:      oc.descuento      || { pct: null, monto: 0 },
    _noGravado:      oc.noGravado      || { pct: null, monto: 0 },
    _impuestosExtra: oc.impuestosExtra || []
  };
}

// Para el PDF de una OC ya autorizada: se re-incrusta la firma y el nombre de
// quien la autorizó (como quedó archivada).
async function ocDataParaPdf(oc) {
  const data = ocDataFromRecord(oc);
  if (oc.estado === 'autorizada' && oc.autorizacion) {
    data._firmante = oc.autorizacion.firmante || data.ejecutor;
    if (oc.autorizacion.firmaCodigo && typeof getFirma === 'function') {
      try { data._firma = await getFirma(oc.autorizacion.firmaCodigo); } catch (_) {}
    }
  }
  return data;
}

// Chip de estado para el encabezado de la ficha. Las OC viejas (sin estado) no llevan.
function estadoChipFicha(oc) {
  const a = oc.autorizacion || {};
  const txt = oc.estado === 'pendiente'  ? 'Pendiente de firma' + (a.solicitadoA?.nombre ? ' — ' + a.solicitadoA.nombre : '')
            : oc.estado === 'autorizada' ? 'Autorizada' + (a.firmante ? ' — ' + a.firmante : '')
            : oc.estado === 'rechazada'  ? 'Rechazada'
            : oc.estado === 'cancelada'  ? 'Cancelada' : '';
  return txt ? `<span class="foc-chip">${_fEsc(txt)}</span>` : '';
}

// Cuerpo de la ficha. `oc` tiene la forma del PDF (ocDataFromRecord / buildOCData).
// Arriba queda #preview-warn para los avisos y la comparación de precios.
function fichaOCHtml(oc, warnHtml) {
  const usd   = oc.moneda === 'USD';
  const money = n => (usd ? 'US$ ' : '$ ') + _fNum(n);
  const prov  = oc.proveedor || {};
  const vacio = v => !v || v === '—';
  const items = oc.items || [];

  const eq = oc.equipo;
  const equipo = eq ? eq.codigo + (eq.patente ? ` (${eq.patente})` : '') + (eq.tipo ? ' — ' + eq.tipo : '') : '';

  const itemsHtml = items.length ? `
    <div class="foc-items-w"><table class="foc-items">
      <thead><tr>
        <th>Descripción</th><th class="foc-n">Cant.</th><th>Un.</th>
        <th class="foc-n foc-c-unit">Unitario</th><th class="foc-n">Total</th>
      </tr></thead>
      <tbody>
        ${items.map(it => `<tr>
          <td>${_fEsc(it.desc)}</td>
          <td class="foc-n">${_fEsc(it.cant)}</td>
          <td>${vacio(it.unidad) ? '' : `<span class="foc-un">${_fEsc(it.unidad)}</span>`}</td>
          <td class="foc-n foc-c-unit">${_fEsc(money(it.unitario))}</td>
          <td class="foc-n">${_fEsc(money(it.total))}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '';

  const tags = [
    !vacio(prov.cuit) && `CUIT ${prov.cuit}`,
    !vacio(prov.iva) && prov.iva,
    prov.codigoInterno && `Cód. ${prov.codigoInterno}`,
    !vacio(prov.telefonos) && prov.telefonos,
    !vacio(prov.domicilio) && prov.domicilio
  ].filter(Boolean);

  return `
    <div id="preview-warn">${warnHtml || ''}</div>
    <div class="foc-prov">
      <span class="foc-prov-ic" aria-hidden="true">${_fEsc(inicialesProv(prov.nombre))}</span>
      <div style="min-width:0">
        <div class="foc-prov-n">${_fEsc(prov.nombre || 'Proveedor sin nombre')}</div>
        ${tags.length ? `<div class="foc-prov-s">${tags.map(t => `<span class="foc-tag">${_fEsc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="foc-grid">
      ${fichaRow('Fecha', oc.fecha)}
      ${fichaRow('Obra', prov.ubicacion)}
      ${fichaRow('Rubro', oc.rubro?.nombre)}
      ${fichaRow('Equipo', equipo)}
      ${fichaRow('Categoría', eq?.categoria)}
      ${fichaRow('Cond. pago', prov.pago)}
      ${fichaRow('Plazo de entrega', prov.plazo)}
      ${fichaRow('Lugar de entrega', prov.lugar)}
      ${fichaRow('Contacto', prov.nombre_contacto)}
      ${fichaRow('Ref. presupuesto', prov.ref)}
      ${fichaRow('Observaciones', oc.observaciones)}
    </div>
    <div class="foc-sec">Ítems <span class="foc-cnt">${items.length}</span></div>
    ${itemsHtml}
    <div class="foc-tot">
      ${(oc.impuestos || []).map(i => `<div class="foc-t ${/^total$/i.test(i.nombre) ? 'foc-t-grand' : ''}">
        <span>${_fEsc(i.nombre)}</span><span>${_fEsc(money(i.monto))}</span></div>`).join('')}
    </div>
    ${oc.totalLetras ? `<div class="foc-letras">Son ${usd ? 'dólares' : 'pesos'}: ${_fEsc(oc.totalLetras)}</div>` : ''}`;
}

// Llena el modal #modal-preview de la página con la ficha de la OC.
function pintarFichaOC(oc, chipsHtml, warnHtml) {
  const usd = oc.moneda === 'USD';
  document.getElementById('preview-title').textContent = oc.nroOC || '—';
  document.getElementById('preview-total').textContent = (usd ? 'US$ ' : '$ ') + _fNum(oc._total);
  document.getElementById('preview-chips').innerHTML = (chipsHtml || '')
    + (usd ? '<span class="foc-chip">En dólares</span>' : '');
  const body = document.getElementById('preview-body');
  body.innerHTML = fichaOCHtml(oc, warnHtml);
  body.scrollTop = 0;
}

// ---- Comparación con OC anteriores al mismo proveedor ----
const normDesc = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const _fNormProv = s => (s || '').toLowerCase()
  .replace(/\b(s\.a\.|s\.r\.l\.|s\.a\.s\.|s\.a|s\.r\.l|sa|srl|sas)\b/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// La última OC al proveedor (como dato) y el precio unitario de cada ítem contra
// la última vez que se compró. `historial` viene ordenado del más nuevo al más
// viejo; con `antesDe` (timestamp) sólo cuentan las OC anteriores a esa fecha.
function checkOCHistorial(oc, historial, antesDe) {
  const cuit = String(oc.proveedor?.cuit || '').replace(/\D/g, '');
  const nom  = _fNormProv(oc.proveedor?.nombre);
  const mismas = (historial || []).filter(h =>
    h.estado !== 'rechazada' && h.estado !== 'cancelada' && h.nroOC !== oc.nroOC &&
    (!antesDe || (h.timestamp || 0) < antesDe) &&
    (cuit.length >= 11
      ? String(h.proveedor?.cuit || '').replace(/\D/g, '') === cuit
      : nom && _fNormProv(h.proveedor?.nombre) === nom));
  if (!mismas.length) return { cambios: [], info: 'Primera OC a este proveedor.' };

  const moneda = oc.moneda || 'ARS';
  const ult = mismas[0];
  const info = `Última OC a este proveedor: ${ult.fecha}, por ${fmtMonto(ult.total, ult.moneda)}.`;

  const cambios = [];
  (oc.items || []).forEach(it => {
    const d  = normDesc(it.desc);
    const pu = parseFloat(it.unitario) || 0;
    if (!d || !pu) return;
    for (const h of mismas) {
      if ((h.moneda || 'ARS') !== moneda) continue;
      const prev = (h.items || []).find(x => normDesc(x.desc) === d);
      const pp = prev && parseFloat(prev.unitario);
      if (!pp) continue;
      const dif = (pu - pp) / pp;
      if (Math.abs(dif) >= 0.10) {
        cambios.push({ desc: it.desc, antes: pp, ahora: pu, dif, moneda, fecha: h.fecha });
      }
      break; // sólo contra la compra más reciente de ese ítem
    }
  });
  return { cambios, info };
}

const fichaInfoHtml = info => info ? `<div class="foc-info">${_fEsc(info)}</div>` : '';

// Desplegable con una tarjeta por ítem cuyo precio cambió respecto de la
// última compra. Sube = rojo, baja = verde.
function comparacionHtml(cambios) {
  if (!cambios || !cambios.length) return '';
  const suben = cambios.filter(c => c.dif > 0).length;
  const bajan = cambios.length - suben;
  const pct = d => (d > 0 ? '+' : '') + (d * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
  const cards = cambios.map(c => {
    const cls = c.dif > 0 ? 'up' : 'down';
    const delta = (c.dif > 0 ? '+' : '−') + fmtMonto(Math.abs(c.ahora - c.antes), c.moneda);
    return `<div class="foc-cmp-card">
      <div class="foc-cmp-desc">${_fEsc(c.desc)}</div>
      <div class="foc-cmp-row">
        <span class="foc-cmp-tag"><small>Antes</small>${_fEsc(fmtMonto(c.antes, c.moneda))}</span>
        ${icSvg('arrowRight', 'foc-cmp-arr')}
        <span class="foc-cmp-tag foc-cmp-now"><small>Ahora</small>${_fEsc(fmtMonto(c.ahora, c.moneda))}</span>
        <span class="foc-cmp-dif ${cls}">${_fEsc(pct(c.dif))}<small>${_fEsc(delta)}</small></span>
      </div>
      <div class="foc-cmp-ref">Última compra: ${_fEsc(c.fecha)}</div>
    </div>`;
  }).join('');
  return `<details class="foc-cmp">
    <summary>
      ${icSvg('trend')}<span class="foc-cmp-t">Comparación<span class="foc-cmp-t2"> de precios</span></span>
      ${suben ? `<span class="foc-cmp-chip up">${suben} ${suben === 1 ? 'sube' : 'suben'}</span>` : ''}
      ${bajan ? `<span class="foc-cmp-chip down">${bajan} ${bajan === 1 ? 'baja' : 'bajan'}</span>` : ''}
      ${icSvg('chevron', 'foc-cmp-chev')}
    </summary>
    <div class="foc-cmp-list">${cards}</div>
  </details>`;
}
