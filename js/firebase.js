/* global FIREBASE_CONFIG */
/* Firebase RTDB — REST API con optimistic locking (sin SDK) */

(function () {
  const _SEED = 2059; // first claim → 2060

  function _url() {
    return FIREBASE_CONFIG.databaseURL + '/oc_counter.json';
  }

  const _COUNTER_KEY = 'vimeco_oc_counter';

  window.readNextOCSeq = async function () {
    try {
      const resp = await fetch(_url());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const val     = await resp.json();
      const current = val ?? _SEED;
      try { localStorage.setItem(_COUNTER_KEY, String(current)); } catch (_) {}
      return current + 1;
    } catch (_) {
      const cached = parseInt(localStorage.getItem(_COUNTER_KEY) || '0', 10);
      return (cached || _SEED) + 1;
    }
  };

  // Incremento atómico via ETag (optimistic locking); fallback local si no hay red
  window.claimNextOCSeq = async function () {
    for (let i = 0; i < 5; i++) {
      let getResp;
      try { getResp = await fetch(_url(), { headers: { 'X-Firebase-ETag': 'true' } }); }
      catch (_) { break; }  // sin red → salir del loop y usar fallback local
      if (!getResp.ok) throw new Error('HTTP ' + getResp.status);
      const etag    = getResp.headers.get('ETag');
      const current = await getResp.json();
      const next    = (current ?? _SEED) + 1;

      let putResp;
      try {
        putResp = await fetch(_url(), {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', 'if-match': etag },
          body:    String(next)
        });
      } catch (_) { break; }
      if (putResp.status === 200) {
        try { localStorage.setItem(_COUNTER_KEY, String(next)); } catch (_) {}
        return next;
      }
      // 412 = otro usuario actualizó el contador primero → reintento
    }

    // Fallback offline: usar contador cacheado si existe, sino timestamp como secuencia única
    const cached = parseInt(localStorage.getItem(_COUNTER_KEY) || '0', 10);
    const next   = cached ? cached + 1 : Math.floor(Date.now() / 1000);
    try { localStorage.setItem(_COUNTER_KEY, String(next)); } catch (_) {}
    return next;
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
      obra:           prov.ubicacion,
      condicionPago:  clean(prov.pago),
      items:          ocData.items,
      impuestos:      ocData.impuestos,
      total:          total,
      descuento:      ocData._descuento      || { pct: null, monto: 0 },
      noGravado:      ocData._noGravado      || { pct: null, monto: 0 },
      impuestosExtra: ocData._impuestosExtra || []
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

  window.getFirma = async function (codigo) {
    const resp = await fetch(_base() + '/firmas/' + codigo + '.json');
    if (!resp.ok) return null;
    return await resp.json(); // base64 string o null
  };

  window.saveFirma = async function (codigo, base64) {
    const resp = await fetch(_base() + '/firmas/' + codigo + '.json', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(base64)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  window.getHistorial = async function (codigoResponsable) {
    const resp = await fetch(_base() + '/historial.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    let ocs = Object.values(data).filter(oc => oc && oc.nroOC);
    if (codigoResponsable !== '0000') {
      ocs = ocs.filter(oc => oc.responsable?.codigo === codigoResponsable);
    }
    const sorted = ocs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    try { localStorage.setItem(`vimeco_hist_${codigoResponsable}`, JSON.stringify(sorted.slice(0, 5))); } catch (_) {}
    return sorted;
  };

  window.getHistorialCached = function (codigoResponsable) {
    try {
      const raw = localStorage.getItem(`vimeco_hist_${codigoResponsable}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  };
})();

// ─── Gestión de Obras ───────────────────────────────
(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  window.getObrasActivas = async function () {
    const resp = await fetch(_base() + '/obras.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .filter(([, o]) => o && o.nombre && o.activa)
      .map(([key, o]) => ({ key, nombre: o.nombre, lugar_entrega: o.lugar_entrega || '' }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  };

  window.getAllObras = async function () {
    const resp = await fetch(_base() + '/obras.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .filter(([, o]) => o && o.nombre)
      .map(([key, o]) => ({ key, ...o }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  };

  window.saveObra = async function (key, data) {
    const resp = await fetch(_base() + '/obras/' + key + '.json', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  window.patchObra = async function (key, fields) {
    const resp = await fetch(_base() + '/obras/' + key + '.json', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  window.patchHistorialEntry = async function (key, fields) {
    const resp = await fetch(_base() + '/historial/' + key + '.json', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };
})();

// ─── Gestión de Usuarios ────────────────────────────
(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  window.getUsuariosActivos = async function () {
    const resp = await fetch(_base() + '/usuarios.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .filter(([, u]) => u && u.nombre && u.activo)
      .map(([codigo, u]) => ({ codigo, nombre: u.nombre }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  };

  window.getAllUsuarios = async function () {
    const resp = await fetch(_base() + '/usuarios.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .filter(([, u]) => u && u.nombre)
      .map(([codigo, u]) => ({ codigo, ...u }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  };

  window.getUsuario = async function (codigo) {
    const resp = await fetch(_base() + '/usuarios/' + codigo + '.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  };

  window.saveUsuario = async function (codigo, data) {
    const resp = await fetch(_base() + '/usuarios/' + codigo + '.json', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  window.patchUsuario = async function (codigo, fields) {
    const resp = await fetch(_base() + '/usuarios/' + codigo + '.json', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };
})();
