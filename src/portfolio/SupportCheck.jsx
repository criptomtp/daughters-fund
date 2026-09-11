import { useEffect, useState } from "react";

const PERSIST_ASKED_KEY = "df_persist_asked";

function checkIndexedDB() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Перевіряє, що браузер підтримує IndexedDB (інакше додаток не працюватиме),
 * та просить дозвіл на "persistent storage" — без нього браузер легально
 * може видалити IndexedDB у low-storage mode або після N днів неактивності (Safari ITP).
 */
export function SupportCheck({ children }) {
  // Lazy init: один раз перевіряємо при mount, синхронно
  const [supported] = useState(checkIndexedDB);
  const [persisted, setPersisted] = useState(null);

  useEffect(() => {
    if (!supported) return;
    if (!navigator.storage?.persist) return;
    let cancelled = false;

    (async () => {
      try {
        const already = await navigator.storage.persisted();
        if (cancelled) return;
        if (already) { setPersisted(true); return; }

        if (!localStorage.getItem(PERSIST_ASKED_KEY)) {
          localStorage.setItem(PERSIST_ASKED_KEY, "1");
        }
        const granted = await navigator.storage.persist();
        if (!cancelled) setPersisted(granted);
      } catch {
        if (!cancelled) setPersisted(null);
      }
    })();

    return () => { cancelled = true; };
  }, [supported]);

  if (!supported) {
    return (
      <div className="support-check error">
        <h1>Браузер не підтримує IndexedDB</h1>
        <p>
          Цей додаток зберігає дані локально через IndexedDB. Ваш браузер або налаштування
          (зазвичай Safari Private Mode, або вимкнено в Firefox) не дозволяють це.
        </p>
        <p>Відкрийте додаток в Chrome / Edge / Safari у звичайному режимі.</p>
      </div>
    );
  }

  return (
    <>
      {isIosBrowser() && !isInstalled() && (
        <div className="persist-warning danger">
          ⚠ <strong>Safari видаляє дані сайту після 7 днів без відвідування.</strong>
          {" "}Додай застосунок на екран «Домівка» (Поділитися → На екран Домівки) —
          {" "}встановлені веб-застосунки під це правило не підпадають.
        </div>
      )}
      {persisted === false && (
        <div className="persist-warning">
          ⚠ Браузер може видалити локальні дані у low-storage режимі.
          {" "}Робіть регулярний JSON-бекап (Портфель → Бекап → Експорт).
        </div>
      )}
      {children}
    </>
  );
}

// Safari з iOS 13.4 чистить усе script-writable сховище (IndexedDB, localStorage,
// service worker) через 7 днів без взаємодії з сайтом. Веб-застосунки, додані на
// екран «Домівка», рахують дні окремо і під це правило не підпадають — тому це
// не косметична порада, а єдиний спосіб не втратити базу.
function isIosBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iosClassic = /iPad|iPhone|iPod/.test(ua);
  // iPadOS від 13-ї версії представляється як Macintosh — розрізняємо по тачу
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  return iosClassic || iPadOS;
}

function isInstalled() {
  if (typeof window === "undefined") return false;
  if (window.navigator?.standalone === true) return true;          // iOS home-screen
  try { return window.matchMedia("(display-mode: standalone)").matches; }
  catch { return false; }
}
