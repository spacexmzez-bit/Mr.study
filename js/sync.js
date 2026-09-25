// js/sync.js

let syncDebounceTimer = null;

// Debounced automated sync push to Cloudflare Worker
function triggerCloudSyncPush() {
  if (!currentUser || !currentUser.is_taskitator_linked) return;

  const syncKey = localStorage.getItem('mrstudy_sync_key');
  if (!syncKey) return;

  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(async () => {
    await pushStateToCloudWorker(syncKey);
    syncDebounceTimer = null;
  }, 2000);
}

// Flush pending debounce push immediately on view switch or unload
async function flushPendingSyncPush() {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
    const syncKey = localStorage.getItem('mrstudy_sync_key');
    if (syncKey) {
      await pushStateToCloudWorker(syncKey);
    }
  }
}

// Compile state payload and send to Worker KV
async function pushStateToCloudWorker(syncKey) {
  if (!currentUser || !currentUser.id) return false;

  const db = await openDB();
  const numericUserId = Number(currentUser.id);

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

  // Generate a strictly new timestamp for the mutation so the worker accepts it
  const newMutationTimestamp = new Date().toISOString();
  
  // Send the last confirmed sync time separately so the worker can perform valid conflict detection
  const baseTimestamp = localStorage.getItem('mrstudy_last_synced_at') || newMutationTimestamp;

  const payload = {
    app: 'MrStudy',
    app_id: 'mrstudy',
    version: 1,
    updated_at: baseTimestamp, // Base version for conflict detection
    mutated_at: newMutationTimestamp, // Actual mutation time
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
    exportable_rules: exportableRules,
    rule_labels: ruleLabels,
    store_items: storeItems,
    user_inventory: userInventory,
    challenges
  };

  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncKey}`,
        'X-Taskitator-User': currentUser.username,
        'X-User-Name': currentUser.username,
        'X-App-ID': 'mrstudy'
      },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      const newTimestamp = (data && data.updated_at) ? data.updated_at : newMutationTimestamp;
      localStorage.setItem('mrstudy_last_synced_at', newTimestamp);
      return true;
    } else if (resp.status === 409) {
      console.warn('Conflict detected: Remote cloud data is newer. Pulling latest cloud state first.');
      await pullStateFromCloudWorker();
      return false;
    } else {
      console.warn(`Worker rejected sync push with status ${resp.status}`);
      return false;
    }
  } catch (err) {
    console.warn('Sync push skipped (offline or network error):', err);
    return false;
  }
}

// Pull snapshot on demand
async function pullStateFromCloudWorker() {
  const syncKey = localStorage.getItem('mrstudy_sync_key');
  if (!syncKey || !currentUser || !currentUser.id) return false;

  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync/pull`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'X-Taskitator-User': currentUser.username,
        'X-User-Name': currentUser.username,
        'X-App-ID': 'mrstudy'
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && !data.empty) {
        
        // Stale KV Replica Guard
        const localLastSync = localStorage.getItem('mrstudy_last_synced_at');
        if (localLastSync && data.updated_at) {
          const remoteEpoch = new Date(data.updated_at).getTime();
          const localEpoch = new Date(localLastSync).getTime();
          if (!isNaN(remoteEpoch) && !isNaN(localEpoch) && remoteEpoch < localEpoch) {
            console.warn('Stale KV edge replica detected. Skipping DB wipe to protect local data.');
            return false;
          }
        }

        await restoreCloudStateToLocalDB(currentUser.id, data);
        if (data.updated_at) {
          localStorage.setItem('mrstudy_last_synced_at', data.updated_at);
        }
        if (typeof refreshDashboardUI === 'function') await refreshDashboardUI();
        return true;
      }
    }
    return false;
  } catch (err) {
    console.warn('Sync pull failed:', err);
    return false;
  }
}

// Guaranteed-order bidirectional sync
async function forceCloudSyncBidirectional() {
  const syncKey = localStorage.getItem('mrstudy_sync_key');
  if (!syncKey) {
    throw new Error('Sync bearer token missing. Please log in again.');
  }

  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }

  // 1. Pull remote state FIRST (establishes baseline)
  const pulled = await pullStateFromCloudWorker();

  // 2. Ingest ledger events ON TOP of the fresh baseline
  let ingestedTasks = 0;
  if (typeof pullTaskitatorAuditLedger === 'function') {
    const bridgeResult = await pullTaskitatorAuditLedger();
    if (bridgeResult && typeof bridgeResult.ingestedCount === 'number') {
      ingestedTasks = bridgeResult.ingestedCount;
    }
  }

  // 3. Push consolidated state back to the Cloudflare Worker
  const pushed = await pushStateToCloudWorker(syncKey);
  if (!pushed) {
    throw new Error('Failed to push state snapshot to Cloudflare KV.');
  }

  if (typeof refreshDashboardUI === 'function') await refreshDashboardUI();
  if (typeof renderActionsGrid === 'function') renderActionsGrid();

  return { ingestedTasks, pulled, pushed };
}

function getAllRecords(db, storeName, userId) {
  const numericUserId = Number(userId);
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index('user_id');
    const req = index.getAll(numericUserId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

// Fully transactional IndexedDB restoration
function restoreCloudStateToLocalDB(userId, cloudData) {
  const numericUserId = Number(userId);

  return new Promise(async (resolve, reject) => {
    const db = await openDB();
    const stores = ['users', 'rules', 'rule_labels', 'store_items', 'user_inventory', 'challenges'];
    const tx = db.transaction(stores, 'readwrite');

    tx.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => resolve();

    if (cloudData.user && currentUser) {
      Object.assign(currentUser, cloudData.user);
      currentUser.id = numericUserId;
      tx.objectStore('users').put(currentUser);
    }

    const syncCollection = (storeName, remoteItems) => {
      return new Promise((res) => {
        if (!Array.isArray(remoteItems)) return res();
        const store = tx.objectStore(storeName);
        const req = store.index('user_id').getAll(numericUserId);

        req.onsuccess = () => {
          const localRecords = req.result || [];
          localRecords.forEach(rec => {
            if (rec.id !== undefined) store.delete(rec.id);
          });
          remoteItems.forEach(item => {
            store.put({ ...item, user_id: numericUserId });
          });
          res();
        };
        req.onerror = () => res(); 
      });
    };

    await Promise.all([
      syncCollection('rules', cloudData.rules),
      syncCollection('rule_labels', cloudData.rule_labels),
      syncCollection('store_items', cloudData.store_items),
      syncCollection('user_inventory', cloudData.user_inventory),
      syncCollection('challenges', cloudData.challenges)
    ]);
  });
}

// Browser lifecycle hooks for persistence on close/tab switch
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingSyncPush();
  }
});

window.addEventListener('beforeunload', () => {
  flushPendingSyncPush();
});

// Global window exposure
window.triggerCloudSyncPush = triggerCloudSyncPush;
window.flushPendingSyncPush = flushPendingSyncPush;
window.pushStateToCloudWorker = pushStateToCloudWorker;
window.pullStateFromCloudWorker = pullStateFromCloudWorker;
window.forceCloudSyncBidirectional = forceCloudSyncBidirectional;
