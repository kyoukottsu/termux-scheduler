const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'events.json');

// ─── UTILS: Minimal Storage ──────────────────────────────────────────────────
function loadEvents() {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch { return []; }
}
function saveEvents(events) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2));
}

// ─── BROADCAST LOG ──────────────────────────────────────────────────────────
function log(msg, type = 'INFO') {
    const timestamp = new Date().toLocaleTimeString('es-MX', { hour12: false });
    const entry = `[${timestamp}] [${type}] ${msg}`;
    console.log(entry);
    
    const payload = JSON.stringify({ type: 'log', message: entry, level: type });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
}

// ─── HEARTBEAT ENGINE ────────────────────────────────────────────────────────
// This is the core. It runs every 10 seconds.
function startHeartbeat() {
    log('Iniciando motor de latidos (10s)...', 'SUCCESS');
    
    setInterval(() => {
        const now = new Date();
        const curH = now.getHours();
        const curM = now.getMinutes();
        const curD = now.getDay();
        
        // Let user know we are alive
        if (now.getSeconds() < 10) {
            log('Latido: Servidor activo y monitoreando.', 'INFO');
        }

        const events = loadEvents();
        events.forEach(ev => {
            if (!ev.active) return;
            
            if (shouldRun(ev, now)) {
                executeAction(ev);
            }
        });
    }, 10000); // 10 second check
}

function shouldRun(ev, now) {
    const [h, m] = ev.time.split(':').map(Number);
    const isMinuteMatch = now.getHours() === h && now.getMinutes() === m;
    
    // Day match (0=Sun, 1=Mon, etc)
    const isDayMatch = ev.days.includes(now.getDay());
    
    // Cooldown: ensure we don't run twice in the same minute
    const lastRun = ev.lastRunMinute || -1;
    const currentMinuteKey = now.getHours() * 60 + now.getMinutes();
    
    if (isMinuteMatch && isDayMatch && lastRun !== currentMinuteKey) {
        ev.lastRunMinute = currentMinuteKey;
        return true;
    }
    return false;
}

function executeAction(ev) {
    log(`EJECUTANDO TAREA: "${ev.name}"`, 'EVENT');
    
    // 1. Termux Notification & Vibration (Requires Termux:API)
    const cmd = `termux-vibrate -d 500 && termux-notification -t "TaskFlow V2" -c "${ev.name}: ${ev.action}"`;
    exec(cmd, (err) => {
        if (err) log('Error al ejecutar acción (¿Tienes Termux:API?): ' + err.message, 'WARN');
    });

    // 2. Local action record
    const events = loadEvents();
    const index = events.findIndex(e => e.id === ev.id);
    if (index !== -1) {
        events[index].lastRunMinute = ev.lastRunMinute;
        events[index].runCount = (events[index].runCount || 0) + 1;
        saveEvents(events);
    }
}

// ─── API ─────────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/events', (req, res) => res.json(loadEvents()));

app.post('/api/events', (req, res) => {
    const events = loadEvents();
    const newEvent = {
        id: Date.now().toString(),
        name: req.body.name || 'Tarea Nueva',
        action: req.body.action || 'Sin acción',
        time: req.body.time || '08:00',
        days: req.body.days || [0,1,2,3,4,5,6], // All days default
        active: true,
        runCount: 0
    };
    events.push(newEvent);
    saveEvents(events);
    log(`Tarea Creada: ${newEvent.name} a las ${newEvent.time}`, 'SUCCESS');
    res.json(newEvent);
});

app.post('/api/test-notification', (req, res) => {
    log('Lanzando prueba de notificación y vibración...', 'INFO');
    exec('termux-vibrate -d 300 && termux-notification -t "Prueba" -c "Si ves esto y vibró, todo funciona"', (err) => {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

app.patch('/api/events/:id', (req, res) => {
    const events = loadEvents();
    const index = events.findIndex(e => e.id === req.params.id);
    if (index === -1) return res.status(404).send('Not found');
    
    events[index].active = !events[index].active;
    saveEvents(events);
    log(`Tarea "${events[index].name}" ${events[index].active ? 'Activada' : 'Desactivada'}`, 'INFO');
    res.json(events[index]);
});

app.delete('/api/events/:id', (req, res) => {
    let events = loadEvents();
    const event = events.find(e => e.id === req.params.id);
    if (!event) return res.status(404).send('Not found');
    
    events = events.filter(e => e.id !== req.params.id);
    saveEvents(events);
    log(`Tarea Borrada: "${event.name}"`, 'WARN');
    res.json({ success: true });
});

// ─── BOOT ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    log(`V2 Iniciada en http://localhost:${PORT}`, 'SUCCESS');
    startHeartbeat();
});
