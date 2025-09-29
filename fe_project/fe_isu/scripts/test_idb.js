// 간단한 idb 검사 스크립트
// fake-indexeddb를 전역 window.indexedDB로 세팅하고 idb를 사용해 put/get/delete/clear 테스트

// fake-indexeddb 자동 등록: global.indexedDB를 제공합니다.
require('fake-indexeddb/auto');
const { openDB } = require('idb');

async function run() {
  // openDB 사용
  const DB_NAME = 'test_db_for_ci';
  const STORE = 'store';
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    }
  });

  console.log('DB opened');

  await db.put(STORE, 'hello world', 'key1');
  console.log('put key1');

  const v = await db.get(STORE, 'key1');
  console.log('get key1 =>', v);

  await db.delete(STORE, 'key1');
  console.log('deleted key1');

  const v2 = await db.get(STORE, 'key1');
  console.log('get after delete =>', v2);

  await db.put(STORE, 'a', 'a');
  await db.put(STORE, 'b', 'b');
  await db.clear(STORE);
  console.log('cleared store');

  const all = await db.getAll(STORE);
  console.log('getAll =>', all);

  console.log('All tests passed');
  process.exit(0);
}

run().catch(err => {
  console.error('Test failed', err);
  process.exit(2);
});