const logWindow = document.getElementById('log-window');
const statusSpan = document.getElementById('status');
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const taskList = document.getElementById('task-list');

// Clock logic
function updateClock() {
    const now = new Date();
    clockTime.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    clockDate.textContent = now.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

// Global Configuration Logic
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        document.getElementById('config-badge-id').value = config.badgeId;
    } catch (err) {
        console.error('Error cargando configuración:', err);
    }
}

async function saveGlobalConfig() {
    const badgeId = document.getElementById('config-badge-id').value;
    if (!badgeId) return alert('El ID de Gafete no puede estar vacío');
    
    const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeId })
    });
    
    if (res.ok) alert('Configuración guardada correctamente');
}

// Task Management Logic
async function loadTasks() {
    try {
        const res = await fetch('/api/events');
        const tasks = await res.json();
        renderTasks(tasks);
    } catch (err) {
        console.error('Error cargando tareas:', err);
    }
}

function renderTasks(tasks) {
    if (tasks.length === 0) {
        taskList.innerHTML = '<p class="empty-msg">No hay tareas programadas.</p>';
        return;
    }

    const typeIcons = {
        'NOTIFICATION': '🔔',
        'PUNCH_IN': '📥',
        'PUNCH_OUT': '📤'
    };
    const dayNames = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    
    taskList.innerHTML = tasks.map(task => `
        <div class="task-card ${task.active ? '' : 'inactive'}" id="task-${task.id}">
            <div class="task-info">
                <h4>${typeIcons[task.type || 'NOTIFICATION']} ${task.name}</h4>
                <p>⏰ ${task.time} | 📅 ${task.days.map(d => dayNames[d]).join(', ')}</p>
                <p>🔄 Ejecuciones: ${task.runCount || 0}</p>
            </div>
            <div class="task-controls">
                <button onclick="toggleTask('${task.id}')" class="btn-toggle" title="Activar/Desactivar">
                    ${task.active ? '🟢' : '⚪'}
                </button>
                <button onclick="deleteTask('${task.id}')" class="btn-delete" title="Eliminar">🗑️</button>
            </div>
        </div>
    `).join('');
}

async function addTask() {
    const nameInput = document.getElementById('task-name');
    const timeInput = document.getElementById('task-time');
    const typeSelect = document.getElementById('task-type');
    const dayCheckboxes = document.querySelectorAll('.days-grid input:checked');
    
    const name = nameInput.value;
    const time = timeInput.value;
    const type = typeSelect.value;
    const days = Array.from(dayCheckboxes).map(cb => parseInt(cb.value));
    
    if (!name) return alert('Ponle un nombre a la tarea');
    if (days.length === 0) return alert('Selecciona al menos un día');

    const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, time, type, days, action: 'Automatización programada' })
    });
    
    if (res.ok) {
        nameInput.value = '';
        loadTasks();
    }
}

async function toggleTask(id) {
    const res = await fetch(`/api/events/${id}`, { method: 'PATCH' });
    if (res.ok) loadTasks();
}

async function deleteTask(id) {
    if (!confirm('¿Seguro que quieres borrar esta tarea?')) return;
    const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
    if (res.ok) loadTasks();
}

// Initial load
loadTasks();
loadConfig();

// WebSocket connection
const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${protocol}://${location.host}`);

ws.onopen = () => {
    statusSpan.textContent = '🟢 Conectado';
    statusSpan.className = 'status-on';
};

ws.onclose = () => {
    statusSpan.textContent = '🔴 Desconectado (Reconectando...)';
    statusSpan.className = 'status-off';
    setTimeout(() => location.reload(), 3000);
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'log') {
        const p = document.createElement('p');
        p.className = `log-entry log-${data.level}`;
        p.textContent = data.message;
        logWindow.prepend(p);
        
        if (logWindow.children.length > 50) {
            logWindow.lastElementChild.remove();
        }

        // If an event was executed, refresh task list to update runCount
        if (data.level === 'EVENT') loadTasks();
    }
};

async function testNotification() {
    await fetch('/api/test-notification', { method: 'POST' });
}
