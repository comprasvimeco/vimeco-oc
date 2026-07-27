/* VIMECO S.A. — Cola offline para subidas a Drive (IndexedDB) */
(function () {
  const DB_NAME    = 'vimeco-drive-queue';
  // v2 agrega el store de remitos. El upgrade corre también sobre bases v1 que
  // ya tienen 'pending' con OC encoladas, así que cada store se crea sólo si
  // falta (crear uno existente tira ConstraintError y deja la cola inservible).
  const DB_VERSION = 2;
  const STORE      = 'pending';
  const STORE_REM  = 'remitos';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE))     db.createObjectStore(STORE,    { keyPath: 'histKey' });
        if (!db.objectStoreNames.contains(STORE_REM)) db.createObjectStore(STORE_REM, { keyPath: 'id' });
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Helpers genéricos sobre un store cualquiera.
  function _write(store, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      fn(tx.objectStore(store));
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    }));
  }

  function _readAll(store) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = e => reject(e.target.error);
    }));
  }

  window.driveQueue = {
    async enqueue({ histKey, pdfBlob, pdfName, obra, fecha, proveedor, nroOC, total, sourceFile }) {
      const db     = await openDB();
      const pdfBuf = await pdfBlob.arrayBuffer();
      const srcBuf = sourceFile ? await sourceFile.arrayBuffer() : null;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({
          histKey, pdfBuf, pdfName, obra, fecha, proveedor, nroOC, total,
          srcBuf,
          srcName:   sourceFile?.name || null,
          srcType:   sourceFile?.type || null,
          timestamp: Date.now()
        });
        tx.oncomplete = resolve;
        tx.onerror    = e => reject(e.target.error);
      });
    },

    async dequeue(histKey) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(histKey);
        tx.oncomplete = resolve;
        tx.onerror    = e => reject(e.target.error);
      });
    },

    async getAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = e => resolve(e.target.result || []);
        req.onerror   = e => reject(e.target.error);
      });
    },

    // ─── Remitos ───
    // El remito se carga en obra, donde la señal es mala, así que se encola
    // ENTERO: el registro (que va a Firebase) y la foto (que va a Drive) pueden
    // fallar por separado. `remitoKey` queda en null hasta que el registro se
    // guardó; el reintento lo usa para no crear el remito dos veces.
    async enqueueRemito({ id, remitoKey, record, file, ocMeta, fileName }) {
      const buf = file ? await file.arrayBuffer() : null;
      await _write(STORE_REM, os => os.put({
        id, remitoKey: remitoKey || null, record, ocMeta,
        fileBuf:   buf,
        fileName:  fileName || file?.name || null,
        fileType:  file?.type || null,
        timestamp: Date.now()
      }));
      return id;
    },

    async dequeueRemito(id) { await _write(STORE_REM, os => os.delete(id)); },

    getAllRemitos() { return _readAll(STORE_REM); }
  };
})();
