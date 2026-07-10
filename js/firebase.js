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

  // `extra` permite adjuntar campos adicionales al registro (estado, autorizacion,
  // _payload para regenerar el PDF, etc.) sin duplicar la construcción del record.
  window.saveOCToHistory = async function (ocData, total, extra = {}) {
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
        codigoInterno: clean(prov.codigoInterno),
        domicilio:   clean(prov.domicilio),
        telefonos:   clean(prov.telefonos),
        condicionIVA: clean(prov.iva),
        ref:         clean(prov.ref)
      },
      obra:           prov.ubicacion,
      equipo:         ocData.equipo || null,
      moneda:         ocData.moneda || 'ARS',
      condicionPago:  clean(prov.pago),
      items:          ocData.items,
      impuestos:      ocData.impuestos,
      total:          total,
      descuento:      ocData._descuento      || { pct: null, monto: 0 },
      noGravado:      ocData._noGravado      || { pct: null, monto: 0 },
      impuestosExtra: ocData._impuestosExtra || [],
      // Snapshot de la cotización del dólar al momento de emitir la OC.
      // Permite reexpresar el total en ARS/USD con el valor real de esa fecha.
      // null si nunca se pudo traer (offline sin caché previa).
      cotizacion:     (typeof getDolarCached === 'function' ? getDolarCached() : null),
      ...extra
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

  // Base maestra de proveedores (importada del ERP) — solo lectura desde la app.
  // Defensiva: si el nodo no existe o no hay permiso, devuelve [] y la app sigue igual.
  window.getProveedoresBase = async function () {
    try {
      const resp = await fetch(_base() + '/proveedores_base.json');
      if (!resp.ok) return [];
      const data = await resp.json();
      if (!data) return [];
      return Object.values(data).filter(p => p && p.nombre);
    } catch (_) { return []; }
  };

  // Busca un proveedor en la base por CUIT (normalizado a dígitos). null si no está.
  window.getProveedorBaseByCuit = async function (cuit) {
    const dig = (cuit || '').replace(/\D/g, '');
    if (dig.length < 10) return null;
    try {
      const resp = await fetch(_base() + '/proveedores_base/cuit_' + dig + '.json');
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) { return null; }
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

  window.getHistorial = async function (codigoResponsable, isAdmin = false) {
    const resp = await fetch(_base() + '/historial.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    let ocs = Object.values(data).filter(oc => oc && oc.nroOC);
    // El super-admin (0000) y los usuarios con permiso admin ven todas las OC.
    if (codigoResponsable !== '0000' && !isAdmin) {
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

  // ─── Autorizaciones ───────────────────────────────
  // Para elegir autorizador se usa getUsuariosActivos(): cualquier usuario
  // activo puede autorizar (si no tiene firma, la dibuja en el momento).

  // OC en estado 'pendiente' cuya autorización fue solicitada al usuario dado.
  window.getAutorizacionesPendientes = async function (codigo) {
    const resp = await fetch(_base() + '/historial.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .map(([key, oc]) => ({ _key: key, ...oc }))
      .filter(oc => oc && oc.estado === 'pendiente' &&
                    oc.autorizacion && oc.autorizacion.solicitadoA &&
                    oc.autorizacion.solicitadoA.codigo === codigo)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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

// ─── Gestión de Equipos ─────────────────────────────
(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;
  const _sort = (a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true });

  // Equipos activos para el desplegable de nuevas OC.
  window.getEquiposActivos = async function () {
    const resp = await fetch(_base() + '/equipos.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .filter(([, e]) => e && e.codigo && e.activo)
      .map(([key, e]) => ({ key, codigo: e.codigo, tipo: e.tipo || '' }))
      .sort(_sort);
  };

  // Todos los equipos (admin).
  window.getAllEquipos = async function () {
    const resp = await fetch(_base() + '/equipos.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .filter(([, e]) => e && e.codigo)
      .map(([key, e]) => ({ key, ...e }))
      .sort(_sort);
  };

  window.saveEquipo = async function (key, data) {
    const resp = await fetch(_base() + '/equipos/' + key + '.json', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  window.patchEquipo = async function (key, fields) {
    const resp = await fetch(_base() + '/equipos/' + key + '.json', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  window.deleteEquipo = async function (key) {
    const resp = await fetch(_base() + '/equipos/' + key + '.json', { method: 'DELETE' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  // Alta masiva (importación de lista inicial). Usa PATCH para no borrar lo existente.
  window.bulkSaveEquipos = async function (obj) {
    const resp = await fetch(_base() + '/equipos.json', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(obj)
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

// ─── Caja Chica ──────────────────────────────────────
(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  function _genKey() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  async function _fbFetch(url, opts) {
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} — ${body.substring(0, 120)}`);
    }
    return resp;
  }

  window.getCajaMovimientos = async function (userId) {
    const resp = await _fbFetch(_base() + '/cajas/' + userId + '/movimientos.json');
    const data = await resp.json();
    if (!data) return [];
    return Object.entries(data)
      .map(([key, m]) => ({ key, ...m }))
      // Por fecha del movimiento (desc); a igual fecha, el más reciente primero
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (b.timestamp || 0) - (a.timestamp || 0));
  };

  window.saveCajaMovimiento = async function (userId, movimiento) {
    const key  = _genKey();
    await _fbFetch(_base() + '/cajas/' + userId + '/movimientos/' + key + '.json', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...movimiento, timestamp: Date.now() })
    });
    return key;
  };

  window.deleteCajaMovimiento = async function (userId, key) {
    await _fbFetch(_base() + '/cajas/' + userId + '/movimientos/' + key + '.json', {
      method: 'DELETE'
    });
  };

  window.patchCajaMovimiento = async function (userId, key, fields) {
    await _fbFetch(_base() + '/cajas/' + userId + '/movimientos/' + key + '.json', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields)
    });
  };

  window.getCategoriasCaja = async function () {
    const resp = await _fbFetch(_base() + '/categorias_caja.json');
    const data = await resp.json();
    if (!data) return [];
    return Array.isArray(data) ? data.filter(Boolean) : Object.values(data).filter(Boolean);
  };

  window.saveCategoriasCaja = async function (categorias) {
    await _fbFetch(_base() + '/categorias_caja.json', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(categorias)
    });
  };
})();

// ─── Feed de Actividad (Novedades para admins) ───────
(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  // Registra un evento de actividad. Best-effort: nunca debe romper el flujo
  // que lo invoca (si falla la red, se descarta silenciosamente).
  // evento = { tipo:'oc'|'adjunto'|'caja', usuario:{codigo,nombre}, titulo, detalle, driveUrl }
  window.logActivity = function (evento) {
    try {
      const body = JSON.stringify({ ...evento, timestamp: evento.timestamp || Date.now() });
      // POST → Firebase genera una push-key única, evitando colisiones
      return fetch(_base() + '/actividad.json', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      }).catch(() => {});
    } catch (_) { return Promise.resolve(); }
  };

  // Borra un evento de actividad (solo Administración). Afecta a todos.
  window.deleteActividad = async function (key) {
    const resp = await fetch(_base() + '/actividad/' + key + '.json', { method: 'DELETE' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };

  // Devuelve los eventos de los últimos `dias` días, más recientes primero.
  window.getActividad = async function (dias = 7) {
    const resp = await fetch(_base() + '/actividad.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data) return [];
    const desde = Date.now() - dias * 86400000;
    return Object.entries(data)
      .map(([key, e]) => ({ key, ...e }))
      .filter(e => e && (e.timestamp || 0) >= desde)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  };
})();

// ─── Módulo Personal (Jefe de Obra) ──────────────────
(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  function _genKey() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  async function _get(path) {
    const resp = await fetch(_base() + path);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  }
  async function _put(path, data) {
    const resp = await fetch(_base() + path, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  }
  async function _patch(path, fields) {
    const resp = await fetch(_base() + path, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  }

  // --- Personal (padrón global) ---
  window.getPersonal = async function () {
    const data = await _get('/personal.json');
    if (!data) return [];
    return Object.entries(data)
      .filter(([, p]) => p && p.apellido)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (a.apellido + a.nombre).localeCompare(b.apellido + b.nombre));
  };

  // Personal asignado a una obra
  window.getPersonalDeObra = async function (obraKey) {
    const all = await window.getPersonal();
    return all.filter(p => p.obras && p.obras[obraKey]);
  };

  window.savePersonal = async function (data) {
    const id = _genKey();
    await _put('/personal/' + id + '.json', { ...data, creadoEn: Date.now() });
    return id;
  };

  window.patchPersonal = async function (id, fields) {
    await _patch('/personal/' + id + '.json', fields);
  };

  // --- Constantes por obra ---
  window.getConstantesObra = async function (obraKey) {
    const data = await _get('/obras/' + obraKey + '/constantes.json');
    return data || { jornadaHoras: 8, valorComida: 0 };
  };
  window.patchConstantesObra = async function (obraKey, fields) {
    await _patch('/obras/' + obraKey + '/constantes.json', fields);
  };

  // --- Jefes por obra / obras de un jefe ---
  // codigos = array de códigos de usuario → se guarda como objeto {codigo:true}
  window.setJefesObra = async function (obraKey, codigos) {
    const obj = {};
    (codigos || []).forEach(c => { obj[c] = true; });
    await _put('/obras/' + obraKey + '/jefes.json', obj);
  };

  window.getObrasDeJefe = async function (codigo) {
    const data = await _get('/obras.json');
    if (!data) return [];
    return Object.entries(data)
      .filter(([, o]) => o && o.nombre && o.activa && o.jefes && o.jefes[codigo])
      .map(([key, o]) => ({ key, nombre: o.nombre, lugar_entrega: o.lugar_entrega || '' }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  };

  // --- Categorías de personal --- (array de strings)
  window.getCategoriasPersonal = async function () {
    const data = await _get('/personal_config/categorias.json');
    if (!data) return [];
    return Array.isArray(data) ? data.filter(Boolean) : Object.values(data).filter(Boolean);
  };
  window.saveCategoriasPersonal = async function (cats) {
    await _put('/personal_config/categorias.json', cats);
  };

  // --- Valores por categoría (UOCRA, carga mensual manual) ---
  // Estructura: /personal_config/valores/{YYYY-MM}/{categoria}: valorHora
  // Firebase no admite . $ # [ ] / en las claves → se sanitizan los nombres.
  window.sanitizeCatKey = function (cat) {
    return String(cat || '').replace(/[.#$/\[\]]/g, '_');
  };
  // Todos los meses cargados: { "YYYY-MM": { catKey: valorHora } }
  window.getValoresCategoriasTodos = async function () {
    return (await _get('/personal_config/valores.json')) || {};
  };
  window.getValoresCategorias = async function (mes) {
    return (await _get('/personal_config/valores/' + mes + '.json')) || {};
  };
  window.saveValoresCategorias = async function (mes, valores) {
    await _put('/personal_config/valores/' + mes + '.json', valores);
  };

  // --- Feriados --- { "YYYY-MM-DD": "Nombre" }
  window.getFeriados = async function () {
    const data = await _get('/personal_config/feriados.json');
    return data || {};
  };
  window.saveFeriados = async function (feriados) {
    await _put('/personal_config/feriados.json', feriados);
  };

  // --- Partes diarios ---
  // Estructura: /partes/{obraKey}/{YYYY-MM-DD}/{ items:{personalId:{...}}, _meta:{validado,...} }
  window.getParte = async function (obraKey, fecha) {
    const data = await _get('/partes/' + obraKey + '/' + fecha + '.json');
    return data || { items: {}, _meta: { validado: false } };
  };

  // _meta de todas las fechas (para pintar el calendario)
  window.getPartesMeta = async function (obraKey) {
    const data = await _get('/partes/' + obraKey + '.json');
    if (!data) return {};
    const out = {};
    Object.entries(data).forEach(([fecha, p]) => {
      out[fecha] = (p && p._meta) || { validado: false };
    });
    return out;
  };

  // Partes completos (items + _meta) de un rango de fechas [isoStart, isoEnd]
  // Devuelve { "YYYY-MM-DD": { items:{...}, _meta:{...} } } (para el reporte de quincena)
  window.getPartesRango = async function (obraKey, isoStart, isoEnd) {
    const data = await _get('/partes/' + obraKey + '.json');
    if (!data) return {};
    const out = {};
    Object.entries(data).forEach(([fecha, p]) => {
      if (fecha >= isoStart && fecha <= isoEnd) out[fecha] = p || {};
    });
    return out;
  };

  // Guarda todos los items del día de una (fuente única de verdad de la tabla)
  window.saveParteDia = async function (obraKey, fecha, items) {
    await _put('/partes/' + obraKey + '/' + fecha + '/items.json', items || {});
  };

  window.setValidadoDia = async function (obraKey, fecha, validado, codigo) {
    await _put('/partes/' + obraKey + '/' + fecha + '/_meta.json', {
      validado:    !!validado,
      validadoPor: validado ? (codigo || '') : null,
      validadoEn:  validado ? Date.now()    : null
    });
  };

  // --- Cierres de quincena --- /cierres/{obraKey}/{quincenaId}  (ej "2026-06-Q2")
  window.getCierre = async function (obraKey, quincenaId) {
    return (await _get('/cierres/' + obraKey + '/' + quincenaId + '.json')) || null;
  };
  window.cerrarQuincena = async function (obraKey, quincenaId, codigo) {
    await _put('/cierres/' + obraKey + '/' + quincenaId + '.json', {
      cerrado: true, cerradoPor: codigo || '', cerradoEn: Date.now()
    });
  };
  window.reabrirQuincena = async function (obraKey, quincenaId) {
    const resp = await fetch(_base() + '/cierres/' + obraKey + '/' + quincenaId + '.json', { method: 'DELETE' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  };
})();
