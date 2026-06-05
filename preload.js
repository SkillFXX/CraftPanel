const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  checkJava: () => ipcRenderer.invoke("check-java"),
  getVersions: () => ipcRenderer.invoke("get-versions"),
  getServers: () => ipcRenderer.invoke("get-servers"),
  createServer: (data) => ipcRenderer.invoke("create-server", data),
  startServer: (data) => ipcRenderer.invoke("start-server", data),
  deleteServer: (folderName) => ipcRenderer.invoke("delete-server", folderName),
  openServerFolder: (folderName) =>
    ipcRenderer.invoke("open-server-folder", folderName),
  getPublicIp: () => ipcRenderer.invoke("get-public-ip"),
  onCreationProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on("server-creation-progress", subscription);
    return () =>
      ipcRenderer.removeListener("server-creation-progress", subscription);
  },
  updateServerSettings: (update) =>
    ipcRenderer.invoke("update-server-settings", update),
});
