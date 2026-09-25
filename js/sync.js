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
  }, 2000);
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
    exportable_rules: exportableRules,
    rule_labels: ruleLabels,
    store_items: storeItems,
    user_inventory: userInventory,
    challenges
  };

  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncKey}`,
        'X-User-Name': currentUser.username
      },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      console.log('Synced successfully to Cloudflare Worker KV.');
      return true;
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
    const resp = await fetch(`${SYNC_WORKER_URL}/sync`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'X-User-Name': currentUser.username
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.user) {
        await restoreCloudStateToLocalDB(currentUser.id, data);
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

// Immediate bidirectional sync (pull ledger updates, push current local state)
async function forceCloudSyncBidirectional() {
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

async function restoreCloudStateToLocalDB(userId, cloudData) {
  const numericUserId = Number(userId);
  const db = await openDB();
  const tx = db.transaction(['users', 'rules', 'rule_labels', 'store_items', 'user_inventory', 'challenges'], 'readwrite');

  if (cloudData.user && currentUser) {
    Object.assign(currentUser, cloudData.user);
    currentUser.id = numericUserId;
    tx.objectStore('users').put(currentUser);
  }

  tx.oncomplete = () => {
    if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
    if (typeof renderActionsGrid === 'function') renderActionsGrid();
  };
}

// Global window exposure
window.triggerCloudSyncPush = triggerCloudSyncPush;
window.pushStateToCloudWorker = pushStateToCloudWorker;
window.pullStateFromCloudWorker = pullStateFromCloudWorker;
window.forceCloudSyncBidirectional = forceCloudSyncBidirectional;
