"use strict";

// Apenas respostas públicas. Falhas/quota do IndexedDB não impedem o mapa de abrir.
(() => {
  // Um banco por uso: os contornos (grandes) ficam separados dos pontos das cidades,
  // para o limite de um não apagar os dados do outro.
  const databases = new Map();
  function openDatabaseNamed(name) {
    if (!databases.has(name)) databases.set(name, new Promise((resolve) => {
      try {
        if (!window.indexedDB) { resolve(null); return; }
        const request = window.indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore("responses", { keyPath: "key" });
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
        request.onerror = request.onblocked = () => resolve(null);
      } catch { resolve(null); }
    }));
    return databases.get(name);
  }
  function create({ now = Date.now, maxEntries = 24, maxBytes = 12 * 1024 * 1024, banco = "cidade15-public-cache" } = {}) {
    const memory = new Map();
    const openDatabase = () => openDatabaseNamed(banco);
    function remember(row) {
      memory.delete(row.key);
      if (row.bytes <= maxBytes) memory.set(row.key, row);
      let bytes = [...memory.values()].reduce((sum, item) => sum + item.bytes, 0);
      while (memory.size > maxEntries || bytes > maxBytes) {
        const oldest = memory.keys().next().value;
        bytes -= memory.get(oldest).bytes; memory.delete(oldest);
      }
    }
    return {
      async get(key, maxAge = 24 * 60 * 60 * 1000) {
        let row = memory.get(key);
        if (!row) {
          const db = await openDatabase();
          if (db) row = await new Promise((resolve) => {
            try {
              const request = db.transaction("responses").objectStore("responses").get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => resolve(null);
            } catch { resolve(null); }
          });
        }
        if (!row || now() - row.savedAt >= maxAge) { memory.delete(key); return null; }
        remember(row); return row.value;
      },
      // "bytes" pode vir pronto (ex.: texto grande), para não converter tudo de novo só para medir.
      async set(key, value, bytes = JSON.stringify(value).length * 2) {
        const row = { key, value, savedAt: now(), bytes };
        if (row.bytes > maxBytes) return;
        remember(row);
        const db = await openDatabase();
        if (!db) return;
        await new Promise((resolve) => {
          try {
            const transaction = db.transaction("responses", "readwrite");
            transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
            const store = transaction.objectStore("responses");
            store.put(row);
            const request = store.getAll();
            request.onsuccess = () => {
              const rows = request.result.sort((a, b) => a.savedAt - b.savedAt);
              let bytes = rows.reduce((sum, item) => sum + item.bytes, 0);
              while (rows.length > maxEntries || bytes > maxBytes) {
                const oldest = rows.shift(); store.delete(oldest.key); bytes -= oldest.bytes;
              }
            };
          } catch { resolve(); }
        });
      },
    };
  }
  window.CityCache = { create };
})();
