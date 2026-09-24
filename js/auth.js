// js/auth.js

const SYNC_WORKER_URL = 'https://taskitator-sync.spacexmzez.workers.dev';
const MASTER_ADMIN_USERNAME = 'mazen ali';
const MASTER_ADMIN_HASH = '78dc65b53e70d4d8ef5ba8ddb16bcebbca7eeb78c89b275bfba5e902b4f9dfc2';

let currentUser = null;

// SHA-256 cryptographic passkey derivation
async function hashPassword(plainText) {
  const msgUint8 = new TextEncoder().encode(plainText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Derive a unified user storage key / bearer token
async function deriveSyncKey(username, plainPassword) {
  const rawCombo = `${username.trim().toLowerCase()}:${plainPassword.trim()}`;
  return await hashPassword(rawCombo);
}

// Guarantee default "General" label exists with numeric user_id
async function ensureDefaultRuleLabel(userId) {
  const numericId = Number(userId);
  if (!numericId) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rule_labels', 'readwrite');
    const store = tx.objectStore('rule_labels');
    const index = store.index('user_id');
    const req = index.getAll(numericId);

    req.onsuccess = () => {
      const labels = req.result || [];
      const hasGeneral = labels.some(l => l.name && l.name.toLowerCase() === 'general');
      if (!hasGeneral) {
        store.add({
          user_id: numericId,
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

// Seed local Master Admin record with guaranteed integer primary key
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
          is_taskitator_linked: true,
          lang_pref: 'en',
          created_at: new Date().toISOString()
        };
        const addReq = userStore.add(newUser);
        addReq.onsuccess = (e) => {
          const newUserId = Number(e.target.result);
          const labelStore = tx.objectStore('rule_labels');
          labelStore.add({
            user_id: newUserId,
            name: 'General',
            is_default: true,
            created_at: new Date().toISOString()
          });
        };
      } else {
        masterUser.id = Number(masterUser.id);
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

// Authenticate via local IndexedDB or fetch snapshot directly from Cloudflare Worker
async function authenticateUser(username, plainPassword) {
  const cleanUsername = username.trim();
  const passwordHash = await hashPassword(plainPassword.trim());
  const syncBearerKey = await deriveSyncKey(cleanUsername, plainPassword);

  const db = await openDB();

  // 1. Check local IndexedDB first
  const localUser = await new Promise((resolve) => {
    const tx = db.transaction('users', 'readonly');
    const store = tx.objectStore('users');
    const req = store.getAll();

    req.onsuccess = () => {
      const match = (req.result || []).find(
        u => u.username.toLowerCase() === cleanUsername.toLowerCase() && u.password_hash === passwordHash
      );
      if (match) {
        match.id = Number(match.id);
      }
      resolve(match || null);
    };
    req.onerror = () => resolve(null);
  });

  if (localUser) {
    sessionStorage.setItem('mrstudy_sync_key', syncBearerKey);
    return localUser;
  }

  // 2. Query Cloudflare Worker KV if local record was not found
  try {
    const resp = await fetch(`${SYNC_WORKER_URL}/sync`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncBearerKey}`,
        'X-User-Name': cleanUsername
      }
    });

    if (resp.ok) {
      const cloudData = await resp.json();
      if (cloudData && cloudData.user) {
        const savedUser = await saveCloudUserLocally(cloudData.user, passwordHash);
        sessionStorage.setItem('mrstudy_sync_key', syncBearerKey);
        
        if (cloudData.rules || cloudData.inventory) {
          await restoreCloudStateToLocalDB(savedUser.id, cloudData);
        }
        return savedUser;
      }
    }
  } catch (err) {
    console.warn('Worker sync request failed during auth:', err);
  }

  // 3. Auto-provision new account if matching Taskitator credentials
  return await autoProvisionAccount(cleanUsername, passwordHash, syncBearerKey);
}

// Provision account locally and register sync token
async function autoProvisionAccount(username, passwordHash, syncBearerKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['users', 'rule_labels'], 'readwrite');
    const userStore = tx.objectStore('users');

    const isMaster = (username.toLowerCase() === MASTER_ADMIN_USERNAME.toLowerCase() && passwordHash === MASTER_ADMIN_HASH);

    const newUser = {
      username: username,
      password_hash: passwordHash,
      role: isMaster ? 'admin' : 'user',
      streak_count: 0,
      last_activity_date: null,
      streak_done: false,
      streak_freeze_active: false,
      banch_balance: 0,
      total_xp: 0,
      withdrawal_penalty_pct: 10,
      is_taskitator_linked: true,
      lang_pref: 'en',
      created_at: new Date().toISOString()
    };

    const addReq = userStore.add(newUser);
    addReq.onsuccess = (e) => {
      const uid = Number(e.target.result);
      newUser.id = uid;

      const labelStore = tx.objectStore('rule_labels');
      labelStore.add({
        user_id: uid,
        name: 'General',
        is_default: true,
        created_at: new Date().toISOString()
      });

      sessionStorage.setItem('mrstudy_sync_key', syncBearerKey);
    };

    tx.oncomplete = () => resolve(newUser);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function saveCloudUserLocally(userObj, passwordHash) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    const store = tx.objectStore('users');

    const record = {
      ...userObj,
      password_hash: passwordHash,
      is_taskitator_linked: true
    };
    delete record.id; // Allow IndexedDB autoIncrement to assign local id

    const req = store.add(record);
    req.onsuccess = (e) => {
      record.id = Number(e.target.result);
      resolve(record);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function setSessionUser(user) {
  if (!user || !user.id) return;
  user.id = Number(user.id);
  currentUser = user;
  sessionStorage.setItem('mrstudy_session_uid', String(user.id));
  updateAuthUI();
}

function getSessionUserId() {
  const uid = sessionStorage.getItem('mrstudy_session_uid');
  return uid ? Number(uid) : null;
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
      if (currentUser) {
        currentUser.id = Number(currentUser.id);
      } else {
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
  sessionStorage.removeItem('mrstudy_sync_key');
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

  if (targetViewId === 'view-setup' && typeof initSetupView === 'function') {
    initSetupView();
  }
  if (targetViewId === 'view-actions' && typeof renderActionsGrid === 'function') {
    renderActionsGrid();
  }
  if (targetViewId === 'view-dashboard' && typeof refreshDashboardUI === 'function') {
    refreshDashboardUI();
  }

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
      if (user && user.id) {
        await ensureDefaultRuleLabel(user.id);
        setSessionUser(user);
        switchView('view-dashboard');
        formLogin.reset();
        showToast(`Welcome, ${user.username}!`, 'success');
        if (typeof refreshDashboardUI === 'function') {
          await refreshDashboardUI();
        }
        if (typeof triggerCloudSyncPush === 'function') {
          triggerCloudSyncPush();
        }
      } else {
        showToast('Login failed. Please check your credentials.', 'danger');
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
