// js/rules.js

let selectedRuleForAction = null;
let activeLabelFilters = new Set(); // Stores label IDs to display

// Fetch user rule labels, ensuring default 'General' is present
async function fetchUserRuleLabels(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rule_labels', 'readonly');
    const store = tx.objectStore('rule_labels');
    const index = store.index('user_id');
    const req = index.getAll(userId);

    req.onsuccess = () => {
      let labels = req.result || [];
      if (!labels.some(l => l.name.toLowerCase() === 'general')) {
        labels.unshift({ id: 0, user_id: userId, name: 'General', is_default: true });
      }
      resolve(labels);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// Fetch all rules configured by current user
async function fetchUserRules(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rules', 'readonly');
    const store = tx.objectStore('rules');
    const index = store.index('user_id');
    const req = index.getAll(userId);

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

// Render Rule Label Filter Checkboxes on Actions view
async function renderRuleLabelFilters() {
  if (!currentUser) return;
  const container = document.getElementById('rule-labels-filter-container');
  if (!container) return;

  const labels = await fetchUserRuleLabels(currentUser.id);

  // Initialize all labels as checked by default on first load
  if (activeLabelFilters.size === 0) {
    labels.forEach(l => activeLabelFilters.add(l.id));
  }

  container.innerHTML = labels.map(label => {
    const isChecked = activeLabelFilters.has(label.id) ? 'checked' : '';
    return `
      <div class="form-check form-check-inline me-1 mb-1">
        <input class="form-check-input rule-label-filter-cb" type="checkbox" id="rl-filter-${label.id}" 
          value="${label.id}" ${isChecked} onchange="handleFilterCheckboxChange(${label.id}, this.checked)">
        <label class="form-check-label small text-slate-light" for="rl-filter-${label.id}">
          ${escapeHtml(label.name)}
        </label>
      </div>
    `;
  }).join('');
}

function handleFilterCheckboxChange(labelId, isChecked) {
  if (isChecked) {
    activeLabelFilters.add(labelId);
  } else {
    activeLabelFilters.delete(labelId);
  }
  renderActionsGrid();
}

// Render Actions Hub grid separated into Point Additions and Point Deductions
async function renderActionsGrid() {
  if (!currentUser) return;
  const gridAdd = document.getElementById('actions-grid-add');
  const gridDeduct = document.getElementById('actions-grid-deduct');
  if (!gridAdd || !gridDeduct) return;

  const allRules = await fetchUserRules(currentUser.id);
  const labels = await fetchUserRuleLabels(currentUser.id);
  const labelMap = new Map(labels.map(l => [l.id, l.name]));

  // Filter based on selected checkboxes
  const visibleRules = allRules.filter(r => activeLabelFilters.has(r.label_id));

  const addRules = visibleRules.filter(r => r.type === 'add');
  const deductRules = visibleRules.filter(r => r.type === 'deduct');

  gridAdd.innerHTML = addRules.length > 0 ? addRules.map(rule => renderRuleButton(rule, labelMap)).join('') 
    : `<div class="col-12 text-slate-muted small text-center py-2">${t('no_activity')}</div>`;

  gridDeduct.innerHTML = deductRules.length > 0 ? deductRules.map(rule => renderRuleButton(rule, labelMap)).join('') 
    : `<div class="col-12 text-slate-muted small text-center py-2">${t('no_activity')}</div>`;
}

function renderRuleButton(rule, labelMap) {
  const labelName = labelMap.get(rule.label_id) || 'General';
  const rangeDisplay = rule.min_points === rule.max_points ? `${rule.min_points}` : `${rule.min_points} - ${rule.max_points}`;
  const borderClass = rule.type === 'add' ? 'btn-add' : 'btn-deduct';
  const textClass = rule.type === 'add' ? 'text-success' : 'text-danger';

  return `
    <div class="col-6 col-md-4">
      <div class="action-grid-btn ${borderClass}" onclick="openActionModal(${rule.id})">
        <span class="badge bg-slate-dark text-slate-light border border-slate mb-1 px-2 py-0" style="font-size: 0.65rem;">
          ${escapeHtml(labelName)}
        </span>
        <strong class="text-white small mb-1 text-truncate w-100">${escapeHtml(rule.name)}</strong>
        <span class="${textClass} fw-bold small">${rule.type === 'add' ? '+' : '-'}${rangeDisplay}</span>
      </div>
    </div>
  `;
}

// Modal handling for executing a rule with jump-interval snapping
async function openActionModal(ruleId) {
  const db = await openDB();
  const tx = db.transaction(['rules', 'action_labels'], 'readonly');
  const ruleStore = tx.objectStore('rules');
  const req = ruleStore.get(ruleId);

  req.onsuccess = async () => {
    const rule = req.result;
    if (!rule) return;
    selectedRuleForAction = rule;

    // Fetch action labels for tagging
    const actionLabelStore = tx.objectStore('action_labels');
    const aReq = actionLabelStore.index('user_id').getAll(currentUser.id);

    aReq.onsuccess = () => {
      const actionLabels = aReq.result || [];
      showActionExecutionModal(rule, actionLabels);
    };
  };
}

function showActionExecutionModal(rule, actionLabels) {
  let modalEl = document.getElementById('modal-action-exec');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'modal-action-exec';
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    document.body.appendChild(modalEl);
  }

  const isFixed = (rule.min_points === rule.max_points);
  const step = rule.jump_interval || 1;

  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered max-w-mobile">
      <div class="modal-content bg-slate border-slate text-white">
        <div class="modal-header border-slate">
          <h6 class="modal-title fw-bold ${rule.type === 'add' ? 'text-success' : 'text-danger'}">
            ${rule.type === 'add' ? '+' : '-'}${escapeHtml(rule.name)}
          </h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          ${rule.description ? `
            <div class="card bg-slate-dark border-slate p-2 mb-3 small text-slate-light">
              ${escapeHtml(rule.description)}
            </div>
          ` : ''}

          <div class="mb-3 text-center">
            <label class="form-label text-slate-muted small text-uppercase">${t('points')}</label>
            <h2 id="modal-point-display" class="${rule.type === 'add' ? 'text-success' : 'text-danger'} fw-bold mb-2">
              ${rule.min_points}
            </h2>
            ${!isFixed ? `
              <input type="range" class="form-range" id="modal-point-slider" 
                min="${rule.min_points}" max="${rule.max_points}" step="${step}" value="${rule.min_points}"
                oninput="document.getElementById('modal-point-display').textContent = this.value">
              <div class="d-flex justify-content-between small text-slate-muted">
                <span>${rule.min_points}</span>
                <span>Step: ${step}</span>
                <span>${rule.max_points}</span>
              </div>
            ` : ''}
          </div>

          <div class="mb-2">
            <label class="form-label text-slate-light small">Action Tag (Optional)</label>
            <input type="text" id="modal-action-tag-input" list="action-labels-datalist" 
              class="form-control form-control-sm bg-slate-dark text-white border-slate" 
              placeholder="e.g., Chapter 2, LeetCode 104..." maxlength="30" />
            <datalist id="action-labels-datalist">
              ${actionLabels.map(al => `<option value="${escapeHtml(al.name)}">`).join('')}
            </datalist>
          </div>
        </div>
        <div class="modal-footer border-slate">
          <button type="button" class="btn btn-outline-slate btn-sm" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn ${rule.type === 'add' ? 'btn-success' : 'btn-danger'} btn-sm fw-bold px-4" 
            onclick="confirmExecuteAction()">
            Confirm
          </button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();
}

async function confirmExecuteAction() {
  if (!selectedRuleForAction || !currentUser) return;

  const slider = document.getElementById('modal-point-slider');
  const pointsVal = slider ? parseInt(slider.value, 10) : selectedRuleForAction.min_points;
  const tagInput = document.getElementById('modal-action-tag-input');
  const tagValue = tagInput ? tagInput.value.trim() : '';

  // Dismiss modal
  const modalEl = document.getElementById('modal-action-exec');
  const bsModal = bootstrap.Modal.getInstance(modalEl);
  if (bsModal) bsModal.hide();

  // Save new action label if non-empty and unique
  if (tagValue) {
    await saveActionLabelIfUnique(currentUser.id, tagValue);
  }

  // Execute point transaction through activity engine
  await applyPointTransaction(selectedRuleForAction, pointsVal, tagValue);
  selectedRuleForAction = null;
}

async function saveActionLabelIfUnique(userId, labelName) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('action_labels', 'readwrite');
    const store = tx.objectStore('action_labels');
    const index = store.index('user_id');
    const req = index.getAll(userId);

    req.onsuccess = () => {
      const existing = req.result || [];
      if (!existing.some(l => l.name.toLowerCase() === labelName.toLowerCase())) {
        store.add({
          user_id: userId,
          name: labelName,
          created_at: new Date().toISOString()
        });
      }
      resolve();
    };
    req.onerror = () => resolve();
  });
}

// Initializer binding
document.addEventListener('DOMContentLoaded', () => {
  const btnToggleAll = document.getElementById('btn-toggle-all-labels');
  if (btnToggleAll) {
    btnToggleAll.addEventListener('click', async () => {
      if (!currentUser) return;
      const labels = await fetchUserRuleLabels(currentUser.id);
      if (activeLabelFilters.size === labels.length) {
        activeLabelFilters.clear();
      } else {
        labels.forEach(l => activeLabelFilters.add(l.id));
      }
      renderRuleLabelFilters();
      renderActionsGrid();
    });
  }
});
