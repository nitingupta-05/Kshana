const SECRET = sessionStorage.getItem('adminSecret');
let API = window.BackendConfig ? window.BackendConfig.defaultApi : (sessionStorage.getItem('apiBase') || '');

if (!SECRET) window.location.href = 'index.html';

const headers = { 'Content-Type': 'application/json', 'x-admin-secret': SECRET };

let allUsers = [];
let broadcastHistory = [];
const pwVisible = {};

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));

    item.classList.add('active');

    const page = item.dataset.page;
    document.getElementById(`page-${page}`).classList.add('active');

    if (page === 'users') renderUsersTable();
    if (page === 'history') renderHistory();
  });
});

function mergeHeaders(extraHeaders) {
  return { ...headers, ...(extraHeaders || {}) };
}

function persistApi(base) {
  API = base;

  if (window.BackendConfig) {
    window.BackendConfig.persistApiBase(base);
  } else if (base) {
    sessionStorage.setItem('apiBase', base);
  }
}

function showOverviewError(message) {
  const safeMessage = escHtml(message || 'Cannot connect to backend');

  document.getElementById('statsGrid').innerHTML = `<div class="loading">${safeMessage}</div>`;
  document.getElementById('recentUsers').innerHTML = `<div class="loading">${safeMessage}</div>`;
  document.getElementById('recentCount').textContent = '';
  document.getElementById('recipientCount').textContent = '0';
}

async function apiFetch(path, opts = {}) {
  const backend = window.BackendConfig;
  const candidates = backend ? backend.getApiCandidates(API) : [API].filter(Boolean);
  const options = { ...opts, headers: mergeHeaders(opts.headers) };

  let lastResult = null;

  for (const candidate of candidates) {
    const result = backend
      ? await backend.fetchJson(candidate, path, options)
      : await fetchFallback(candidate, path, options);

    lastResult = result;

    if (result.ok) {
      persistApi(result.base);
      return result.data;
    }

    if (result.status === 401) {
      logout();
      return null;
    }

    if (result.status === 404) {
      continue;
    }

    if (result.status > 0) {
      persistApi(result.base);
      return result.data;
    }
  }

  console.error(`Backend request failed for ${path}`, lastResult);
  return { msg: 'Cannot connect to backend' };
}

async function fetchFallback(base, path, options) {
  try {
    const res = await fetch(`${base}${path}`, options);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data, base };
  } catch (error) {
    return { ok: false, status: 0, data: null, error, base };
  }
}

async function loadOverview() {
  const [stats, usersData] = await Promise.all([
    apiFetch('/admin/stats'),
    apiFetch('/admin/users'),
  ]);

  if (!stats || !usersData) return;

  if (stats.msg || usersData.msg) {
    showOverviewError(stats.msg || usersData.msg);
    return;
  }

  allUsers = usersData.users || [];
  document.getElementById('recipientCount').textContent = allUsers.length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon purple">US</div>
      <div><div class="stat-val">${stats.totalUsers ?? 0}</div><div class="stat-label">Total Users</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">NW</div>
      <div><div class="stat-val">${stats.newToday ?? 0}</div><div class="stat-label">Joined Today</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon cyan">MS</div>
      <div><div class="stat-val">${stats.totalMessages ?? 0}</div><div class="stat-label">Messages Sent</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange">CV</div>
      <div><div class="stat-val">${stats.totalConversations ?? 0}</div><div class="stat-label">Conversations</div></div>
    </div>
  `;

  const recent = allUsers.slice(0, 5);
  document.getElementById('recentCount').textContent = `Showing ${recent.length} of ${allUsers.length}`;
  document.getElementById('recentUsers').innerHTML = buildUsersTable(recent, false);
}

function renderUsersTable() {
  if (!allUsers.length) {
    apiFetch('/admin/users').then((data) => {
      if (data?.msg) {
        document.getElementById('usersTable').innerHTML = `<div class="loading">${escHtml(data.msg)}</div>`;
        return;
      }

      allUsers = data?.users || [];
      document.getElementById('userCount').textContent = `(${allUsers.length})`;
      document.getElementById('usersTable').innerHTML = buildUsersTable(allUsers, true);
    });

    return;
  }

  document.getElementById('userCount').textContent = `(${allUsers.length})`;
  document.getElementById('usersTable').innerHTML = buildUsersTable(allUsers, true);
}

function buildUsersTable(users, showDelete) {
  if (!users.length) return '<div class="loading">No users found</div>';

  return `
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Email</th>
          <th>Password</th>
          <th>Joined</th>
          ${showDelete ? '<th>Action</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${users.map((user) => `
          <tr>
            <td>
              <div class="avatar-cell">
                <div class="avatar-circle">
                  ${user.profileImage
                    ? `<img src="${user.profileImage}" alt="${escHtml((user.name || 'U')[0])}" />`
                    : escHtml((user.name || 'U')[0].toUpperCase())}
                </div>
                <div>
                  <div style="font-weight:600">${escHtml(user.name)}</div>
                  <div style="font-size:12px;color:var(--subtext)">${user.description ? escHtml(user.description.slice(0, 30)) : '-'}</div>
                </div>
              </div>
            </td>
            <td style="color:var(--subtext)">${escHtml(user.email)}</td>
            <td>
              <div class="pw-cell">
                <span class="pw-text" id="pw-${user._id}">........</span>
                <button class="eye-btn" onclick="togglePw('${user._id}','${escHtml(user.password)}')" title="Show or hide">View</button>
              </div>
            </td>
            <td style="color:var(--subtext);font-size:13px">${formatDate(user.createdAt)}</td>
            ${showDelete ? `<td><button class="icon-btn" onclick="deleteUser('${user._id}','${escHtml(user.name)}')" title="Delete">Delete</button></td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function filterUsers() {
  const query = document.getElementById('userSearch').value.toLowerCase();
  const filtered = allUsers.filter((user) =>
    user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query)
  );

  document.getElementById('userCount').textContent = `(${filtered.length}/${allUsers.length})`;
  document.getElementById('usersTable').innerHTML = buildUsersTable(filtered, true);
}

function togglePw(id, password) {
  const el = document.getElementById(`pw-${id}`);
  if (!el) return;

  pwVisible[id] = !pwVisible[id];
  el.textContent = pwVisible[id] ? password : '........';
}

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;

  const data = await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
  if (data?.ok) {
    allUsers = allUsers.filter((user) => user._id !== id);
    renderUsersTable();
    return;
  }

  alert(data?.msg || 'Delete failed');
}

const templates = {
  update: {
    title: 'New update available',
    message: 'We have released a new update with performance improvements and bug fixes.',
  },
  feature: {
    title: 'New feature launched',
    message: 'A new feature is now live in Kshana. Open the app to explore what changed.',
  },
  event: {
    title: 'Special event',
    message: 'Join us for a special event on Kshana. More details are coming soon.',
  },
  maintenance: {
    title: 'Scheduled maintenance',
    message: 'Kshana will undergo scheduled maintenance. Service may be briefly unavailable.',
  },
  welcome: {
    title: 'Welcome to Kshana',
    message: 'Thank you for joining Kshana. Connect with people and enjoy seamless messaging.',
  },
};

function useTemplate(key) {
  const template = templates[key];
  document.getElementById('bcTitle').value = template.title;
  document.getElementById('bcMessage').value = template.message;
  updateCharCount();
}

function updateCharCount() {
  document.getElementById('titleCount').textContent = document.getElementById('bcTitle').value.length;
  document.getElementById('msgCount').textContent = document.getElementById('bcMessage').value.length;
}

async function sendBroadcast() {
  const title = document.getElementById('bcTitle').value.trim();
  const message = document.getElementById('bcMessage').value.trim();
  const err = document.getElementById('bcError');
  const toast = document.getElementById('successToast');

  err.textContent = '';
  toast.style.display = 'none';

  if (!title || !message) {
    err.textContent = 'Title and message are required.';
    return;
  }

  const data = await apiFetch('/admin/broadcast', {
    method: 'POST',
    body: JSON.stringify({ title, message }),
  });

  if (data?.ok) {
    toast.textContent = `Broadcast sent to ${data.sent} users`;
    toast.style.display = 'block';
    document.getElementById('bcTitle').value = '';
    document.getElementById('bcMessage').value = '';
    updateCharCount();

    broadcastHistory.unshift({ title, message, sent: data.sent, time: new Date().toISOString() });
    localStorage.setItem('bcHistory', JSON.stringify(broadcastHistory));

    setTimeout(() => {
      toast.style.display = 'none';
    }, 4000);

    return;
  }

  err.textContent = data?.msg || 'Failed to send';
}

function renderHistory() {
  const saved = localStorage.getItem('bcHistory');
  broadcastHistory = saved ? JSON.parse(saved) : [];

  const el = document.getElementById('historyList');
  if (!broadcastHistory.length) {
    el.innerHTML = '<div class="loading">No broadcasts sent yet.</div>';
    return;
  }

  el.innerHTML = `<div class="history-list">${broadcastHistory.map((broadcast) => `
    <div class="history-item">
      <div class="history-icon">BC</div>
      <div style="flex:1">
        <div class="history-title">${escHtml(broadcast.title)}</div>
        <div class="history-msg">${escHtml(broadcast.message)}</div>
        <div class="history-meta">Sent to ${broadcast.sent} users | ${formatDate(broadcast.time)}</div>
      </div>
    </div>
  `).join('')}</div>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '-';

  const date = new Date(iso);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function logout() {
  sessionStorage.removeItem('adminSecret');
  window.location.href = 'index.html';
}

loadOverview();
