/* global DRIVE_CONFIG, FIREBASE_CONFIG */
(function () {
  'use strict';

  if (!window.DRIVE_CONFIG || !window.DRIVE_CONFIG.clientId) {
    const noDrive = async function () { throw new Error('Drive no configurado'); };
    window.uploadToDrive       = noDrive;
    window.uploadSourceToDrive = noDrive;
    window.uploadPdfToDrive    = noDrive;
    return;
  }

  const TOKEN_URL = 'https://oauth2.googleapis.com/token';

  async function getAccessToken() {
    const cached = sessionStorage.getItem('_dtok');
    const expiry = parseInt(sessionStorage.getItem('_dexp') || '0', 10);
    if (cached && Date.now() < expiry) return cached;

    // Leer refresh token desde Firebase
    const fbResp = await fetch(
      FIREBASE_CONFIG.databaseURL + '/drive_refresh_token.json'
    );
    if (!fbResp.ok) throw new Error(`Firebase RT (${fbResp.status})`);
    const refreshToken = await fbResp.json();
    if (!refreshToken) throw new Error('No hay refresh token en Firebase');

    const resp = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     DRIVE_CONFIG.clientId,
        client_secret: DRIVE_CONFIG.clientSecret
      })
    });
    if (!resp.ok) throw new Error(`Token (${resp.status}): ${await resp.text()}`);
    const { access_token, expires_in } = await resp.json();

    sessionStorage.setItem('_dtok', access_token);
    sessionStorage.setItem('_dexp', String(Date.now() + (expires_in - 60) * 1000));
    return access_token;
  }

  async function getOrCreateFolder(token, name, parentId) {
    const safe = (name || 'Sin nombre').replace(/[/\\]/g, '-').trim().substring(0, 120);
    const q    = `name=${JSON.stringify(safe)} and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const s    = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!s.ok) throw new Error(`Drive search (${s.status})`);
    const { files } = await s.json();
    if (files.length) return files[0].id;

    const c = await fetch('https://www.googleapis.com/drive/v3/files', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:     safe,
        mimeType: 'application/vnd.google-apps.folder',
        parents:  [parentId]
      })
    });
    if (!c.ok) throw new Error(`Drive mkdir (${c.status})`);
    return (await c.json()).id;
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function uploadFile(token, blob, name, mimeType, folderId) {
    const boundary = 'vimeco_' + Date.now();
    const meta     = JSON.stringify({ name, parents: [folderId], mimeType });
    const enc      = new TextEncoder();
    const pre      = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const post    = enc.encode(`\r\n--${boundary}--`);
    const content = new Uint8Array(await blob.arrayBuffer());

    const body = new Uint8Array(pre.length + content.length + post.length);
    body.set(pre, 0);
    body.set(content, pre.length);
    body.set(post, pre.length + content.length);

    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
    // Reintentos con backoff: en móvil la subida falla a veces por cortes de red
    // transitorios ("Load failed") o respuestas 5xx/429. Reintentar las absorbe.
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await _sleep(600 * attempt);   // 0, 600, 1200, 1800 ms
      try {
        const resp = await fetch(url, {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body
        });
        if (resp.ok) {
          try { return (await resp.json()).id; } catch (_) { return null; }
        }
        lastErr = new Error(`Upload (${resp.status})`);
        if (resp.status < 500 && resp.status !== 429) break;  // 4xx no transitorio → no reintentar
      } catch (e) {
        lastErr = e;   // error de red ("Load failed") → reintentar
      }
    }
    throw lastErr;
  }

  async function logDriveError(nroOC, error) {
    try {
      const key = (nroOC || 'unknown').replace(/[^a-z0-9]/gi, '');
      await fetch(`${FIREBASE_CONFIG.databaseURL}/drive_errors/${key}.json`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          nroOC,
          error:     error.message || String(error),
          timestamp: Date.now()
        })
      });
    } catch (_) {}
  }

  // Cache en memoria de los IDs de las carpetas raíz OBRAS y PROVEEDORES
  let _obrasId, _proveedoresId;

  async function getObrasRootId(token) {
    if (_obrasId) return _obrasId;
    try {
      const r = await fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/obrasId.json');
      if (r.ok) { const v = await r.json(); if (v) { _obrasId = v; return v; } }
    } catch (_) {}
    _obrasId = await getOrCreateFolder(token, 'OBRAS', DRIVE_CONFIG.folderId);
    fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/obrasId.json', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_obrasId)
    }).catch(() => {});
    return _obrasId;
  }

  async function getProveedoresRootId(token) {
    if (_proveedoresId) return _proveedoresId;
    try {
      const r = await fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/proveedoresId.json');
      if (r.ok) { const v = await r.json(); if (v) { _proveedoresId = v; return v; } }
    } catch (_) {}
    _proveedoresId = await getOrCreateFolder(token, 'PROVEEDORES', DRIVE_CONFIG.folderId);
    fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/proveedoresId.json', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_proveedoresId)
    }).catch(() => {});
    return _proveedoresId;
  }

  // Crea (o reutiliza) las dos carpetas destino de una OC y devuelve sus IDs.
  //   COMPRAS/OBRAS/{Obra}/{YYYY-MM-DD | Proveedor}/
  //   COMPRAS/PROVEEDORES/{Proveedor}/{YYYY-MM-DD | Proveedor}/
  async function _ensureOCFolders(token, { obra, fecha, proveedor }) {
    const subName = `${fecha} | ${(proveedor || 'Sin proveedor').substring(0, 80)}`;
    const [obrasRootId, proveedoresRootId] = await Promise.all([
      getObrasRootId(token),
      getProveedoresRootId(token)
    ]);
    const [obraParentId, provParentId] = await Promise.all([
      getOrCreateFolder(token, obra || 'Sin obra',           obrasRootId),
      getOrCreateFolder(token, proveedor || 'Sin proveedor', proveedoresRootId)
    ]);
    const [obrasFolderId, proveedoresFolderId] = await Promise.all([
      getOrCreateFolder(token, subName, obraParentId),
      getOrCreateFolder(token, subName, provParentId)
    ]);
    return { obrasFolderId, proveedoresFolderId };
  }

  // Sube el PDF a ambas carpetas; deja un marcador de error si alguna falla.
  // Lanza solo si fallan las dos.
  async function _pushPdf(token, pdfBlob, pdfName, obrasFolderId, proveedoresFolderId, nroOC) {
    const pdfResults = await Promise.allSettled([
      uploadFile(token, pdfBlob, pdfName, 'application/pdf', obrasFolderId),
      uploadFile(token, pdfBlob, pdfName, 'application/pdf', proveedoresFolderId)
    ]);
    for (const [i, res] of pdfResults.entries()) {
      if (res.status === 'rejected') {
        const label = i === 0 ? 'OBRAS' : 'PROVEEDORES';
        const fid   = i === 0 ? obrasFolderId : proveedoresFolderId;
        await logDriveError(nroOC, new Error(`PDF ${label}: ${res.reason?.message}`));
        try {
          const marker = new Blob(
            [`Error al subir PDF\nOC: ${nroOC}\nFecha: ${new Date().toISOString()}\nError: ${res.reason?.message}`],
            { type: 'text/plain' }
          );
          await uploadFile(token, marker, '_ERROR_PDF.txt', 'text/plain', fid);
        } catch (_) {}
      }
    }
    if (pdfResults.every(r => r.status === 'rejected')) throw pdfResults[0].reason;
  }

  // Sube el archivo fuente a ambas carpetas. Devuelve un link de vista a la
  // primera copia subida con éxito (o '' si no hay archivo / falló todo).
  async function _pushSource(token, sourceFile, obrasFolderId, proveedoresFolderId, nroOC) {
    if (!sourceFile) return '';
    const mime = sourceFile.type || 'application/octet-stream';
    const results = await Promise.allSettled([
      uploadFile(token, sourceFile, sourceFile.name, mime, obrasFolderId),
      uploadFile(token, sourceFile, sourceFile.name, mime, proveedoresFolderId)
    ]);
    results.forEach((r, i) => {
      if (r.status === 'rejected')
        logDriveError(nroOC, new Error(`Fuente ${i === 0 ? 'OBRAS' : 'PROVEEDORES'}: ${r.reason?.message}`));
    });
    const ok = results.find(r => r.status === 'fulfilled' && r.value);
    return ok ? `https://drive.google.com/file/d/${ok.value}/view` : '';
  }

  window.uploadToDrive = async function (pdfBlob, pdfName, meta, sourceFile) {
    const { nroOC } = meta;
    let token, obrasFolderId, proveedoresFolderId;
    try {
      token = await getAccessToken();
      ({ obrasFolderId, proveedoresFolderId } = await _ensureOCFolders(token, meta));
    } catch (err) {
      await logDriveError(nroOC, err);
      throw err;
    }

    await _pushPdf(token, pdfBlob, pdfName, obrasFolderId, proveedoresFolderId, nroOC);

    // Archivo fuente en background (best-effort)
    if (sourceFile) {
      _pushSource(token, sourceFile, obrasFolderId, proveedoresFolderId, nroOC).catch(() => {});
    }

    return { obrasFolderId, proveedoresFolderId };
  };

  // Al PEDIR autorización: crea las carpetas y sube solo el archivo fuente (si hay),
  // para que el autorizador pueda verlo. Devuelve IDs de carpeta + link al fuente.
  window.uploadSourceToDrive = async function (meta, sourceFile) {
    const { nroOC } = meta;
    let token, obrasFolderId, proveedoresFolderId;
    try {
      token = await getAccessToken();
      ({ obrasFolderId, proveedoresFolderId } = await _ensureOCFolders(token, meta));
    } catch (err) {
      await logDriveError(nroOC, err);
      throw err;
    }
    const sourceLink = await _pushSource(token, sourceFile, obrasFolderId, proveedoresFolderId, nroOC);
    return { obrasFolderId, proveedoresFolderId, sourceLink };
  };

  // Al AUTORIZAR: sube el PDF final a las carpetas ya creadas (o las recrea si no
  // se conocen los IDs, p. ej. si al pedir no había conexión con Drive).
  window.uploadPdfToDrive = async function (pdfBlob, pdfName, meta) {
    const { nroOC } = meta;
    let { obrasFolderId, proveedoresFolderId } = meta;
    let token;
    try {
      token = await getAccessToken();
      if (!obrasFolderId || !proveedoresFolderId) {
        ({ obrasFolderId, proveedoresFolderId } = await _ensureOCFolders(token, meta));
      }
    } catch (err) {
      await logDriveError(nroOC, err);
      throw err;
    }
    await _pushPdf(token, pdfBlob, pdfName, obrasFolderId, proveedoresFolderId, nroOC);
    return { obrasFolderId, proveedoresFolderId };
  };

  // Estructura Caja: Cajas → {userName} → {YYYY-MM} → Fotos|Archivos → archivo
  window.uploadToCajaDrive = async function (file, { userId, userName, fecha, tipo }) {
    const token = await getAccessToken();

    // Leer o crear carpeta raíz "Cajas" (id guardado en Firebase)
    let cajasId;
    try {
      const r = await fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/cajasId.json');
      if (r.ok) cajasId = await r.json();
    } catch (_) {}

    if (!cajasId) {
      cajasId = await getOrCreateFolder(token, 'CAJAS', DRIVE_CONFIG.folderId);
      fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/cajasId.json', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(cajasId)
      }).catch(() => {});
    }

    const mes        = fecha ? fecha.substring(0, 7) : new Date().toISOString().substring(0, 7);
    const userFolder = await getOrCreateFolder(token, userName || userId, cajasId);
    const mesFolder  = await getOrCreateFolder(token, mes, userFolder);
    // tipo 'planilla' → sube directo a la carpeta del mes; 'foto'/'archivo' → subcarpeta
    const typeFolder = (tipo === 'foto' || tipo === 'archivo')
      ? await getOrCreateFolder(token, tipo === 'foto' ? 'Fotos' : 'Archivos', mesFolder)
      : mesFolder;

    const mimeType = file.type || 'application/octet-stream';

    // Para planilla: buscar si ya existe y hacer PATCH (actualizar) en vez de crear
    if (tipo === 'planilla') {
      const q = `name=${JSON.stringify(file.name)} and '${typeFolder}' in parents and trashed=false`;
      const search = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (search.ok) {
        const { files } = await search.json();
        if (files?.length) {
          // Actualizar contenido del archivo existente
          const existingId = files[0].id;
          const boundary   = 'vimeco_' + Date.now();
          const meta       = JSON.stringify({ name: file.name, mimeType });
          const enc        = new TextEncoder();
          const pre        = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
          const post       = enc.encode(`\r\n--${boundary}--`);
          const content    = new Uint8Array(await file.arrayBuffer());
          const body       = new Uint8Array(pre.length + content.length + post.length);
          body.set(pre, 0); body.set(content, pre.length); body.set(post, pre.length + content.length);
          const upd = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`,
            { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
          );
          if (!upd.ok) throw new Error(`Update planilla (${upd.status})`);
          return { fileId: (await upd.json()).id };
        }
      }
    }

    // Crear nuevo archivo
    const boundary = 'vimeco_' + Date.now();
    const meta     = JSON.stringify({ name: file.name, parents: [typeFolder], mimeType });
    const enc      = new TextEncoder();
    const pre      = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const post     = enc.encode(`\r\n--${boundary}--`);
    const content  = new Uint8Array(await file.arrayBuffer());
    const body     = new Uint8Array(pre.length + content.length + post.length);
    body.set(pre, 0); body.set(content, pre.length); body.set(post, pre.length + content.length);
    const resp = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
    );
    if (!resp.ok) throw new Error(`Upload caja (${resp.status})`);
    return { fileId: (await resp.json()).id };
  };

  // Carpeta padre de COMPRAS (para colgar PERSONAL como hermana, no adentro)
  async function getComprasParentId(token) {
    try {
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${DRIVE_CONFIG.folderId}?fields=parents&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) return null;
      const { parents } = await r.json();
      return (parents && parents[0]) || null;
    } catch (_) { return null; }
  }

  function _setPersonalMovedFlag() {
    fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/personalMovedOut.json', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
    }).catch(() => {});
  }

  // Migración única: si PERSONAL quedó dentro de COMPRAS, la mueve al padre de COMPRAS.
  // Best-effort y guardada por flag para no chequear en cada subida.
  async function _ensurePersonalOutsideCompras(token, personalId) {
    try {
      const f = await fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/personalMovedOut.json');
      if (f.ok && (await f.json()) === true) return;

      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${personalId}?fields=parents&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) return;
      const parents = (await r.json()).parents || [];
      if (!parents.includes(DRIVE_CONFIG.folderId)) { _setPersonalMovedFlag(); return; }

      const target = await getComprasParentId(token);
      if (!target || target === DRIVE_CONFIG.folderId) return;
      const upd = await fetch(
        `https://www.googleapis.com/drive/v3/files/${personalId}?addParents=${target}&removeParents=${DRIVE_CONFIG.folderId}&supportsAllDrives=true&fields=id`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }
      );
      if (upd.ok) _setPersonalMovedFlag();
    } catch (_) {}
  }

  // Raíz PERSONAL (id cacheado en Firebase). Vive como hermana de COMPRAS.
  async function getPersonalRootId(token) {
    let id;
    try {
      const r = await fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/personalRootId.json');
      if (r.ok) id = await r.json();
    } catch (_) {}
    if (!id) {
      const parent = (await getComprasParentId(token)) || DRIVE_CONFIG.folderId;
      id = await getOrCreateFolder(token, 'PERSONAL', parent);
      fetch(FIREBASE_CONFIG.databaseURL + '/drive_config/personalRootId.json', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(id)
      }).catch(() => {});
      return id;
    }
    // Si ya existía (probablemente dentro de COMPRAS), moverla afuera una vez.
    _ensurePersonalOutsideCompras(token, id);
    return id;
  }

  // Sube un blob a una carpeta y devuelve { fileId, url }
  async function _uploadReturningId(token, file, name, folderId) {
    const mimeType = file.type || 'application/octet-stream';
    const boundary = 'vimeco_' + Date.now();
    const meta     = JSON.stringify({ name, parents: [folderId], mimeType });
    const enc      = new TextEncoder();
    const pre      = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const post     = enc.encode(`\r\n--${boundary}--`);
    const content  = new Uint8Array(await file.arrayBuffer());
    const body     = new Uint8Array(pre.length + content.length + post.length);
    body.set(pre, 0); body.set(content, pre.length); body.set(post, pre.length + content.length);
    const resp = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
    );
    if (!resp.ok) throw new Error(`Upload (${resp.status})`);
    const fileId = (await resp.json()).id;
    return { fileId, url: `https://drive.google.com/file/d/${fileId}/view` };
  }

  // Estructura Personal: PERSONAL → Padron → {label} → dni_{lado}.{ext}
  // label = "Apellido Nombre - DNI"; lado = 'frente' | 'dorso'.
  // Devuelve { fileId, url } (link de vista).
  window.uploadDniToDrive = async function (file, { label, lado }) {
    const token = await getAccessToken();
    const personalRootId = await getPersonalRootId(token);

    const padronId     = await getOrCreateFolder(token, 'Padron', personalRootId);
    const personFolder = await getOrCreateFolder(token, label || 'Sin nombre', padronId);

    const mimeType = file.type || 'application/octet-stream';
    const ext      = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : 'jpg';
    const base     = 'dni_' + (lado || 'frente');
    const fname    = base + '.' + ext;

    // Si ya hay un dni_{lado}.* en la carpeta, lo reemplazamos (PATCH) en vez de duplicar
    let existingId = null;
    try {
      const q = `'${personFolder}' in parents and name contains '${base}' and trashed=false`;
      const search = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (search.ok) {
        const { files } = await search.json();
        if (files?.length) existingId = files[0].id;
      }
    } catch (_) {}

    const boundary = 'vimeco_' + Date.now();
    const meta     = JSON.stringify(existingId
      ? { name: fname, mimeType }
      : { name: fname, parents: [personFolder], mimeType });
    const enc     = new TextEncoder();
    const pre     = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const post    = enc.encode(`\r\n--${boundary}--`);
    const content = new Uint8Array(await file.arrayBuffer());
    const body    = new Uint8Array(pre.length + content.length + post.length);
    body.set(pre, 0); body.set(content, pre.length); body.set(post, pre.length + content.length);

    const upUrl = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
    const resp = await fetch(upUrl, {
      method:  existingId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    if (!resp.ok) throw new Error(`Upload DNI (${resp.status})`);
    const fileId = (await resp.json()).id;
    return {
      fileId,
      url:       `https://drive.google.com/file/d/${fileId}/view`,
      folderId:  personFolder,
      folderUrl: `https://drive.google.com/drive/folders/${personFolder}`
    };
  };

  // Reporte de quincena para RRHH (Excel).
  // Estructura: PERSONAL → Reportes → {Obra} → archivo. Si ya existe (mismo nombre), lo actualiza.
  // Devuelve { fileId, url }.
  window.uploadReporteQuincena = async function (file, { obra }) {
    const token   = await getAccessToken();
    const rootId  = await getPersonalRootId(token);
    const repId   = await getOrCreateFolder(token, 'Reportes', rootId);
    const obraId  = await getOrCreateFolder(token, obra || 'Sin obra', repId);
    const mimeType = file.type || 'application/octet-stream';

    // Buscar archivo existente con el mismo nombre → PATCH (actualizar contenido)
    let existingId = null;
    try {
      const q = `name=${JSON.stringify(file.name)} and '${obraId}' in parents and trashed=false`;
      const s = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (s.ok) { const { files } = await s.json(); if (files?.length) existingId = files[0].id; }
    } catch (_) {}

    const boundary = 'vimeco_' + Date.now();
    const meta     = JSON.stringify(existingId
      ? { name: file.name, mimeType }
      : { name: file.name, parents: [obraId], mimeType });
    const enc     = new TextEncoder();
    const pre     = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const post    = enc.encode(`\r\n--${boundary}--`);
    const content = new Uint8Array(await file.arrayBuffer());
    const body    = new Uint8Array(pre.length + content.length + post.length);
    body.set(pre, 0); body.set(content, pre.length); body.set(post, pre.length + content.length);

    const upUrl = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
    const resp = await fetch(upUrl, {
      method:  existingId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    if (!resp.ok) throw new Error(`Upload reporte (${resp.status})`);
    const fileId = (await resp.json()).id;
    return { fileId, url: `https://drive.google.com/file/d/${fileId}/view` };
  };

  // Comprobantes del parte (certificados médicos, pasajes, etc.)
  // Estructura: PERSONAL → Comprobantes → {Obra} → {YYYY-MM-DD} → {Apellido Nombre} → archivo
  // Devuelve { fileId, url, name }.
  window.uploadComprobantePersonal = async function (file, { obra, fecha, persona }) {
    const token   = await getAccessToken();
    const rootId  = await getPersonalRootId(token);
    const compId  = await getOrCreateFolder(token, 'Comprobantes', rootId);
    const obraId  = await getOrCreateFolder(token, obra || 'Sin obra', compId);
    const fechaId = await getOrCreateFolder(token, fecha || 'sin-fecha', obraId);
    const persId  = await getOrCreateFolder(token, (persona || 'Sin nombre').substring(0, 100), fechaId);

    const name = file.name || ('comprobante_' + Date.now());
    const { fileId, url } = await _uploadReturningId(token, file, name, persId);
    return { fileId, url, name };
  };

  // Adjuntar un archivo a las carpetas Drive de una OC existente
  window.attachToDriveOC = async function (file, { drive_folder_obras_id, drive_folder_proveedores_id, drive_folder_id, obra, fecha, proveedor, nroOC }) {
    try {
      const token   = await getAccessToken();
      const mime    = file.type || 'application/octet-stream';
      const subName = `${fecha} | ${(proveedor || 'Sin proveedor').substring(0, 80)}`;

      // OC pre-reorganización: tiene solo drive_folder_id apuntando a COMPRAS/{obra}/...
      if (!drive_folder_obras_id && !drive_folder_proveedores_id && drive_folder_id) {
        await uploadFile(token, file, file.name, mime, drive_folder_id);
        return { folderId: drive_folder_id };
      }

      // Resolver IDs: usar los guardados o reconstruir bajo OBRAS/PROVEEDORES
      let obrasFid = drive_folder_obras_id;
      let provsFid = drive_folder_proveedores_id;

      if (!obrasFid || !provsFid) {
        const [obrasRoot, provsRoot] = await Promise.all([
          getObrasRootId(token),
          getProveedoresRootId(token)
        ]);
        if (!obrasFid) {
          const parent = await getOrCreateFolder(token, obra || 'Sin obra', obrasRoot);
          obrasFid = await getOrCreateFolder(token, subName, parent);
        }
        if (!provsFid) {
          const parent = await getOrCreateFolder(token, proveedor || 'Sin proveedor', provsRoot);
          provsFid = await getOrCreateFolder(token, subName, parent);
        }
      }

      await Promise.all([
        uploadFile(token, file, file.name, mime, obrasFid),
        uploadFile(token, file, file.name, mime, provsFid)
      ]);
      return { folderId: obrasFid || provsFid };
    } catch (err) {
      await logDriveError(nroOC, new Error(`Adjunto: ${err.message}`));
      throw err;
    }
  };
})();
