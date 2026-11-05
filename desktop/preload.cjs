const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('tidy', {
    state: () => ipcRenderer.invoke('tidy:state'),
    save: value => ipcRenderer.invoke('tidy:save', value),
    permissions: () => ipcRenderer.invoke('tidy:permissions'),
    choose: zone => ipcRenderer.send('tidy:choose', zone),
    regions: regions => ipcRenderer.send('tidy:regions', regions),
    close: () => ipcRenderer.send('tidy:close'),
    hover: callback => ipcRenderer.on('hover', (_event, zone) => callback(zone)),
    changed: callback => ipcRenderer.on('changed', () => callback()),
});
