/* ===================================================
   VIMECO S.A. — Cotización del dólar
   dolar.js

   Captura un "snapshot" de la cotización (oficial + blue) al momento
   de crear una OC, para poder reexpresar totales en ARS/USD con la
   cotización real de esa fecha (y no la de hoy).

   Fuente: dolarapi.com (pública, sin API key, con CORS).
   El snapshot se cachea en localStorage con un TTL corto; si la red
   falla, se reutiliza el último snapshot conocido y nunca bloquea el
   guardado de la OC.
   =================================================== */
(function () {
  const CACHE_KEY = 'vimeco_dolar_cache';
  const TTL_MS    = 3 * 60 * 60 * 1000; // 3 h: suficiente para OC del día

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null; // { ts, snap }
    } catch (_) { return null; }
  }

  function writeCache(snap) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), snap })); }
    catch (_) {}
  }

  async function fetchCasa(casa) {
    const resp = await fetch('https://dolarapi.com/v1/dolares/' + casa, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const d = await resp.json();
    return { compra: Number(d.compra) || null, venta: Number(d.venta) || null };
  }

  // Trae oficial + blue y arma el snapshot. Lanza si no hay red.
  async function fetchSnapshot() {
    const [oficial, blue] = await Promise.all([fetchCasa('oficial'), fetchCasa('blue')]);
    return {
      fecha:   new Date().toISOString(),
      fuente:  'dolarapi.com',
      oficial,
      blue
    };
  }

  // Snapshot cacheado (sincrónico). null si nunca se pudo traer.
  window.getDolarCached = function () {
    const c = readCache();
    return c && c.snap ? c.snap : null;
  };

  // Snapshot fresco: usa caché si es reciente (<TTL); si no, refetch.
  // Nunca rechaza: ante error de red devuelve el último snapshot o null.
  window.getDolarSnapshot = async function () {
    const c = readCache();
    if (c && c.snap && (Date.now() - c.ts) < TTL_MS) return c.snap;
    try {
      const snap = await fetchSnapshot();
      writeCache(snap);
      return snap;
    } catch (_) {
      return c && c.snap ? c.snap : null;
    }
  };

  // Refresca la caché en segundo plano (fire-and-forget) al cargar la página,
  // así al generar una OC ya hay un valor caliente disponible sincrónicamente.
  window.warmDolarCache = function () {
    getDolarSnapshot().catch(() => {});
  };

  // Auto-warm al cargar el script (no bloquea nada).
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', window.warmDolarCache, { once: true });
  else
    window.warmDolarCache();
})();
