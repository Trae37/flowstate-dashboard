const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use ipcRenderer
contextBridge.exposeInMainWorld('electronAPI', {
  captureWorkspace: (payload) => ipcRenderer.invoke('capture-workspace', payload),
  restoreWorkspace: (captureId, userId) => ipcRenderer.invoke('restore-workspace', { captureId, userId }),
  restoreAsset: (assetId, userId) => ipcRenderer.invoke('restore-asset', { assetId, userId }),
  getCaptures: (userId) => ipcRenderer.invoke('get-captures', userId),
  getCaptureDetails: (captureId, userId) =>
    ipcRenderer.invoke('get-capture-details', { captureId, userId }),
  deleteCapture: (captureId, userId) =>
    ipcRenderer.invoke('delete-capture', { captureId, userId }),
  getSettings: (userId) => ipcRenderer.invoke('get-settings', userId),
  saveSettings: (settings, userId) =>
    ipcRenderer.invoke('save-settings', { settings, userId }),
  launchBrowserWithDebugging: (browserName) => ipcRenderer.invoke('launch-browser-with-debugging', browserName),
  // Auth methods
  authSignup: (email, password, username) => ipcRenderer.invoke('auth-signup', email, password, username),
  authLogin: (email, password) => ipcRenderer.invoke('auth-login', email, password),
  authVerifySession: (sessionToken) => ipcRenderer.invoke('auth-verify-session', sessionToken),
  authLogout: (sessionToken) => ipcRenderer.invoke('auth-logout', sessionToken),
  authCompleteOnboarding: (userId) => ipcRenderer.invoke('auth-complete-onboarding', userId),
  authCompleteFeatureTour: (userId) => ipcRenderer.invoke('auth-complete-feature-tour', userId),
  authDeleteUser: (email) => ipcRenderer.invoke('auth-delete-user', email),
  createDemoCapture: (userId) => ipcRenderer.invoke('create-demo-capture', userId),
  getPowerStatus: () => ipcRenderer.invoke('get-power-status'),
  // Listen for main process logs
  onMainProcessLog: (callback) => {
    ipcRenderer.on('main-process-log', (_event, message) => callback(message));
  },
  onPowerStatusChange: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('power-status-changed', handler);
    return () => ipcRenderer.removeListener('power-status-changed', handler);
  },
});
