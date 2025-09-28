import { openDB } from 'idb';

const DB_NAME = 'isu_audio_store_v1';
const STORE_NAME = 'audio_blobs';
const DB_VERSION = 1;

let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      }
    });
  }
  return dbPromise;
}

export async function putBlob(key, blob) {
  const db = await getDb();
  return db.put(STORE_NAME, blob, key);
}

export async function getBlob(key) {
  const db = await getDb();
  return db.get(STORE_NAME, key);
}

export async function deleteBlob(key) {
  const db = await getDb();
  return db.delete(STORE_NAME, key);
}

export async function clearAll() {
  const db = await getDb();
  return db.clear(STORE_NAME);
}
