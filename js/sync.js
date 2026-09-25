// js/sync.js

let syncDebounceTimer = null;

// Debounced automated sync push to Cloudflare Worker
function triggerCloudSyncPush() {
  if (!currentUser || !currentUser.is_taskitator_linked) return;

  const syncKey = localStorage.getItem('mrstudy_sync_key');
  if (!syncKey) return;

  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    pushStateToCloudWorker(syncKey).catch((err) => {
      console.warn('Debounced background sync failed:', err.message);
    });
  }, 2000);
}

// Compile state payload and send to Worker KV
async function pushStateToCloudWorker(syncKey) {
  if (!currentUser) {
    throw new Error('Current user context is missing. Please reload the app.');
  }

  const userIdRaw = currentUser.id;
  if (userIdRaw === undefined || userIdRaw === null || userIdRaw === '') {
    throw new Error('User record contains an invalid or missing ID.');
  }

  const numericUserId = Number(userIdRaw);
  if (Number.isNaN(numericUserId)) {
    throw new Error(`Invalid numeric user ID: ${userIdRaw}`);
  }

  const db = await openDB();

  const [rules, ruleLabels, storeItems, userInventory, challenges, exportableRules] = await Promise.all([
    getAllRecords(db, 'rules', numericUserId),
    getAllRecords(db, 'rule_labels', numericUserId),
    getAllRecords(db, 'store_items', numericUserId),
    getAllRecords(db, 'user_inventory', numericUserId),
    getAllRecords(db, 'challenges', numericUserId),
    (typeof getExportableRulesForTaskitator === 'function')
      ? getExportableRulesForTaskitator(numericUserId)
      : []
  ]);

  const payload = {
    app: 'MrStudy',
    version: '1.0',
    updated_at: new Date().toISOString(),
    user: {
      username: currentUser.username,
      role: currentUser.role,
      streak_count: currentUser.streak_count || 0,
      last_activity_date: currentUser.last_activity_date,
      streak_done: currentUser.streak_done || false,
      streak_freeze_active: currentUser.streak_freeze_active || false,
      banch_balance: currentUser.banch_balance || 0,
      total_xp: currentUser.total_xp || 0,
      withdrawal_penalty_pct: currentUser.withdrawal_penalty_pct ?? 10,
      lang_pref: currentUser.lang_pref || 'en'
    },
    rules,
    study_rules: exportableRules,
    rule_labels: ruleLabels,
    store_items: storeItems,
    user_inventory: userInventory,
    challenges
  };

  let resp;
  try {
    resp = await fetch(`${SYNC_WORKER_URL}/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncKey}`,
        'X-Taskitator-User': currentUser.username,
        'X-App-ID': 'mrstudy'
      },
      body: JSON.stringify(payload)
    });
  } catch (netErr) {
    throw new Error(`Network/CORS fetch error: ${netErr.message}`);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Worker status ${resp.status}: ${errText || resp.statusText}`);
  }

  return true;
}

// Pull snapshot on demand
async function pullStateFromCloudWorker() {
  const syncKey = localStorage.getItem('mrstudy_sync_key');
  if (!syncKey || !currentUser || currentUser.id === undefined || currentUser.id === null) {
    return false;
  }

  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync/pull`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'X-Taskitator-User': currentUser.username,
        'X-App-ID': 'mrstudy'
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.user) {
        await restoreCloudStateToLocalDB(currentUser.id, data);
        if (typeof refreshDashboardUI === 'function') await refreshDashboardUI();
        return true;
      }
    } else {
      const errText = await resp.text();
      console.warn(`Sync pull rejected: ${resp.status} - ${errText}`);
    }
    return false;
  } catch (err) {
    console.warn('Sync pull skipped (offline or network error):', err);
    return false;
  }
}

// Immediate bidirectional sync (pull ledger updates, push current local state)
async function forceCloudSyncBidirectional() {
  try {
    const syncKey = localStorage.getItem('mrstudy_sync_key');
    if (!syncKey) {
      throw new Error('Sync bearer token missing. Please log in again.');
    }

    let ingestedTasks = 0;

    // 1. Pull ledger completions from Taskitator bridge
    if (typeof pullTaskitatorAuditLedger === 'function') {
      const bridgeResult = await pullTaskitatorAuditLedger();
      if (bridgeResult && typeof bridgeResult.ingestedCount === 'number') {
        ingestedTasks = bridgeResult.ingestedCount;
      }
    }

    // 2. Pull remote user state
    const pulled = await pullStateFromCloudWorker();

    // 3. Push active local state
    const pushed = await pushStateToCloudWorker(syncKey);

    if (typeof refreshDashboardUI === 'function') await refreshDashboardUI();
    if (typeof renderActionsGrid === 'function') renderActionsGrid();

    alert('Sync successful!');
    return { ingestedTasks, pulled, pushed };
  } catch (err) {
    // Shows popup directly on mobile screen
    alert(`SYNC FAILED:\n\n${err.message}`);
    throw err;
  }
}

function getAllRecords(db, storeName, userId) {
  const numericUserId = Number(userId);
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`IndexedDB store "${storeName}" does not exist.`);
        return resolve([]);
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index('user_id');
      const req = index.getAll(numericUserId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (err) => {
        console.warn(`Error reading ${storeName}:`, err);
        resolve([]);
      };
    } catch (e) {
      console.warn(`Failed reading store ${storeName}:`, e);
      resolve([]);
    }
  });
}

async function restoreCloudStateToLocalDB(userId, cloudData) {
  const numericUserId = Number(userId);
  const db = await openDB();

  const storeNames = ['users', 'rules', 'rule_labels', 'store_items', 'user_inventory', 'challenges']
    .filter((store) => db.objectStoreNames.contains(store));

  const tx = db.transaction(storeNames, 'readwrite');

  // 1. Restore user data
  if (cloudData.user && currentUser && storeNames.includes('users')) {
    Object.assign(currentUser, cloudData.user);
    currentUser.id = numericUserId;
    tx.objectStore('users').put(currentUser);
  }

  // 2. Restore collection entities
  const collections = [
    { key: 'rules', store: 'rules' },
    { key: 'rule_labels', store: 'rule_labels' },
    { key: 'store_items', store: 'store_items' },
    { key: 'user_inventory', store: 'user_inventory' },
    { key: 'challenges', store: 'challenges' }
  ];

  for (const { key, store } of collections) {
    if (storeNames.includes(store) && Array.isArray(cloudData[key])) {
      const targetStore = tx.objectStore(store);
      for (const item of cloudData[key]) {
        targetStore.put({ ...item, user_id: numericUserId });
      }
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
      if (typeof renderActionsGrid === 'function') renderActionsGrid();
      resolve(true);
    };
    tx.onerror = (evt) => reject(evt.target.error);
  });
}

// Global window exposure
window.triggerCloudSyncPush = triggerCloudSyncPush;
window.pushStateToCloudWorker = pushStateToCloudWorker;
window.pullStateFromCloudWorker = pullStateFromCloudWorker;
window.forceCloudSyncBidirectional = forceCloudSyncBidirectional;
