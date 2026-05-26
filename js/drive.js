/* global DRIVE_CONFIG, FIREBASE_CONFIG */
(function () {
  'use strict';

  // Si no está configurado, exponer stub para no romper app.js
  if (!window.DRIVE_CONFIG || !window.DRIVE_CONFIG.serviceAccount) {
    window.uploadToDrive = async function () { throw new Error('Drive no configurado'); };
    return;
  }

  function b64u(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  function b64uBytes(arr) {
    let bin = '';
    arr.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  async function generateJWT() {
    const { client_email, private_key } = DRIVE_CONFIG.serviceAccount;
    const header  = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const now     = Math.floor(Date.now() / 1000);
    const claims  = b64u(JSON.stringify({
      iss: client_email, scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
    }));
    const signing  = `${header}.${claims}`;
    const pem      = private_key
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');
    const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8', keyBytes.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signing)
    );
    return `${signing}.${b64uBytes(new Uint8Array(sig))}`;
  }

  const SCOPE_VERSION = 'v3';

  async function getAccessToken() {
    const cached = sessionStorage.getItem('_dtok');
    const expiry = parseInt(sessionStorage.getItem('_dexp') || '0', 10);
    const sv     = sessionStorage.getItem('_dsv');
    if (cached && Date.now() < expiry && sv === SCOPE_VERSION) return cached;
    const jwt  = await generateJWT();
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:   `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    if (!resp.ok) throw new Error(`Token (${resp.status}): ${await resp.text()}`);
    const { access_token } = await resp.json();
    sessionStorage.setItem('_dtok', access_token);
    sessionStorage.setItem('_dexp', String(Date.now() + 55 * 60 * 1000));
    sessionStorage.setItem('_dsv', SCOPE_VERSION);
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
      body:    JSON.stringify({ name: safe, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (!c.ok) throw new Error(`Drive mkdir (${c.status})`);
    return (await c.json()).id;
  }

  async function uploadFile(token, blob, name, mimeType, folderId) {
    const create = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id',
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, parents: [folderId], mimeType })
      }
    );
    if (!create.ok) throw new Error(`Create (${create.status}): ${await create.text()}`);
    const { id } = await create.json();
    const upload = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
      {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
        body:    blob
      }
    );
    if (!upload.ok) throw new Error(`Upload (${upload.status}): ${await upload.text()}`);
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
      // Dejar registro visible en la carpeta
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
  };
})();
