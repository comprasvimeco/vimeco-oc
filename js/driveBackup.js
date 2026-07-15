/* ===================================================
   VIMECO S.A. — Respaldo de OC en Drive
   driveBackup.js

   Lógica compartida sobre el respaldo de las OC en Drive. La usan Novedades
   (panel de OC sin respaldo + resubida) y Reportes (alcance del reporte).

   Requiere: firebase.js. Para resubir además ocGenerator.js + drive.js.
   =================================================== */

// Obras que se usan para probar la app: no son gasto real ni fallas reales.
// Match exacto sobre el nombre normalizado — ninguna obra real tiene un
// nombre de un solo carácter.
const OBRAS_PRUEBA = new Set(['x']);
function esObraPrueba(oc) {
  return OBRAS_PRUEBA.has((oc.obra || '').trim().toLowerCase());
}

// Clave del registro en /historial (así se guarda en saveOCToHistory).
function histKeyOf(oc) { return (oc.nroOC || '').replace(/-/g, ''); }

// Una OC respaldada guarda el id de su carpeta al subir el PDF.
function driveFolderId(oc) {
  return oc.drive_folder_obras_id || oc.drive_folder_proveedores_id || null;
}

function driveUrlOf(oc) {
  const id = driveFolderId(oc);
  return id ? `https://drive.google.com/drive/folders/${id}` : '';
}

// El corte se deduce de los datos: la OC respaldada más antigua marca el momento
// en que el respaldo empezó a existir. Todo lo anterior es de las primeras
// iteraciones y no tiene sentido reclamarlo. Se usa la fecha (no la presencia
// del id) para no perder una OC reciente cuya subida sigue en la cola offline.
function driveCutoff(list) {
  const conRespaldo = list.filter(driveFolderId).map(o => o.timestamp || 0).filter(Boolean);
  return conRespaldo.length ? Math.min(...conRespaldo) : 0;
}

// Una OC pendiente de autorización todavía no tiene PDF, y una rechazada nunca
// lo va a tener: no se les puede reclamar respaldo ni resubirlas (hacerlo
// emitiría el PDF de una orden sin autorizar).
const SIN_PDF = new Set(['pendiente', 'rechazada']);

// OC que deberían tener respaldo y no lo tienen: emitidas, posteriores al corte,
// sin carpeta registrada y sin contar las obras de prueba. Más recientes primero.
function ocsSinRespaldo(list) {
  const corte = driveCutoff(list);
  return list
    .filter(oc => (oc.timestamp || 0) >= corte &&
                  !SIN_PDF.has(oc.estado) &&
                  !driveFolderId(oc) &&
                  !esObraPrueba(oc))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// OC esperando que alguien las autorice. Más recientes primero.
function ocsPendientes(list) {
  return list
    .filter(oc => oc.estado === 'pendiente' && oc.autorizacion?.solicitadoA && !esObraPrueba(oc))
    .sort((a, b) => (b.autorizacion?.solicitadoEn || b.timestamp || 0) -
                    (a.autorizacion?.solicitadoEn || a.timestamp || 0));
}

// Reconstruye el payload que espera generateOCBlob a partir del registro del
// historial. Las OC nuevas guardan `_payload` y se regeneran idénticas; las
// viejas se rearman campo por campo.
async function ocDataDe(oc) {
  const prov = oc.proveedor || {};
  const ocData = oc._payload ? { ...oc._payload } : {
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
      plazo:     '', lugar:        '',
      ref:       prov.ref          || '',
      ubicacion: oc.obra           || ''
    },
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

  if (oc.estado === 'autorizada' && oc.autorizacion) {
    ocData._firmante = oc.autorizacion.firmante || ocData.ejecutor;
    if (oc.autorizacion.firmaCodigo && typeof getFirma === 'function') {
      try { ocData._firma = await getFirma(oc.autorizacion.firmaCodigo); } catch (_) {}
    }
  }
  return ocData;
}

// Regenera el PDF de una OC y lo sube a sus dos carpetas, registrando los ids en
// el historial. Muta `oc` para que quien la tenga en memoria la vea respaldada.
async function resubirOC(oc) {
  const blob  = generateOCBlob(await ocDataDe(oc));
  const fname = `OC_${oc.nroOC}_${sanitize(oc.proveedor?.nombre || 'SinProveedor')}.pdf`;
  // La fecha de la OC, no la de hoy: la carpeta destino se llama
  // "{fecha} | {proveedor}" y tiene que ser la de la orden original.
  const fecha = new Date(oc.timestamp || Date.now()).toISOString().slice(0, 10);
  const { obrasFolderId, proveedoresFolderId } = await uploadToDrive(blob, fname, {
    obra: oc.obra || 'Sin obra', fecha,
    proveedor: oc.proveedor?.nombre || 'Sin proveedor', nroOC: oc.nroOC
  }, null);
  await patchHistorialEntry(histKeyOf(oc), {
    drive_folder_obras_id:       obrasFolderId       || null,
    drive_folder_proveedores_id: proveedoresFolderId || null
  });
  oc.drive_folder_obras_id       = obrasFolderId;
  oc.drive_folder_proveedores_id = proveedoresFolderId;
}
