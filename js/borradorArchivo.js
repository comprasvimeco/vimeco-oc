/* VIMECO OC — Borrador de archivos
 *
 * El archivo elegido en Facturas o en Remitos queda guardado en el dispositivo
 * (IndexedDB: un PDF no entra en localStorage) hasta que se sube. Si se toca la
 * flecha de volver, se sale de la pantalla o Android cierra la app mientras se
 * busca otra cosa, al entrar de nuevo sigue ahí: buscarlo otra vez era lo que
 * más tiempo llevaba.
 *
 * Uno por pantalla y por usuario (en un teléfono compartido cada uno ve el
 * suyo). Junto al archivo se guarda lo que la pantalla necesite para retomar
 * (la OC, lo tipeado…). Se borra al subir el archivo o al descartarlo a
 * propósito; si quedó olvidado, a los 7 días.
 */
const borradorArchivo = (() => {
  const DB   = 'vimeco-borrador-archivos';
  const VIDA = 7 * 24 * 3600 * 1000;

  function clave(pantalla) {
    return [pantalla, sessionStorage.getItem('responsable_code') || ''].join(':');
  }

  function abrir() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('borradores');
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  // De a una operación por vez: un borrar seguido de un guardar (cambiar de
  // archivo) tiene que terminar en ese orden, y cada una abre su conexión.
  let cola = Promise.resolve();
  function tx(modo, fn) {
    const p = cola.then(() => _tx(modo, fn));
    cola = p.catch(() => {});
    return p;
  }

  async function _tx(modo, fn) {
    const db = await abrir();
    try {
      const t   = db.transaction('borradores', modo);
      const req = fn(t.objectStore('borradores'));
      await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
      return req?.result;
    } finally {
      db.close();
    }
  }

  return {
    // datos: { file, ...lo que la pantalla quiera recuperar }
    async guardar(pantalla, datos) {
      try { await tx('readwrite', s => s.put({ ...datos, ts: Date.now() }, clave(pantalla))); }
      catch (e) { console.warn('borradorArchivo.guardar:', e); }
    },
    // El borrador guardado, o null (nada, vencido o sin archivo).
    async leer(pantalla) {
      try {
        const b = await tx('readonly', s => s.get(clave(pantalla)));
        if (b?.file && Date.now() - b.ts < VIDA) return b;
        if (b) this.borrar(pantalla);
      } catch (e) { console.warn('borradorArchivo.leer:', e); }
      return null;
    },
    async borrar(pantalla) {
      try { await tx('readwrite', s => s.delete(clave(pantalla))); }
      catch (e) { console.warn('borradorArchivo.borrar:', e); }
    }
  };
})();
