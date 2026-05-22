/* global FIREBASE_CONFIG */
/* Firebase RTDB — REST API con optimistic locking (sin SDK) */

(function () {
  const _SEED = 2059; // first claim → 2060

  function _url() {
    return FIREBASE_CONFIG.databaseURL + '/oc_counter.json';
  }

  window.readNextOCSeq = async function () {
    const resp = await fetch(_url());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const val = await resp.json();
    return (val ?? _SEED) + 1;
  };

  // Incremento atómico via ETag (optimistic locking)
  window.claimNextOCSeq = async function () {
    for (let i = 0; i < 5; i++) {
      const getResp = await fetch(_url(), { headers: { 'X-Firebase-ETag': 'true' } });
      if (!getResp.ok) throw new Error('HTTP ' + getResp.status);
      const etag    = getResp.headers.get('ETag');
      const current = await getResp.json();
      const next    = (current ?? _SEED) + 1;

      const putResp = await fetch(_url(), {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', 'if-match': etag },
        body:    String(next)
      });
      if (putResp.status === 200) return next;
      // 412 = otro usuario actualizó el contador primero → reintento
    }
    throw new Error('No se pudo reservar el número (5 reintentos)');
  };

  window.setOCSeqTo = async function (targetSeq) {
    const resp = await fetch(_url(), {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    String(targetSeq - 1)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };
})();

// ─── Historial de OC ────────────────────────────────
(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  function _proveedorKey(p) {
    const cuit = (p.cuit || '').replace(/[-\s]/g, '');
    if (cuit.length >= 10) return 'cuit_' + cuit;
    return 'nom_' + (p.nombre || '').toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40);
  }

  window.saveOCToHistory = async function (ocData, total) {
    const key  = ocData.nroOC.replace(/-/g, '');
    const prov = ocData.proveedor;
    const clean = v => (v && v !== '—') ? v : '';

    const record = {
      nroOC:      ocData.nroOC,
      fecha:      ocData.fecha,
      timestamp:  Date.now(),
      responsable: {
        codigo: sessionStorage.getItem('responsable_code') || '',
        nombre: ocData.ejecutor || ''
      },
      proveedor: {
        nombre:      prov.nombre,
        cuit:        clean(prov.cuit),
        domicilio:   clean(prov.domicilio),
        telefonos:   clean(prov.telefonos),
        condicionIVA: clean(prov.iva),
        ref:         clean(prov.ref)
      },
      obra:         prov.ubicacion,
      condicionPago: clean(prov.pago),
      items:        ocData.items,
      impuestos:    ocData.impuestos,
      total:        total
    };

    const base = _base();
    const resp = await fetch(`${base}/historial/${key}.json`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(record)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    // Actualizar índice de proveedores (no bloquea si falla)
    const provKey = _proveedorKey(record.proveedor);
    fetch(`${base}/proveedores/${provKey}.json`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(record.proveedor)
    }).catch(() => {});
  };

  window.getProveedores = async function () {
    const resp = await fetch(_base() + '/proveedores.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.values(data).filter(p => p && p.nombre);
  };
})();
