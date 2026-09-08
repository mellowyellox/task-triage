const STORAGE_KEY = 'task-triage-v1';
const SETTINGS_KEY = 'task-triage-settings-v1';

const $ = (id) => document.getElementById(id);
const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
const nowISO = () => new Date().toISOString();

let state = { tasks: [] };
let settings = { topN: 5 };
let deferredInstallPrompt = null;

function uid() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.tasks && Array.isArray(saved.tasks)) state = saved;
  } catch (_) {}
  try {
    const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (savedSettings?.topN) settings.topN = clampTopN(savedSettings.topN);
  } catch (_) {}
}

function saveState() {
  state.updatedAt = nowISO();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function clampTopN(value) {
  return Math.max(1, Math.min(20, Number(value) || 5));
}

function parseLocalDate(value) {
  return value ? new Date(value) : null;
}

function ageDays(task, now = new Date()) {
  return Math.max(0, (now - new Date(task.createdAt)) / 86400000);
}

function deadlineHours(task, now = new Date()) {
  if (!task.deadline) return null;
  return (new Date(task.deadline) - now) / 3600000;
}

// Deterministic, explainable ranking. No external AI/API required.
function priorityScore(task, now = new Date()) {
  if (task.completedAt) return -Infinity;
  const hrs = deadlineHours(task, now);
  const importance = Number(task.importance || 3);
  const effort = Number(task.effort || 2);
  const age = ageDays(task, now);

  let deadlineScore = 0;
  if (hrs !== null) {
    if (hrs < 0) deadlineScore = 90 + Math.min(60, Math.abs(hrs) / 6);
    else if (hrs <= 6) deadlineScore = 85;
    else if (hrs <= 24) deadlineScore = 72;
    else if (hrs <= 72) deadlineScore = 55;
    else if (hrs <= 168) deadlineScore = 35;
    else if (hrs <= 336) deadlineScore = 18;
    else deadlineScore = 8;
  }

  const importanceScore = importance * 12;
  const agingScore = Math.min(25, age * 1.25);
  // Small quick wins get a slight boost; large tasks are not unfairly buried.
  const effortAdjustment = (3 - effort) * 2;

  return Math.round((deadlineScore + importanceScore + agingScore + effortAdjustment) * 10) / 10;
}

function priorityLabel(task) {
  if (task.completedAt) return 'Done';
  const hrs = deadlineHours(task);
  if (hrs !== null && hrs < 0) return 'OVERDUE';
  const score = priorityScore(task);
  if (score >= 110) return 'Urgent';
  if (score >= 80) return 'High';
  if (score >= 55) return 'Medium';
  return 'Normal';
}

function fmtDate(value) {
  if (!value) return 'No deadline';
  const d = new Date(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function fmtAge(task) {
  const days = ageDays(task);
  if (days < 1) return `${Math.max(0, Math.floor(days * 24))}h old`;
  return `${Math.floor(days)}d old`;
}

function deadlineText(task) {
  if (!task.deadline) return 'No deadline';
  const hrs = deadlineHours(task);
  if (hrs < 0) {
    const abs = Math.abs(hrs);
    return abs < 24 ? `${Math.ceil(abs)}h overdue` : `${Math.ceil(abs / 24)}d overdue`;
  }
  if (hrs < 24) return `Due in ${Math.max(1, Math.ceil(hrs))}h`;
  return `Due in ${Math.ceil(hrs / 24)}d`;
}

function openTasks() {
  return state.tasks.filter(t => !t.completedAt);
}

function rankedOpen() {
  return openTasks().slice().sort((a, b) => priorityScore(b) - priorityScore(a) || new Date(a.createdAt) - new Date(b.createdAt));
}

function oldestOpen() {
  return openTasks().slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function renderCard(task) {
  const node = clone('taskCardTemplate');
  node.dataset.id = task.id;
  node.querySelector('.task-title').textContent = task.title;
  const badge = node.querySelector('.priority-badge');
  badge.textContent = priorityLabel(task);
  const hrs = deadlineHours(task);
  if (hrs !== null && hrs < 0) badge.classList.add('overdue');
  else if (priorityScore(task) >= 80) badge.classList.add('high');

  const metaBits = [deadlineText(task), fmtAge(task), `Importance ${task.importance}/5`, `Effort ${task.effort}/5`];
  if (task.category) metaBits.push(task.category);
  node.querySelector('.task-meta').textContent = metaBits.join(' · ');
  const notes = node.querySelector('.task-notes');
  notes.textContent = task.notes || '';
  notes.hidden = !task.notes;
  node.querySelector('.complete-btn').addEventListener('click', () => completeTask(task.id));
  node.querySelector('.edit-btn').addEventListener('click', () => openEdit(task.id));
  return node;
}

function renderFocusList(container, tasks) {
  container.innerHTML = '';
  container.classList.toggle('empty-state', tasks.length === 0);
  if (!tasks.length) {
    container.textContent = 'No open tasks yet.';
    return;
  }
  tasks.forEach(task => container.append(renderCard(task)));
}

function renderAllTasks() {
  const status = $('statusFilter').value;
  const mode = $('sortMode').value;
  let tasks = state.tasks.slice();
  if (status === 'open') tasks = tasks.filter(t => !t.completedAt);
  if (status === 'done') tasks = tasks.filter(t => t.completedAt);

  tasks.sort((a, b) => {
    if (mode === 'deadline') {
      const aa = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bb = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return aa - bb;
    }
    if (mode === 'age') return new Date(a.createdAt) - new Date(b.createdAt);
    if (mode === 'createdDesc') return new Date(b.createdAt) - new Date(a.createdAt);
    return priorityScore(b) - priorityScore(a);
  });

  if (!tasks.length) {
    $('allTasks').innerHTML = '<p class="empty-state">Nothing to show for this filter.</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Task</th><th>Deadline</th><th>Priority</th><th>Age</th><th>Project</th><th>Actions</th></tr></thead>';
  const tbody = document.createElement('tbody');
  tasks.forEach(task => {
    const tr = document.createElement('tr');
    if (task.completedAt) tr.classList.add('done');
    tr.innerHTML = `
      <td><strong class="row-title"></strong><div class="task-meta"></div></td>
      <td></td><td></td><td></td><td></td><td class="row-actions"></td>`;
    tr.children[0].querySelector('.row-title').textContent = task.title;
    tr.children[0].querySelector('.task-meta').textContent = task.notes || '';
    tr.children[1].textContent = task.deadline ? fmtDate(task.deadline) : '—';
    tr.children[2].textContent = task.completedAt ? 'Done' : `${priorityLabel(task)} (${priorityScore(task)})`;
    tr.children[3].textContent = fmtAge(task);
    tr.children[4].textContent = task.category || '—';
    const actions = tr.children[5];
    const toggle = document.createElement('button');
    toggle.className = 'small primary';
    toggle.textContent = task.completedAt ? 'Reopen' : 'Done';
    toggle.addEventListener('click', () => task.completedAt ? reopenTask(task.id) : completeTask(task.id));
    const edit = document.createElement('button');
    edit.className = 'small secondary'; edit.textContent = 'Edit';
    edit.addEventListener('click', () => openEdit(task.id));
    const del = document.createElement('button');
    del.className = 'small danger'; del.textContent = 'Delete';
    del.addEventListener('click', () => deleteTask(task.id));
    actions.append(toggle, edit, del);
    tbody.append(tr);
  });
  table.append(tbody);
  $('allTasks').innerHTML = '';
  $('allTasks').append(table);
}

function render() {
  const open = openTasks();
  const done = state.tasks.filter(t => t.completedAt);
  const n = settings.topN;
  document.querySelectorAll('.topNLabel').forEach(el => el.textContent = n);
  $('topN').value = n;
  $('openCount').textContent = open.length;
  $('doneCount').textContent = done.length;
  $('urgentCount').textContent = Math.min(n, open.length);
  $('oldestCount').textContent = Math.min(n, open.length);
  renderFocusList($('urgentList'), rankedOpen().slice(0, n));
  renderFocusList($('oldestList'), oldestOpen().slice(0, n));
  renderAllTasks();
}

function addTask(data) {
  state.tasks.push({
    id: uid(),
    title: data.title.trim(),
    deadline: data.deadline || null,
    effort: Number(data.effort || 2),
    importance: Number(data.importance || 3),
    category: (data.category || '').trim(),
    notes: (data.notes || '').trim(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    completedAt: null
  });
  saveState(); render();
}

function completeTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.completedAt = nowISO(); task.updatedAt = nowISO();
  saveState(); render();
}

function reopenTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.completedAt = null; task.updatedAt = nowISO();
  saveState(); render();
}

function deleteTask(id) {
  if (!confirm('Delete this task permanently?')) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState(); render();
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function openEdit(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  $('editId').value = task.id;
  $('editTitle').value = task.title;
  $('editDeadline').value = toLocalInput(task.deadline);
  $('editEffort').value = task.effort;
  $('editImportance').value = task.importance;
  $('editCategory').value = task.category || '';
  $('editNotes').value = task.notes || '';
  $('editDialog').showModal();
}

function exportData() {
  const payload = JSON.stringify({ version: 1, exportedAt: nowISO(), settings, tasks: state.tasks }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `task-triage-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!Array.isArray(obj.tasks)) throw new Error('No tasks array found');
    const incoming = obj.tasks.filter(t => t && typeof t.title === 'string').map(t => ({
      id: t.id || uid(), title: t.title, deadline: t.deadline || null,
      effort: Number(t.effort || 2), importance: Number(t.importance || 3),
      category: t.category || '', notes: t.notes || '',
      createdAt: t.createdAt || nowISO(), updatedAt: t.updatedAt || nowISO(), completedAt: t.completedAt || null
    }));
    state.tasks = incoming;
    if (obj.settings?.topN) settings.topN = clampTopN(obj.settings.topN);
    saveState(); render();
    alert(`Imported ${incoming.length} task(s).`);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  } finally {
    $('importInput').value = '';
  }
}

function seedDemo() {
  const h = 3600000;
  const d = 24 * h;
  const now = Date.now();
  state.tasks = [
    { title: 'Prepare steering committee deck', deadline: new Date(now + 7*h).toISOString(), effort: 4, importance: 5, category: 'Phoenix', notes: 'Need status, risks and decision log.', createdAt: new Date(now - 3*d).toISOString() },
    { title: 'Resolve vendor API dependency', deadline: new Date(now - 5*h).toISOString(), effort: 3, importance: 5, category: 'Integration', notes: 'Blocking UAT.', createdAt: new Date(now - 6*d).toISOString() },
    { title: 'Review backlog with product owner', deadline: new Date(now + 2*d).toISOString(), effort: 2, importance: 4, category: 'BAU', notes: '', createdAt: new Date(now - 1*d).toISOString() },
    { title: 'Document current-state process', deadline: null, effort: 5, importance: 3, category: 'Process mapping', notes: 'Has been sitting around too long.', createdAt: new Date(now - 18*d).toISOString() },
    { title: 'Send meeting minutes', deadline: new Date(now + 18*h).toISOString(), effort: 1, importance: 2, category: 'PMO', notes: '', createdAt: new Date(now - 2*h).toISOString() },
    { title: 'Confirm UAT tester availability', deadline: new Date(now + 5*d).toISOString(), effort: 1, importance: 4, category: 'UAT', notes: '', createdAt: new Date(now - 9*d).toISOString() }
  ].map(t => ({ id: uid(), ...t, updatedAt: nowISO(), completedAt: null }));
  saveState(); render();
}

$('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  addTask({
    title: $('title').value, deadline: $('deadline').value ? new Date($('deadline').value).toISOString() : null,
    effort: $('effort').value, importance: $('importance').value,
    category: $('category').value, notes: $('notes').value
  });
  e.currentTarget.reset();
  $('effort').value = '2'; $('importance').value = '3';
  $('title').focus();
});

$('editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const task = state.tasks.find(t => t.id === $('editId').value);
  if (!task) return;
  task.title = $('editTitle').value.trim();
  task.deadline = $('editDeadline').value ? new Date($('editDeadline').value).toISOString() : null;
  task.effort = Number($('editEffort').value);
  task.importance = Number($('editImportance').value);
  task.category = $('editCategory').value.trim();
  task.notes = $('editNotes').value.trim();
  task.updatedAt = nowISO();
  saveState(); render(); $('editDialog').close();
});

$('closeDialog').addEventListener('click', () => $('editDialog').close());
$('statusFilter').addEventListener('change', renderAllTasks);
$('sortMode').addEventListener('change', renderAllTasks);
$('topN').addEventListener('change', () => { settings.topN = clampTopN($('topN').value); saveState(); render(); });
$('exportBtn').addEventListener('click', exportData);
$('importInput').addEventListener('change', (e) => importData(e.target.files[0]));
$('seedBtn').addEventListener('click', () => { if (!state.tasks.length || confirm('Replace current tasks with demo tasks?')) seedDemo(); });
$('clearBtn').addEventListener('click', () => { if (confirm('Clear all task data stored on this device?')) { state = { tasks: [] }; saveState(); render(); } });

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredInstallPrompt = e; $('installBtn').classList.remove('hidden');
});
$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null; $('installBtn').classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

loadState(); render();
