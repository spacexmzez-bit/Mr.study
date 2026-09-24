// js/sync.js

let syncDebounceTimer = null;

// Debounced automated sync push to Cloudflare Worker
function triggerCloudSyncPush() {
  if (!currentUser || !currentUser.is_taskitator_linked) return;

  const syncKey = sessionStorage.getItem('mrstudy_sync_key');
  if (!syncKey) return;

  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(async () => {
    await pushStateToCloudWorker(syncKey);
  }, 2000);
}

// Compile state payload and send to Worker KV
async function pushStateToCloudWorker(syncKey) {
  const db = await openDB();

  const [rules, ruleLabels, storeItems, userInventory, challenges] = await Promise.all([
    getAllRecords(db, 'rules', currentUser.id),
    getAllRecords(db, 'rule_labels', currentUser.id),
    getAllRecords(db, 'store_items', currentUser.id),
    getAllRecords(db, 'user_inventory', currentUser.id),
    getAllRecords(db, 'challenges', currentUser.id)
  ]);

  const payload = {
    app: 'MrStudy',
    version: '1.0',
    updated_at: new Date().toISOString(),
    user: {
      username: currentUser.username,
      role: currentUser.role,
      streak_count: currentUser.streak_count,
      last_activity_date: currentUser.last_activity_date,
      streak_done: currentUser.streak_done,
      streak_freeze_active: currentUser.streak_freeze_active,
      banch_balance: currentUser.banch_balance,
      total_xp: currentUser.total_xp,
      withdrawal_penalty_pct: currentUser.withdrawal_penalty_pct,
      lang_pref: currentUser.lang_pref
    },
    rules,
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
        'Authorization': `Bearer ${syncKey}`
      },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      console.log('Synced successfully to Cloudflare Worker KV.');
    }
  } catch (err) {
    console.warn('Sync push skipped (offline or network error):', err);
  }
}

// Pull snapshot on demand
async function pullStateFromCloudWorker() {
  const syncKey = sessionStorage.getItem('mrstudy_sync_key');
  if (!syncKey || !currentUser) return;

  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey}`
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.user) {
        await restoreCloudStateToLocalDB(currentUser.id, data);
        showToast("Synced with Cloudflare Worker.", "success");
        await refreshDashboardUI();
      }
    }
  } catch (err) {
    console.warn('Sync pull failed:', err);
  }
}

function getAllRecords(db, storeName, userId) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index('user_id');
    const req = index.getAll(userId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function restoreCloudStateToLocalDB(userId, cloudData) {
  const db = await openDB();
  const tx = db.transaction(['users', 'rules', 'rule_labels', 'store_items', 'user_inventory', 'challenges'], 'readwrite');

  if (cloudData.user && currentUser) {
    Object.assign(currentUser, cloudData.user);
    tx.objectStore('users').put(currentUser);
  }

  tx.oncomplete = () => {
    if (typeof refreshDashboardUI === 'function') refreshDashboardUI();
    if (typeof renderActionsGrid === 'function') renderActionsGrid();
  };
}
