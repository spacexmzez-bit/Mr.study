// js/store.js

const DEFAULT_STREAK_FREEZE_PRICE = 500;

// Ensure default "Streak Freeze" consumable exists in user's store
async function initDefaultStoreItems(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('store_items', 'readwrite');
    const store = tx.objectStore('store_items');
    const index = store.index('user_id');
    const req = index.getAll(userId);

    req.onsuccess = () => {
      const items = req.result || [];
      const hasFreeze = items.some(item => item.is_streak_freeze);

      if (!hasFreeze) {
        store.add({
          user_id: userId,
          name: 'Streak Freeze',
          description: 'Freezes your daily streak once active. Missed days do not reset your streak.',
          price: DEFAULT_STREAK_FREEZE_PRICE,
          is_streak_freeze: true,
          created_at: new Date().toISOString()
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Fetch all store items for active user
async function fetchUserStoreItems(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('store_items', 'readonly');
    const store = tx.objectStore('store_items');
    const index = store.index('user_id');
    const req = index.getAll(userId);

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

// Render Store View
async function renderStoreItems() {
  if (!currentUser) return;
  const container = document.getElementById('store-items-container');
  const balanceEl = document.getElementById('store-banch-balance');
  if (!container) return;

  if (balanceEl) balanceEl.textContent = currentUser.banch_balance.toLocaleString();

  await initDefaultStoreItems(currentUser.id);
  const items = await fetchUserStoreItems(currentUser.id);

  if (items.length === 0) {
    container.innerHTML = `<div class="col-12 text-slate-muted small text-center py-4">No rewards created yet.</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const canAfford = currentUser.banch_balance >= item.price;
    return `
      <div class="col-12 col-md-6">
        <div class="card bg-slate border-slate p-3 d-flex flex-column justify-content-between h-100">
          <div>
            <div class="d-flex justify-content-between align-items-start mb-1">
              <h6 class="text-white fw-bold mb-0">${escapeHtml(item.name)}</h6>
              <span class="badge ${canAfford ? 'bg-cyan text-slate-darker' : 'bg-slate-dark text-danger border border-slate'}">
                ${item.price.toLocaleString()} Banch
              </span>
            </div>
            ${item.description ? `<p class="text-slate-light small mb-2">${escapeHtml(item.description)}</p>` : ''}
          </div>
          <div class="d-flex gap-2 pt-2 border-top border-slate align-items-center">
            <button class="btn btn-cyan btn-sm flex-grow-1 fw-bold" onclick="promptPurchaseStoreItem(${item.id})">
              ${t('buy')}
            </button>
            ${!item.is_streak_freeze ? `
              <button class="btn btn-outline-danger btn-sm" onclick="handleDeleteStoreItem(${item.id}, '${escapeHtml(item.name)}',${item.price})">
                <i class="bi bi-trash"></i>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Purchase confirmation modal and balance check
async function promptPurchaseStoreItem(itemId) {
  const db = await openDB();
  const tx = db.transaction('store_items', 'readonly');
  const store = tx.objectStore('store_items');
  const req = store.get(itemId);

  req.onsuccess = () => {
    const item = req.result;
    if (!item || !currentUser) return;

    // Hard verification: Debt logic guardrail
    if (currentUser.banch_balance < item.price) {
      showToast("banch is not enough to purchase this product", "danger");
      return;
    }

    if (confirm(`Confirm purchase of "${item.name}" for ${item.price} Banch?`)) {
      executeStoreItemPurchase(item);
    }
  };
}

// Execute purchase, adjust balance, update inventory, or activate streak freeze
async function executeStoreItemPurchase(item) {
  const db = await openDB();
  const tx = db.transaction(['users', 'user_inventory'], 'readwrite');
  const userStore = tx.objectStore('users');
  const invStore = tx.objectStore('user_inventory');

  // Deduct Banch balance safely (XP remains untouched)
  currentUser.banch_balance = Math.max(0, currentUser.banch_balance - item.price);
  userStore.put(currentUser);

  // If Streak Freeze purchased, set consumable guard flag
  if (item.is_streak_freeze) {
    currentUser.streak_freeze_active = true;
    userStore.put(currentUser);
  }

  // Update or insert into inventory
  const userItemIndex = invStore.index('user_item_compound');
  const invReq = userItemIndex.get([currentUser.id, item.id]);

  invReq.onsuccess = () => {
    let invRecord = invReq.result;
    if (invRecord) {
      invRecord.total_bought += 1;
      invRecord.unused_count += 1;
      invStore.put(invRecord);
    } else {
      invStore.add({
        user_id: currentUser.id,
        item_id: item.id,
        total_bought: 1,
        unused_count: 1
      });
    }
  };

  tx.oncomplete = async () => {
    await refreshDashboardUI();
    renderStoreItems();
    showToast(`Purchased "${item.name}" successfully!`, "success");
  };

  tx.onerror = (e) => {
    showToast(`Purchase failed: ${e.target.error}`, "danger");
  };
}

// Handle deletion of store items and refund unused stock
async function handleDeleteStoreItem(itemId, itemName, itemPrice) {
  if (!confirm(`Delete reward "${itemName}"? Any unused inventory of this item will be fully refunded.`)) {
    return;
  }

  await refundAndDeleteStoreItem(itemId, itemPrice);
  renderStoreItems();
}

// Wire store events
document.addEventListener('DOMContentLoaded', () => {
  const btnOpenInventory = document.getElementById('btn-open-inventory');
  if (btnOpenInventory) {
    btnOpenInventory.addEventListener('click', () => {
      switchView('view-inventory');
      if (typeof renderInventoryItems === 'function') {
        renderInventoryItems();
      }
    });
  }
});
