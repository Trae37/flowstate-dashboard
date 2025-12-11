const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use ipcRenderer
contextBridge.exposeInMainWorld('electronAPI', {
  captureWorkspace: (payload) => ipcRenderer.invoke('capture-workspace', payload),
  restoreWorkspace: (captureId, userId) => ipcRenderer.invoke('restore-workspace', { captureId, userId }),
  restoreAsset: (assetId, userId) => ipcRenderer.invoke('restore-asset', { assetId, userId }),
  cancelRestoration: () => ipcRenderer.invoke('cancel-restoration'),
  getCaptures: (payload) => ipcRenderer.invoke('get-captures', payload), // payload: { userId, sessionId? }
  getCaptureDetails: (captureId, userId) =>
    ipcRenderer.invoke('get-capture-details', { captureId, userId }),
  deleteCapture: (captureId, userId) =>
    ipcRenderer.invoke('delete-capture', { captureId, userId }),
  getSettings: (userId) => ipcRenderer.invoke('get-settings', userId),
  saveSettings: (settings, userId) =>
    ipcRenderer.invoke('save-settings', { settings, userId }),
  launchBrowserWithDebugging: (browserName) => ipcRenderer.invoke('launch-browser-with-debugging', browserName),
  promptCloseAndRelaunchBrowser: (browserName) => ipcRenderer.invoke('prompt-close-and-relaunch-browser', browserName),
  getBrowsersWithoutDebugging: () => ipcRenderer.invoke('get-browsers-without-debugging'),
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
  // Session management methods
  sessionGetCurrent: (userId) => ipcRenderer.invoke('session-get-current', userId),
  sessionGetAll: (userId, includeArchived) => ipcRenderer.invoke('session-get-all', userId, includeArchived),
  sessionCreate: (userId, name, description) => ipcRenderer.invoke('session-create', userId, name, description),
  sessionUpdate: (sessionId, name, description) => ipcRenderer.invoke('session-update', sessionId, name, description),
  sessionArchive: (sessionId) => ipcRenderer.invoke('session-archive', sessionId),
  sessionDelete: (sessionId) => ipcRenderer.invoke('session-delete', sessionId),
  sessionGetAutoRecovered: (userId) => ipcRenderer.invoke('session-get-auto-recovered', userId),
  // Archive management methods
  archiveCapture: (payload) => ipcRenderer.invoke('archive-capture', payload),
  unarchiveCapture: (payload) => ipcRenderer.invoke('unarchive-capture', payload),
  archiveAsset: (payload) => ipcRenderer.invoke('archive-asset', payload),
  unarchiveAsset: (payload) => ipcRenderer.invoke('unarchive-asset', payload),
  deleteAsset: (payload) => ipcRenderer.invoke('delete-asset', payload),
  // Listen for main process logs
  onMainProcessLog: (callback) => {
    ipcRenderer.on('main-process-log', (_event, message) => callback(message));
  },
  // Listen for capture progress updates
  onCaptureProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('capture-progress', handler);
    return () => ipcRenderer.removeListener('capture-progress', handler);
  },
  onPowerStatusChange: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('power-status-changed', handler);
    return () => ipcRenderer.removeListener('power-status-changed', handler);
  },
  onRestoreProgress: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('restore-progress', handler);
    return () => ipcRenderer.removeListener('restore-progress', handler);
  },
});
