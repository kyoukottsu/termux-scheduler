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
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ─── UTILS: Minimal Storage ──────────────────────────────────────────────────
function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ badgeId: '5057358' }));
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

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
function startHeartbeat() {
    log('Iniciando motor de latidos (10s)...', 'SUCCESS');
    
    setInterval(() => {
        const now = new Date();
        
        // Let user know we are alive (every minute approx)
        if (now.getSeconds() < 10) {
            log('Latido: Servidor activo y monitoreando.', 'INFO');
        }

        const events = loadEvents();
        events.forEach(ev => {
            if (!ev.active) return;
            
            if (shouldRun(ev, now)) {
                if (ev.type === 'PUNCH_IN' || ev.type === 'PUNCH_OUT') {
                    performPunch(ev);
                } else {
                    executeAction(ev);
                }
            }
        });
    }, 10000); // 10 second check
}

function shouldRun(ev, now) {
    const [h, m] = ev.time.split(':').map(Number);
    const isMinuteMatch = now.getHours() === h && now.getMinutes() === m;
    const isDayMatch = ev.days.includes(now.getDay());
    
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
    
    const isTermux = process.platform === 'android' || process.env.TERMUX_VERSION;

    if (isTermux) {
        const cmd = `termux-vibrate -d 500 && termux-notification -t "TaskFlow V2" -c "${ev.name}: ${ev.action}"`;
        exec(cmd, (err) => {
            if (err) log('Error en Termux API: ' + err.message, 'WARN');
        });
    } else {
        log(`Simulación: Notificación "${ev.name}" ejecutada (Modo Windows)`, 'INFO');
    }

    const events = loadEvents();
    const index = events.findIndex(e => e.id === ev.id);
    if (index !== -1) {
        events[index].lastRunMinute = ev.lastRunMinute;
        events[index].runCount = (events[index].runCount || 0) + 1;
        saveEvents(events);
    }
}

// ─── AUTOMATION ENGINE: OXXO PUNCH ──────────────────────────────────────────
async function performPunch(ev) {
    const config = loadConfig();
    const typeLabel = ev.type === 'PUNCH_IN' ? 'ENTRADA' : 'SALIDA';
    const typeCode = ev.type === 'PUNCH_IN' ? 'O' : 'X';
    const badge = config.badgeId;
    
    log(`Iniciando marcaje de ${typeLabel} para ID ${badge}...`, 'INFO');

    const now = new Date();
    const fmt = (d) => d.toISOString().replace(/[-:T]/g, '').split('.')[0];
    const time = fmt(now);
    const txnId = `WebClock_10MON50TSL${Date.now()}`;
    
    const txn = `${ev.type === 'PUNCH_IN' ? '3' : '4'}%05${badge}%051%05A%05${time}%05%05%05%05%05WebClock_10MON50TSL%0510MON50TSL%05%05%05${time}%05%05%05`;
    
    const payload = new URLSearchParams({
        devid: 'WebClock_10MON50TSL',
        devtype: '11',
        txnmode: typeCode,
        txncat: 'T',
        time: time,
        txn: decodeURIComponent(txn),
        isFromWebClock: 'Y',
        txnId: txnId,
        locale: 'es_MX'
    }).toString();

    try {
        const response = await fetch('https://oxxo.reflexisinc.com/RWS4/servlet/ClockRequestManager', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://oxxo.reflexisinc.com/RWS4/WebClockLogin.jsp?locationID=Caja_POS&UnitID=10MON50TSL&'
            },
            body: payload
        });

        const result = await response.text();
        if (result.includes('Aceptado')) {
            const msgMatch = result.match(/<td[^>]*>(.*?)<\/td>/); 
            const detail = msgMatch ? msgMatch[1] : 'Marcaje Aceptado';
            log(`✅ OXXO CONFIRMÓ: ${detail.replace(/<[^>]*>/g, '')}`, 'SUCCESS');
        } else {
            const cleanError = result.substring(0, 150).replace(/<[^>]*>/g, '').trim();
            log(`⚠️ OXXO RECHAZÓ: ${cleanError}`, 'WARN');
        }
    } catch (err) {
        log(`ERROR DE CONEXIÓN AL MARCAR: ${err.message}`, 'WARN');
    }

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
        action: req.body.action || 'Automatización programada',
        time: req.body.time || '08:00',
        type: req.body.type || 'NOTIFICATION',
        days: req.body.days || [0,1,2,3,4,5,6],
        active: true,
        runCount: 0
    };
    events.push(newEvent);
    saveEvents(events);
    log(`Tarea Creada: ${newEvent.name} (${newEvent.type}) a las ${newEvent.time}`, 'SUCCESS');
    res.json(newEvent);
});

app.post('/api/test-notification', (req, res) => {
    log('Lanzando prueba de notificación...', 'INFO');
    const isTermux = process.platform === 'android' || process.env.TERMUX_VERSION;
    if (isTermux) {
        exec('termux-vibrate -d 300 && termux-notification -t "Prueba" -c "Si ves esto y vibró, todo funciona"', (err) => {
            if (err) return res.json({ success: false, error: err.message });
            res.json({ success: true });
        });
    } else {
        log('Prueba en Windows: Notificación simulada con éxito', 'SUCCESS');
        res.json({ success: true, mode: 'windows' });
    }
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

app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => {
    saveConfig(req.body);
    log('Configuración de Gafete actualizada', 'SUCCESS');
    res.json({ success: true });
});

// ─── BOOT ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    log(`V2 Iniciada en http://localhost:${PORT}`, 'SUCCESS');
    startHeartbeat();
});
