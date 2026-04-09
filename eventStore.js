const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const EVENTS_FILE = path.join(__dirname, 'events.json');

// ─── Default events file ───────────────────────────────────────────────────
function ensureFile() {
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.writeFileSync(EVENTS_FILE, JSON.stringify([], null, 2));
  }
}

function loadEvents() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

// ─── Validation ────────────────────────────────────────────────────────────
function validateEvent(data) {
  if (!data.name || !data.name.trim()) throw new Error('El nombre es requerido');
  if (!data.action || !data.action.trim()) throw new Error('La acción es requerida');
  if (!data.schedule) throw new Error('La programación es requerida');
  
  // Validate schedule object
  const { type, time, days, interval, intervalUnit } = data.schedule;
  if (!type) throw new Error('Tipo de programación requerido');
  
  if (type === 'daily' || type === 'weekly') {
    if (!time) throw new Error('Hora requerida para este tipo de programación');
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      throw new Error('Hora inválida');
    }
  }
  if (type === 'weekly' && (!days || days.length === 0)) {
    throw new Error('Selecciona al menos un día de la semana');
  }
  if (type === 'interval') {
    if (!interval || interval < 1) throw new Error('Intervalo debe ser mayor a 0');
    if (!intervalUnit) throw new Error('Unidad de intervalo requerida');
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────────
function createEvent(data) {
  validateEvent(data);
  const events = loadEvents();
  const now = new Date().toISOString();
  const event = {
    id: uuidv4(),
    name: data.name.trim(),
    description: (data.description || '').trim(),
    action: data.action.trim(),
    actionType: data.actionType || 'log',
    schedule: data.schedule,
    active: true,
    createdAt: now,
    updatedAt: now,
    lastRun: null,
    runCount: 0,
    tags: data.tags || [],
    color: data.color || '#6c63ff',
  };
  events.push(event);
  saveEvents(events);
  return event;
}

function updateEvent(id, data) {
  validateEvent(data);
  const events = loadEvents();
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) throw new Error('Evento no encontrado');
  
  events[idx] = {
    ...events[idx],
    name: data.name.trim(),
    description: (data.description || '').trim(),
    action: data.action.trim(),
    actionType: data.actionType || 'log',
    schedule: data.schedule,
    tags: data.tags || [],
    color: data.color || events[idx].color,
    updatedAt: new Date().toISOString(),
  };
  saveEvents(events);
  return events[idx];
}

function deleteEvent(id) {
  const events = loadEvents();
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) throw new Error('Evento no encontrado');
  const [removed] = events.splice(idx, 1);
  saveEvents(events);
  return removed;
}

function recordRun(id) {
  const events = loadEvents();
  const event = events.find(e => e.id === id);
  if (event) {
    event.lastRun = new Date().toISOString();
    event.runCount = (event.runCount || 0) + 1;
    saveEvents(events);
  }
}

module.exports = { loadEvents, saveEvents, createEvent, updateEvent, deleteEvent, recordRun };
