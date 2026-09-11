import { useCallback, useEffect, useState } from "react";
import "./portfolio/portfolio.css";
import { useMarket } from "./portfolio/useMarket.js";
import { FundScreen } from "./portfolio/FundScreen.jsx";
import { HistoryScreen } from "./portfolio/HistoryScreen.jsx";
import { DetailsScreen } from "./portfolio/DetailsScreen.jsx";
import { RecordSheet } from "./portfolio/RecordSheet.jsx";
import { snapshots } from "./portfolio/repository.js";

// Каркас застосунку: три екрани внизу + кнопка запису.
//
// Раніше було п'ять вкладок угорі, з яких чотири (калькулятор у євро,
// порівняння гіпотетичних сценаріїв, ручні курси, крипто-гаманці) не мали
// стосунку до щомісячного ритуалу, а стартувала завжди перша з них.
// Тепер застосунок відкривається на тому, заради чого його відкривають.

const TABS = [
  { id: "fund",    label: "Фонд",    icon: "◆" },
  { id: "history", label: "Історія", icon: "▤" },
  { id: "details", label: "Деталі",  icon: "⋯" },
];

const TAB_KEY = "df_tab";
const loadTab = () => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some(x => x.id === t) ? t : "fund";
  } catch { return "fund"; }
};

export default function App() {
  const { market, loading: pricesLoading, error: pricesError, refresh: refreshPrices } = useMarket();
  const [tab, setTab] = useState(loadTab);
  const [detail, setDetail] = useState(null);      // відкритий підекран «Деталей»
  const [sheet, setSheet] = useState(null);        // null | "buy" | "coupon" | "transfer"

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  // Денний знімок вартості — джерело для спарклайна на «Фонді».
  useEffect(() => { snapshots.takeIfStale().catch(() => {}); }, []);

  // Встановлений на iOS PWA може місяцями показувати стару збірку: service
  // worker віддає прекеш і сам перевіряє оновлення рідко. Тому питаємо явно —
  // при кожному поверненні до застосунку.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      navigator.serviceWorker.getRegistration()
        .then(reg => reg?.update())
        .catch(() => {});
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  // Standalone-PWA не має кнопки «назад» браузера, але системний свайп від
  // лівого краю ходить по history застосунку. Тому кожен накладений шар
  // (лист запису, підекран Деталей) пушить стан — і свайп працює як «назад».
  const pushLayer = useCallback((kind) => {
    try { window.history.pushState({ layer: kind }, ""); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onPop = () => { setSheet(null); setDetail(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const closeLayer = useCallback(() => {
    // history.back() відкриє popstate, який і закриє шар — так стан не
    // розсинхронізується зі стеком історії.
    if (window.history.state?.layer) window.history.back();
    else { setSheet(null); setDetail(null); }
  }, []);

  const openSheet = useCallback((which = "buy") => { setSheet(which); pushLayer("sheet"); }, [pushLayer]);
  const openDetail = useCallback((id) => { setTab("details"); setDetail(id); pushLayer("detail"); }, [pushLayer]);

  return (
    <div className="app">
      <main className="app-main">
        {tab === "fund" && (
          <FundScreen market={market} pricesLoading={pricesLoading} pricesError={pricesError}
            onRefreshPrices={refreshPrices} onRecord={openSheet} onOpenDetails={openDetail} />
        )}
        {tab === "history" && <HistoryScreen />}
        {tab === "details" && (
          <DetailsScreen open={detail} onOpen={openDetail} onClose={closeLayer} market={market} />
        )}
      </main>

      <button className="fab" onClick={() => openSheet("buy")} aria-label="Записати">＋</button>

      <nav className="tabbar" role="tablist" aria-label="Розділи">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tabbar-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => { setTab(t.id); if (t.id !== "details") setDetail(null); }}
          >
            <span className="tabbar-icon">{t.icon}</span>
            <span className="tabbar-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <RecordSheet open={!!sheet} initialTab={sheet || "buy"} onClose={closeLayer} market={market} />
    </div>
  );
}
