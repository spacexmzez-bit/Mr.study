// js/challenge_modals.js

// Build and launch Create Challenge modal
function openCreateChallengeModal() {
  let modalEl = document.getElementById('modal-create-challenge');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'modal-create-challenge';
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    document.body.appendChild(modalEl);
  }

  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered max-w-mobile">
      <div class="modal-content bg-slate border-slate text-white">
        <div class="modal-header border-slate">
          <h6 class="modal-title fw-bold text-cyan">${t('new_challenge')}</h6>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="mb-2">
            <label class="form-label small text-slate-light">Title *</label>
            <input type="text" id="input-c-title" class="form-control form-control-sm bg-slate-dark text-white border-slate" required />
          </div>
          <div class="mb-2">
            <label class="form-label small text-slate-light">Description (Optional)</label>
            <textarea id="input-c-desc" rows="2" class="form-control form-control-sm bg-slate-dark text-white border-slate"></textarea>
          </div>
          <div class="row g-2 mb-2">
            <div class="col-6">
              <label class="form-label small text-slate-light">Duration (Days) *</label>
              <input type="number" id="input-c-days" min="1" value="3" class="form-control form-control-sm bg-slate-dark text-white border-slate" required />
            </div>
            <div class="col-6">
              <label class="form-label small text-slate-light">Entry Cost (Banch)</label>
              <input type="number" id="input-c-entry" min="0" value="0" class="form-control form-control-sm bg-slate-dark text-white border-slate" />
            </div>
          </div>
          <div class="mb-2">
            <label class="form-label small text-slate-light">Prize Type</label>
            <select id="select-c-prize-type" class="form-select form-select-sm bg-slate-dark text-white border-slate" onchange="togglePrizeTypeInput(this.value)">
              <option value="banch">Banch Currency</option>
              <option value="items">Custom Item(s)</option>
            </select>
          </div>
          <div id="c-banch-prize-container" class="mb-2">
            <label class="form-label small text-slate-light">Banch Prize *</label>
            <input type="number" id="input-c-prize-banch" min="0" value="100" class="form-control form-control-sm bg-slate-dark text-white border-slate" />
          </div>
          <div id="c-item-prize-container" class="mb-2 d-none">
            <label class="form-label small text-slate-light">Item Distribution (Name & Qty)</label>
            <div class="input-group input-group-sm">
              <input type="text" id="input-c-prize-item-name" placeholder="Item name" class="form-control bg-slate-dark text-white border-slate" />
              <input type="number" id="input-c-prize-item-qty" placeholder="Qty" min="1" value="1" class="form-control bg-slate-dark text-white border-slate" style="max-width: 80px;" />
            </div>
          </div>
        </div>
        <div class="modal-footer border-slate">
          <button type="button" class="btn btn-outline-slate btn-sm" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-cyan btn-sm fw-bold px-4" onclick="saveNewChallenge()">Save Challenge</button>
        </div>
      </div>
    </div>
  `;

  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();
}

function togglePrizeTypeInput(val) {
  const banchBox = document.getElementById('c-banch-prize-container');
  const itemBox = document.getElementById('c-item-prize-container');
  if (val === 'items') {
    banchBox.classList.add('d-none');
    itemBox.classList.remove('d-none');
  } else {
    banchBox.classList.remove('d-none');
    itemBox.classList.add('d-none');
  }
}

async function saveNewChallenge() {
  if (!currentUser) return;
  const title = document.getElementById('input-c-title').value.trim();
  const desc = document.getElementById('input-c-desc').value.trim();
  const days = parseInt(document.getElementById('input-c-days').value, 10);
  const entryCost = parseInt(document.getElementById('input-c-entry').value, 10) || 0;
  const prizeType = document.getElementById('select-c-prize-type').value;

  if (!title || isNaN(days) || days <= 0) {
    showToast("Please provide a title and valid duration.", "warning");
    return;
  }

  const isItemPrize = (prizeType === 'items');
  const banchPrize = isItemPrize ? 0 : (parseInt(document.getElementById('input-c-prize-banch').value, 10) || 0);

  const db = await openDB();
  const tx = db.transaction(['challenges', 'challenge_prize_items'], 'readwrite');
  const challengeStore = tx.objectStore('challenges');
  const prizeStore = tx.objectStore('challenge_prize_items');

  const addReq = challengeStore.add({
    user_id: currentUser.id,
    title,
    description: desc,
    entry_cost: entryCost,
    banch_prize: banchPrize,
    is_item_prize: isItemPrize,
    duration_days: days,
    status: 'Created',
    start_date: null,
    finish_date: null,
    created_at: new Date().toISOString()
  });

  addReq.onsuccess = (e) => {
    const newChallengeId = e.target.result;
    if (isItemPrize) {
      const itemName = document.getElementById('input-c-prize-item-name').value.trim() || 'Reward Box';
      const itemQty = parseInt(document.getElementById('input-c-prize-item-qty').value, 10) || 1;
      prizeStore.add({
        challenge_id: newChallengeId,
        item_name: itemName,
        amount: itemQty
      });
    }
  };

  tx.oncomplete = () => {
    const modalEl = document.getElementById('modal-create-challenge');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();

    renderChallengesHub();
    showToast("Challenge created!", "success");
  };

  tx.onerror = (e) => showToast(`Failed to create challenge: ${e.target.error}`, "danger");
}

// Wire modal and history buttons
document.addEventListener('DOMContentLoaded', () => {
  const btnNew = document.getElementById('btn-open-create-challenge');
  if (btnNew) {
    btnNew.addEventListener('click', () => openCreateChallengeModal());
  }

  const btnHistory = document.getElementById('btn-open-challenge-history');
  if (btnHistory) {
    btnHistory.addEventListener('click', () => {
      switchView('view-challenge-history');
      renderChallengeHistory();
    });
  }

  const btnBackHistory = document.getElementById('btn-back-to-challenges');
  if (btnBackHistory) {
    btnBackHistory.addEventListener('click', () => {
      switchView('view-challenges');
      renderChallengesHub();
    });
  }

  const btnDashChallenges = document.getElementById('btn-dash-view-challenges');
  if (btnDashChallenges) {
    btnDashChallenges.addEventListener('click', () => {
      switchView('view-challenges');
      renderChallengesHub();
    });
  }
});
