const { loadEvents, recordRun, saveEvents } = require('./eventStore');
const { exec } = require('child_process');
const https = require('https');
const http = require('http');

// ─── Internal State ────────────────────────────────────────────────────────
let heartbeatInterval = null;
let schedulerStartTime = null;
let lastCheckMinute = -1; // To ensure we only process "once per minute" logic once

// Map to track last execution time/minute to avoid double triggers
// id -> timestamp of last execution
const lastExecutionMap = new Map();

/**
 * Main Heartbeat Loop
 * Runs every 30 seconds to check if any tasks are due.
 */
function heartbeat() {
  const log = global.log || console.log;
  const now = new Date();
  const currentMinute = now.getMinutes();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0 (Sun) - 6 (Sat)
  
  // Format current time for logging
  const timeStr = now.toLocaleTimeString('es-MX', { hour12: false });
  
  // DEBUG LOG: Heartbeat indicator
  log(`[DEBUG] Latido del sistema (${timeStr}) - Revisando tareas...`, 'INFO');

  const events = loadEvents();
  let checked = 0;
  let activeCount = 0;

  events.forEach(event => {
    if (!event.active) return;
    activeCount++;

    try {
      if (shouldEventRun(event, now)) {
        log(`[DEBUG] ⚡ Tarea "${event.name}" identificada como DEBIDA. Ejecutando ahora.`, 'EVENT');
        executeEvent(event);
        lastExecutionMap.set(event.id, now.getTime());
      }
    } catch (err) {
      log(`[ERROR] Error al evaluar tarea "${event.name}": ${err.message}`, 'ERROR');
    }
    checked++;
  });
}

/**
 * Logic to determine if an event should run right now
 */
function shouldEventRun(event, now) {
  const log = global.log || console.log;
  const { schedule } = event;
  const lastExec = lastExecutionMap.get(event.id) || 0;
  const msSinceLastRun = now.getTime() - lastExec;

  // 1. Minimum cooldown: Never run the same task more than once every 50 seconds 
  // (to avoid double-firing within the same minute mark due to heartbeat frequency)
  if (msSinceLastRun < 50000) return false;

  const [targetH, targetM] = (schedule.time || "00:00").split(':').map(Number);
  const currentH = now.getHours();
  const currentM = now.getMinutes();
  const currentD = now.getDay();

  switch (schedule.type) {
    case 'daily':
    case 'once':
      // Matches hour and minute
      return currentH === targetH && currentM === targetM;

    case 'weekly': {
      const dayMap = { 'dom': 0, 'lun': 1, 'mar': 2, 'mie': 3, 'jue': 4, 'vie': 5, 'sab': 6 };
      const isTargetDay = (schedule.days || []).some(d => dayMap[d] === currentD);
      return isTargetDay && currentH === targetH && currentM === targetM;
    }

    case 'interval': {
      // For intervals, we check if enough time has passed
      let intervalMs = 0;
      if (schedule.intervalUnit === 'minutes') intervalMs = schedule.interval * 60 * 1000;
      else if (schedule.intervalUnit === 'hours') intervalMs = schedule.interval * 60 * 60 * 1000;
      else if (schedule.intervalUnit === 'seconds') intervalMs = schedule.interval * 1000;
      
      // If never run (lastRun is null in DB), we use createdAt as base or just run it now
      const baseTime = event.lastRun ? new Date(event.lastRun).getTime() : new Date(event.createdAt).getTime();
      return (now.getTime() - baseTime) >= intervalMs;
    }

    case 'hourly':
      return currentM === 0; // Trigger at the start of every hour

    case 'minutely':
      return true; // Trigger every heartbeat minute (cooldown handles the 1-min spacing)

    default:
      return false;
  }
}

/**
 * Execute a single event action
 */
function executeEvent(event) {
  const log = global.log || console.log;
  
  try {
    log(`⚡ Ejecutando: "${event.name}" (${event.actionType})`, 'EVENT');
    
    switch (event.actionType) {
      case 'log':
        log(`📝 [${event.name}] ${event.action}`, 'INFO');
        break;
        
      case 'http': {
        const url = new URL(event.action);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.get(event.action, (res) => {
          log(`🌐 [${event.name}] HTTP ${res.statusCode}`, 'SUCCESS');
        });
        req.on('error', (err) => log(`🌐 [${event.name}] Error: ${err.message}`, 'ERROR'));
        break;
      }
        
      case 'shell': {
        exec(event.action, (err, stdout, stderr) => {
          if (err) log(`💻 [${event.name}] Error: ${err.message}`, 'ERROR');
          else log(`💻 [${event.name}] OK: ${(stdout || '').trim()}`, 'SUCCESS');
        });
        break;
      }
        
      case 'reminder':
        log(`🔔 RECORDATORIO: ${event.action}`, 'WARN');
        break;
    }
    
    recordRun(event.id);
    
    // Auto-disable "once" events
    if (event.schedule.type === 'once') {
      const events = loadEvents();
      const ev = events.find(e => e.id === event.id);
      if (ev) {
        ev.active = false;
        saveEvents(events);
        log(`🔕 Evento único "${event.name}" completado y desactivado.`, 'INFO');
      }
    }
    
  } catch (err) {
    log(`❌ Fallo crítico en "${event.name}": ${err.message}`, 'ERROR');
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

function initScheduler() {
  const log = global.log || console.log;
  schedulerStartTime = new Date();
  
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  
  // Start heartbeat every 30 seconds
  heartbeatInterval = setInterval(heartbeat, 30000);
  
  log('🚀 Motor de Scheduler (Heartbeat) iniciado.', 'SUCCESS');
  log('   - Chequeo: Cada 30 segundos.', 'INFO');
  log('   - Modo: Reloj interno directo.', 'INFO');
  
  // Run once immediately
  heartbeat();
}

function reloadScheduler() {
  const log = global.log || console.log;
  log('♻ Recargando motor de tareas...', 'INFO');
  // With heartbeat, reload implies just letting the next tick pick up the new JSON
}

function getSchedulerStatus() {
  return {
    schedulerUpSince: schedulerStartTime,
    activeTasks: loadEvents().filter(e => e.active).length,
    mode: 'Manual Heartbeat (30s)'
  };
}

module.exports = { initScheduler, reloadScheduler, executeEvent, getSchedulerStatus };
