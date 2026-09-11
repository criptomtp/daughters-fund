import { useEffect, useState } from "react";
import { backup } from "./repository.js";
import { Modal } from "./Modal.jsx";

// Імпорт підготовленого портфеля за посиланням виду ?seed=<токен>.
//
// Дані застосунку живуть виключно в IndexedDB браузера — записати їх ззовні
// неможливо. Це той самий імпорт бекапу, лише файл підтягується сам, щоб на
// телефоні не шукати його руками у «Файлах».
//
// Безпека: токен — 32 hex-символи, файл читається ТІЛЬКИ з власного походження
// (/seed/<токен>.json, CSP connect-src 'self'), заміна даних — лише після явного
// підтвердження, зі списком того, що буде записано.

const TOKEN_RE = /^[a-f0-9]{32}$/;
const DISMISSED_KEY = "df_seed_dismissed";

// Щоб запропонований портфель не питався при кожному відкритті, якщо його
// свідомо відхилили. Прив'язано до токена: новий підготовлений файл спитає знову.
function wasDismissed(token) {
  try { return (localStorage.getItem(DISMISSED_KEY) || "").split(",").includes(token); }
  catch { return false; }
}
function rememberDismissed(token) {
  if (!token) return;
  try {
    const prev = (localStorage.getItem(DISMISSED_KEY) || "").split(",").filter(Boolean);
    if (!prev.includes(token)) localStorage.setItem(DISMISSED_KEY, [...prev, token].join(","));
  } catch { /* приватний режим — переживемо */ }
}

function stripSeedParam() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("seed");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch { /* нічого страшного */ }
}

export function SeedImport() {
  const [state, setState] = useState({ phase: "idle", payload: null, error: null, token: null, auto: false });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Явне посилання ?seed=<токен> має пріоритет; інакше дивимось, чи не лежить
      // на сервері підготовлений портфель. Другий шлях потрібен тому, що
      // встановлений на iOS веб-застосунок не має адресного рядка — а його
      // сховище ізольоване від Safari, тож імпорт має статися саме всередині нього.
      const fromUrl = new URLSearchParams(window.location.search).get("seed");
      let token = fromUrl;
      let auto = false;

      if (!token) {
        try {
          const idx = await fetch("/seed/index.json", { credentials: "omit", cache: "no-store" });
          if (idx.ok) {
            const { token: t } = await idx.json();
            if (t && !wasDismissed(t)) { token = t; auto = true; }
          }
        } catch { /* нічого підготовленого немає — це нормальний стан */ }
      }

      if (!token) return;
      if (!TOKEN_RE.test(token)) {
        if (!cancelled) setState({ phase: "error", payload: null, error: "Некоректне посилання на портфель." });
        stripSeedParam();
        return;
      }

      try {
        const res = await fetch(`/seed/${token}.json`, { credentials: "omit", cache: "no-store" });
        if (!res.ok) throw new Error(`Файл портфеля не знайдено (${res.status}). Можливо, його вже видалено після імпорту.`);
        const payload = await res.json();
        if (!payload?.data) throw new Error("Файл не схожий на бекап портфеля.");
        if (!cancelled) setState({ phase: "confirm", payload, error: null, token, auto });
      } catch (e) {
        // Автоматичну спробу не перетворюємо на помилку на весь екран —
        // якщо файл уже прибрано, застосунок має просто відкритись як звичайно.
        if (cancelled) return;
        if (auto) setState({ phase: "idle", payload: null, error: null });
        else setState({ phase: "error", payload: null, error: e.message });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const apply = async () => {
    setState(s => ({ ...s, phase: "working" }));
    try {
      await backup.importAll(state.payload);
      stripSeedParam();
      setState({ phase: "done", payload: null, error: null, token: null, auto: false });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setState(s => ({ ...s, phase: "error", error: e.message }));
    }
  };

  const dismiss = () => {
    if (state.auto) rememberDismissed(state.token);
    stripSeedParam();
    setState({ phase: "idle", payload: null, error: null, token: null, auto: false });
  };

  if (state.phase === "idle") return null;

  const d = state.payload?.data;
  const counts = d && [
    [d.lots?.length, "лотів"],
    [d.bondReferences?.length, "облігацій у довіднику"],
    [d.couponPayments?.length, "купонних виплат"],
    [d.cashTransactions?.length, "транзакцій"],
    [d.accounts?.length, "рахунків"],
  ].filter(([n]) => n > 0);

  return (
    <Modal onClose={state.phase === "working" ? undefined : dismiss} ariaLabel="Імпорт готового портфеля">
      <h3 className="modal-title">
        {state.phase === "error" ? "Не вдалося завантажити портфель" : "Готовий портфель"}
      </h3>

      {state.phase === "error" && <div className="portfolio-error">⚠ {state.error}</div>}

      {state.phase === "confirm" && (
        <>
          <div className="modal-info">
            Знайдено підготовлений портфель: {counts.map(([n, l], i) => (
              <span key={l}>{i > 0 && ", "}<strong>{n}</strong> {l}</span>
            ))}.
          </div>
          <div className="portfolio-error">
            ⚠ Імпорт <strong>замінить усі дані</strong>, які зараз є в застосунку.
            Якщо ти вже щось вводив — спершу закрий це вікно і зроби експорт у розділі «Бекап».
          </div>
        </>
      )}

      {state.phase === "done" && <div className="modal-info">✓ Портфель завантажено. Оновлюю…</div>}

      <div className="modal-actions">
        {state.phase === "confirm" && (
          <button className="owner-action-btn ok" onClick={apply}>Замінити дані портфелем</button>
        )}
        {state.phase !== "working" && state.phase !== "done" && (
          <button className="owner-action-btn" onClick={dismiss}>Скасувати</button>
        )}
        {state.phase === "working" && <span className="form-hint">Записую…</span>}
      </div>
    </Modal>
  );
}
