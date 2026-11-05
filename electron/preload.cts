import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld("cuthelper", {
  importVideo: () => ipcRenderer.invoke("import"),
  importDropped: (file: File) =>
    ipcRenderer.invoke("drop", webUtils.getPathForFile(file)),
  analyze: (params: unknown) => ipcRenderer.invoke("analyze", params),
  preview: (project: unknown) => ipcRenderer.invoke("preview", project),
  saveProject: (project: unknown) => ipcRenderer.invoke("save", project),
  openProject: () => ipcRenderer.invoke("open"),
  exportProject: (project: unknown, kind: string) =>
    ipcRenderer.invoke("export", project, kind),
  cancel: () => ipcRenderer.invoke("cancel"),
  onProgress: (cb: (p: unknown) => void) => {
    const listener = (_: unknown, p: unknown) => cb(p);
    ipcRenderer.on("progress", listener);
    return () => ipcRenderer.removeListener("progress", listener);
  },
});
