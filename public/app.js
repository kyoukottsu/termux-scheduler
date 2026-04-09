const logWindow = document.getElementById('log-window');
const statusSpan = document.getElementById('status');

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
        
        // Limit log lines
        if (logWindow.children.length > 50) {
            logWindow.lastElementChild.remove();
        }
    }
};

async function testNotification() {
    await fetch('/api/test-notification', { method: 'POST' });
}

async function addTask() {
    const name = document.getElementById('task-name').value;
    const time = document.getElementById('task-time').value;
    
    if (!name) return alert('Ponle un nombre a la tarea');

    const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, time, action: 'Recordatorio automático' })
    });
    
    if (res.ok) {
        document.getElementById('task-name').value = '';
        alert('Tarea programada con éxito');
    }
}
