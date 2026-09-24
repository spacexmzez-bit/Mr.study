// js/bridge.js

const TASKITATOR_SHARED_DB_NAME = 'TaskitatorDB';
const TASKITATOR_STORAGE_CHANNEL = 'mrstudy_taskitator_bus';

let broadcastChannel = null;

// Initialize cross-tab broadcast bus
function initTaskitatorBroadcastBus() {
  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(TASKITATOR_STORAGE_CHANNEL);
    broadcastChannel.onmessage = async (event) => {
      if (!currentUser || !currentUser.is_taskitator_linked) return;
      const { type, payload } = event.data || {};

      if (type === 'TASK_COMPLETED') {
        await handleExternalTaskCompleted(payload);
      } else if (type === 'TASK_DEADLINE_FAILED') {
        await handleExternalDeadlineFailed(payload);
      }
    };
  }
}

// Handle Taskitator completion payload
async function handleExternalTaskCompleted(payload) {
  const { taskId, ruleId, challengeId, pointsValue, aiVerified } = payload;
  if (!aiVerified) return; // Strict audit gate check

  const db = await openDB();
  const tx = db.transaction(['task_bridge', 'rules'], 'readwrite');
  const bridgeStore = tx.objectStore('task_bridge');
  const ruleStore = tx.objectStore('rules');

  const bIndex = bridgeStore.index('taskitator_task_id');
  const bReq = bIndex.get(taskId);

  bReq.onsuccess = async () => {
    let bridgeRecord = bReq.result;

    // Idempotency check: prevent duplicate payouts
    if (bridgeRecord && bridgeRecord.points_awarded) {
      return;
    }

    const rReq = ruleStore.get(ruleId);
    rReq.onsuccess = async () => {
      const rule = rReq.result || {
        id: ruleId,
        name: 'Taskitator Task',
        type: 'add',
        min_points: pointsValue,
        max_points: pointsValue
      };

      // Apply points via central activity engine
      await applyPointTransaction(rule, pointsValue, `Task #${taskId}`);

      // If attached to active challenge, bump challenge counter
      if (challengeId) {
        await incrementChallengeTaskCount(challengeId);
      }

      // Mark idempotency flag
      if (!bridgeRecord) {
        bridgeStore.add({
          user_id: currentUser.id,
          taskitator_task_id: taskId,
          mr_study_rule_id: ruleId,
          challenge_id: challengeId || null,
          points_value: pointsValue,
          points_awarded: true,
          processed_at: new Date().toISOString()
        });
      } else {
        bridgeRecord.points_awarded = true;
        bridgeRecord.processed_at = new Date().toISOString();
        bridgeStore.put(bridgeRecord);
      }
    };
  };
}

// Missed hard-deadline failure penalty from Taskitator
async function handleExternalDeadlineFailed(payload) {
  const { taskId, ruleId, penaltyPoints } = payload;

  const db = await openDB();
  const rule = {
    id: ruleId || 0,
    name: `Missed Deadline (Task #${taskId})`,
    type: 'deduct',
    min_points: penaltyPoints,
    max_points: penaltyPoints
  };

  await applyPointTransaction(rule, penaltyPoints, 'Deadline Penalty');
}

// Auto-increment challenge counter when a linked task completes
async function incrementChallengeTaskCount(challengeId) {
  const db = await openDB();
  const tx = db.transaction('challenges', 'readwrite');
  const store = tx.objectStore('challenges');
  const req = store.get(challengeId);

  req.onsuccess = () => {
    const c = req.result;
    if (c && c.status === 'Active') {
      c.completed_task_count = (c.completed_task_count || 0) + 1;
      store.put(c);
    }
  };

  tx.oncomplete = () => {
    renderChallengesHub();
  };
}

// Create a Taskitator task directly from Mr.Study UI
async function createTaskInTaskitator(title, priority, dueDate, ruleId, pointsValue, challengeId = null) {
  if (!currentUser || !currentUser.is_taskitator_linked) {
    showToast("Taskitator linking is disabled in Setup.", "warning");
    return;
  }

  const payload = {
    userId: currentUser.id,
    title,
    priority,
    dueDate,
    ruleId,
    pointsValue,
    challengeId,
    createdAt: new Date().toISOString()
  };

  // Broadcast to active Taskitator instances
  if (broadcastChannel) {
    broadcastChannel.postMessage({
      type: 'CREATE_TASK_REQUEST',
      payload
    });
  }

  showToast(`Task "${title}" dispatched to Taskitator!`, "success");
}

document.addEventListener('DOMContentLoaded', () => {
  initTaskitatorBroadcastBus();
});
