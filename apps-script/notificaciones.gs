/**
 * VIMECO OC — intermediario de notificaciones push (Google Apps Script).
 *
 * La app (js/push.js → notificarUsuario) manda por POST {to, title, body, url, tag}.
 * Esto busca los dispositivos de ese usuario en /usuarios/{to}/pushTokens y los
 * avisa por la API HTTP v1 de Firebase Cloud Messaging. Los tokens que FCM da por
 * muertos se borran de la base.
 *
 * Necesita la propiedad de script SERVICE_ACCOUNT con el JSON completo de la
 * cuenta de servicio de Firebase. Pasos de instalación: apps-script/README.md.
 */
const DB_URL  = 'https://vimeco-oc-1a978-default-rtdb.firebaseio.com';
// El proyecto de FCM sale del project_id de SERVICE_ACCOUNT.

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (_) { return _json({ ok: false, error: 'json inválido' }); }

  const to = String(req.to || '').replace(/[^\w-]/g, '');
  if (!to || !req.title) return _json({ ok: false, error: 'faltan datos' });

  const tokens = _get('/usuarios/' + to + '/pushTokens') || {};
  const ids = Object.keys(tokens).filter(id => tokens[id] && tokens[id].token);
  if (!ids.length) return _json({ ok: true, enviados: 0 });

  // FCM exige que los valores de `data` sean strings.
  const data = {
    title: String(req.title).slice(0, 120),
    body:  String(req.body || '').slice(0, 400),
    url:   String(req.url || 'autorizaciones.html'),
    tag:   String(req.tag || '')
  };
  const access = _accessToken();
  const fcmUrl = 'https://fcm.googleapis.com/v1/projects/' + _sa().project_id + '/messages:send';
  const resps = UrlFetchApp.fetchAll(ids.map(id => ({
    url: fcmUrl,
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + access },
    muteHttpExceptions: true,
    payload: JSON.stringify({ message: {
      token: tokens[id].token,
      data: data,
      webpush: { headers: { Urgency: 'high', TTL: '86400' } }
    } })
  })));

  let enviados = 0;
  resps.forEach((r, i) => {
    const code = r.getResponseCode();
    if (code === 200) { enviados++; return; }
    const txt = r.getContentText();
    // Desinstalada, permiso revocado o token rotado: no va a volver a servir.
    if (code === 404 || /UNREGISTERED/.test(txt)) _delete('/usuarios/' + to + '/pushTokens/' + ids[i]);
    else console.warn('FCM ' + code + ' (' + ids[i] + '): ' + txt.slice(0, 300));
  });
  return _json({ ok: true, enviados: enviados });
}

// Abrir la URL del despliegue en el navegador sirve para comprobar que responde.
function doGet() {
  return _json({ ok: true, servicio: 'vimeco-oc notificaciones' });
}

// Correr a mano desde el editor: la primera vez pide los permisos del script.
// Cambiar el código por el de un usuario que ya haya activado las notificaciones.
function probar() {
  const r = doPost({ postData: { contents: JSON.stringify({
    to: '0000', title: 'Prueba de VIMECO OC', body: 'Si ves esto, las notificaciones andan.'
  }) } });
  Logger.log(r.getContent());
}

function _get(path) {
  const r = UrlFetchApp.fetch(DB_URL + path + '.json', { muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
}

function _delete(path) {
  UrlFetchApp.fetch(DB_URL + path + '.json', { method: 'delete', muteHttpExceptions: true });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Token OAuth de la cuenta de servicio (JWT firmado con RS256), cacheado ~55 min.
function _accessToken() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fcm_access');
  if (hit) return hit;

  const sa  = _sa();
  const now = Math.floor(Date.now() / 1000);
  const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const unsigned = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600
  }));
  const sig = b64(Utilities.computeRsaSha256Signature(unsigned, sa.private_key));

  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }
  });
  const token = JSON.parse(r.getContentText()).access_token;
  cache.put('fcm_access', token, 3300);
  return token;
}

function _sa() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT'));
}
