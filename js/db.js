// js/db.js
const DB_NAME = 'MrStudyDB';
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Users Store
      if (!db.objectStoreNames.contains('users')) {
        const userStore = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
        userStore.createIndex('username', 'username', { unique: true });
      }

      // 2. Rule Labels Store
      if (!db.objectStoreNames.contains('rule_labels')) {
        const rLabelStore = db.createObjectStore('rule_labels', { keyPath: 'id', autoIncrement: true });
        rLabelStore.createIndex('user_id', 'user_id', { unique: false });
      }

      // 3. Rules Store
      if (!db.objectStoreNames.contains('rules')) {
        const ruleStore = db.createObjectStore('rules', { keyPath: 'id', autoIncrement: true });
        ruleStore.createIndex('user_id', 'user_id', { unique: false });
        ruleStore.createIndex('label_id', 'label_id', { unique: false });
      }

      // 4. Action Labels Store
      if (!db.objectStoreNames.contains('action_labels')) {
        const aLabelStore = db.createObjectStore('action_labels', { keyPath: 'id', autoIncrement: true });
        aLabelStore.createIndex('user_id', 'user_id', { unique: false });
      }

      // 5. Activity Logs Store (Rolling 15 items)
      if (!db.objectStoreNames.contains('activity_logs')) {
        const logStore = db.createObjectStore('activity_logs', { keyPath: 'id', autoIncrement: true });
        logStore.createIndex('user_id', 'user_id', { unique: false });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // 6. Store Items Store
      if (!db.objectStoreNames.contains('store_items')) {
        const itemStore = db.createObjectStore('store_items', { keyPath: 'id', autoIncrement: true });
        itemStore.createIndex('user_id', 'user_id', { unique: false });
      }

      // 7. User Inventory Store
      if (!db.objectStoreNames.contains('user_inventory')) {
        const invStore = db.createObjectStore('user_inventory', { keyPath: 'id', autoIncrement: true });
        invStore.createIndex('user_id', 'user_id', { unique: false });
        invStore.createIndex('user_item_compound', ['user_id', 'item_id'], { unique: true });
      }

      // 8. Challenges Store
      if (!db.objectStoreNames.contains('challenges')) {
        const challengeStore = db.createObjectStore('challenges', { keyPath: 'id', autoIncrement: true });
        challengeStore.createIndex('user_id', 'user_id', { unique: false });
        challengeStore.createIndex('status', 'status', { unique: false });
      }

      // 9. Challenge Prize Items Store
      if (!db.objectStoreNames.contains('challenge_prize_items')) {
        const cPrizeStore = db.createObjectStore('challenge_prize_items', { keyPath: 'id', autoIncrement: true });
        cPrizeStore.createIndex('challenge_id', 'challenge_id', { unique: false });
      }

      // 10. Challenge History Store (Rolling 25 records)
      if (!db.objectStoreNames.contains('challenge_history')) {
        const cHistoryStore = db.createObjectStore('challenge_history', { keyPath: 'id', autoIncrement: true });
        cHistoryStore.createIndex('user_id', 'user_id', { unique: false });
      }

      // 11. Task Bridge Store (Shared Taskitator bindings)
      if (!db.objectStoreNames.contains('task_bridge')) {
        const bridgeStore = db.createObjectStore('task_bridge', { keyPath: 'id', autoIncrement: true });
        bridgeStore.createIndex('user_id', 'user_id', { unique: false });
        bridgeStore.createIndex('taskitator_task_id', 'taskitator_task_id', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(`IndexedDB error: ${event.target.errorCode}`);
    };
  });
}

function runTransaction(storeName, mode, callback) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      try {
        result = callback(store, tx);
      } catch (err) {
        reject(err);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = (e) => reject(e.target.error);
    });
  });
}

// Global helper: retrieve all rule labels for a specific numeric user ID
async function fetchUserRuleLabels(userId) {
  const numericId = Number(userId);
  if (!numericId) return [];
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('rule_labels', 'readonly');
    const store = tx.objectStore('rule_labels');
    const index = store.index('user_id');
    const req = index.getAll(numericId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

// Utility: Cap rolling logs to limit per user
async function pruneRollingLogs(storeName, userId, limit) {
  const numericId = Number(userId);
  if (!numericId) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const index = store.index('user_id');
    const request = index.getAll(numericId);

    request.onsuccess = () => {
      const records = request.result || [];
      if (records.length > limit) {
        records.sort((a, b) => a.id - b.id);
        const excessCount = records.length - limit;
        for (let i = 0; i < excessCount; i++) {
          store.delete(records[i].id);
        }
      }
      resolve();
    };
    request.onerror = (e) => reject(e.target.error);
  });
}
