// js/setup.js

// Initialize and bind Setup / Management controls
function initSetupView() {
  if (!currentUser) return;

  const toggleTaskitator = document.getElementById('toggle-taskitator-link');
  const inputPenalty = document.getElementById('input-withdrawal-penalty');
  const btnSavePenalty = document.getElementById('btn-save-penalty');

  // Load existing user preferences
  if (toggleTaskitator) {
    toggleTaskitator.checked = !!currentUser.is_taskitator_linked;
    toggleTaskitator.addEventListener('change', async (e) => {
      currentUser.is_taskitator_linked = e.target.checked;
      await updateUserRecord(currentUser);
      showToast(
        currentUser.is_taskitator_linked ? "Taskitator integration linked." : "Taskitator integration unlinked.",
        "info"
      );
    });
  }

  if (inputPenalty) {
    inputPenalty.value = currentUser.withdrawal_penalty_pct || 10;
  }

  if (btnSavePenalty && inputPenalty) {
    btnSavePenalty.addEventListener('click', async () => {
      const val = parseInt(inputPenalty.value, 10);
      if (isNaN(val) || val < 0 || val > 100) {
        showToast("Penalty must be a percentage between 0 and 100.", "warning");
        return;
      }

      currentUser.withdrawal_penalty_pct = val;
      await updateUserRecord(currentUser);
      showToast("Withdrawal penalty updated successfully.", "success");
    });
  }

  bindManagerModalButtons();
}

// Persist user record updates to IndexedDB
async function updateUserRecord(user) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    tx.objectStore('users').put(user);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Bind modal open buttons for Rules, Labels, and Store managers
function bindManagerModalButtons() {
  const btnRules = document.getElementById('btn-open-rule-manager');
  const btnLabels = document.getElementById('btn-open-label-manager');
  const btnStore = document.getElementById('btn-open-store-manager');

  if (btnRules) {
    btnRules.addEventListener('click', () => openRuleManagerModal());
  }
  if (btnLabels) {
    btnLabels.addEventListener('click', () => openLabelManagerModal());
  }
  if (btnStore) {
    btnStore.addEventListener('click', () => openStoreRewardManagerModal());
  }
}

// Rule Creation/Manager Modal
async function openRuleManagerModal() {
  let modalEl = document.getElementById('modal-manage-rules');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'modal-manage-rules';
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    document.body.appendChild(modalEl);
  }

  const labels = await fetchUserRuleLabels(currentUser.id);

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
            <input type="text" id="rule-create-name" class="form-control form-control-sm bg-slate-dark text-white border-slate" required />
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
          <button type="button" class="btn btn-cyan btn-sm fw-bold px-4" onclick="saveNewRule()">Save Rule</button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();
}

async function saveNewRule() {
  const name = document.getElementById('rule-create-name').value.trim();
  const labelId = parseInt(document.getElementById('rule-create-label').value, 10);
  const type = document.getElementById('rule-create-type').value;
  const minPoints = parseInt(document.getElementById('rule-create-min').value, 10);
  const maxPoints = parseInt(document.getElementById('rule-create-max').value, 10);
  const jump = parseInt(document.getElementById('rule-create-jump').value, 10);
  const desc = document.getElementById('rule-create-desc').value.trim();

  // Mathematical constraints verification
  if (!name || isNaN(minPoints) || isNaN(maxPoints) || isNaN(jump)) {
    showToast("Please fill all required numeric fields.", "warning");
    return;
  }
  if (minPoints > maxPoints) {
    showToast("Min points cannot exceed Max points.", "danger");
    return;
  }
  if (jump < 1 || jump > (maxPoints - minPoints + 1)) {
    showToast(`Jump interval must be between 1 and ${maxPoints - minPoints + 1}.`, "danger");
    return;
  }

  const db = await openDB();
  const tx = db.transaction('rules', 'readwrite');
  tx.objectStore('rules').add({
    user_id: currentUser.id,
    label_id: labelId,
    name,
    description: desc,
    min_points: minPoints,
    max_points: maxPoints,
    jump_interval: jump,
    type,
    created_at: new Date().toISOString()
  });

  tx.oncomplete = () => {
    const modalEl = document.getElementById('modal-manage-rules');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();

    if (typeof renderActionsGrid === 'function') renderActionsGrid();
    showToast(`Rule "${name}" created!`, "success");
  };
}

// Label Creation Modal
function openLabelManagerModal() {
  let modalEl = document.getElementById('modal-manage-labels');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'modal-manage-labels';
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    document.body.appendChild(modalEl);
  }

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
          <button type="button" class="btn btn-cyan btn-sm fw-bold px-4" onclick="saveNewRuleLabel()">Create Label</button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();
}

async function saveNewRuleLabel() {
  const name = document.getElementById('label-create-name').value.trim();
  if (!name) return;

  const db = await openDB();
  const tx = db.transaction('rule_labels', 'readwrite');
  tx.objectStore('rule_labels').add({
    user_id: currentUser.id,
    name,
    is_default: false,
    created_at: new Date().toISOString()
  });

  tx.oncomplete = () => {
    const modalEl = document.getElementById('modal-manage-labels');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();

    if (typeof renderRuleLabelFilters === 'function') renderRuleLabelFilters();
    showToast(`Label "${name}" created!`, "success");
  };
}

// Store Catalog Creator Modal
function openStoreRewardManagerModal() {
  let modalEl = document.getElementById('modal-manage-store-item');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'modal-manage-store-item';
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    document.body.appendChild(modalEl);
  }

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
          <button type="button" class="btn btn-cyan btn-sm fw-bold px-4" onclick="saveNewStoreItem()">Save Reward</button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();
}

async function saveNewStoreItem() {
  const name = document.getElementById('store-create-name').value.trim();
  const desc = document.getElementById('store-create-desc').value.trim();
  const price = parseInt(document.getElementById('store-create-price').value, 10);

  if (!name || isNaN(price) || price < 0) {
    showToast("Please provide a name and non-negative price.", "warning");
    return;
  }

  const db = await openDB();
  const tx = db.transaction('store_items', 'readwrite');
  tx.objectStore('store_items').add({
    user_id: currentUser.id,
    name,
    description: desc,
    price,
    is_streak_freeze: false,
    created_at: new Date().toISOString()
  });

  tx.oncomplete = () => {
    const modalEl = document.getElementById('modal-manage-store-item');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();

    if (typeof renderStoreItems === 'function') renderStoreItems();
    showToast(`Reward "${name}" created!`, "success");
  };
}

document.addEventListener('DOMContentLoaded', () => {
  // Bind Setup controls once view initializes
  setTimeout(initSetupView, 150);
});
