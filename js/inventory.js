// js/inventory.js

// Fetch inventory joined with store item details
async function fetchUserInventoryJoined(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['user_inventory', 'store_items'], 'readonly');
    const invStore = tx.objectStore('user_inventory');
    const itemStore = tx.objectStore('store_items');

    const invIndex = invStore.index('user_id');
    const invReq = invIndex.getAll(userId);

    invReq.onsuccess = () => {
      const invRecords = invReq.result || [];
      const itemReq = itemStore.index('user_id').getAll(userId);

      itemReq.onsuccess = () => {
        const storeItems = itemReq.result || [];
        const itemMap = new Map(storeItems.map(item => [item.id, item]));

        const joined = invRecords.map(inv => {
          const item = itemMap.get(inv.item_id);
          return {
            invId: inv.id,
            itemId: inv.item_id,
            name: item ? item.name : 'Unknown Item',
            description: item ? item.description : '',
            price: item ? item.price : 0,
            is_streak_freeze: item ? item.is_streak_freeze : false,
            total_bought: inv.total_bought,
            unused_count: inv.unused_count
          };
        });

        resolve(joined);
      };
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// Render Inventory View
async function renderInventoryItems() {
  if (!currentUser) return;
  const container = document.getElementById('inventory-items-container');
  if (!container) return;

  const items = await fetchUserInventoryJoined(currentUser.id);

  if (items.length === 0) {
    container.innerHTML = `<div class="col-12 text-slate-muted small text-center py-4">Your inventory is empty.</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    return `
      <div class="col-12 col-md-6">
        <div class="card bg-slate border-slate p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h6 class="text-white fw-bold mb-0">${escapeHtml(item.name)}</h6>
            <span class="badge bg-slate-dark text-cyan border border-slate">
              ${item.unused_count} Available
            </span>
          </div>
          <div class="d-flex justify-content-between small text-slate-light mb-3">
            <span>Total Purchased: <strong>${item.total_bought}</strong></span>
            <span>Unused Stock: <strong class="text-cyan">${item.unused_count}</strong></span>
          </div>
          <div class="border-top border-slate pt-2 d-flex justify-content-end">
            ${item.unused_count > 0 ? `
              <button class="btn btn-cyan btn-sm fw-bold px-3" onclick="promptUseInventoryItem(${item.invId}, '${escapeHtml(item.name)}',${item.unused_count})">
                ${t('use')}
              </button>
            ` : `<button class="btn btn-outline-slate btn-sm disabled" disabled>Exhausted</button>`}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Prompt user to consume unused stock
async function promptUseInventoryItem(invId, itemName, maxAvailable) {
  const countStr = prompt(`How many "${itemName}" would you like to use? (1 - ${maxAvailable})`, "1");
  if (!countStr) return;

  const count = parseInt(countStr, 10);
  if (isNaN(count) || count <= 0 || count > maxAvailable) {
    showToast(`Invalid amount entered. Choose between 1 and ${maxAvailable}.`, "warning");
    return;
  }

  const db = await openDB();
  const tx = db.transaction('user_inventory', 'readwrite');
  const store = tx.objectStore('user_inventory');
  const req = store.get(invId);

  req.onsuccess = () => {
    const invRecord = req.result;
    if (invRecord) {
      invRecord.unused_count = Math.max(0, invRecord.unused_count - count);
      store.put(invRecord);
    }
  };

  tx.oncomplete = () => {
    renderInventoryItems();
    showToast(`Used ${count}x "${itemName}".`, "info");
  };

  tx.onerror = (e) => {
    showToast(`Failed to use item: ${e.target.error}`, "danger");
  };
}

// Deletion Refund Engine: Calculates and refunds (Price * Unused) to Banch
async function refundAndDeleteStoreItem(itemId, itemPrice) {
  const db = await openDB();
  const tx = db.transaction(['users', 'store_items', 'user_inventory'], 'readwrite');
  const userStore = tx.objectStore('users');
  const storeItemStore = tx.objectStore('store_items');
  const invStore = tx.objectStore('user_inventory');

  let refundedBanch = 0;

  // Check inventory for unused counts
  const userItemIndex = invStore.index('user_item_compound');
  const invReq = userItemIndex.get([currentUser.id, itemId]);

  invReq.onsuccess = () => {
    const inv = invReq.result;
    if (inv && inv.unused_count > 0) {
      refundedBanch = inv.unused_count * itemPrice;
      currentUser.banch_balance += refundedBanch;
      userStore.put(currentUser);
    }
    if (inv) {
      invStore.delete(inv.id);
    }
    // Delete store catalog entry
    storeItemStore.delete(itemId);
  };

  tx.oncomplete = async () => {
    await refreshDashboardUI();
    if (refundedBanch > 0) {
      showToast(`Item removed. Refunded ${refundedBanch} Banch for unused stock.`, "success");
    } else {
      showToast("Item removed from store.", "info");
    }
  };

  tx.onerror = (e) => {
    showToast(`Error deleting item: ${e.target.error}`, "danger");
  };
}

// Inventory view navigation binding
document.addEventListener('DOMContentLoaded', () => {
  const btnBackToStore = document.getElementById('btn-back-to-store');
  if (btnBackToStore) {
    btnBackToStore.addEventListener('click', () => {
      switchView('view-store');
      if (typeof renderStoreItems === 'function') {
        renderStoreItems();
      }
    });
  }
});
