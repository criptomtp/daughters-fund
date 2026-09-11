// Авто-бекап через File System Access API (Chromium; фіча-детект для решти).
// Користувач один раз обирає файл — далі застосунок тихо перезаписує його
// актуальним експортом. Файл локальний (той самий диск, що й IndexedDB),
// тому пишеться незашифрованим; для хмари існує шифрований ручний експорт.
//
// FileSystemFileHandle structured-clone-иться в IndexedDB — зберігаємо хендл
// в окремій крихітній БД, щоб не піднімати версію основної Dexie-схеми.

const DB_NAME = "df-autobackup";
const STORE = "handles";
const KEY = "backupFile";
export const LAST_AUTOBACKUP_KEY = "df_autobackup_at";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbOp(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  }));
}

const getHandle = () => idbOp("readonly", s => s.get(KEY));
const setHandle = (h) => idbOp("readwrite", s => s.put(h, KEY));
const clearHandle = () => idbOp("readwrite", s => s.delete(KEY));

export function isAutoBackupSupported() {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export async function connectAutoBackup() {
  const handle = await window.showSaveFilePicker({
    suggestedName: "daughters-fund-autobackup.json",
    types: [{ description: "JSON backup", accept: { "application/json": [".json"] } }],
  });
  await setHandle(handle);
  return handle;
}

export async function disconnectAutoBackup() {
  await clearHandle().catch(() => {});
  try { localStorage.removeItem(LAST_AUTOBACKUP_KEY); } catch { /* ignore */ }
}

export async function getAutoBackupStatus() {
  const handle = await getHandle().catch(() => null);
  if (!handle) return { connected: false };
  let permission = "prompt";
  try { permission = await handle.queryPermission({ mode: "readwrite" }); } catch { /* old impl */ }
  let lastRunAt = null;
  try { lastRunAt = localStorage.getItem(LAST_AUTOBACKUP_KEY); } catch { /* ignore */ }
  return { connected: true, permission, name: handle.name, lastRunAt };
}

// Потребує user gesture — викликати лише з onClick.
export async function requestAutoBackupPermission() {
  const handle = await getHandle().catch(() => null);
  if (!handle) return "not-connected";
  return handle.requestPermission({ mode: "readwrite" });
}

// Захист від конкурентних викликів (інтервал + visibilitychange можуть
// зійтися): createWritable на той самий handle не реентерабельний.
let backupInFlight = false;

export async function runAutoBackup(exportAllFn) {
  if (backupInFlight) return { ok: false, reason: "busy" };
  backupInFlight = true;
  try {
    const handle = await getHandle().catch(() => null);
    if (!handle) return { ok: false, reason: "not-connected" };
    let permission = "prompt";
    try { permission = await handle.queryPermission({ mode: "readwrite" }); } catch { /* ignore */ }
    if (permission !== "granted") return { ok: false, reason: "permission" };
    try {
      const payload = await exportAllFn();
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      try { localStorage.setItem(LAST_AUTOBACKUP_KEY, new Date().toISOString()); } catch { /* ignore */ }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "write-failed", error: e?.message };
    }
  } finally {
    backupInFlight = false;
  }
}
