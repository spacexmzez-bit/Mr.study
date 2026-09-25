// js/setup.js

// Safe string escaper for XSS prevention and template rendering
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Get the guaranteed active user from memory or persistent localStorage
async function getGuaranteedUser() {
  if (currentUser && currentUser.id) {
    currentUser.id = Number(currentUser.id);
    return currentUser;
  }
  const uid = localStorage.getItem('mrstudy_session_uid');
  if (!uid) return null;

  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('users', 'readonly');
    const store = tx.objectStore('users');
    const req = store.get(Number(uid));
    req.onsuccess = () => {
      if (req.result) {
        req.result.id = Number(req.result.id);
        currentUser = req.result;
      }
      resolve(currentUser);
    };
    req.onerror = () => resolve(null);
  });
}

// Check real-time bridge status against Cloudflare Worker
async function checkTaskitatorBridgeStatus(user) {
  const statusBadge = document.getElementById('sync-status-indicator');
  if (!statusBadge) return;

  if (!user || !user.is_taskitator_linked) {
    statusBadge.textContent = 'Unlinked';
    statusBadge.className = 'badge bg-slate-dark text-slate-muted border border-slate';
    return;
  }

  const syncKey = localStorage.getItem('mrstudy_sync_key');
  if (!syncKey) {
    statusBadge.textContent = 'Missing Token';
    statusBadge.className = 'badge bg-warning text-dark';
    return;
  }

  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync/bridge/taskitator-ledger`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'X-User-Name': user.username
      }
    });

    if (resp.ok || resp.status === 404) {
      statusBadge.textContent = 'Bridge Active';
      statusBadge.className = 'badge bg-success text-white';
    } else {
      statusBadge.textContent = `Status: ${resp.status}`;
      statusBadge.className = 'badge bg-danger text-white';
    }
  } catch (err) {
    statusBadge.textContent = 'Offline';
    statusBadge.className = 'badge bg-secondary text-white';
  }
}

// Initialize and bind Setup / Management controls
async function initSetupView() {
  const user = await getGuaranteedUser();
  if (!user) return;

  const toggleTaskitator = document.getElementById('toggle-taskitator-link');
  const inputPenalty = document.getElementById('input-withdrawal-penalty');
  const btnSavePenalty = document.getElementById('btn-save-penalty');
  const btnForceSync = document.getElementById('btn-force-sync');

  if (toggleTaskitator) {
    toggleTaskitator.checked = !!user.is_taskitator_linked;
    toggleTaskitator.onchange = async (e) => {
      user.is_taskitator_linked = e.target.checked;
      await updateUserRecord(user);
      if (typeof triggerCloudSyncPush === 'function') triggerCloudSyncPush();
      await checkTaskitatorBridgeStatus(user);
      showToast(
        user.is_taskitator_linked ? "Taskitator integration enabled." : "Taskitator integration disabled.",
        "info"
      );
    };
  }

  if (inputPenalty) {
    inputPenalty.value = user.withdrawal_penalty_pct ?? 10;
  }

  if (btnSavePenalty && inputPenalty) {
    btnSavePenalty.onclick = async () => {
      const val = parseInt(inputPenalty.value, 10);
      if (isNaN(val) || val < 0 || val > 100) {
        showToast("Penalty must be a percentage between 0 and 100.", "warning");
        return;
      }

      user.withdrawal_penalty_pct = val;
      await updateUserRecord(user);
      if (typeof triggerCloudSyncPush === 'function') triggerCloudSyncPush();
      showToast(`Penalty updated to ${val}%.`, "success");
    };
  }

  if (btnForceSync) {
    btnForceSync.onclick = async () => {
      await handleForceSyncTrigger();
    };
  }

  await checkTaskitatorBridgeStatus(user);
  bindManagerModalButtons();
}

// Immediate bidirectional sync trigger with visual feedback
async function handleForceSyncTrigger() {
  const btn = document.getElementById('btn-force-sync');
  const icon = document.getElementById('icon-force-sync');
  const label = document.getElementById('label-force-sync');
  const statusBadge = document.getElementById('sync-status-indicator');

  if (btn) btn.disabled = true;
  if (icon) icon.className = 'spinner-border spinner-border-sm me-1';
  if (label) label.textContent = 'Syncing...';
  if (statusBadge) {
    statusBadge.textContent = 'Syncing...';
    statusBadge.className = 'badge bg-warning text-dark';
  }

  try {
    let result = null;
    if (typeof forceCloudSyncBidirectional === 'function') {
      result = await forceCloudSyncBidirectional();
    } else if (typeof triggerCloudSyncPush === 'function') {
      await triggerCloudSyncPush();
      result = { ingestedTasks: 0, pushed: true };
    } else {
      throw new Error('Sync engine not initialized');
    }

    if (statusBadge) {
      statusBadge.textContent = 'Synced';
      statusBadge.className = 'badge bg-success text-white';
    }

    const taskMsg = (result && result.ingestedTasks > 0)
      ? ` (Ingested ${result.ingestedTasks} tasks)`
      : '';
    showToast(`Cloud sync complete!${taskMsg}`, 'success');
  } catch (err) {
    console.error('Manual force sync failed:', err);
    if (statusBadge) {
      statusBadge.textContent = 'Sync Error';
      statusBadge.className = 'badge bg-danger text-white';
    }
    showToast(err.message || 'Sync failed. Please check network connection.', 'danger');
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.className = 'bi bi-arrow-repeat me-1';
    if (label) label.textContent = 'Force Sync Now';
  }
}

// Persist user record updates to IndexedDB and update memory reference
async function updateUserRecord(user) {
  if (!user || !user.id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    const store = tx.objectStore('users');
    store.put(user);
    tx.oncomplete = () => {
      currentUser = user;
      resolve();
    };
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Bind modal trigger buttons safely
function bindManagerModalButtons() {
  const btnRules = document.getElementById('btn-open-rule-manager');
  const btnLabels = document.getElementById('btn-open-label-manager');
  const btnStore = document.getElementById('btn-open-store-manager');

  if (btnRules) btnRules.onclick = () => openRuleManagerModal();
  if (btnLabels) btnLabels.onclick = () => openLabelManagerModal();
  if (btnStore) btnStore.onclick = () => openStoreRewardManagerModal();
}

// Clean singleton modal element provider with backdrop safety
function getCleanModalElement(modalId) {
  let modalEl = document.getElementById(modalId);
  if (modalEl) {
    const existingInstance = bootstrap.Modal.getInstance(modalEl);
    if (existingInstance) existingInstance.dispose();
    modalEl.remove();
  }
  document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
  document.body.classList.remove('modal-open');

  modalEl = document.createElement('div');
  modalEl.id = modalId;
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(modalEl);
  return modalEl;
}

// Rule Creation/Manager Modal
async function openRuleManagerModal() {
  const user = await getGuaranteedUser();
  if (!user) {
    showToast("Please log in first.", "danger");
    return;
  }

  const modalEl = getCleanModalElement('modal-manage-rules');
  let labels = await fetchUserRuleLabels(user.id);

  if (!labels || labels.length === 0) {
    await ensureDefaultRuleLabel(user.id);
    labels = await fetchUserRuleLabels(user.id);
  }

  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered max-w-mobile">
      <div class="modal-content bg-slate border-slate text-white">
        <div class="modal-header border-slate">
          <h6 class="modal-title fw-bold text-cyan">Create Rule</h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="mb-2">
            <label class="form-label small text-slate-light">Rule Name *</label>
            <input type="text" id="rule-create-name" class="form-control form-control-sm bg-slate-dark text-white border-slate" placeholder="e.g., Read Biology Chapter" required />
          </div>
          <div class="mb-2">
            <label class="form-label small text-slate-light">Label Group *</label>
            <select id="rule-create-label" class="form-select form-select-sm bg-slate-dark text-white border-slate">
              ${labels.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
            </select>
          </div>
          <div class="mb-2">
            <label class="form-label small text-slate-light">Type *</label>
            <select id="rule-create-type" class="form-select form-select-sm bg-slate-dark text-white border-slate">
              <option value="add">Addition (+)</option>
              <option value="deduct">Deduction (-)</option>
            </select>
          </div>
          <div class="row g-2 mb-2">
            <div class="col-4">
              <label class="form-label small text-slate-light">Min *</label>
              <input type="number" id="rule-create-min" min="0" value="10" class="form-control form-control-sm bg-slate-dark text-white border-slate" />
            </div>
            <div class="col-4">
              <label class="form-label small text-slate-light">Max *</label>
              <input type="number" id="rule-create-max" min="0" value="50" class="form-control form-control-sm bg-slate-dark text-white border-slate" />
            </div>
            <div class="col-4">
              <label class="form-label small text-slate-light">Jump *</label>
              <input type="number" id="rule-create-jump" min="1" value="5" class="form-control form-control-sm bg-slate-dark text-white border-slate" />
            </div>
          </div>
          <div class="mb-2">
            <label class="form-label small text-slate-light">Description (Optional)</label>
            <textarea id="rule-create-desc" rows="2" class="form-control form-control-sm bg-slate-dark text-white border-slate"></textarea>
          </div>
        </div>
        <div class="modal-footer border-slate">
          <button type="button" class="btn btn-outline-slate btn-sm" data-bs-dismiss="modal">Cancel</button>
          <button type="button" id="btn-submit-save-rule" class="btn btn-cyan btn-sm fw-bold px-4">Save Rule</button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  document.getElementById('btn-submit-save-rule').onclick = () => saveNewRule(bsModal);
  bsModal.show();
}

async function saveNewRule(bsModal) {
  const user = await getGuaranteedUser();
  if (!user) {
    showToast("Session expired. Please log in again.", "danger");
    return;
  }

  const nameEl = document.getElementById('rule-create-name');
  const labelEl = document.getElementById('rule-create-label');
  const typeEl = document.getElementById('rule-create-type');
  const minEl = document.getElementById('rule-create-min');
  const maxEl = document.getElementById('rule-create-max');
  const jumpEl = document.getElementById('rule-create-jump');
  const descEl = document.getElementById('rule-create-desc');

  const name = nameEl ? nameEl.value.trim() : '';
  const labelId = labelEl ? parseInt(labelEl.value, 10) : NaN;
  const type = typeEl ? typeEl.value : 'add';
  const minPoints = minEl ? parseInt(minEl.value, 10) : NaN;
  const maxPoints = maxEl ? parseInt(maxEl.value, 10) : NaN;
  const jump = jumpEl ? parseInt(jumpEl.value, 10) : NaN;
  const desc = descEl ? descEl.value.trim() : '';

  if (!name || isNaN(minPoints) || isNaN(maxPoints) || isNaN(jump) || isNaN(labelId)) {
    showToast("Please fill all required fields correctly.", "warning");
    return;
  }
  if (minPoints > maxPoints) {
    showToast("Min points cannot exceed Max points.", "danger");
    return;
  }
  if (jump < 1) {
    showToast("Jump interval must be at least 1.", "danger");
    return;
  }

  const db = await openDB();
  const tx = db.transaction('rules', 'readwrite');
  tx.objectStore('rules').add({
    user_id: Number(user.id),
    label_id: Number(labelId),
    name,
    description: desc,
    min_points: minPoints,
    max_points: maxPoints,
    jump_interval: jump,
    type,
    created_at: new Date().toISOString()
  });

  tx.oncomplete = () => {
    if (bsModal) bsModal.hide();
    if (typeof renderActionsGrid === 'function') renderActionsGrid();
    if (typeof triggerCloudSyncPush === 'function') triggerCloudSyncPush();
    showToast(`Rule "${name}" created successfully!`, "success");
  };
  tx.onerror = (e) => {
    showToast(`Failed to save rule: ${e.target.error.message}`, "danger");
  };
}

// Label Creation Modal
async function openLabelManagerModal() {
  const user = await getGuaranteedUser();
  if (!user) {
    showToast("Please log in first.", "danger");
    return;
  }

  const modalEl = getCleanModalElement('modal-manage-labels');

  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered max-w-mobile">
      <div class="modal-content bg-slate border-slate text-white">
        <div class="modal-header border-slate">
          <h6 class="modal-title fw-bold text-cyan">Create Rule Label</h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="mb-2">
            <label class="form-label small text-slate-light">Label Name *</label>
            <input type="text" id="label-create-name" class="form-control form-control-sm bg-slate-dark text-white border-slate" placeholder="e.g. Study, Fitness, Coding" required />
          </div>
        </div>
        <div class="modal-footer border-slate">
          <button type="button" class="btn btn-outline-slate btn-sm" data-bs-dismiss="modal">Cancel</button>
          <button type="button" id="btn-submit-save-label" class="btn btn-cyan btn-sm fw-bold px-4">Create Label</button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  document.getElementById('btn-submit-save-label').onclick = () => saveNewRuleLabel(bsModal);
  bsModal.show();
}

async function saveNewRuleLabel(bsModal) {
  const user = await getGuaranteedUser();
  if (!user) {
    showToast("Session expired.", "danger");
    return;
  }

  const nameInput = document.getElementById('label-create-name');
  const name = nameInput ? nameInput.value.trim() : '';

  if (!name) {
    showToast("Label name cannot be empty.", "warning");
    return;
  }

  const db = await openDB();
  const tx = db.transaction('rule_labels', 'readwrite');
  tx.objectStore('rule_labels').add({
    user_id: Number(user.id),
    name,
    is_default: false,
    created_at: new Date().toISOString()
  });

  tx.oncomplete = () => {
    if (bsModal) bsModal.hide();
    if (typeof renderRuleLabelFilters === 'function') renderRuleLabelFilters();
    if (typeof triggerCloudSyncPush === 'function') triggerCloudSyncPush();
    showToast(`Label "${name}" created!`, "success");
  };
  tx.onerror = (e) => {
    showToast(`Failed to save label: ${e.target.error.message}`, "danger");
  };
}

// Store Catalog Creator Modal
async function openStoreRewardManagerModal() {
  const user = await getGuaranteedUser();
  if (!user) {
    showToast("Please log in first.", "danger");
    return;
  }

  const modalEl = getCleanModalElement('modal-manage-store-item');

  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered max-w-mobile">
      <div class="modal-content bg-slate border-slate text-white">
        <div class="modal-header border-slate">
          <h6 class="modal-title fw-bold text-cyan">Create Store Reward</h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="mb-2">
            <label class="form-label small text-slate-light">Reward Name *</label>
            <input type="text" id="store-create-name" class="form-control form-control-sm bg-slate-dark text-white border-slate" required />
          </div>
          <div class="mb-2">
            <label class="form-label small text-slate-light">Description (Optional)</label>
            <textarea id="store-create-desc" rows="2" class="form-control form-control-sm bg-slate-dark text-white border-slate"></textarea>
          </div>
          <div class="mb-2">
            <label class="form-label small text-slate-light">Price (Banch) *</label>
            <input type="number" id="store-create-price" min="0" value="100" class="form-control form-control-sm bg-slate-dark text-white border-slate" required />
          </div>
        </div>
        <div class="modal-footer border-slate">
          <button type="button" class="btn btn-outline-slate btn-sm" data-bs-dismiss="modal">Cancel</button>
          <button type="button" id="btn-submit-save-reward" class="btn btn-cyan btn-sm fw-bold px-4">Save Reward</button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  document.getElementById('btn-submit-save-reward').onclick = () => saveNewStoreItem(bsModal);
  bsModal.show();
}

async function saveNewStoreItem(bsModal) {
  const user = await getGuaranteedUser();
  if (!user) {
    showToast("Session expired.", "danger");
    return;
  }

  const nameInput = document.getElementById('store-create-name');
  const descInput = document.getElementById('store-create-desc');
  const priceInput = document.getElementById('store-create-price');

  const name = nameInput ? nameInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';
  const price = priceInput ? parseInt(priceInput.value, 10) : NaN;

  if (!name || isNaN(price) || price < 0) {
    showToast("Please provide a name and non-negative price.", "warning");
    return;
  }

  const db = await openDB();
  const tx = db.transaction('store_items', 'readwrite');
  tx.objectStore('store_items').add({
    user_id: Number(user.id),
    name,
    description: desc,
    price,
    is_streak_freeze: false,
    created_at: new Date().toISOString()
  });

  tx.oncomplete = () => {
    if (bsModal) bsModal.hide();
    if (typeof renderStoreItems === 'function') renderStoreItems();
    if (typeof triggerCloudSyncPush === 'function') triggerCloudSyncPush();
    showToast(`Reward "${name}" created!`, "success");
  };
  tx.onerror = (e) => {
    showToast(`Failed to save reward: ${e.target.error.message}`, "danger");
  };
}

// Global window exposure
window.escapeHtml = escapeHtml;
window.getGuaranteedUser = getGuaranteedUser;
window.checkTaskitatorBridgeStatus = checkTaskitatorBridgeStatus;
window.initSetupView = initSetupView;
window.updateUserRecord = updateUserRecord;
window.handleForceSyncTrigger = handleForceSyncTrigger;
window.openRuleManagerModal = openRuleManagerModal;
window.openLabelManagerModal = openLabelManagerModal;
window.openStoreRewardManagerModal = openStoreRewardManagerModal;
window.saveNewRule = saveNewRule;
window.saveNewRuleLabel = saveNewRuleLabel;
window.saveNewStoreItem = saveNewStoreItem;

document.addEventListener('DOMContentLoaded', () => {
  initSetupView();
});
