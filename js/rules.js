// js/rules.js

let selectedRuleForAction = null;
let activeLabelFilters = new Set(); // Stores numeric label IDs to display

// Fetch user rules with guaranteed numeric user_id
async function fetchUserRules(userId) {
  const numericId = Number(userId);
  if (!numericId) return [];
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('rules', 'readonly');
    const store = tx.objectStore('rules');
    const index = store.index('user_id');
    const req = index.getAll(numericId);

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

// Render Rule Label Filter Checkboxes on Actions view
async function renderRuleLabelFilters() {
  if (!currentUser || !currentUser.id) return;
  const container = document.getElementById('rule-labels-filter-container');
  if (!container) return;

  const labels = await fetchUserRuleLabels(currentUser.id);

  // If filter is uninitialized or new labels were added, select all by default
  labels.forEach(l => {
    const numId = Number(l.id);
    if (!activeLabelFilters.has(numId) && activeLabelFilters.size === 0) {
      activeLabelFilters.add(numId);
    }
  });

  // Ensure at least all current labels are active if set was empty
  if (activeLabelFilters.size === 0) {
    labels.forEach(l => activeLabelFilters.add(Number(l.id)));
  }

  container.innerHTML = labels.map(label => {
    const numId = Number(label.id);
    const isChecked = activeLabelFilters.has(numId) ? 'checked' : '';
    return `
      <div class="form-check form-check-inline me-1 mb-1">
        <input class="form-check-input rule-label-filter-cb" type="checkbox" id="rl-filter-${numId}" 
          value="${numId}" ${isChecked} onchange="handleFilterCheckboxChange(${numId}, this.checked)">
        <label class="form-check-label small text-slate-light" for="rl-filter-${numId}">
          ${escapeHtml(label.name)}
        </label>
      </div>
    `;
  }).join('');
}

function handleFilterCheckboxChange(labelId, isChecked) {
  const numId = Number(labelId);
  if (isChecked) {
    activeLabelFilters.add(numId);
  } else {
    activeLabelFilters.delete(numId);
  }
  renderActionsGrid();
}

// Render Actions Hub grid separated into Point Additions and Point Deductions
async function renderActionsGrid() {
  if (!currentUser || !currentUser.id) return;
  const gridAdd = document.getElementById('actions-grid-add');
  const gridDeduct = document.getElementById('actions-grid-deduct');
  if (!gridAdd || !gridDeduct) return;

  await renderRuleLabelFilters();

  const allRules = await fetchUserRules(currentUser.id);
  const labels = await fetchUserRuleLabels(currentUser.id);
  const labelMap = new Map(labels.map(l => [Number(l.id), l.name]));

  // Auto-include any rule label IDs that exist in rules but aren't filtered out
  const visibleRules = allRules.filter(r => activeLabelFilters.has(Number(r.label_id)));

  const addRules = visibleRules.filter(r => r.type === 'add');
  const deductRules = visibleRules.filter(r => r.type === 'deduct');

  gridAdd.innerHTML = addRules.length > 0 
    ? addRules.map(rule => renderRuleButton(rule, labelMap)).join('') 
    : `<div class="col-12 text-slate-muted small text-center py-3">No addition rules found.</div>`;

  gridDeduct.innerHTML = deductRules.length > 0 
    ? deductRules.map(rule => renderRuleButton(rule, labelMap)).join('') 
    : `<div class="col-12 text-slate-muted small text-center py-3">No deduction rules found.</div>`;
}

function renderRuleButton(rule, labelMap) {
  const labelName = labelMap.get(Number(rule.label_id)) || 'General';
  const rangeDisplay = rule.min_points === rule.max_points ? `${rule.min_points}` : `${rule.min_points} - ${rule.max_points}`;
  const borderClass = rule.type === 'add' ? 'btn-add' : 'btn-deduct';
  const textClass = rule.type === 'add' ? 'text-success' : 'text-danger';

  return `
    <div class="col-6 col-md-4">
      <div class="action-grid-btn ${borderClass}" onclick="openActionModal(${Number(rule.id)})" role="button" tabindex="0">
        <span class="badge bg-slate-dark text-slate-light border border-slate mb-1 px-2 py-0" style="font-size: 0.65rem;">
          ${escapeHtml(labelName)}
        </span>
        <strong class="text-white small mb-1 text-truncate w-100 d-block">${escapeHtml(rule.name)}</strong>
        <span class="${textClass} fw-bold small">${rule.type === 'add' ? '+' : '-'}${rangeDisplay}</span>
      </div>
    </div>
  `;
}

// Modal handling for executing a rule with jump-interval snapping
async function openActionModal(ruleId) {
  const numericRuleId = Number(ruleId);
  const db = await openDB();
  const tx = db.transaction(['rules', 'action_labels'], 'readonly');
  const ruleStore = tx.objectStore('rules');
  const req = ruleStore.get(numericRuleId);

  req.onsuccess = async () => {
    const rule = req.result;
    if (!rule) return;
    selectedRuleForAction = rule;

    const actionLabelStore = tx.objectStore('action_labels');
    const aReq = actionLabelStore.index('user_id').getAll(Number(currentUser.id));

    aReq.onsuccess = () => {
      const actionLabels = aReq.result || [];
      showActionExecutionModal(rule, actionLabels);
    };
  };
}

function showActionExecutionModal(rule, actionLabels) {
  let modalEl = document.getElementById('modal-action-exec');
  if (modalEl) {
    const inst = bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.dispose();
    modalEl.remove();
  }

  modalEl = document.createElement('div');
  modalEl.id = 'modal-action-exec';
  modalEl.className = 'modal fade';
  modalEl.tabIndex = -1;
  modalEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(modalEl);

  const isFixed = (rule.min_points === rule.max_points);
  const step = Math.max(1, Number(rule.jump_interval) || 1);

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
            <label class="form-label text-slate-muted small text-uppercase">Points</label>
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
              placeholder="e.g., Chapter 2, Revision..." maxlength="30" />
            <datalist id="action-labels-datalist">
              ${actionLabels.map(al => `<option value="${escapeHtml(al.name)}">`).join('')}
            </datalist>
          </div>
        </div>
        <div class="modal-footer border-slate">
          <button type="button" class="btn btn-outline-slate btn-sm" data-bs-dismiss="modal">Cancel</button>
          <button type="button" id="btn-confirm-exec-action" class="btn ${rule.type === 'add' ? 'btn-success' : 'btn-danger'} btn-sm fw-bold px-4">
            Confirm
          </button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  document.getElementById('btn-confirm-exec-action').onclick = () => confirmExecuteAction(bsModal);
  bsModal.show();
}

async function confirmExecuteAction(bsModal) {
  if (!selectedRuleForAction || !currentUser) return;

  const slider = document.getElementById('modal-point-slider');
  const pointsVal = slider ? parseInt(slider.value, 10) : selectedRuleForAction.min_points;
  const tagInput = document.getElementById('modal-action-tag-input');
  const tagValue = tagInput ? tagInput.value.trim() : '';

  if (bsModal) bsModal.hide();

  if (tagValue) {
    await saveActionLabelIfUnique(currentUser.id, tagValue);
  }

  if (typeof applyPointTransaction === 'function') {
    await applyPointTransaction(selectedRuleForAction, pointsVal, tagValue);
  }

  selectedRuleForAction = null;
  if (typeof triggerCloudSyncPush === 'function') triggerCloudSyncPush();
}

async function saveActionLabelIfUnique(userId, labelName) {
  const numericId = Number(userId);
  if (!numericId || !labelName) return;
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('action_labels', 'readwrite');
    const store = tx.objectStore('action_labels');
    const index = store.index('user_id');
    const req = index.getAll(numericId);

    req.onsuccess = () => {
      const existing = req.result || [];
      if (!existing.some(l => l.name.toLowerCase() === labelName.toLowerCase())) {
        store.add({
          user_id: numericId,
          name: labelName,
          created_at: new Date().toISOString()
        });
      }
      resolve();
    };
    req.onerror = () => resolve();
  });
}

// Global window exposure
window.fetchUserRules = fetchUserRules;
window.renderRuleLabelFilters = renderRuleLabelFilters;
window.handleFilterCheckboxChange = handleFilterCheckboxChange;
window.renderActionsGrid = renderActionsGrid;
window.openActionModal = openActionModal;
window.confirmExecuteAction = confirmExecuteAction;

document.addEventListener('DOMContentLoaded', () => {
  const btnToggleAll = document.getElementById('btn-toggle-all-labels');
  if (btnToggleAll) {
    btnToggleAll.onclick = async () => {
      if (!currentUser || !currentUser.id) return;
      const labels = await fetchUserRuleLabels(currentUser.id);
      if (activeLabelFilters.size === labels.length) {
        activeLabelFilters.clear();
      } else {
        labels.forEach(l => activeLabelFilters.add(Number(l.id)));
      }
      renderRuleLabelFilters();
      renderActionsGrid();
    };
  }
});
