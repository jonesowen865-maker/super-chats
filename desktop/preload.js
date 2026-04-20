const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  login: (username, password) => ipcRenderer.invoke('login', { username, password }),
  register: (username, password) => ipcRenderer.invoke('register', { username, password }),
  logout: () => ipcRenderer.invoke('logout'),
  getSession: () => ipcRenderer.invoke('getSession'),

  // Settings
  saveSettings: (settings) => ipcRenderer.invoke('saveSettings', settings),
  getSettings: () => ipcRenderer.invoke('getSettings'),

  // Server URL
  getServerUrl: () => ipcRenderer.invoke('getServerUrl'),
  setServerUrl: (url) => ipcRenderer.invoke('setServerUrl', url),

  // Window
  minimize: () => ipcRenderer.invoke('minimize'),

  // Overlay data (sent from main process)
  onSuperchat: (cb) => ipcRenderer.on('superchat', (_, data) => cb(data)),
  onTestSuperchat: (cb) => ipcRenderer.on('test-superchat', (_, data) => cb(data)),

  // Test overlay
  sendTestOverlay: () => ipcRenderer.invoke('sendTestOverlay'),

  // Data
  getRecentSuperchats: () => ipcRenderer.invoke('getRecentSuperchats'),

  // Overlay ready
  overlayReady: () => ipcRenderer.invoke('overlayReady'),
  closeOverlay: () => ipcRenderer.invoke('closeOverlay'),
});
