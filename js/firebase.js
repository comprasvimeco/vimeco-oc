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
