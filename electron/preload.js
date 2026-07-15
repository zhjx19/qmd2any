'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main (fire-and-forget)
  send: (channel, ...args) => {
    const allowed = [
      'editorContentChanged', 'ready', 'getConfig', 'saveConfig',
      'setTheme', 'getWechatHtml', 'getZhihuHtml', 'getXhsCopyHtml',
      'exportHtml', 'fetchImageBase64', 'generateXhsViaPython',
      'saveXhsImages', 'upload', 'todoToggle',
      'newFile', 'openExternal', 'saveFile',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  // Main → Renderer (listener)
  on: (channel, callback) => {
    const allowedOn = [
      'update', 'themeList', 'config', 'error',
      'wechatHtml', 'wechatHtmlError',
      'zhihuHtml', 'zhihuHtmlError',
      'xhsCopyHtml', 'xhsCopyHtmlError',
      'xhsPythonProgress', 'xhsPythonDone', 'xhsPythonError',
      'imageBase64Result',
      'uploadStart', 'uploadResult',
      'configSaved',
      'saveXhsImagesDone', 'saveXhsImagesError',
    ];
    if (allowedOn.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },

  // Main → Renderer (remove listener)
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // Dialog operations (Renderer → Main, promise-based)
  invoke: (channel, ...args) => {
    const allowed = ['dialog:openFile', 'dialog:saveFileAs', 'getAppPath'];
    if (allowed.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error('Unknown channel: ' + channel));
  },
});
