// js/challenges.js

// Fetch user challenges by status
async function fetchUserChallenges(userId, status = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('challenges', 'readonly');
    const store = tx.objectStore('challenges');
    const index = store.index('user_id');
    const req = index.getAll(userId);

    req.onsuccess = () => {
      let challenges = req.result || [];
      if (status) {
        challenges = challenges.filter(c => c.status === status);
      }
      resolve(challenges);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// Check and mark overdue active challenges as Failed
async function checkOverdueChallenges() {
  if (!currentUser) return;
  const todayStr = getLocalDateString();
  const activeChallenges = await fetchUserChallenges(currentUser.id, 'Active');

  for (const challenge of activeChallenges) {
    if (challenge.finish_date && challenge.finish_date < todayStr) {
      await failChallenge(challenge.id, "Deadline expired");
    }
  }
}

// Render Challenges Hub
async function renderChallengesHub() {
  if (!currentUser) return;
  await checkOverdueChallenges();

  const activeList = document.getElementById('challenges-active-list');
  const createdList = document.getElementById('challenges-created-list');
  const dashContainer = document.getElementById('dash-live-challenges-container');
  const dashList = document.getElementById('dash-live-challenges-list');

  const activeChallenges = await fetchUserChallenges(currentUser.id, 'Active');
  const createdChallenges = await fetchUserChallenges(currentUser.id, 'Created');

  // Render Dashboard widget
  if (dashContainer && dashList) {
    if (activeChallenges.length > 0) {
      dashContainer.classList.remove('d-none');
      dashList.innerHTML = activeChallenges.map(c => `
        <div class="card bg-slate-dark border-cyan p-2 d-flex flex-row justify-content-between align-items-center">
          <div>
            <strong class="text-white small">${escapeHtml(c.title)}</strong>
            <div class="text-slate-muted small">Ends: ${c.finish_date}</div>
          </div>
          <button class="btn btn-outline-cyan btn-sm py-0 px-2" onclick="promptCompleteChallenge(${c.id})">${t('complete')}</button>
        </div>
      `).join('');
    } else {
      dashContainer.classList.add('d-none');
    }
  }

  // Render Challenges Tab Active
  if (activeList) {
    if (activeChallenges.length === 0) {
      activeList.innerHTML = `<p class="text-slate-muted small text-center my-2 mb-0">No active challenges running.</p>`;
    } else {
      activeList.innerHTML = activeChallenges.map(c => `
        <div class="card bg-slate border-cyan p-3 mb-2">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <h6 class="text-white fw-bold mb-0">${escapeHtml(c.title)}</h6>
            <span class="badge bg-cyan text-slate-darker">${c.duration_days} Days</span>
          </div>
          ${c.description ? `<p class="text-slate-light small mb-2">${escapeHtml(c.description)}</p>` : ''}
          <div class="d-flex justify-content-between align-items-center small text-slate-light mb-3">
            <span>Escrow: <strong class="text-warning">${c.entry_cost} Banch</strong></span>
            <span>Ends: <strong class="text-white">${c.finish_date}</strong></span>
          </div>
          <div class="d-flex gap-2 border-top border-slate pt-2">
            <button class="btn btn-success btn-sm flex-grow-1 fw-bold" onclick="promptCompleteChallenge(${c.id})">${t('complete')}</button>
            <button class="btn btn-outline-danger btn-sm" onclick="promptAbandonChallenge(${c.id}, ${c.entry_cost})">${t('withdraw')}</button>
          </div>
        </div>
      `).join('');
    }
  }

  // Render Challenges Tab Created
  if (createdList) {
    if (createdChallenges.length === 0) {
      createdList.innerHTML = `<p class="text-slate-muted small text-center my-2 mb-0">No created challenges saved.</p>`;
    } else {
      createdList.innerHTML = createdChallenges.map(c => `
        <div class="card bg-slate border-slate p-3 mb-2">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <h6 class="text-white fw-bold mb-0">${escapeHtml(c.title)}</h6>
            <span class="badge bg-slate-dark text-slate-light border border-slate">${c.duration_days} Days</span>
          </div>
          <div class="d-flex justify-content-between align-items-center small text-slate-light mb-2">
            <span>Entry Cost: <strong>${c.entry_cost} Banch</strong></span>
            <span>Prize: <strong class="text-cyan">${c.is_item_prize ? 'Item Reward' : c.banch_prize + ' Banch'}</strong></span>
          </div>
          <div class="d-flex gap-2 border-top border-slate pt-2">
            <button class="btn btn-cyan btn-sm flex-grow-1 fw-bold" onclick="startChallenge(${c.id}, ${c.entry_cost}, ${c.duration_days})">${t('start')}</button>
            <button class="btn btn-outline-danger btn-sm" onclick="deleteCreatedChallenge(${c.id})"><i class="bi bi-trash"></i></button>
          </div>
        </div>
      `).join('');
    }
  }
}

// Start / Activate Challenge with Escrow lock
async function startChallenge(challengeId, entryCost, durationDays) {
  if (!currentUser) return;

  if (currentUser.banch_balance < entryCost) {
    showToast("banch is not enough to purchase this product", "danger");
    return;
  }

  const todayStr = getLocalDateString();
  const finishDate = new Date();
  finishDate.setDate(finishDate.getDate() + durationDays);
  const finishStr = finishDate.toISOString().split('T')[0];

  const db = await openDB();
  const tx = db.transaction(['users', 'challenges'], 'readwrite');
  const userStore = tx.objectStore('users');
  const challengeStore = tx.objectStore('challenges');

  // Lock entry cost in escrow
  currentUser.banch_balance -= entryCost;
  userStore.put(currentUser);

  const req = challengeStore.get(challengeId);
  req.onsuccess = () => {
    const c = req.result;
    c.status = 'Active';
    c.start_date = todayStr;
    c.finish_date = finishStr;
    challengeStore.put(c);
  };

  tx.oncomplete = async () => {
    await refreshDashboardUI();
    renderChallengesHub();
    showToast(`Challenge started! ${entryCost} Banch placed in escrow.`, "success");
  };

  tx.onerror = (e) => showToast(`Failed to start: ${e.target.error}`, "danger");
}

// Complete Challenge: Refund escrow, disburse prize, bump streak
async function promptCompleteChallenge(challengeId) {
  const db = await openDB();
  const tx = db.transaction(['users', 'challenges', 'challenge_prize_items', 'user_inventory', 'challenge_history'], 'readwrite');
  const userStore = tx.objectStore('users');
  const challengeStore = tx.objectStore('challenges');
  const prizeStore = tx.objectStore('challenge_prize_items');
  const invStore = tx.objectStore('user_inventory');
  const historyStore = tx.objectStore('challenge_history');

  const cReq = challengeStore.get(challengeId);
  cReq.onsuccess = () => {
    const c = cReq.result;
    if (!c || c.status !== 'Active') return;

    // Refund escrow entry cost
    currentUser.banch_balance += c.entry_cost;

    // Disburse prize
    if (!c.is_item_prize) {
      currentUser.banch_balance += c.banch_prize;
    }

    // Award streak advancement
    applyDailyStreakOnPointAddition(currentUser);
    userStore.put(currentUser);

    // If item prize, disburse items
    if (c.is_item_prize) {
      const pIndex = prizeStore.index('challenge_id');
      const pReq = pIndex.getAll(c.id);
      pReq.onsuccess = () => {
        const prizes = pReq.result || [];
        prizes.forEach(p => {
          // Add into user inventory
          invStore.add({
            user_id: currentUser.id,
            item_id: 0,
            total_bought: p.amount,
            unused_count: p.amount
          });
        });
      };
    }

    // Mark completed
    c.status = 'Completed';
    challengeStore.put(c);

    // Record into rolling 25 history
    historyStore.add({
      user_id: currentUser.id,
      challenge_title: c.title,
      final_status: 'Completed',
      entry_cost: c.entry_cost,
      refunded_or_awarded: `+${c.entry_cost + (c.is_item_prize ? 0 : c.banch_prize)} Banch`,
      finished_at: new Date().toISOString()
    });
  };

  tx.oncomplete = async () => {
    await pruneRollingLogs('challenge_history', currentUser.id, 25);
    await refreshDashboardUI();
    renderChallengesHub();
    showToast("Challenge Completed! Rewards and escrow refunded.", "success");
  };

  tx.onerror = (e) => showToast(`Error completing challenge: ${e.target.error}`, "danger");
}

// Abandon Challenge with withdrawal penalty math
async function promptAbandonChallenge(challengeId, entryCost) {
  const penaltyPct = currentUser.withdrawal_penalty_pct || 10;
  const penaltyAmount = Math.round((entryCost * penaltyPct) / 100);
  const refundAmount = Math.max(0, entryCost - penaltyAmount);

  if (!confirm(`Abandon challenge? A ${penaltyPct}% penalty (${penaltyAmount} Banch) applies. You will be refunded ${refundAmount} Banch.`)) {
    return;
  }

  const db = await openDB();
  const tx = db.transaction(['users', 'challenges', 'challenge_history'], 'readwrite');
  const userStore = tx.objectStore('users');
  const challengeStore = tx.objectStore('challenges');
  const historyStore = tx.objectStore('challenge_history');

  currentUser.banch_balance += refundAmount;
  userStore.put(currentUser);

  const cReq = challengeStore.get(challengeId);
  cReq.onsuccess = () => {
    const c = cReq.result;
    c.status = 'Abandoned';
    challengeStore.put(c);

    historyStore.add({
      user_id: currentUser.id,
      challenge_title: c.title,
      final_status: 'Abandoned',
      entry_cost: entryCost,
      refunded_or_awarded: `Refunded: ${refundAmount} Banch (-${penaltyPct}%)`,
      finished_at: new Date().toISOString()
    });
  };

  tx.oncomplete = async () => {
    await pruneRollingLogs('challenge_history', currentUser.id, 25);
    await refreshDashboardUI();
    renderChallengesHub();
    showToast(`Challenge abandoned. Refunded ${refundAmount} Banch.`, "info");
  };

  tx.onerror = (e) => showToast(`Error abandoning challenge: ${e.target.error}`, "danger");
}

// Fail Challenge when overdue
async function failChallenge(challengeId, reason = "Overdue") {
  const db = await openDB();
  const tx = db.transaction(['challenges', 'challenge_history'], 'readwrite');
  const challengeStore = tx.objectStore('challenges');
  const historyStore = tx.objectStore('challenge_history');

  const cReq = challengeStore.get(challengeId);
  cReq.onsuccess = () => {
    const c = cReq.result;
    if (!c || c.status !== 'Active') return;
    c.status = 'Failed';
    challengeStore.put(c);

    historyStore.add({
      user_id: currentUser.id,
      challenge_title: c.title,
      final_status: 'Failed',
      entry_cost: c.entry_cost,
      refunded_or_awarded: `Forfeited ${c.entry_cost} Banch (${reason})`,
      finished_at: new Date().toISOString()
    });
  };

  tx.oncomplete = async () => {
    await pruneRollingLogs('challenge_history', currentUser.id, 25);
    renderChallengesHub();
  };
}

// Render Resolved Challenges (Rolling 25 History)
async function renderChallengeHistory() {
  if (!currentUser) return;
  const container = document.getElementById('challenge-history-list');
  if (!container) return;

  const db = await openDB();
  const tx = db.transaction('challenge_history', 'readonly');
  const store = tx.objectStore('challenge_history');
  const index = store.index('user_id');
  const req = index.getAll(currentUser.id);

  req.onsuccess = () => {
    let history = req.result || [];
    if (history.length === 0) {
      container.innerHTML = `<p class="text-slate-muted small text-center my-3 mb-0">No past challenge history.</p>`;
      return;
    }

    history.sort((a, b) => b.id - a.id);

    container.innerHTML = history.map(h => {
      const badgeClass = h.final_status === 'Completed' ? 'bg-success' : h.final_status === 'Failed' ? 'bg-danger' : 'bg-warning text-dark';
      return `
        <div class="card bg-slate-dark border-slate p-2 d-flex flex-row justify-content-between align-items-center">
          <div>
            <strong class="text-white small">${escapeHtml(h.challenge_title)}</strong>
            <div class="text-slate-muted small">${escapeHtml(h.refunded_or_awarded)}</div>
          </div>
          <span class="badge ${badgeClass}">${h.final_status}</span>
        </div>
      `;
    }).join('');
  };
}

async function deleteCreatedChallenge(challengeId) {
  const db = await openDB();
  const tx = db.transaction('challenges', 'readwrite');
  tx.objectStore('challenges').delete(challengeId);
  tx.oncomplete = () => {
    renderChallengesHub();
    showToast("Challenge removed.", "info");
  };
}
