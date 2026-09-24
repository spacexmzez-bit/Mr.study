// js/streak.js

// Multiplier mapping across the 4 streak tiers
function getActiveStreakMultiplier(streakCount) {
  if (streakCount >= 90) return 7.0;
  if (streakCount >= 30) return 3.0;
  if (streakCount >= 15) return 2.0;
  if (streakCount >= 7) return 1.5;
  return 1.0;
}

// Get client current date string in YYYY-MM-DD
function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Calculate calendar difference in days between two YYYY-MM-DD dates
function getDateDayDifference(dateStrEarlier, dateStrLater) {
  if (!dateStrEarlier || !dateStrLater) return null;
  const d1 = new Date(dateStrEarlier + 'T00:00:00');
  const d2 = new Date(dateStrLater + 'T00:00:00');
  const diffTime = d2 - d1;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

// Progression logic triggered whenever points are added
function applyDailyStreakOnPointAddition(user) {
  const todayStr = getLocalDateString();
  const lastDate = user.last_activity_date;

  if (!lastDate) {
    user.streak_count = 1;
    user.streak_done = true;
    user.last_activity_date = todayStr;
    return;
  }

  const diffDays = getDateDayDifference(lastDate, todayStr);

  if (diffDays === 0) {
    // Already logged activity today; streak count unchanged
    user.streak_done = true;
  } else if (diffDays === 1) {
    // Yesterday was the last activity; advance streak
    user.streak_count += 1;
    user.streak_done = true;
    user.last_activity_date = todayStr;
  } else {
    // Gap of 2 or more days: check Streak Freeze guardrail
    if (user.streak_freeze_active) {
      // Streak Freeze absorbs missed day gap; carry forward
      user.streak_freeze_active = false;
      user.streak_count += 1;
      user.streak_done = true;
      user.last_activity_date = todayStr;
      showToast("Streak Freeze protected your streak! (+1 Day)", "warning");
    } else {
      // Reset streak back to 1 for new cycle
      user.streak_count = 1;
      user.streak_done = true;
      user.last_activity_date = todayStr;
    }
  }
}

// Midnight evaluation: runs date verification and resets missed streaks
async function evaluateDailyStreakMidnightCheck() {
  if (!currentUser) return;

  const todayStr = getLocalDateString();
  const lastDate = currentUser.last_activity_date;

  if (lastDate) {
    const diffDays = getDateDayDifference(lastDate, todayStr);

    if (diffDays > 1) {
      if (currentUser.streak_freeze_active) {
        currentUser.streak_freeze_active = false;
        showToast("Streak Freeze consumed at midnight check.", "warning");
      } else {
        currentUser.streak_count = 0;
        showToast("Streak reset to 0: daily activity missed.", "danger");
      }
      currentUser.streak_done = false;
    } else if (diffDays === 1 && !currentUser.streak_done) {
      // New day started; reset streak_done flag for today
      currentUser.streak_done = false;
    }
  }

  // Persist checked status
  const db = await openDB();
  const tx = db.transaction('users', 'readwrite');
  tx.objectStore('users').put(currentUser);

  tx.oncomplete = () => {
    refreshDashboardUI();
  };
}

// Attach listener and setup periodic evaluation
document.addEventListener('DOMContentLoaded', () => {
  // Check streak validity immediately on load
  setTimeout(() => {
    evaluateDailyStreakMidnightCheck();
  }, 200);

  // Periodically check every 10 minutes for midnight rollover
  setInterval(() => {
    evaluateDailyStreakMidnightCheck();
  }, 10 * 60 * 1000);
});
