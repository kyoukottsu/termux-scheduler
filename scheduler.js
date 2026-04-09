const cron = require('node-cron');
const { loadEvents, recordRun } = require('./eventStore');

// ─── Active scheduled tasks ────────────────────────────────────────────────
let activeTasks = new Map(); // id -> cron task
let schedulerStartTime = null;

// ─── Build cron expression from schedule object ────────────────────────────
function buildCronExpression(schedule) {
  const { type, time, days, interval, intervalUnit } = schedule;

  switch (type) {
    case 'daily': {
      // Every day at HH:MM
      const [h, m] = time.split(':').map(Number);
      return `${m} ${h} * * *`;
    }
    case 'weekly': {
      // Specific days of week at HH:MM
      const [h, m] = time.split(':').map(Number);
      const dayMap = { 'dom': 0, 'lun': 1, 'mar': 2, 'mie': 3, 'jue': 4, 'vie': 5, 'sab': 6 };
      const dayNums = days.map(d => dayMap[d] ?? d).join(',');
      return `${m} ${h} * * ${dayNums}`;
    }
    case 'interval': {
      // Every N minutes/hours
      if (intervalUnit === 'minutes') {
        return `*/${interval} * * * *`;
      } else if (intervalUnit === 'hours') {
        return `0 */${interval} * * *`;
      } else if (intervalUnit === 'seconds') {
        return `*/${interval} * * * * *`; // node-cron supports seconds
      }
      break;
    }
    case 'once': {
      // Run once at specific time today/date
      const [h, m] = time.split(':').map(Number);
      return `${m} ${h} * * *`; // Will be destroyed after first run
    }
    case 'hourly': {
      return '0 * * * *';
    }
    case 'minutely': {
      return '* * * * *';
    }
    default:
      throw new Error(`Tipo de programación desconocido: ${type}`);
  }
}

// ─── Execute a single event ────────────────────────────────────────────────
function executeEvent(event) {
  const log = global.log;
  try {
    log(`⚡ Ejecutando evento: "${event.name}"`, 'EVENT');
    
    switch (event.actionType) {
      case 'log':
        log(`📝 [${event.name}] ${event.action}`, 'INFO');
        break;
        
      case 'http': {
        // HTTP request action
        const https = require('https');
        const http = require('http');
        const url = new URL(event.action);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.get(event.action, (res) => {
          log(`🌐 [${event.name}] HTTP ${res.statusCode} → ${event.action}`, 'SUCCESS');
        });
        req.on('error', (err) => {
          log(`🌐 [${event.name}] HTTP Error: ${err.message}`, 'ERROR');
        });
        break;
      }
        
      case 'shell': {
        // Shell command
        const { exec } = require('child_process');
        exec(event.action, (err, stdout, stderr) => {
          if (err) {
            log(`💻 [${event.name}] Error: ${err.message}`, 'ERROR');
          } else {
            log(`💻 [${event.name}] OK: ${(stdout || '').trim()}`, 'SUCCESS');
          }
        });
        break;
      }
        
      case 'reminder':
        log(`🔔 RECORDATORIO: ${event.action}`, 'WARN');
        break;
        
      default:
        log(`[${event.name}] ${event.action}`, 'INFO');
    }
    
    recordRun(event.id);
    
    // Auto-disable "once" events after first run
    if (event.schedule.type === 'once') {
      const { saveEvents, loadEvents } = require('./eventStore');
      const events = loadEvents();
      const ev = events.find(e => e.id === event.id);
      if (ev) {
        ev.active = false;
        saveEvents(events);
        reloadScheduler();
        log(`🔕 Evento único "${event.name}" desactivado tras ejecución`, 'INFO');
      }
    }
    
  } catch (err) {
    log(`❌ Error ejecutando "${event.name}": ${err.message}`, 'ERROR');
  }
}

// ─── (Re)load all scheduled tasks ─────────────────────────────────────────
function reloadScheduler() {
  const log = global.log;
  
  // Stop all current tasks
  activeTasks.forEach((task, id) => {
    task.stop();
  });
  activeTasks.clear();
  
  const events = loadEvents();
  let scheduled = 0;
  
  events.forEach(event => {
    if (!event.active) return;
    
    try {
      const cronExpr = buildCronExpression(event.schedule);
      const useSeconds = event.schedule.type === 'interval' && event.schedule.intervalUnit === 'seconds';
      
      const task = cron.schedule(cronExpr, () => {
        executeEvent(event);
      }, {
        scheduled: true
      });
      
      activeTasks.set(event.id, task);
      scheduled++;
      
    } catch (err) {
      log(`⚠ No se pudo programar "${event.name}": ${err.message}`, 'WARN');
    }
  });
  
  log(`♻ Scheduler recargado: ${scheduled}/${events.length} eventos activos`, 'INFO');
}

// ─── Init ──────────────────────────────────────────────────────────────────
function initScheduler() {
  schedulerStartTime = new Date();
  reloadScheduler();
}

function getSchedulerStatus() {
  return {
    schedulerUpSince: schedulerStartTime,
    scheduledTasks: activeTasks.size,
  };
}

module.exports = { initScheduler, reloadScheduler, executeEvent, getSchedulerStatus };
