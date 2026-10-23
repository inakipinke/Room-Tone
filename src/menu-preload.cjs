const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blocksMenu', {
  onInit: callback => {
    const listener = (_event, visibility) => callback(visibility || {});
    ipcRenderer.on('blocks-menu:init', listener);
    return () => ipcRenderer.removeListener('blocks-menu:init', listener);
  },
  setVisibility: (name, visible) => ipcRenderer.send('blocks-menu:visibility', name, visible),
  close: () => ipcRenderer.send('blocks-menu:close')
});
