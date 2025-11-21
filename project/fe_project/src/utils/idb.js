// IndexedDB 관련 유틸

const DB_NAME = 'isu_recordings_db';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

// 캐시된 DB 인스턴스 및 열기 프라미스
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
      // 다른 탭에서 버전 변경 시 안전하게 닫고 캐시를 무효화
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
