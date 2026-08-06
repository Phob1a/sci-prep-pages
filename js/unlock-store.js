const DATABASE = 'sci-prep-unlock-v1';
const OBJECT_STORE = 'keys';
const RECORD_ID = 'content-key';

const closeBestEffort = database => {
  try {
    database.close();
  } catch {}
};

export function createIndexedDbUnlockStore(indexedDBImpl = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    if (!indexedDBImpl) {
      reject(new Error('Remembered unlock is unavailable'));
      return;
    }
    const request = indexedDBImpl.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const read = async () => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readonly');
      const request = transaction.objectStore(OBJECT_STORE).get(RECORD_ID);
      request.onsuccess = () => {
        resolve(request.result
          ? { contentVersion: request.result.contentVersion, key: request.result.key }
          : null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    }).finally(() => closeBestEffort(database));
  };

  const write = async entry => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readwrite');
      transaction.objectStore(OBJECT_STORE).put({
        id: RECORD_ID,
        contentVersion: entry.contentVersion,
        key: entry.key,
      });
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error);
      };
      transaction.onabort = () => {
        reject(transaction.error);
      };
    }).finally(() => closeBestEffort(database));
  };

  const remove = async () => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, 'readwrite');
      transaction.objectStore(OBJECT_STORE).delete(RECORD_ID);
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error);
      };
      transaction.onabort = () => {
        reject(transaction.error);
      };
    }).finally(() => closeBestEffort(database));
  };

  return { get: read, put: write, delete: remove };
}
