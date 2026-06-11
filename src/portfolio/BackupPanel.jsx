import { useState, useRef, useEffect } from "react";
import { backup } from "./repository.js";

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

export function BackupPanel({ onRestore }) {
  const [status, setStatus] = useState(null);
  const [lastBackup, setLastBackup] = useState(getLastBackupAt());
  const inputRef = useRef(null);

  useEffect(() => {
    // Refresh on mount in case localStorage was updated elsewhere
    setLastBackup(getLastBackupAt());
  }, []);

  const exportNow = async () => {
    try {
      const data = await backup.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `daughters-fund-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const ts = new Date();
      setLastBackupAt(ts);
      setLastBackup(ts);
      setStatus({ kind: "ok", text: "Бекап завантажено" });
    } catch (e) {
      setStatus({ kind: "err", text: e.message });
    }
  };

  const importFile = async (file, merge) => {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!merge && !confirm("Це повністю замінить поточні дані. Продовжити?")) return;
      await backup.importAll(payload, { merge });
      setStatus({ kind: "ok", text: merge ? "Дані додано" : "Дані відновлено" });
      onRestore?.();
    } catch (e) {
      setStatus({ kind: "err", text: e.message });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
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
        onChange={e => importFile(e.target.files?.[0], false)}
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
        <button className="owner-action-btn ok" onClick={exportNow}>⬇ Експорт JSON</button>
        <button className="owner-action-btn" onClick={() => inputRef.current?.click()}>⬆ Імпорт (заміна)</button>
      </div>

      {lastBackup && !isStale && (
        <div className="backup-meta">
          Останній бекап: {lastBackup.toLocaleString("uk-UA")}
        </div>
      )}

      <div className="backup-hint">
        Source of truth — цей файл. Тримай останню копію в надійному місці (Google Drive, iCloud, USB).
        Браузер може випадково очистити локальне сховище — JSON-файл повертає все назад.
      </div>

      {status && (
        <div className={status.kind === "ok" ? "backup-ok" : "portfolio-error"}>
          {status.kind === "ok" ? "✓" : "⚠"} {status.text}
        </div>
      )}
    </div>
  );
}
