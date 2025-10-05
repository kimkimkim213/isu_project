
const DB_NAME = 'isu_recordings_db';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

// IDB 연결 및 초기화
function openDB() {
  return new Promise((resolve, reject) => {
  console.log('IDB: DB 열기', DB_NAME, 'v', DB_VERSION);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
  console.log('IDB: onupgradeneeded - 스토어 생성 확인');
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { console.error('IDB: open error', req.error); reject(req.error); };
  });
}

// 모든 녹음본 조회
async function getAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
  console.log('IDB: getAllRecords - 트랜잭션 시작');
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => { console.error('IDB: getAll error', req.error); reject(req.error); };
  });
}

// 녹음본 추가/갱신
async function put(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
  console.log('IDB: putRecord - id=', record && record.id);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { console.error('IDB: put error', req.error, record && record.id); reject(req.error); };
  });
}

// id로 녹음본 삭제
async function del(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
  console.log('IDB: deleteRecord - id=', id);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => { console.error('IDB: delete error', req.error); reject(req.error); };
  });
}

// 전체 녹음본 삭제
async function clear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export { getAll, put, del, clear };
