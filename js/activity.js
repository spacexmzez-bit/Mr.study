// js/activity.js

// Execute point addition or deduction and commit to rolling 15-entry log
async function applyPointTransaction(rule, pointValue, actionLabel = '') {
  if (!currentUser || !currentUser.id) return;

  const numericUserId = Number(currentUser.id);
  const db = await openDB();
  const tx = db.transaction(['users', 'activity_logs'], 'readwrite');
  const userStore = tx.objectStore('users');
  const logStore = tx.objectStore('activity_logs');

  let xpDelta = 0;
  let banchDelta = 0;

  if (rule.type === 'add') {
    const multiplier = (typeof getActiveStreakMultiplier === 'function')
      ? getActiveStreakMultiplier(currentUser.streak_count)
      : 1;
    const finalPoints = Math.round(pointValue * multiplier);

    xpDelta = finalPoints;
    banchDelta = finalPoints;

    currentUser.total_xp = (currentUser.total_xp || 0) + xpDelta;
    currentUser.banch_balance = (currentUser.banch_balance || 0) + banchDelta;

    if (typeof applyDailyStreakOnPointAddition === 'function') {
      applyDailyStreakOnPointAddition(currentUser);
    }
  } else {
    xpDelta = -pointValue;
    currentUser.total_xp = Math.max(0, (currentUser.total_xp || 0) + xpDelta);

    // Debt Guardrail: Clamp spendable Banch balance strictly to 0
    if ((currentUser.banch_balance || 0) < pointValue) {
      banchDelta = -(currentUser.banch_balance || 0);
      currentUser.banch_balance = 0;
    } else {
      banchDelta = -pointValue;
      currentUser.banch_balance += banchDelta;
    }
  }

  // Update user profile in store
  userStore.put(currentUser);

  // Append to activity log
  const newLogEntry = {
    user_id: numericUserId,
    rule_id: Number(rule.id) || 0,
    rule_name: rule.name,
    rule_type: rule.type,
    delta: xpDelta,
    banch_delta: banchDelta,
    action_label: actionLabel || null,
    timestamp: new Date().toISOString()
  };
  logStore.add(newLogEntry);

  tx.oncomplete = async () => {
    await pruneRollingLogs('activity_logs', numericUserId, 15);
    await refreshDashboardUI();
    renderActivityFeed();

    if (typeof triggerCloudSyncPush === 'function') {
      triggerCloudSyncPush();
    }

    showToast(
      `${rule.type === 'add' ? '+' : ''}${banchDelta} Banch (${rule.name})`,
      rule.type === 'add' ? 'success' : 'danger'
    );
  };

  tx.onerror = (e) => {
    showToast(`Transaction failed: ${e.target.error}`, 'danger');
  };
}

// Render rolling 15 Recent Activity entries on Dashboard
async function renderActivityFeed() {
  if (!currentUser || !currentUser.id) return;
  const container = document.getElementById('activity-feed-list');
  if (!container) return;

  const numericUserId = Number(currentUser.id);
  const db = await openDB();
  const tx = db.transaction('activity_logs', 'readonly');
  const store = tx.objectStore('activity_logs');
  const index = store.index('user_id');
  const req = index.getAll(numericUserId);

  req.onsuccess = () => {
    let logs = req.result || [];
    if (logs.length === 0) {
      container.innerHTML = `<p class="text-slate-muted small text-center my-3 mb-0">No recent activity recorded.</p>`;
      return;
    }

    logs.sort((a, b) => b.id - a.id);

    container.innerHTML = logs.map(log => {
      const isAdd = (log.delta >= 0);
      const sign = isAdd ? '+' : '';
      const colorClass = isAdd ? 'text-success' : 'text-danger';
      const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="card bg-slate-dark border-slate p-2 d-flex flex-row justify-content-between align-items-center">
          <div class="text-truncate me-2">
            <div class="d-flex align-items-center gap-1">
              <strong class="text-white small text-truncate">${escapeHtml(log.rule_name)}</strong>
              ${log.action_label ? `<span class="badge bg-slate text-cyan border border-slate px-1 py-0" style="font-size: 0.65rem;">${escapeHtml(log.action_label)}</span>` : ''}
            </div>
            <small class="text-slate-muted">${timeStr}</small>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="${colorClass} fw-bold small text-nowrap">${sign}${log.banch_delta} B</span>
            <button class="btn btn-outline-slate btn-sm py-0 px-2 text-slate-light" 
              onclick="undoActivityAction(${Number(log.id)})" title="Undo">
              <i class="bi bi-arrow-counterclockwise"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  };
}

// Atomic Undo Engine: Reverses exact XP/Banch deltas and purges log entry
async function undoActivityAction(logId) {
  if (!currentUser || !currentUser.id) return;

  const numericLogId = Number(logId);
  const db = await openDB();
  const tx = db.transaction(['users', 'activity_logs'], 'readwrite');
  const logStore = tx.objectStore('activity_logs');
  const userStore = tx.objectStore('users');

  const req = logStore.get(numericLogId);
  req.onsuccess = () => {
    const log = req.result;
    if (!log) return;

    currentUser.total_xp = Math.max(0, (currentUser.total_xp || 0) - log.delta);
    currentUser.banch_balance = Math.max(0, (currentUser.banch_balance || 0) - log.banch_delta);

    userStore.put(currentUser);
    logStore.delete(numericLogId);
  };

  tx.oncomplete = async () => {
    await refreshDashboardUI();
    renderActivityFeed();
    if (typeof triggerCloudSyncPush === 'function') {
      triggerCloudSyncPush();
    }
    showToast("Action undone. Balances restored.", "info");
  };

  tx.onerror = (e) => {
    showToast(`Undo failed: ${e.target.error}`, "danger");
  };
}

// Refresh Dashboard summary counters
async function refreshDashboardUI() {
  if (!currentUser) return;

  const rankTitleEl = document.getElementById('dash-rank-title');
  const streakCountEl = document.getElementById('dash-streak-count');
  const totalXpEl = document.getElementById('dash-total-xp');
  const xpToNextEl = document.getElementById('dash-xp-to-next');
  const rankProgressEl = document.getElementById('dash-rank-progress');
  const banchBalanceEl = document.getElementById('dash-banch-balance');
  const storeBanchBalanceEl = document.getElementById('store-banch-balance');

  if (totalXpEl) totalXpEl.textContent = (currentUser.total_xp || 0).toLocaleString();
  if (banchBalanceEl) banchBalanceEl.textContent = (currentUser.banch_balance || 0).toLocaleString();
  if (storeBanchBalanceEl) storeBanchBalanceEl.textContent = (currentUser.banch_balance || 0).toLocaleString();
  if (streakCountEl) streakCountEl.innerHTML = `${currentUser.streak_count || 0} <i class="bi bi-fire"></i>`;

  if (typeof calculateRankProgress === 'function') {
    const rankInfo = calculateRankProgress(currentUser.total_xp || 0);
    if (rankTitleEl) rankTitleEl.textContent = rankInfo.currentRank.title;
    if (xpToNextEl) xpToNextEl.textContent = rankInfo.pointsNeeded.toLocaleString();
    if (rankProgressEl) rankProgressEl.style.width = `${rankInfo.percent}%`;
  }

  if (typeof renderDashboardLiveChallenges === 'function') {
    renderDashboardLiveChallenges();
  }
}

// Global window exposure
window.applyPointTransaction = applyPointTransaction;
window.renderActivityFeed = renderActivityFeed;
window.undoActivityAction = undoActivityAction;
window.refreshDashboardUI = refreshDashboardUI;
