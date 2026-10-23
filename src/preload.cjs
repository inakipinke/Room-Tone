const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  setAlwaysOnTop: enabled => ipcRenderer.send('window:always-on-top', enabled),
  fitContent: height => ipcRenderer.send('window:fit-content', height),
  toggleBlocksMenu: (visible, bounds) => ipcRenderer.send('window:blocks-menu', visible, bounds),
  updateBlocksMenuAnchor: bounds => ipcRenderer.send('window:blocks-menu-anchor', bounds),
  onBlocksVisibility: callback => {
    const listener = (_event, name, visible) => callback(name, visible);
    ipcRenderer.on('blocks-menu:visibility', listener);
    return () => ipcRenderer.removeListener('blocks-menu:visibility', listener);
  },
  onBlocksMenuClosed: callback => {
    const listener = () => callback();
    ipcRenderer.on('blocks-menu:closed', listener);
    return () => ipcRenderer.removeListener('blocks-menu:closed', listener);
  },
  setDiagnosticRecording: enabled => ipcRenderer.send('diagnostics:set-recording', Boolean(enabled)),
  onDiagnosticEvent: callback => {
    const listener = (_event, diagnosticEvent) => callback(diagnosticEvent);
    ipcRenderer.on('diagnostics:event', listener);
    return () => ipcRenderer.removeListener('diagnostics:event', listener);
  },
  copyText: text => ipcRenderer.invoke('diagnostics:copy-text', String(text))
});