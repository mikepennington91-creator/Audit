const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('traceabilityApp', {
  version: process.env.npm_package_version,
});
