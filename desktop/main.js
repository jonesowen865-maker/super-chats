const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const Store = require('electron-store');

const store = new Store();

let SERVER_URL = store.get('serverUrl', 'http://localhost:3000');
let cachedSession = null;
let cachedSettings = { corner: 'top-right' };
let lastSuperchatId = 0;

let mainWindow = null;
let tray = null;
let pollInterval = null;
let overlayWin = null;
const overlayQueue = [];
let overlayActive = false;

// ── HTTP helper ───────────────────────────────────────────────────────────────

function apiRequest(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(SERVER_URL + urlPath);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };

    const req = lib.request(options, res => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(json.error || 'Request failed'));
          else resolve(json);
        } catch {
          reject(new Error('Invalid response'));
        }
      });
    });

    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Server took too long to respond. It may be waking up — try again in a moment.')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Overlay position helper ───────────────────────────────────────────────────

function getOverlayPosition(corner) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const W = 420, H = 140, PAD = 20;
  switch (corner) {
    case 'top-left':     return { x: PAD,          y: PAD };
    case 'bottom-left':  return { x: PAD,          y: sh - H - PAD };
    case 'bottom-right': return { x: sw - W - PAD, y: sh - H - PAD };
    default:             return { x: sw - W - PAD, y: PAD };
  }
}

// ── Main Window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    resizable: false,
    frame: true,
    backgroundColor: '#080810',
    title: 'SuperChat',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'login.html'));

  mainWindow.on('minimize', e => {
    if (cachedSession) { e.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.on('close', e => {
    if (cachedSession && !app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

// ── Overlay Window (created once, stays at corner — no off-screen juggling) ──

function createOverlayWindow() {
  const { x, y } = getOverlayPosition(cachedSettings.corner);

  overlayWin = new BrowserWindow({
    width: 420,
    height: 140,
    x, y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: false,
    }
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setVisibleOnAllWorkspaces(true);
  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWin.on('closed', () => { overlayWin = null; });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIklEQVR42mP8z8BQDwADhQGAWjR9QgAAAABJRU5ErkJggg=='
    );
  }

  tray = new Tray(icon);
  tray.setToolTip('SuperChat — Running');
  updateTrayMenu();
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: cachedSession ? `Logged in as ${cachedSession.username}` : 'Not logged in',
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Open SuperChat', click: () => { mainWindow.show(); mainWindow.focus(); } },
    {
      label: 'Send Test Alert',
      enabled: !!cachedSession,
      click: () => queueOverlay({ sender_name: 'TestViewer', message: 'This is a test superchat!', amount: 50, color: 'pink' })
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

// ── Polling ───────────────────────────────────────────────────────────────────

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    if (!cachedSession) return stopPolling();

    try {
      const data = await apiRequest(
        'GET',
        `/api/poll/${encodeURIComponent(cachedSession.username)}?last_id=${lastSuperchatId}`,
        null,
        cachedSession.token
      );

      if (data.superchats && data.superchats.length > 0) {
        for (const sc of data.superchats) {
          queueOverlay(sc);
          if (sc.id > lastSuperchatId) lastSuperchatId = sc.id;
        }
      }
    } catch (err) {
      if (err.message === 'Invalid token' || err.message === 'Unauthorized') {
        stopPolling();
        cachedSession = null;
        store.delete('session');
        mainWindow.show();
        mainWindow.loadFile(path.join(__dirname, 'login.html'));
      }
    }
  }, 2500);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ── Overlay Queue ─────────────────────────────────────────────────────────────

function queueOverlay(superchat) {
  overlayQueue.push(superchat);
  if (!overlayActive) processNextOverlay();
}

function processNextOverlay() {
  if (overlayQueue.length === 0) { overlayActive = false; return; }
  overlayActive = true;
  showOverlay(overlayQueue.shift());
}

function showOverlay(superchat) {
  if (!overlayWin || overlayWin.isDestroyed()) createOverlayWindow();

  const doSend = () => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.webContents.send('superchat', superchat);
  };

  if (overlayWin.webContents.isLoading()) {
    overlayWin.webContents.once('did-finish-load', doSend);
  } else {
    doSend();
  }

  // Total visible time: 7500ms + 550ms fade-out = 8050ms. Add buffer then move on.
  setTimeout(() => {
    overlayActive = false;
    setTimeout(processNextOverlay, 800);
  }, 8200);
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('login', async (_, { username, password }) => {
  const data = await apiRequest('POST', '/api/login', { username, password });
  cachedSession = { token: data.token, username: data.username };
  cachedSettings = { corner: data.corner || 'top-right' };
  lastSuperchatId = data.last_id || 0;
  store.set('session', cachedSession);
  store.set('settings', cachedSettings);
  updateTrayMenu();
  startPolling();
  return data;
});

ipcMain.handle('register', async (_, { username, password }) => {
  const data = await apiRequest('POST', '/api/register', { username, password });
  cachedSession = { token: data.token, username: data.username };
  cachedSettings = { corner: 'top-right' };
  lastSuperchatId = data.last_id || 0;
  store.set('session', cachedSession);
  store.set('settings', cachedSettings);
  updateTrayMenu();
  startPolling();
  return data;
});

ipcMain.handle('logout', () => {
  stopPolling();
  cachedSession = null;
  store.delete('session');
  updateTrayMenu();
  mainWindow.loadFile(path.join(__dirname, 'login.html'));
});

ipcMain.handle('getSession', () => cachedSession);
ipcMain.handle('getSettings', () => cachedSettings);
ipcMain.handle('getServerUrl', () => SERVER_URL);

ipcMain.handle('getRecentSuperchats', async () => {
  if (!cachedSession) return [];
  try {
    const data = await apiRequest(
      'GET',
      `/api/superchats/${encodeURIComponent(cachedSession.username)}`,
      null,
      cachedSession.token
    );
    return (data.superchats || []).slice(-10).reverse();
  } catch {
    return [];
  }
});

ipcMain.handle('saveSettings', async (_, settings) => {
  cachedSettings = { ...cachedSettings, ...settings };
  store.set('settings', cachedSettings);
  if (cachedSession && settings.corner) {
    try { await apiRequest('POST', '/api/settings', { corner: settings.corner }, cachedSession.token); } catch {}
  }
  // Reposition overlay immediately when corner changes
  if (settings.corner && overlayWin && !overlayWin.isDestroyed()) {
    const { x, y } = getOverlayPosition(settings.corner);
    overlayWin.setPosition(x, y);
  }
  return cachedSettings;
});

ipcMain.handle('minimize', () => mainWindow.hide());

ipcMain.handle('sendTestOverlay', () => {
  queueOverlay({ sender_name: 'TestViewer', message: 'This is a test superchat!', amount: 50, color: 'pink' });
});

ipcMain.handle('setServerUrl', (_, url) => {
  SERVER_URL = url;
  store.set('serverUrl', url);
});

ipcMain.handle('overlayReady', () => {});
ipcMain.handle('closeOverlay', () => {});

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createMainWindow();
  createTray();

  const savedSession = store.get('session');
  const savedSettings = store.get('settings', { corner: 'top-right' });
  cachedSettings = savedSettings;

  // Create overlay at the correct corner from the start
  createOverlayWindow();

  if (savedSession) {
    apiRequest('GET', '/api/verify', null, savedSession.token)
      .then(data => {
        cachedSession = { token: savedSession.token, username: data.username };
        cachedSettings = { corner: data.corner || 'top-right' };
        store.set('session', cachedSession);
        // Reposition overlay to saved corner
        if (overlayWin && !overlayWin.isDestroyed()) {
          const { x, y } = getOverlayPosition(cachedSettings.corner);
          overlayWin.setPosition(x, y);
        }
        return apiRequest(
          'GET',
          `/api/superchats/${encodeURIComponent(data.username)}`,
          null,
          savedSession.token
        ).catch(() => ({ superchats: [] }));
      })
      .then(data => {
        if (data.superchats && data.superchats.length > 0) {
          lastSuperchatId = Math.max(...data.superchats.map(s => s.id));
        }
        mainWindow.loadFile(path.join(__dirname, 'settings.html'));
        startPolling();
        updateTrayMenu();
      })
      .catch(() => {
        cachedSession = null;
        store.delete('session');
      });
  }
});

app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { app.isQuitting = true; stopPolling(); });
