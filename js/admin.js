// js/admin.js

// Pure deterministic substring search across users (strictly zero AI involvement)
async function fetchFilteredUsers(query = '') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readonly');
    const store = tx.objectStore('users');
    const req = store.getAll();

    req.onsuccess = () => {
      let users = req.result || [];
      const cleanQuery = query.trim().toLowerCase();

      if (cleanQuery) {
        users = users.filter(user => user.username.toLowerCase().includes(cleanQuery));
      }

      // Sort alphabetically by username
      users.sort((a, b) => a.username.localeCompare(b.username));
      resolve(users);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// Render the user roster inside the Admin panel
async function renderAdminUsersList(query = '') {
  const listContainer = document.getElementById('admin-users-list');
  if (!listContainer) return;

  if (!currentUser || currentUser.role !== 'admin') {
    listContainer.innerHTML = `<div class="card bg-slate border-slate p-3 text-danger small">Access denied: Admin role required.</div>`;
    return;
  }

  const isMasterAdmin = (currentUser.username === MASTER_ADMIN_USERNAME);
  const users = await fetchFilteredUsers(query);

  if (users.length === 0) {
    listContainer.innerHTML = `<div class="card bg-slate border-slate p-3 text-slate-muted small text-center">No matching accounts found.</div>`;
    return;
  }

  listContainer.innerHTML = users.map(user => {
    const isTargetMaster = (user.username === MASTER_ADMIN_USERNAME);
    const dateFormatted = user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A';

    return `
      <div class="card bg-slate border-slate p-3">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <h6 class="text-white fw-bold mb-0">${escapeHtml(user.username)}</h6>
            <small class="text-slate-muted">Joined: ${dateFormatted} | ID: #${user.id}</small>
          </div>
          <span class="badge ${user.role === 'admin' ? 'bg-cyan text-slate-darker' : 'bg-slate-dark text-slate-light border border-slate'}">
            ${user.role.toUpperCase()}
          </span>
        </div>
        <div class="d-flex justify-content-between align-items-center small text-slate-light mb-3">
          <span>XP: <strong class="text-white">${user.total_xp}</strong></span>
          <span>Banch: <strong class="text-cyan">${user.banch_balance}</strong></span>
          <span>Streak: <strong class="text-warning">${user.streak_count}d</strong></span>
        </div>
        <div class="d-flex gap-2 border-top border-slate pt-2 align-items-center">
          ${isMasterAdmin ? `
            <label class="small text-slate-muted me-1 mb-0">Role:</label>
            <select class="form-select form-select-sm bg-slate-dark text-white border-slate w-auto" 
              onchange="handleRoleChange(${user.id}, this.value)" 
              ${isTargetMaster ? 'disabled' : ''}>
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
            ${!isTargetMaster ? `
              <button class="btn btn-outline-danger btn-sm ms-auto" onclick="handleDeleteUser(${user.id}, '${escapeHtml(user.username)}')">
                <i class="bi bi-trash"></i>
              </button>
            ` : '<span class="small text-slate-muted ms-auto fst-italic">Master Account</span>'}
          ` : `
            <span class="small text-slate-muted fst-italic">Role management restricted to Master Admin.</span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// Master-Admin-only role change handler
async function handleRoleChange(targetUserId, newRole) {
  if (!currentUser || currentUser.username !== MASTER_ADMIN_USERNAME) {
    showToast("Unauthorized: Only the Master Admin can change account roles.", "danger");
    return;
  }

  if (!['user', 'admin'].includes(newRole)) {
    showToast("Invalid role selection.", "warning");
    return;
  }

  const db = await openDB();
  const tx = db.transaction('users', 'readwrite');
  const store = tx.objectStore('users');
  const getReq = store.get(targetUserId);

  getReq.onsuccess = () => {
    const targetUser = getReq.result;
    if (!targetUser) {
      showToast("Target account not found.", "danger");
      return;
    }

    if (targetUser.username === MASTER_ADMIN_USERNAME && newRole !== 'admin') {
      showToast("Cannot demote the Master Admin account.", "danger");
      return;
    }

    targetUser.role = newRole;
    store.put(targetUser);
  };

  tx.oncomplete = () => {
    showToast(`Role updated successfully.`, "success");
    const searchInput = document.getElementById('admin-search-input');
    renderAdminUsersList(searchInput ? searchInput.value : '');
  };

  tx.onerror = (e) => {
    showToast(`Failed to update role: ${e.target.error}`, "danger");
  };
}

// Master-Admin-only user deletion handler
async function handleDeleteUser(targetUserId, targetUsername) {
  if (!currentUser || currentUser.username !== MASTER_ADMIN_USERNAME) {
    showToast("Unauthorized: Only the Master Admin can delete accounts.", "danger");
    return;
  }

  if (targetUsername === MASTER_ADMIN_USERNAME) {
    showToast("Cannot delete the Master Admin account.", "danger");
    return;
  }

  if (!confirm(`Are you sure you want to permanently delete account "${targetUsername}"? This cannot be undone.`)) {
    return;
  }

  const db = await openDB();
  const tx = db.transaction(['users', 'rules', 'rule_labels', 'action_labels', 'activity_logs', 'challenges', 'user_inventory'], 'readwrite');

  // Purge user profile
  tx.objectStore('users').delete(targetUserId);

  // Cascade clean user-specific records
  ['rules', 'rule_labels', 'action_labels', 'activity_logs', 'challenges', 'user_inventory'].forEach(storeName => {
    const store = tx.objectStore(storeName);
    const index = store.index('user_id');
    const req = index.getAllKeys(targetUserId);
    req.onsuccess = () => {
      const keys = req.result;
      keys.forEach(k => store.delete(k));
    };
  });

  tx.oncomplete = () => {
    showToast(`Account "${targetUsername}" deleted.`, "info");
    const searchInput = document.getElementById('admin-search-input');
    renderAdminUsersList(searchInput ? searchInput.value : '');
  };

  tx.onerror = (e) => {
    showToast(`Deletion error: ${e.target.error}`, "danger");
  };
}

// Search bar input listener
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('admin-search-input');
  const searchBtn = document.getElementById('btn-admin-search');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderAdminUsersList(e.target.value);
    });
  }

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      renderAdminUsersList(searchInput.value);
    });
  }
});

// XSS Sanitizer helper
function escapeHtml(string) {
  const str = String(string);
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return m;
    }
  });
}
