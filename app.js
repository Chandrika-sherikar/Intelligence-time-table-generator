const API = '/api';
let DATASET = null;
let META = null;
let RUNS = [];
let CURRENT_RUN = null;
let TOKEN = localStorage.getItem('p0_token') || null;
let CURRENT_USER = null;

const ROLE_LABELS = { admin: 'Administrator', hod: 'Head of Department', faculty: 'Faculty' };
const CAN_EDIT_SETUP = () => CURRENT_USER?.role === 'admin';
const CAN_GENERATE = () => ['admin', 'hod'].includes(CURRENT_USER?.role);
const CAN_PUBLISH = () => CURRENT_USER?.role === 'admin';

// ---------- auth: login/logout ----------
const loginScreen = document.getElementById('login-screen');
const appShell = document.getElementById('app-shell');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

document.querySelectorAll('.demo-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    loginForm.username.value = chip.dataset.user;
    loginForm.password.value = chip.dataset.pass;
    loginForm.requestSubmit();
  });
});

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const { username, password } = Object.fromEntries(new FormData(loginForm).entries());
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Login failed.');
    TOKEN = body.token;
    CURRENT_USER = body.user;
    localStorage.setItem('p0_token', TOKEN);
    enterApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  TOKEN = null;
  CURRENT_USER = null;
  localStorage.removeItem('p0_token');
  appShell.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  loginForm.reset();
});

function applyRoleUI() {
  document.getElementById('user-name').textContent = CURRENT_USER.name;
  document.getElementById('user-role').textContent = ROLE_LABELS[CURRENT_USER.role] || CURRENT_USER.role;

  document.getElementById('reset-btn').classList.toggle('hidden', CURRENT_USER.role !== 'admin');

  // Setup tab: only Admin can add/remove. Hide the forms and delete buttons for everyone else.
  document.querySelectorAll('.inline-form').forEach(f => f.classList.toggle('hidden', !CAN_EDIT_SETUP()));

  // Generate tab
  document.getElementById('generate-btn').classList.toggle('hidden', !CAN_GENERATE());
  document.getElementById('generate-btn').nextElementSibling.textContent = CAN_GENERATE()
    ? ''
    : 'Only Admin or HOD can run generation. You can still view results in the Timetable tab.';

  // Publish button
  publishBtn.classList.toggle('hidden', !CAN_PUBLISH());
}

async function tryResumeSession() {
  if (!TOKEN) return showLogin();
  try {
    const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error('expired');
    const body = await res.json();
    CURRENT_USER = body.user;
    enterApp();
  } catch {
    TOKEN = null;
    localStorage.removeItem('p0_token');
    showLogin();
  }
}

function showLogin() {
  appShell.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

function enterApp() {
  loginScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  applyRoleUI();
  loadDataset();
}

// ---------- tab switching ----------
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'generate') loadRuns();
    if (btn.dataset.tab === 'view') loadRuns().then(populateViewTab);
  });
});

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
    },
    ...opts
  });
  if (res.status === 401) {
    // Session expired or missing — bounce back to login.
    TOKEN = null;
    localStorage.removeItem('p0_token');
    showLogin();
    throw new Error('Session expired. Please sign in again.');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.status === 204 ? null : res.json();
}

// ---------- setup: load + render ----------
async function loadDataset() {
  DATASET = await api('/dataset');
  META = await api('/meta');
  renderTable('rooms', ['name', 'type', 'capacity']);
  renderTable('faculty', ['name', 'dept', 'maxWeeklyLoad']);
  renderTable('subjects', ['name', 'dept', 'weeklyHours', 'roomType']);
  renderTable('sections', ['name', 'division', 'strength']);
  renderAssignmentsTable();
  populateAssignmentSelects();
}

function nameOf(collection, id) {
  const item = DATASET[collection]?.find(x => x.id === id);
  return item ? item.name : '—';
}

function renderTable(collection, fields) {
  const table = document.getElementById(`table-${collection}`);
  const items = DATASET[collection];
  const canEdit = CAN_EDIT_SETUP();
  document.getElementById(`count-${collection}`).textContent = items.length;
  let html = `<tr>${fields.map(f => `<th>${labelize(f)}</th>`).join('')}<th></th></tr>`;
  if (items.length === 0) {
    html += `<tr class="empty-row"><td colspan="${fields.length + 1}">Nothing added yet.</td></tr>`;
  } else {
    items.forEach(item => {
      const delCell = canEdit ? `<button class="del-btn" data-collection="${collection}" data-id="${item.id}">Remove</button>` : '';
      html += `<tr>${fields.map(f => `<td>${item[f]}</td>`).join('')}<td>${delCell}</td></tr>`;
    });
  }
  table.innerHTML = html;
  table.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/${btn.dataset.collection}/${btn.dataset.id}`, { method: 'DELETE' });
      await loadDataset();
    });
  });
}

function renderAssignmentsTable() {
  const table = document.getElementById('table-assignments');
  const items = DATASET.assignments;
  const canEdit = CAN_EDIT_SETUP();
  document.getElementById('count-assignments').textContent = items.length;
  let html = `<tr><th>Subject</th><th>Faculty</th><th>Section</th><th></th></tr>`;
  if (items.length === 0) {
    html += `<tr class="empty-row"><td colspan="4">Nothing added yet.</td></tr>`;
  } else {
    items.forEach(a => {
      const delCell = canEdit ? `<button class="del-btn" data-collection="assignments" data-id="${a.id}">Remove</button>` : '';
      html += `<tr><td>${nameOf('subjects', a.subjectId)}</td><td>${nameOf('faculty', a.facultyId)}</td><td>${nameOf('sections', a.sectionId)}</td><td>${delCell}</td></tr>`;
    });
  }
  table.innerHTML = html;
  table.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/assignments/${btn.dataset.id}`, { method: 'DELETE' });
      await loadDataset();
    });
  });
}

function populateAssignmentSelects() {
  const subjSel = document.getElementById('select-subject');
  const facSel = document.getElementById('select-faculty');
  const secSel = document.getElementById('select-section');
  subjSel.innerHTML = DATASET.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  facSel.innerHTML = DATASET.faculty.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
  secSel.innerHTML = DATASET.sections.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function labelize(field) {
  const map = { weeklyHours: 'Hrs/wk', maxWeeklyLoad: 'Max hrs', roomType: 'Room type' };
  return map[field] || field[0].toUpperCase() + field.slice(1);
}

// ---------- setup: forms ----------
function bindForm(id, collection, transform) {
  document.getElementById(id).addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    await api(`/${collection}`, { method: 'POST', body: JSON.stringify(transform ? transform(data) : data) });
    e.target.reset();
    await loadDataset();
  });
}

bindForm('form-rooms', 'rooms', d => ({ ...d, capacity: Number(d.capacity) }));
bindForm('form-faculty', 'faculty', d => ({ ...d, maxWeeklyLoad: Number(d.maxWeeklyLoad) }));
bindForm('form-subjects', 'subjects', d => ({ ...d, weeklyHours: Number(d.weeklyHours) }));
bindForm('form-sections', 'sections', d => ({ ...d, strength: Number(d.strength) }));
bindForm('form-assignments', 'assignments');

document.getElementById('reset-btn').addEventListener('click', async () => {
  if (!confirm('Reset all setup data and generated timetables back to the seed demo?')) return;
  await api('/reset', { method: 'POST' });
  await loadDataset();
  RUNS = []; CURRENT_RUN = null;
  document.getElementById('conflict-panel').classList.add('hidden');
  document.getElementById('generate-status').textContent = '';
});

// ---------- generate ----------
document.getElementById('generate-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('generate-status');
  statusEl.textContent = 'Solving…';
  const run = await api('/timetables/generate', { method: 'POST' });
  await loadDataset(); // room/faculty counts unaffected but keep in sync
  await loadRuns();
  CURRENT_RUN = run;
  if (run.conflicts.length === 0) {
    statusEl.textContent = `Done — all ${run.slots.length} sessions placed with zero conflicts.`;
    document.getElementById('conflict-panel').classList.add('hidden');
  } else {
    statusEl.textContent = `Done — ${run.slots.length} sessions placed, ${run.conflicts.length} could not be scheduled.`;
    showConflicts(run.conflicts);
  }
});

function showConflicts(conflicts) {
  const panel = document.getElementById('conflict-panel');
  const list = document.getElementById('conflict-list');
  list.innerHTML = conflicts.map(c => `
    <li>
      <b>${c.subjectName}</b> for <b>${c.sectionName}</b> with ${c.facultyName} — occurrence ${c.occurrence}
      <span class="reason">${c.reason}</span>
    </li>
  `).join('');
  panel.classList.remove('hidden');
}

async function loadRuns() {
  RUNS = await api('/timetables');
  const table = document.getElementById('table-runs');
  if (RUNS.length === 0) {
    table.innerHTML = `<tr class="empty-row"><td>No generations run yet.</td></tr>`;
  } else {
    table.innerHTML = `<tr><th>Version</th><th>Status</th><th>Sessions placed</th><th>Conflicts</th><th>Created</th></tr>` +
      RUNS.slice().reverse().map(r => `
        <tr>
          <td>v${r.version}</td>
          <td>${r.status}</td>
          <td>${r.slotCount}</td>
          <td>${r.conflictCount}</td>
          <td>${new Date(r.createdAt).toLocaleString()}</td>
        </tr>
      `).join('');
  }
  return RUNS;
}

// ---------- view tab ----------
const runSelect = document.getElementById('run-select');
const viewBy = document.getElementById('view-by');
const viewTarget = document.getElementById('view-target');
const publishBtn = document.getElementById('publish-btn');
const publishStatus = document.getElementById('publish-status');

async function populateViewTab() {
  if (RUNS.length === 0) {
    document.getElementById('timetable-grid').innerHTML = '';
    runSelect.innerHTML = '<option>No runs yet</option>';
    return;
  }
  runSelect.innerHTML = RUNS.slice().reverse().map(r => `<option value="${r.id}">v${r.version} — ${r.status} (${r.conflictCount} conflicts)</option>`).join('');
  await refreshViewTargets();
  await renderGrid();
}

function refreshViewTargets() {
  const by = viewBy.value;
  const map = { section: DATASET.sections, faculty: DATASET.faculty, room: DATASET.rooms };
  viewTarget.innerHTML = map[by].map(x => `<option value="${x.id}">${x.name}</option>`).join('');
}

async function renderGrid() {
  if (!runSelect.value) return;
  const tt = await api(`/timetables/${runSelect.value}`);
  CURRENT_RUN = tt;
  publishStatus.textContent = tt.status;
  publishStatus.className = `status-tag ${tt.status === 'published' ? 'published' : 'draft'}`;

  const by = viewBy.value;
  const targetId = viewTarget.value;
  const keyField = by === 'section' ? 'sectionId' : by === 'faculty' ? 'facultyId' : 'roomId';

  const grid = document.getElementById('timetable-grid');
  let html = `<thead><tr><th>Period</th>${META.days.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>`;
  META.periods.forEach(p => {
    html += `<tr><th>P${p.period}<br>${p.start}</th>`;
    META.days.forEach(day => {
      const slot = tt.slots.find(s => s.day === day && s.period === p.period && s[keyField] === targetId);
      if (slot) {
        const subject = DATASET.subjects.find(s => s.id === slot.subjectId)?.name || '?';
        const fac = DATASET.faculty.find(f => f.id === slot.facultyId)?.name || '?';
        const room = DATASET.rooms.find(r => r.id === slot.roomId)?.name || '?';
        const section = DATASET.sections.find(sec => sec.id === slot.sectionId)?.name || '?';
        const metaLine = by === 'section' ? `${fac} · ${room}` : by === 'faculty' ? `${section} · ${room}` : `${section} · ${fac}`;
        html += `<td class="slot-cell"><span class="slot-subject">${subject}</span><span class="slot-meta">${metaLine}</span></td>`;
      } else {
        html += `<td class="slot-cell slot-empty">—</td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody>`;
  grid.innerHTML = html;
}

runSelect.addEventListener('change', renderGrid);
viewBy.addEventListener('change', async () => { refreshViewTargets(); await renderGrid(); });
viewTarget.addEventListener('change', renderGrid);

publishBtn.addEventListener('click', async () => {
  if (!runSelect.value) return;
  await api(`/timetables/${runSelect.value}/publish`, { method: 'POST' });
  await loadRuns();
  await renderGrid();
});

// ---------- init ----------
tryResumeSession();
