const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sNotesAPI', {
  // Notes storage
  saveNotes: (content) => ipcRenderer.invoke('save-notes', content),
  loadNotes: () => ipcRenderer.invoke('load-notes'),
  
  // Settings & Window state
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  
  // Window control actions
  togglePrivateMode: (enable) => ipcRenderer.invoke('toggle-private-mode', enable),
  toggleAlwaysOnTop: (enable) => ipcRenderer.invoke('toggle-always-on-top', enable),
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  
  // Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  selectResume: () => ipcRenderer.invoke('select-resume'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  askGroq: (question, history, interviewBrief, screenImage, sessionMode) => ipcRenderer.invoke('ask-groq', question, history, interviewBrief, screenImage, sessionMode),
  transcribeGroq: (audioData, mimeType) => ipcRenderer.invoke('transcribe-groq', audioData, mimeType),
  
  // Event listeners
  onPrivateModeChanged: (callback) => {
    const handler = (event, state) => callback(state);
    ipcRenderer.on('private-mode-changed', handler);
    return () => ipcRenderer.removeListener('private-mode-changed', handler);
  },
  onAlwaysOnTopChanged: (callback) => {
    const handler = (event, state) => callback(state);
    ipcRenderer.on('always-on-top-changed', handler);
    return () => ipcRenderer.removeListener('always-on-top-changed', handler);
  },
  onGlobalToggle: (callback) => {
    const handler = (event) => callback();
    ipcRenderer.on('global-toggle-focus', handler);
    return () => ipcRenderer.removeListener('global-toggle-focus', handler);
  }
});
