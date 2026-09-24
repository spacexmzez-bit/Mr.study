// js/auth.js

const MASTER_ADMIN_USERNAME = 'mazen ali';
// Pre-computed SHA-256 hash for 'Mzon1974125$'
const MASTER_ADMIN_HASH = '78dc65b53e70d4d8ef5ba8ddb16bcebbca7eeb78c89b275bfba5e902b4f9dfc2';

let currentUser = null;

// SHA-256 cryptographic hashing using Web Crypto API
async function hashPassword(plainText) {
  const msgUint8 = new TextEncoder().encode(plainText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Self-healing seed: Inserts or updates the master admin account automatically
async function initMasterAdminAndDefaults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['users', 'rule_labels'], 'readwrite');
    const userStore = tx.objectStore('users');
    const usernameIndex = userStore.index('username');
    const checkReq = usernameIndex.get(MASTER_ADMIN_USERNAME);

    checkReq.onsuccess = () => {
      let masterUser = checkReq.result;

      if (!masterUser) {
        const newUser = {
          username: MASTER_ADMIN_USERNAME,
          password_hash: MASTER_ADMIN_HASH,
          role: 'admin',
          streak_count: 0,
          last_activity_date: null,
          streak_done: false,
          streak_freeze_active: false,
          banch_balance: 0,
          total_xp: 0,
          withdrawal_penalty_pct: 10,
          is_taskitator_linked: false,
          lang_pref: 'en',
          created_at: new Date().toISOString()
        };
        const addReq = userStore.add(newUser);
        addReq.onsuccess = (e) => {
          const newUserId = e.target.result;
          const labelStore = tx.objectStore('rule_labels');
          labelStore.add({
            user_id: newUserId,
            name: 'General',
            is_default: true,
            created_at: new Date().toISOString()
          });
        };
      } else {
        // Guarantee password hash is always synchronized with MASTER_ADMIN_HASH
        if (masterUser.password_hash !== MASTER_ADMIN_HASH || masterUser.role !== 'admin') {
          masterUser.password_hash = MASTER_ADMIN_HASH;
          masterUser.role = 'admin';
          userStore.put(masterUser);
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Ensure default "General" label exists for user
async function ensureDefaultRuleLabel(userId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rule_labels', 'readwrite');
    const store = tx.objectStore('rule_labels');
    const index = store.index('user_id');
    const req = index.getAll(userId);

    req.onsuccess = () => {
      const labels = req.result || [];
      const hasGeneral = labels.some(l => l.name.toLowerCase() === 'general');
      if (!hasGeneral) {
        store.add({
          user_id: userId,
          name: 'General',
          is_default: true,
          created_at: new Date().toISOString()
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// Login verification
async function authenticateUser(username, plainPassword) {
  const db = await openDB();
  const hashedPassword = await hashPassword(plainPassword.trim());

  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readonly');
    const store = tx.objectStore('users');
    const index = store.index('username');
    const req = index.get(username.trim().toLowerCase());

    req.onsuccess = () => {
      let user = req.result;
      
      // Fallback: check exact or case-insensitive match
      if (!user) {
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const matched = (allReq.result || []).find(
            u => u.username.toLowerCase() === username.trim().toLowerCase()
          );
          if (matched && matched.password_hash === hashedPassword) {
            resolve(matched);
          } else {
            resolve(null);
          }
        };
        return;
      }

      if (user && user.password_hash === hashedPassword) {
        resolve(user);
      } else {
        resolve(null);
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function setSessionUser(user) {
  currentUser = user;
  sessionStorage.setItem('mrstudy_session_uid', user.id);
  updateAuthUI();
}

function getSessionUserId() {
  const uid = sessionStorage.getItem('mrstudy_session_uid');
  return uid ? parseInt(uid, 10) : null;
}

async function restoreSession() {
  const uid = getSessionUserId();
  if (!uid) {
    currentUser = null;
    updateAuthUI();
    return null;
  }

  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('users', 'readonly');
    const store = tx.objectStore('users');
    const req = store.get(uid);

    req.onsuccess = () => {
      currentUser = req.result || null;
      if (!currentUser) {
        sessionStorage.removeItem('mrstudy_session_uid');
      }
      updateAuthUI();
      resolve(currentUser);
    };
    req.onerror = () => {
      currentUser = null;
      sessionStorage.removeItem('mrstudy_session_uid');
      updateAuthUI();
      resolve(null);
    };
  });
}

function logoutUser() {
  currentUser = null;
  sessionStorage.removeItem('mrstudy_session_uid');
  updateAuthUI();
  showToast("Logged out successfully.", "info");
}

function updateAuthUI() {
  const viewAuth = document.getElementById('view-auth');
  const bottomNav = document.getElementById('bottom-nav');
  const headerBadge = document.getElementById('header-user-badge');
  const btnAdminNav = document.getElementById('btn-admin-nav');

  if (!currentUser) {
    document.querySelectorAll('.view-panel').forEach(el => el.classList.add('d-none'));
    if (viewAuth) viewAuth.classList.remove('d-none');
    if (bottomNav) bottomNav.classList.add('d-none');
    if (headerBadge) headerBadge.classList.add('d-none');
    if (btnAdminNav) btnAdminNav.classList.add('d-none');
  } else {
    if (viewAuth) viewAuth.classList.add('d-none');
    if (bottomNav) bottomNav.classList.remove('d-none');
    if (headerBadge) {
      headerBadge.textContent = currentUser.username;
      headerBadge.classList.remove('d-none');
    }
    if (btnAdminNav) {
      if (currentUser.role === 'admin') {
        btnAdminNav.classList.remove('d-none');
      } else {
        btnAdminNav.classList.add('d-none');
      }
    }
    switchView('view-dashboard');
  }
}

function showToast(message, type = 'info') {
  const toastEl = document.getElementById('app-toast');
  const toastBody = document.getElementById('toast-body');
  if (!toastEl || !toastBody) return;

  toastBody.textContent = message;
  toastEl.className = 'toast align-items-center text-white bg-slate';

  if (type === 'success') {
    toastEl.classList.add('border-cyan');
  } else if (type === 'danger') {
    toastEl.classList.add('border-danger');
  } else if (type === 'warning') {
    toastEl.classList.add('border-warning');
  } else {
    toastEl.classList.add('border-slate');
  }

  const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
  toast.show();
}

function switchView(targetViewId) {
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.add('d-none');
  });

  const targetPanel = document.getElementById(targetViewId);
  if (targetPanel) {
    targetPanel.classList.remove('d-none');
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-target') === targetViewId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'instant' });
}

// App Bootstrap
document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await initMasterAdminAndDefaults();
  await restoreSession();

  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');

      const user = await authenticateUser(usernameInput.value, passwordInput.value);
      if (user) {
        await ensureDefaultRuleLabel(user.id);
        setSessionUser(user);
        formLogin.reset();
        showToast(`Welcome, ${user.username}!`, 'success');
        if (typeof refreshDashboardUI === 'function') {
          await refreshDashboardUI();
        }
      } else {
        showToast('Invalid credentials. Please verify or register via Taskitator.', 'danger');
      }
    });
  }

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      logoutUser();
    });
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target) {
        switchView(target);
      }
    });
  });

  const btnAdminNav = document.getElementById('btn-admin-nav');
  if (btnAdminNav) {
    btnAdminNav.addEventListener('click', () => {
      switchView('view-admin');
      if (typeof renderAdminUsersList === 'function') {
        renderAdminUsersList('');
      }
    });
  }

  const btnBackAdmin = document.getElementById('btn-back-to-dash-from-admin');
  if (btnBackAdmin) {
    btnBackAdmin.addEventListener('click', () => {
      switchView('view-dashboard');
    });
  }
});
