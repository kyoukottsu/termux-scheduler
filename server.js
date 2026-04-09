const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { loadEvents, saveEvents, createEvent, updateEvent, deleteEvent } = require('./eventStore');
const { initScheduler, reloadScheduler, getSchedulerStatus } = require('./scheduler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, 'logs.txt');

// ─── WebSocket clients ────────────────────────────────────────────────────────
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  // Send last 100 log lines on connect
  try {
    if (fs.existsSync(LOG_FILE)) {
      const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-100);
      ws.send(JSON.stringify({ type: 'log_history', lines }));
    }
  } catch (_) {}
});

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(message, level = 'INFO') {
  const timestamp = new Date().toLocaleString('es-MX', { hour12: false });
  const entry = `[${timestamp}] [${level}] ${message}`;
  
  // Console
  const colors = { INFO: '\x1b[36m', SUCCESS: '\x1b[32m', ERROR: '\x1b[31m', WARN: '\x1b[33m', EVENT: '\x1b[35m' };
  console.log(`${colors[level] || ''}${entry}\x1b[0m`);
  
  // File
  fs.appendFileSync(LOG_FILE, entry + '\n');
  
  // Broadcast to all WebSocket clients
  const payload = JSON.stringify({ type: 'log', entry, level, timestamp });
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

// Expose log globally for scheduler
global.log = log;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET all events
app.get('/api/events', (req, res) => {
  res.json({ success: true, events: loadEvents() });
});

// GET single event
app.get('/api/events/:id', (req, res) => {
  const events = loadEvents();
  const event = events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ success: false, error: 'Evento no encontrado' });
  res.json({ success: true, event });
});

// POST create event
app.post('/api/events', (req, res) => {
  try {
    const event = createEvent(req.body);
    reloadScheduler();
    log(`Evento creado: "${event.name}" [${event.id}]`, 'SUCCESS');
    res.json({ success: true, event });
  } catch (err) {
    log(`Error al crear evento: ${err.message}`, 'ERROR');
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT update event
app.put('/api/events/:id', (req, res) => {
  try {
    const event = updateEvent(req.params.id, req.body);
    reloadScheduler();
    log(`Evento actualizado: "${event.name}" [${event.id}]`, 'SUCCESS');
    res.json({ success: true, event });
  } catch (err) {
    log(`Error al actualizar evento: ${err.message}`, 'ERROR');
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE event
app.delete('/api/events/:id', (req, res) => {
  try {
    const event = deleteEvent(req.params.id);
    reloadScheduler();
    log(`Evento eliminado: "${event.name}" [${event.id}]`, 'WARN');
    res.json({ success: true });
  } catch (err) {
    log(`Error al eliminar evento: ${err.message}`, 'ERROR');
    res.status(400).json({ success: false, error: err.message });
  }
});

// Toggle event active/paused
app.patch('/api/events/:id/toggle', (req, res) => {
  try {
    const events = loadEvents();
    const event = events.find(e => e.id === req.params.id);
    if (!event) throw new Error('Evento no encontrado');
    event.active = !event.active;
    saveEvents(events);
    reloadScheduler();
    log(`Evento ${event.active ? 'activado' : 'pausado'}: "${event.name}"`, event.active ? 'SUCCESS' : 'WARN');
    res.json({ success: true, event });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Execute event manually
app.post('/api/events/:id/run', (req, res) => {
  try {
    const events = loadEvents();
    const event = events.find(e => e.id === req.params.id);
    if (!event) throw new Error('Evento no encontrado');
    log(`▶ Ejecución manual: "${event.name}"`, 'EVENT');
    executeEvent(event);
    res.json({ success: true, message: 'Evento ejecutado' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET scheduler status
app.get('/api/status', (req, res) => {
  const events = loadEvents();
  const status = getSchedulerStatus();
  res.json({
    success: true,
    uptime: process.uptime(),
    totalEvents: events.length,
    activeEvents: events.filter(e => e.active).length,
    ...status
  });
});

// GET logs
app.get('/api/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const content = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
    const lines = content.split('\n').filter(Boolean).slice(-limit);
    res.json({ success: true, lines });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear logs
app.delete('/api/logs', (req, res) => {
  fs.writeFileSync(LOG_FILE, '');
  log('Logs limpiados', 'INFO');
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  log(`🚀 Servidor iniciado en http://localhost:${PORT}`, 'SUCCESS');
  log(`📅 Sistema de tareas programadas listo`, 'INFO');
  initScheduler();
});
