/* ══════════════════════════════════════════════════════════════════════════
   TASKFLOW — Frontend Logic
   ══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ──────────────────────────────────────────────────────────────────
let allEvents      = [];
let currentFilter  = 'all';
let currentView    = 'dashboard';
let editingId      = null;
let scheduleType   = 'daily';
let autoScroll     = true;
let pendingConfirm = null;
let ws             = null;
let logLines       = [];

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  connectWebSocket();
  loadEvents();
  loadStatus();
  setInterval(loadStatus, 10000);
});

/* ══════════════════════════════════════════════════════════════════════════
   CLOCK
   ══════════════════════════════════════════════════════════════════════════ */
function startClock() {
  const el = document.getElementById('system-time');
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('es-MX', { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

/* ══════════════════════════════════════════════════════════════════════════
   WEBSOCKET — Real-time logs
   ══════════════════════════════════════════════════════════════════════════ */
function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url   = `${proto}://${location.host}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    setWsStatus('connected', '🟢 Conectado');
  };

  ws.onclose = () => {
    setWsStatus('disconnected', '🔴 Desconectado');
    setTimeout(connectWebSocket, 3000); // auto-reconnect
  };

  ws.onerror = () => setWsStatus('disconnected', '⚠ Error WS');

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'log') {
      appendLog(msg.entry, msg.level);
      loadEvents(); // refresh card run counts
    } else if (msg.type === 'log_history') {
      msg.lines.forEach(l => appendLog(l, detectLevel(l)));
    }
  };
}

function setWsStatus(cls, text) {
  const dot  = document.getElementById('ws-status-dot');
  const span = document.getElementById('ws-status-text');
  dot.className  = `status-dot ${cls}`;
  span.textContent = text;
}

function detectLevel(line) {
  if (line.includes('[ERROR]'))   return 'ERROR';
  if (line.includes('[SUCCESS]')) return 'SUCCESS';
  if (line.includes('[WARN]'))    return 'WARN';
  if (line.includes('[EVENT]'))   return 'EVENT';
  return 'INFO';
}

/* ══════════════════════════════════════════════════════════════════════════
   LOGS
   ══════════════════════════════════════════════════════════════════════════ */
function appendLog(text, level = 'INFO') {
  logLines.push({ text, level });
  if (logLines.length > 500) logLines.shift();

  const terminal = document.getElementById('log-terminal');
  const mini     = document.getElementById('mini-log');

  const lineEl = makeLogLine(text, level);
  const placeholder = terminal.querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();

  terminal.appendChild(lineEl);
  if (autoScroll) terminal.scrollTop = terminal.scrollHeight;

  // Mini log (dashboard) — last 20 lines
  const miniLine = makeLogLine(text, level);
  mini.appendChild(miniLine);
  while (mini.childElementCount > 20) mini.firstElementChild.remove();
  mini.scrollTop = mini.scrollHeight;
}

function makeLogLine(text, level) {
  const div = document.createElement('div');
  div.className = `log-line log-${level}`;
  div.textContent = text;
  return div;
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  document.getElementById('btn-autoscroll').textContent =
    autoScroll ? '📌 Auto-scroll ON' : '📌 Auto-scroll OFF';
}

async function clearLogs() {
  if (!confirm('¿Limpiar todos los logs?')) return;
  await api('DELETE', '/api/logs');
  logLines = [];
  document.getElementById('log-terminal').innerHTML = '<div class="log-placeholder">Logs limpiados.</div>';
  document.getElementById('mini-log').innerHTML = '';
  toast('Logs limpiados', 'info');
}

/* ══════════════════════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════════════════════ */
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`nav-${view}`).classList.add('active');

  const titles = { dashboard: 'Dashboard', events: 'Eventos', logs: 'Logs en Vivo' };
  document.getElementById('page-title').textContent = titles[view] || view;

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.classList.remove('open');
  }
}

// Attach nav buttons
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) overlay.classList.toggle('open');
}

/* ══════════════════════════════════════════════════════════════════════════
   API HELPERS
   ══════════════════════════════════════════════════════════════════════════ */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(path, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Error desconocido');
  return data;
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENTS — Fetch & Render
   ══════════════════════════════════════════════════════════════════════════ */
async function loadEvents() {
  try {
    const data = await api('GET', '/api/events');
    allEvents  = data.events;
    renderEvents();
    updateStats();
    updateNavBadge();
  } catch (err) {
    console.error('Error cargando eventos:', err);
  }
}

async function loadStatus() {
  try {
    const data = await api('GET', '/api/status');
    document.getElementById('stat-runs-val').textContent =
      allEvents.reduce((sum, e) => sum + (e.runCount || 0), 0);
  } catch (_) {}
}

function updateNavBadge() {
  document.getElementById('nav-events-count').textContent = allEvents.length;
}

function updateStats() {
  const total  = allEvents.length;
  const active = allEvents.filter(e => e.active).length;
  const paused = total - active;
  const runs   = allEvents.reduce((s, e) => s + (e.runCount || 0), 0);

  animCount('stat-total-val',  total);
  animCount('stat-active-val', active);
  animCount('stat-paused-val', paused);
  animCount('stat-runs-val',   runs);
}

function animCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  let step = Math.ceil(Math.abs(target - current) / 10);
  let val  = current;
  const timer = setInterval(() => {
    val += target > val ? step : -step;
    if ((target > current && val >= target) || (target < current && val <= target)) {
      val = target;
      clearInterval(timer);
    }
    el.textContent = val;
  }, 30);
}

function filterEvents() {
  renderEvents();
}

function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderEvents();
}

function renderEvents() {
  const query  = (document.getElementById('search-input')?.value || '').toLowerCase();
  let filtered = allEvents.filter(e => {
    const matchFilter = currentFilter === 'all'
      || (currentFilter === 'active' && e.active)
      || (currentFilter === 'paused' && !e.active);
    const matchSearch = !query
      || e.name.toLowerCase().includes(query)
      || (e.description || '').toLowerCase().includes(query)
      || (e.tags || []).some(t => t.toLowerCase().includes(query));
    return matchFilter && matchSearch;
  });

  // Dashboard grid
  const grid  = document.getElementById('dashboard-events-grid');
  const empty = document.getElementById('dashboard-empty');
  grid.innerHTML = '';

  // Events list view
  const list      = document.getElementById('events-list');
  const listEmpty = document.getElementById('events-empty');
  list.innerHTML  = '';

  if (filtered.length === 0) {
    grid.appendChild(empty || makeEmpty());
    list.appendChild(listEmpty || makeEmpty());
    return;
  }

  filtered.slice(0, 6).forEach(ev => grid.appendChild(makeEventCard(ev)));
  filtered.forEach(ev => list.appendChild(makeEventRow(ev)));
}

/* ── Card (dashboard) ─────────────────────────────────────────────────── */
function makeEventCard(ev) {
  const card = document.createElement('div');
  card.className = `event-card ${ev.active ? '' : 'paused'}`;
  card.style.setProperty('--event-color', ev.color || '#6c63ff');

  const schedLabel = formatScheduleLabel(ev.schedule);
  const actionIcon = { log: '📝', reminder: '🔔', shell: '💻', http: '🌐' }[ev.actionType] || '⚡';
  const tagsHtml   = (ev.tags || []).filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
  const lastRun    = ev.lastRun ? timeSince(ev.lastRun) : 'Nunca';

  card.innerHTML = `
    <div class="event-card-top">
      <div>
        <div class="event-card-name">${esc(ev.name)}</div>
        ${ev.description ? `<div class="event-card-desc">${esc(ev.description)}</div>` : ''}
      </div>
      <span class="event-card-badge badge-${ev.active ? 'active' : 'paused'}">
        ${ev.active ? 'Activo' : 'Pausado'}
      </span>
    </div>
    <div class="event-card-meta">
      <span class="meta-chip">${actionIcon} ${schedLabel}</span>
      <span class="meta-chip">🕐 ${lastRun}</span>
      ${tagsHtml}
    </div>
    <div class="event-card-footer">
      <span class="run-count-badge">⚡ ${ev.runCount || 0} ejecuciones</span>
      <div class="event-actions">
        <button class="icon-btn success" title="Ejecutar ahora" onclick="runEvent('${ev.id}')">▶</button>
        <button class="icon-btn ${ev.active ? 'warning' : 'success'}" title="${ev.active ? 'Pausar' : 'Activar'}"
          onclick="toggleEvent('${ev.id}')">
          ${ev.active ? '⏸' : '▶'}
        </button>
        <button class="icon-btn" title="Editar" onclick="openEventModal('${ev.id}')">✏️</button>
        <button class="icon-btn danger" title="Eliminar" onclick="confirmDelete('${ev.id}', '${esc(ev.name)}')">🗑</button>
      </div>
    </div>`;
  return card;
}

/* ── Row (events list) ────────────────────────────────────────────────── */
function makeEventRow(ev) {
  const row = document.createElement('div');
  row.className = `event-row ${ev.active ? '' : 'paused'}`;
  row.style.setProperty('--event-color', ev.color || '#6c63ff');

  const actionIcon = { log: '📝', reminder: '🔔', shell: '💻', http: '🌐' }[ev.actionType] || '⚡';
  const schedLabel = formatScheduleLabel(ev.schedule);
  const lastRun    = ev.lastRun ? timeSince(ev.lastRun) : 'Nunca';
  const tagsHtml   = (ev.tags || []).filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');

  row.innerHTML = `
    <div class="event-row-info">
      <div class="event-row-name">${actionIcon} ${esc(ev.name)}</div>
      <div class="event-row-sub">
        ${ev.description ? esc(ev.description) + ' · ' : ''}
        ${tagsHtml}
        <span class="meta-chip" style="margin-left:.25rem">🕐 ${lastRun}</span>
      </div>
    </div>
    <div class="event-row-meta">
      <span class="event-row-sched">${schedLabel}</span>
      <span class="run-count-badge">⚡ ${ev.runCount || 0}</span>
      <span class="event-card-badge badge-${ev.active ? 'active' : 'paused'}">${ev.active ? 'Activo' : 'Pausado'}</span>
    </div>
    <div class="event-row-actions">
      <button class="icon-btn success" title="Ejecutar" onclick="runEvent('${ev.id}')">▶</button>
      <button class="icon-btn ${ev.active ? 'warning' : 'success'}" title="${ev.active ? 'Pausar' : 'Activar'}"
        onclick="toggleEvent('${ev.id}')">${ev.active ? '⏸' : '▶'}</button>
      <button class="icon-btn" title="Editar" onclick="openEventModal('${ev.id}')">✏️</button>
      <button class="icon-btn danger" title="Eliminar" onclick="confirmDelete('${ev.id}', '${esc(ev.name)}')">🗑</button>
    </div>`;
  return row;
}

function makeEmpty() {
  const d = document.createElement('div');
  d.className = 'empty-state';
  d.innerHTML = `<div class="empty-icon">📅</div><h3>Sin resultados</h3>
    <p>No hay eventos que coincidan con tu búsqueda</p>`;
  return d;
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENT ACTIONS
   ══════════════════════════════════════════════════════════════════════════ */
async function runEvent(id) {
  try {
    await api('POST', `/api/events/${id}/run`);
    toast('Evento ejecutado ▶', 'success');
    setTimeout(loadEvents, 800);
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleEvent(id) {
  try {
    await api('PATCH', `/api/events/${id}/toggle`);
    await loadEvents();
  } catch (err) { toast(err.message, 'error'); }
}

/* ── Confirm delete ───────────────────────────────────────────────────── */
function confirmDelete(id, name) {
  pendingConfirm = id;
  document.getElementById('confirm-title').textContent   = 'Eliminar Evento';
  document.getElementById('confirm-message').textContent = `¿Eliminar "${name}"? Esta acción no se puede deshacer.`;
  openModal('confirm-modal');
}

async function confirmAction() {
  if (!pendingConfirm) return;
  try {
    await api('DELETE', `/api/events/${pendingConfirm}`);
    toast('Evento eliminado', 'info');
    await loadEvents();
  } catch (err) { toast(err.message, 'error'); }
  closeConfirmModal();
}

function closeConfirmModal() {
  pendingConfirm = null;
  closeModal('confirm-modal');
}

function handleConfirmOverlay(e) {
  if (e.target.id === 'confirm-modal') closeConfirmModal();
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENT MODAL — Create / Edit
   ══════════════════════════════════════════════════════════════════════════ */
function openEventModal(id = null) {
  editingId = id;
  resetForm();

  if (id) {
    const ev = allEvents.find(e => e.id === id);
    if (!ev) return;
    document.getElementById('modal-title').textContent  = 'Editar Evento';
    document.getElementById('save-btn-text').textContent = 'Actualizar';
    document.getElementById('event-id').value    = ev.id;
    document.getElementById('event-name').value  = ev.name;
    document.getElementById('event-desc').value  = ev.description || '';
    document.getElementById('event-tags').value  = (ev.tags || []).join(', ');
    document.getElementById('event-color').value = ev.color || '#6c63ff';
    document.getElementById('event-action-type').value = ev.actionType || 'log';
    document.getElementById('event-action').value = ev.action || '';
    updateActionPlaceholder();
    applyScheduleToForm(ev.schedule);
  } else {
    document.getElementById('modal-title').textContent  = 'Nuevo Evento';
    document.getElementById('save-btn-text').textContent = 'Guardar Evento';
    setScheduleType('daily', document.querySelector('.sched-type[data-type="daily"]'));
  }

  updateCronPreview();
  openModal('event-modal');
}

function resetForm() {
  document.getElementById('event-form').reset();
  document.getElementById('event-id').value    = '';
  document.getElementById('event-color').value = '#6c63ff';

  // Reset day buttons
  document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));

  // Reset schedule type buttons
  document.querySelectorAll('.sched-type').forEach(b => b.classList.remove('active'));

  // Show/hide groups
  showSchedGroup('time');
}

function closeEventModal() {
  editingId = null;
  closeModal('event-modal');
}

function handleOverlayClick(e) {
  if (e.target.id === 'event-modal') closeEventModal();
}

async function submitEvent(e) {
  e.preventDefault();
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const payload = buildPayload();
    if (editingId) {
      await api('PUT', `/api/events/${editingId}`, payload);
      toast('Evento actualizado ✓', 'success');
    } else {
      await api('POST', '/api/events', payload);
      toast('Evento creado ✓', 'success');
    }
    closeEventModal();
    await loadEvents();
    if (currentView === 'dashboard') switchView('events'); // jump to events view
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    document.getElementById('save-btn-text').textContent = editingId ? 'Actualizar' : 'Guardar Evento';
  }
}

function buildPayload() {
  const schedule = buildScheduleFromForm();
  return {
    name:        document.getElementById('event-name').value.trim(),
    description: document.getElementById('event-desc').value.trim(),
    tags:        document.getElementById('event-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    color:       document.getElementById('event-color').value,
    actionType:  document.getElementById('event-action-type').value,
    action:      document.getElementById('event-action').value.trim(),
    schedule,
  };
}

function updateActionPlaceholder() {
  const type   = document.getElementById('event-action-type').value;
  const input  = document.getElementById('event-action');
  const placeholders = {
    log:      'Mensaje a registrar en log...',
    reminder: '🔔 Recuerda beber agua!',
    shell:    'echo "hola mundo" o termux-notification -t "Alerta"',
    http:     'https://api.example.com/webhook',
  };
  input.placeholder = placeholders[type] || '';
}

/* ── Schedule form helpers ────────────────────────────────────────────── */
function setScheduleType(type, btn) {
  scheduleType = type;
  document.querySelectorAll('.sched-type').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Show/hide appropriate groups
  const timeGroup     = document.getElementById('sched-time-group');
  const daysGroup     = document.getElementById('sched-days-group');
  const intervalGroup = document.getElementById('sched-interval-group');

  timeGroup.classList.add('hidden');
  daysGroup.classList.add('hidden');
  intervalGroup.classList.add('hidden');

  if (type === 'daily' || type === 'once') {
    timeGroup.classList.remove('hidden');
  } else if (type === 'weekly') {
    timeGroup.classList.remove('hidden');
    daysGroup.classList.remove('hidden');
  } else if (type === 'interval') {
    intervalGroup.classList.remove('hidden');
  }
  // hourly & minutely: no extra options needed

  updateCronPreview();
}

function showSchedGroup(which) {
  document.getElementById('sched-time-group').classList.toggle('hidden', which !== 'time' && which !== 'both');
  document.getElementById('sched-days-group').classList.toggle('hidden', which !== 'both');
  document.getElementById('sched-interval-group').classList.toggle('hidden', which !== 'interval');
}

// Toggle day buttons
document.querySelectorAll('.day-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    updateCronPreview();
  });
});

// Update cron preview on any change
document.querySelectorAll('#sched-time, #sched-interval, #sched-interval-unit').forEach(el => {
  el.addEventListener('input', updateCronPreview);
  el.addEventListener('change', updateCronPreview);
});

function buildScheduleFromForm() {
  const type     = scheduleType;
  const time     = document.getElementById('sched-time').value || '08:00';
  const days     = [...document.querySelectorAll('.day-btn.active')].map(b => b.dataset.day);
  const interval = parseInt(document.getElementById('sched-interval').value) || 30;
  const unit     = document.getElementById('sched-interval-unit').value;

  return { type, time, days, interval, intervalUnit: unit };
}

function applyScheduleToForm(sched) {
  if (!sched) return;
  scheduleType = sched.type;

  const btn = document.querySelector(`.sched-type[data-type="${sched.type}"]`);
  setScheduleType(sched.type, btn);

  if (sched.time) document.getElementById('sched-time').value = sched.time;
  if (sched.interval) document.getElementById('sched-interval').value = sched.interval;
  if (sched.intervalUnit) document.getElementById('sched-interval-unit').value = sched.intervalUnit;

  // Days
  if (sched.days) {
    document.querySelectorAll('.day-btn').forEach(b => {
      b.classList.toggle('active', sched.days.includes(b.dataset.day));
    });
  }
}

function updateCronPreview() {
  const sched    = buildScheduleFromForm();
  const cronExpr = buildCronPreview(sched);
  document.getElementById('cron-expr').textContent = cronExpr;
}

function buildCronPreview(s) {
  const { type, time, days, interval, intervalUnit } = s;
  try {
    switch (type) {
      case 'daily':    { const [h,m] = time.split(':'); return `${m} ${h} * * *`; }
      case 'once':     { const [h,m] = time.split(':'); return `${m} ${h} * * * (una vez)`; }
      case 'hourly':   return '0 * * * *';
      case 'minutely': return '* * * * *';
      case 'weekly': {
        const [h,m]  = time.split(':');
        const dayMap = { lun:1, mar:2, mie:3, jue:4, vie:5, sab:6, dom:0 };
        const d = days.map(x => dayMap[x]).join(',') || '?';
        return `${m} ${h} * * ${d}`;
      }
      case 'interval': {
        if (intervalUnit === 'minutes') return `*/${interval} * * * *`;
        if (intervalUnit === 'hours')   return `0 */${interval} * * *`;
        if (intervalUnit === 'seconds') return `*/${interval} * * * * *`;
      }
      default: return '--';
    }
  } catch { return '--'; }
}

/* ══════════════════════════════════════════════════════════════════════════
   MODALS
   ══════════════════════════════════════════════════════════════════════════ */
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

/* ══════════════════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════════════════════════════════════════════ */
function toast(message, type = 'info') {
  const icons    = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const container = document.getElementById('toast-container');
  const el        = document.createElement('div');
  el.className    = `toast toast-${type}`;
  el.innerHTML    = `<span>${icons[type] || 'ℹ️'}</span><span>${esc(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'fadeOutToast .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

/* ══════════════════════════════════════════════════════════════════════════
   UTILS
   ══════════════════════════════════════════════════════════════════════════ */
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function timeSince(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `hace ${h}h`;
  return `hace ${Math.floor(h/24)}d`;
}

function formatScheduleLabel(sched) {
  if (!sched) return '—';
  const { type, time, days, interval, intervalUnit } = sched;
  const dayNames = { lun:'Lun', mar:'Mar', mie:'Mié', jue:'Jue', vie:'Vie', sab:'Sáb', dom:'Dom' };
  switch (type) {
    case 'daily':    return `Diario ${time || ''}`;
    case 'once':     return `Una vez ${time || ''}`;
    case 'hourly':   return 'Cada hora';
    case 'minutely': return 'Cada minuto';
    case 'weekly': {
      const d = (days || []).map(x => dayNames[x] || x).join(', ');
      return `${d} ${time || ''}`;
    }
    case 'interval': return `Cada ${interval} ${intervalUnit || ''}`;
    default:         return type;
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal('event-modal');
    closeModal('confirm-modal');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openEventModal();
  }
});
