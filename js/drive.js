/* global DRIVE_CONFIG, FIREBASE_CONFIG */
(function () {
  'use strict';

  if (!window.DRIVE_CONFIG || !window.DRIVE_CONFIG.clientId) {
    window.uploadToDrive = async function () { throw new Error('Drive no configurado'); };
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

    const resp = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      }
    );
    if (!resp.ok) throw new Error(`Upload (${resp.status}): ${await resp.text()}`);
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

  // Estructura: COMPRAS → Obra → "YYYY-MM-DD | Proveedor" → PDF [+ archivo fuente]
  window.uploadToDrive = async function (pdfBlob, pdfName, { obra, fecha, proveedor, nroOC }, sourceFile) {
    let token, ocFolderId;

    try {
      token = await getAccessToken();
      const obraFolderId = await getOrCreateFolder(token, obra || 'Sin obra', DRIVE_CONFIG.folderId);
      const subName      = `${fecha} | ${(proveedor || 'Sin proveedor').substring(0, 80)}`;
      ocFolderId         = await getOrCreateFolder(token, subName, obraFolderId);
    } catch (err) {
      await logDriveError(nroOC, err);
      throw err;
    }

    // Subir PDF
    try {
      await uploadFile(token, pdfBlob, pdfName, 'application/pdf', ocFolderId);
    } catch (err) {
      await logDriveError(nroOC, new Error(`PDF: ${err.message}`));
      try {
        const marker = new Blob(
          [`Error al subir PDF\nOC: ${nroOC}\nFecha: ${new Date().toISOString()}\nError: ${err.message}`],
          { type: 'text/plain' }
        );
        await uploadFile(token, marker, '_ERROR_PDF.txt', 'text/plain', ocFolderId);
      } catch (_) {}
      throw err;
    }

    // Subir archivo fuente (best-effort, no lanza error)
    if (sourceFile) {
      try {
        await uploadFile(token, sourceFile, sourceFile.name, sourceFile.type || 'application/octet-stream', ocFolderId);
      } catch (err) {
        await logDriveError(nroOC, new Error(`Archivo fuente: ${err.message}`));
      }
    }

    return ocFolderId;
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
      cajasId = await getOrCreateFolder(token, 'Cajas', DRIVE_CONFIG.folderId);
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

    const resp = await (async () => {
      const boundary = 'vimeco_' + Date.now();
      const mimeType = file.type || 'application/octet-stream';
      const meta     = JSON.stringify({ name: file.name, parents: [typeFolder], mimeType });
      const enc      = new TextEncoder();
      const pre      = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
      const post     = enc.encode(`\r\n--${boundary}--`);
      const content  = new Uint8Array(await file.arrayBuffer());
      const body     = new Uint8Array(pre.length + content.length + post.length);
      body.set(pre, 0); body.set(content, pre.length); body.set(post, pre.length + content.length);
      return fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
      );
    })();
    if (!resp.ok) throw new Error(`Upload caja (${resp.status})`);
    const { id } = await resp.json();
    return { fileId: id };
  };

  // Adjuntar un archivo a la carpeta Drive de una OC existente
  window.attachToDriveOC = async function (file, { drive_folder_id, obra, fecha, proveedor, nroOC }) {
    let token, folderId;
    try {
      token    = await getAccessToken();
      folderId = drive_folder_id;
      if (!folderId) {
        const obraFolderId = await getOrCreateFolder(token, obra || 'Sin obra', DRIVE_CONFIG.folderId);
        const subName      = `${fecha} | ${(proveedor || 'Sin proveedor').substring(0, 80)}`;
        folderId           = await getOrCreateFolder(token, subName, obraFolderId);
      }
      await uploadFile(token, file, file.name, file.type || 'application/octet-stream', folderId);
    } catch (err) {
      await logDriveError(nroOC, new Error(`Adjunto: ${err.message}`));
      throw err;
    }
  };
})();
