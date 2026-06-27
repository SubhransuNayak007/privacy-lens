export async function scanStorage() {
  // 1. Extended Storage Scanning
  let indexedDBCount = 0;
  try {
    if (window.indexedDB && window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      indexedDBCount = dbs.length;
    }
  } catch (_e) {}

  let cacheCount = 0;
  try {
    if (window.caches) {
      const keys = await window.caches.keys();
      cacheCount = keys.length;
    }
  } catch (_e) {}

  let swCount = 0;
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      swCount = regs.length;
    }
  } catch (_e) {}

  let localStorageCount = 0;
  try {
    if (window.localStorage) localStorageCount = window.localStorage.length;
  } catch (_e) {}

  let sessionStorageCount = 0;
  try {
    if (window.sessionStorage) sessionStorageCount = window.sessionStorage.length;
  } catch (_e) {}

  const storage = {
    localStorage: localStorageCount,
    sessionStorage: sessionStorageCount,
    indexedDB: indexedDBCount,
    cacheStorage: cacheCount,
    serviceWorkers: swCount
  };

  // 2. Extended Permission Scanning
  const permissionsToScan = [
    "geolocation", "notifications", "camera", "microphone", 
    "clipboard-read", "clipboard-write", "bluetooth", "midi", "usb"
  ];
  
  const permissions = {};
  
  for (const perm of permissionsToScan) {
    try {
      const status = await navigator.permissions.query({ name: perm });
      permissions[perm] = status.state;
    } catch (_e) {
      permissions[perm] = "unsupported";
    }
  }

  return { storage, permissions };
}