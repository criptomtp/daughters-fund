import { useState, useRef, useEffect } from "react";
import { backup } from "./repository.js";
import { encryptBackup, decryptBackup, isEncryptedBackup } from "./cryptoBackup.js";
import {
  isAutoBackupSupported, connectAutoBackup, disconnectAutoBackup,
  getAutoBackupStatus, requestAutoBackupPermission, runAutoBackup,
} from "./autoBackup.js";

const LAST_BACKUP_KEY = "df_last_backup_at";
const STALE_THRESHOLD_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getLastBackupAt() {
  const raw = localStorage.getItem(LAST_BACKUP_KEY);
  return raw ? new Date(raw) : null;
}

function setLastBackupAt(date = new Date()) {
  localStorage.setItem(LAST_BACKUP_KEY, date.toISOString());
}

function daysAgo(date) {
  return Math.floor((Date.now() - date.getTime()) / MS_PER_DAY);
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BackupPanel({ onRestore }) {
  const [status, setStatus] = useState(null);
  const [lastBackup, setLastBackup] = useState(getLastBackupAt());
  const [auto, setAuto] = useState({ connected: false });
  const inputRef = useRef(null);

  const refreshAutoStatus = () => {
    getAutoBackupStatus().then(setAuto).catch(() => setAuto({ connected: false }));
  };

  useEffect(() => {
    // Refresh on mount in case localStorage was updated elsewhere
    setLastBackup(getLastBackupAt());
    refreshAutoStatus();
  }, []);

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  const markExported = () => {
    const ts = new Date();
    setLastBackupAt(ts);
    setLastBackup(ts);
  };

  // Основний експорт: зашифрований AES-GCM — саме його можна класти у хмару.
  const exportEncrypted = async () => {
    try {
      const pass = prompt("Пароль для шифрування бекапу (запам'ятайте — без нього файл не відновити):");
      if (!pass) return;
      const pass2 = prompt("Повторіть пароль:");
      if (pass !== pass2) { setStatus({ kind: "err", text: "Паролі не збігаються" }); return; }
      const data = await backup.exportAll();
      const envelope = await encryptBackup(data, pass);
      downloadJSON(envelope, `daughters-fund-backup-${stamp()}.enc.json`);
      markExported();
      setStatus({ kind: "ok", text: "Зашифрований бекап завантажено" });
    } catch (e) {
      setStatus({ kind: "err", text: e.message });
    }
  };

  // Відкритий експорт лишається для повного контролю, але з попередженням.
  const exportPlain = async () => {
    try {
      const data = await backup.exportAll();
      downloadJSON(data, `daughters-fund-backup-${stamp()}.json`);
      markExported();
      setStatus({ kind: "ok", text: "Бекап завантажено (відкритий JSON — не тримайте його у хмарі)" });
    } catch (e) {
      setStatus({ kind: "err", text: e.message });
    }
  };

  const importFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      let payload = JSON.parse(text);
      if (isEncryptedBackup(payload)) {
        const pass = prompt("Файл зашифровано. Введіть пароль:");
        if (!pass) return;
        payload = await decryptBackup(payload, pass);
      }
      if (!confirm("Це повністю замінить поточні дані. Продовжити?")) return;
      await backup.importAll(payload);
      setStatus({ kind: "ok", text: "Дані відновлено" });
      onRestore?.();
    } catch (e) {
      setStatus({ kind: "err", text: e.message });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // ── Авто-бекап (File System Access API, Chromium) ────────────────────────
  const handleConnectAuto = async () => {
    try {
      await connectAutoBackup();
      const res = await runAutoBackup(() => backup.exportAll());
      refreshAutoStatus();
      setStatus(res.ok
        ? { kind: "ok", text: "Авто-бекап підключено і записано" }
        : { kind: "err", text: "Підключено, але запис не вдався: " + (res.error || res.reason) });
    } catch (e) {
      if (e?.name !== "AbortError") setStatus({ kind: "err", text: e.message });
    }
  };

  const handleRunAuto = async () => {
    let res = await runAutoBackup(() => backup.exportAll());
    if (!res.ok && res.reason === "permission") {
      const perm = await requestAutoBackupPermission();   // потребує кліку — ми в onClick
      if (perm === "granted") res = await runAutoBackup(() => backup.exportAll());
    }
    refreshAutoStatus();
    setStatus(res.ok
      ? { kind: "ok", text: "Авто-бекап записано" }
      : { kind: "err", text: "Не вдалося записати: " + (res.error || res.reason) });
  };

  const handleDisconnectAuto = async () => {
    await disconnectAutoBackup();
    refreshAutoStatus();
    setStatus({ kind: "ok", text: "Авто-бекап відключено" });
  };

  const staleDays = lastBackup ? daysAgo(lastBackup) : null;
  const isStale = lastBackup === null || (staleDays != null && staleDays >= STALE_THRESHOLD_DAYS);

  return (
    <div className="backup-panel">
      <input
        ref={inputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={e => importFile(e.target.files?.[0])}
      />

      {isStale && (
        <div className="backup-stale-warning">
          ⚠ {lastBackup === null
            ? "Ви ще не зробили жодного бекапу."
            : `Останній бекап ${staleDays} днів тому.`}
          {" "}Зробіть зараз — рекомендується раз на 1-2 тижні.
        </div>
      )}

      <div className="backup-actions">
        <button className="owner-action-btn ok" onClick={exportEncrypted}>🔐 Експорт (зашифрований)</button>
        <button className="owner-action-btn" onClick={exportPlain}>⬇ Експорт JSON (відкритий)</button>
        <button className="owner-action-btn" onClick={() => inputRef.current?.click()}>⬆ Імпорт (заміна)</button>
      </div>

      <div className="backup-auto">
        <div className="backup-auto-head">Авто-бекап у файл</div>
        {!isAutoBackupSupported() && (
          <div className="backup-hint">Недоступно в цьому браузері (потрібен Chrome/Edge на компʼютері).</div>
        )}
        {isAutoBackupSupported() && !auto.connected && (
          <div className="backup-auto-row">
            <span className="backup-hint">Обери файл один раз — застосунок тихо оновлюватиме його при кожному відкритті.</span>
            <button className="owner-action-btn ok" onClick={handleConnectAuto}>Підключити файл</button>
          </div>
        )}
        {isAutoBackupSupported() && auto.connected && (
          <div className="backup-auto-row">
            <span className="backup-meta">
              📄 {auto.name}
              {auto.lastRunAt && <> · останній запис {new Date(auto.lastRunAt).toLocaleString("uk-UA")}</>}
              {auto.permission !== "granted" && <> · <strong>потрібен дозвіл</strong></>}
            </span>
            <span className="backup-auto-btns">
              <button className="owner-action-btn ok" onClick={handleRunAuto}>
                {auto.permission === "granted" ? "Записати зараз" : "Дозволити і записати"}
              </button>
              <button className="owner-action-btn" onClick={handleDisconnectAuto}>Відключити</button>
            </span>
          </div>
        )}
      </div>

      {lastBackup && !isStale && (
        <div className="backup-meta">
          Останній бекап: {lastBackup.toLocaleString("uk-UA")}
        </div>
      )}

      <div className="backup-hint">
        Source of truth — файл бекапу. У хмару (Google Drive, iCloud) клади <strong>зашифрований</strong> —
        він містить усі фінансові дані сім'ї. Відкритий JSON тримай лише на власному диску/USB.
        Адреси гаманців теж включені в бекап.
      </div>

      {status && (
        <div className={status.kind === "ok" ? "backup-ok" : "portfolio-error"}>
          {status.kind === "ok" ? "✓" : "⚠"} {status.text}
        </div>
      )}
    </div>
  );
}
