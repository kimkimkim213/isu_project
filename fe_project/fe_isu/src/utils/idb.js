// IndexedDB 관련 함수

const DB_NAME = 'isu_recordings_db';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

let cachedDB = null;
let openPromise = null;

function openDB() {
  if (cachedDB) return Promise.resolve(cachedDB);
  if (openPromise) return openPromise;

  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = () => {
      cachedDB = req.result;
      cachedDB.onversionchange = () => {
        cachedDB.close();
        cachedDB = null;
        openPromise = null;
      };
      resolve(cachedDB);
    };
    req.onerror = () => {
      openPromise = null;
      reject(req.error);
    };
  });
    return openPromise;
}

export async function getAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function put(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function del(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
