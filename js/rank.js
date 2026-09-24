// js/rank.js

const RANK_TIERS = [
  { level: 1, title: 'Beginner', minXp: 0 },
  { level: 2, title: 'Apprentice', minXp: 250 },
  { level: 3, title: 'Technician', minXp: 750 },
  { level: 4, title: 'Specialist', minXp: 2000 },
  { level: 5, title: 'Strategist', minXp: 5000 },
  { level: 6, title: 'Veteran', minXp: 12500 },
  { level: 7, title: 'Expert', minXp: 25000 },
  { level: 8, title: 'Virtuoso', minXp: 50000 },
  { level: 9, title: 'Titan', minXp: 100000 },
  { level: 10, title: 'Architect', minXp: 250000 },
  { level: 11, title: 'Ascendant', minXp: 500000 },
  { level: 12, title: 'Apex', minXp: 1000000 },
  { level: 13, title: 'Zenith', minXp: 2000000 }
];

// Calculate current rank and progress toward next tier
function calculateRankProgress(totalXp) {
  let currentRank = RANK_TIERS[0];
  let nextRank = null;

  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (totalXp >= RANK_TIERS[i].minXp) {
      currentRank = RANK_TIERS[i];
      nextRank = RANK_TIERS[i + 1] || null;
    } else {
      break;
    }
  }

  if (!nextRank) {
    // Max level achieved (Zenith)
    return {
      currentRank,
      nextRank: null,
      pointsNeeded: 0,
      percent: 100
    };
  }

  const rangeSpan = nextRank.minXp - currentRank.minXp;
  const progressIntoRank = totalXp - currentRank.minXp;
  const pointsNeeded = nextRank.minXp - totalXp;
  const percent = Math.min(100, Math.max(0, Math.round((progressIntoRank / rangeSpan) * 100)));

  return {
    currentRank,
    nextRank,
    pointsNeeded,
    percent
  };
}

// Render the 13-tier breakdown in the /rank view
function renderRankTiersBreakdown() {
  const container = document.getElementById('rank-tiers-list');
  if (!container || !currentUser) return;

  const currentXp = currentUser.total_xp;

  container.innerHTML = RANK_TIERS.map(tier => {
    const isUnlocked = currentXp >= tier.minXp;
    const isCurrent = calculateRankProgress(currentXp).currentRank.level === tier.level;

    return `
      <div class="card ${isCurrent ? 'bg-slate-dark border-cyan' : 'bg-slate border-slate'} p-2 d-flex flex-row justify-content-between align-items-center">
        <div>
          <span class="badge ${isCurrent ? 'bg-cyan text-slate-darker' : 'bg-slate-dark text-slate-light border border-slate'} me-1">
            Lvl ${tier.level}
          </span>
          <strong class="${isCurrent ? 'text-cyan' : isUnlocked ? 'text-white' : 'text-slate-muted'} small">
            ${escapeHtml(tier.title)}
          </strong>
        </div>
        <div class="small">
          <span class="${isUnlocked ? 'text-slate-light' : 'text-slate-muted'}">${tier.minXp.toLocaleString()} XP</span>
          ${isCurrent ? `<span class="badge bg-cyan text-slate-darker ms-1">Current</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Attach navigation link between Dashboard rank card and Rank view
document.addEventListener('DOMContentLoaded', () => {
  const dashRankCard = document.getElementById('dash-rank-title')?.closest('.card');
  if (dashRankCard) {
    dashRankCard.style.cursor = 'pointer';
    dashRankCard.addEventListener('click', () => {
      switchView('view-rank');
      renderRankTiersBreakdown();
    });
  }

  const btnBackFromRank = document.getElementById('btn-back-to-dash-from-rank');
  if (btnBackFromRank) {
    btnBackFromRank.addEventListener('click', () => {
      switchView('view-dashboard');
    });
  }
});
