/* global DRIVE_CONFIG */
(function () {
  'use strict';

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
      iss:   client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud:   'https://oauth2.googleapis.com/token',
      exp:   now + 3600,
      iat:   now
    }));
    const signing = `${header}.${claims}`;

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
      'RSASSA-PKCS1-v1_5', cryptoKey,
      new TextEncoder().encode(signing)
    );

    return `${signing}.${b64uBytes(new Uint8Array(sig))}`;
  }

  const SCOPE_VERSION = 'v2'; // incrementar si cambia el scope

  async function getAccessToken() {
    const cached = sessionStorage.getItem('_dtok');
    const expiry = parseInt(sessionStorage.getItem('_dexp') || '0', 10);
    const sv     = sessionStorage.getItem('_dsv');
    if (cached && Date.now() < expiry && sv === SCOPE_VERSION) return cached;

    const jwt  = await generateJWT();
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Token Drive (${resp.status}): ${t}`);
    }
    const { access_token } = await resp.json();
    sessionStorage.setItem('_dtok', access_token);
    sessionStorage.setItem('_dexp', String(Date.now() + 55 * 60 * 1000));
    sessionStorage.setItem('_dsv', SCOPE_VERSION);
    return access_token;
  }

  async function getOrCreateProviderFolder(token, providerName) {
    const parent    = DRIVE_CONFIG.folderId;
    const folderName = providerName.trim() || 'Sin proveedor';
    const q = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;

    const s = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!s.ok) throw new Error(`Drive search (${s.status})`);
    const { files } = await s.json();
    if (files.length) return files[0].id;

    const c = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parent] })
    });
    if (!c.ok) throw new Error(`Drive mkdir (${c.status})`);
    const { id } = await c.json();
    return id;
  }

  window.uploadToDrive = async function (pdfBlob, filename, providerName) {
    const token    = await getAccessToken();
    const folderId = await getOrCreateProviderFolder(token, providerName || '');

    // Paso 1: crear el archivo con metadata (JSON simple)
    const create = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id,webViewLink',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: filename, parents: [folderId], mimeType: 'application/pdf' })
      }
    );
    if (!create.ok) {
      const t = await create.text();
      throw new Error(`Create ${create.status}: ${t}`);
    }
    const { id, webViewLink } = await create.json();

    // Paso 2: subir el contenido binario
    const upload = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
        body: pdfBlob
      }
    );
    if (!upload.ok) {
      const t = await upload.text();
      throw new Error(`Upload ${upload.status}: ${t}`);
    }
    return webViewLink;
  };
})();
