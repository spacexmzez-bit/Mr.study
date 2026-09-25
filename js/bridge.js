// js/bridge.js

const TASKITATOR_STORAGE_CHANNEL = 'mrstudy_taskitator_bus';
let broadcastChannel = null;

// Primary Ingestion Engine: Polls Taskitator Audit Ledger from Cloudflare Worker
async function pullTaskitatorAuditLedger() {
  if (!currentUser || !currentUser.id || !currentUser.is_taskitator_linked) {
    return { ingestedCount: 0, status: 'unlinked' };
  }

  const syncKey = localStorage.getItem('mrstudy_sync_key');
  if (!syncKey) {
    return { ingestedCount: 0, status: 'no_token' };
  }

  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync/bridge/taskitator-ledger`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey}`,
        'X-User-Name': currentUser.username
      }
    });

    if (!resp.ok) {
      if (resp.status === 404) return { ingestedCount: 0, status: 'uninitialized' };
      console.warn(`Bridge ledger fetch failed with status: ${resp.status}`);
      return { ingestedCount: 0, status: 'error' };
    }

    const data = await resp.json();
    const ledger = Array.isArray(data.ledger) ? data.ledger : [];
    if (ledger.length === 0) {
      return { ingestedCount: 0, status: 'empty' };
    }

    let ingestedCount = 0;
    for (const event of ledger) {
      const processed = await ingestLedgerEvent(event);
      if (processed) ingestedCount++;
    }

    if (ingestedCount > 0) {
      await refreshDashboardUI();
      if (typeof renderActivityFeed === 'function') renderActivityFeed();
      showToast(`Ingested ${ingestedCount} task completion(s) from Taskitator!`, 'success');
    }

    return { ingestedCount, status: 'success' };
  } catch (err) {
    console.warn('Taskitator bridge ledger sync failed (offline or network error):', err);
    return { ingestedCount: 0, status: 'network_error' };
  }
}

// Atomic Ingestion & Deduplication for a Single Ledger Event
async function ingestLedgerEvent(event) {
  const taskId = String(event.taskId || event.id || '');
  const eventId = String(event.eventId || taskId);
  if (!taskId && !eventId) return false;

  // Strict Audit Gate: Check if AI verification was locked but never passed
  if (event.ai_locked && !event.aiVerified) {
    return false;
  }

  const db = await openDB();
  const numericUserId = Number(currentUser.id);

  // Check Idempotency via IndexedDB task_bridge
  const alreadyProcessed = await new Promise((resolve) => {
    const tx = db.transaction('task_bridge', 'readonly');
    const store = tx.objectStore('task_bridge');
    const index = store.index('taskitator_task_id');
    const req = index.get(taskId);

    req.onsuccess = () => resolve(Boolean(req.result && req.result.points_awarded));
    req.onerror = () => resolve(false);
  });

  if (alreadyProcessed) {
    return false;
  }

  // Calculate Reward Deltas based on Event Type & Payload
  const rawXp = Number(event.assigned_xp ?? event.points ?? 0);
  const rawBanch = Number(event.assigned_banch ?? event.points ?? rawXp);
  const eventType = event.eventType || 'ROOT_TASK_COMPLETED';

  let multiplier = 1;
  if (eventType === 'ROOT_TASK_COMPLETED' && typeof getActiveStreakMultiplier === 'function') {
    multiplier = getActiveStreakMultiplier(currentUser.streak_count || 0);
  } else if (eventType === 'CASCADE_COMPLETED') {
    // Project-level bundled bonus rather than compounding full multipliers
    multiplier = 1.0;
  }

  const xpDelta = Math.round(rawXp * multiplier);
  const banchDelta = Math.round(rawBanch * multiplier);

  // Apply Balance Mutations
  currentUser.total_xp = (currentUser.total_xp || 0) + xpDelta;
  currentUser.banch_balance = (currentUser.banch_balance || 0) + banchDelta;

  if (typeof applyDailyStreakOnPointAddition === 'function' && eventType === 'ROOT_TASK_COMPLETED') {
    applyDailyStreakOnPointAddition(currentUser);
  }

  // Commit mutations to users, activity_logs, and task_bridge in a single transaction
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['users', 'activity_logs', 'task_bridge'], 'readwrite');
    const userStore = tx.objectStore('users');
    const logStore = tx.objectStore('activity_logs');
    const bridgeStore = tx.objectStore('task_bridge');

    userStore.put(currentUser);

    const logTitle = event.taskTitle || event.ruleName || `Task #${taskId}`;
    logStore.add({
      user_id: numericUserId,
      rule_id: Number(event.ruleId) || 0,
      rule_name: logTitle,
      rule_type: 'add',
      delta: xpDelta,
      banch_delta: banchDelta,
      action_label: 'Taskitator',
      timestamp: event.completedAt || new Date().toISOString()
    });

    bridgeStore.add({
      user_id: numericUserId,
      taskitator_task_id: taskId,
      event_id: eventId,
      mr_study_rule_id: Number(event.ruleId) || 0,
      challenge_id: event.challengeId || null,
      xp_awarded: xpDelta,
      banch_awarded: banchDelta,
      points_awarded: true,
      processed_at: new Date().toISOString()
    });

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });

  // Prune activity logs to keep 15-entry rolling cap
  if (typeof pruneRollingLogs === 'function') {
    await pruneRollingLogs('activity_logs', numericUserId, 15);
  }

  // If bound to an active challenge, increment completion counter
  if (event.challengeId) {
    await incrementChallengeTaskCount(event.challengeId);
  }

  return true;
}

// Auto-increment challenge counter when a linked task completes
async function incrementChallengeTaskCount(challengeId) {
  const numericChallengeId = Number(challengeId);
  if (!numericChallengeId) return;

  const db = await openDB();
  const tx = db.transaction('challenges', 'readwrite');
  const store = tx.objectStore('challenges');
  const req = store.get(numericChallengeId);

  req.onsuccess = () => {
    const c = req.result;
    if (c && c.status === 'Active') {
      c.completed_task_count = (c.completed_task_count || 0) + 1;
      store.put(c);
    }
  };

  tx.oncomplete = () => {
    if (typeof renderDashboardLiveChallenges === 'function') renderDashboardLiveChallenges();
  };
}

// Fallback: Local Same-Origin BroadcastChannel Bus
function initTaskitatorBroadcastBus() {
  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(TASKITATOR_STORAGE_CHANNEL);
    broadcastChannel.onmessage = async (event) => {
      if (!currentUser || !currentUser.is_taskitator_linked) return;
      const { type, payload } = event.data || {};

      if (type === 'TASK_COMPLETED' && payload) {
        await ingestLedgerEvent(payload);
        await refreshDashboardUI();
        if (typeof renderActivityFeed === 'function') renderActivityFeed();
      }
    };
  }
}

// Global window exposure
window.pullTaskitatorAuditLedger = pullTaskitatorAuditLedger;
window.ingestLedgerEvent = ingestLedgerEvent;

document.addEventListener('DOMContentLoaded', () => {
  initTaskitatorBroadcastBus();
});
