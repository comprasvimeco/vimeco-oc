/* VIMECO S.A. — Cola offline para subidas a Drive (IndexedDB) */
(function () {
  const DB_NAME    = 'vimeco-drive-queue';
  const DB_VERSION = 1;
  const STORE      = 'pending';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE, { keyPath: 'histKey' });
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
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
    }
  };
})();
