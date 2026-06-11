import { useState, useMemo } from "react";
import { useAccounts } from "./hooks/useAccounts.js";
import { usePersons } from "./hooks/usePersons.js";
import { useBrokers } from "./hooks/useBrokers.js";
import { PersonsManager } from "./PersonsManager.jsx";
import { BrokersManager } from "./BrokersManager.jsx";
import { AccountsManager } from "./AccountsManager.jsx";
import { BondsManager } from "./BondsManager.jsx";
import { LotsManager } from "./LotsManager.jsx";
import { CouponCalendar } from "./CouponCalendar.jsx";
import { AccountDashboard } from "./AccountDashboard.jsx";
import { TransactionsPanel } from "./TransactionsPanel.jsx";
import { BackupPanel } from "./BackupPanel.jsx";
import { OnboardingBanner } from "./OnboardingBanner.jsx";
import { useLots } from "./hooks/useLots.js";
import "./portfolio.css";

export function PortfolioTab() {
  const { list: accounts } = useAccounts();
  const { list: persons }  = usePersons();
  const { list: brokers }  = useBrokers();
  const { list: lots }     = useLots();
  const [accountFilter, setAccountFilter] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);

  const brokersById = useMemo(() => new Map(brokers.map(b => [b.id, b])), [brokers]);
  const isEmpty = lots.length === 0 && accounts.length === 0;

  const filterOptions = useMemo(() => {
    return [
      { id: "all", label: "Усі", emoji: "🌐", color: "#c9a96a", broker: null },
      ...accounts.map(a => ({
        id: a.id,
        label: a.name,
        emoji: a.emoji,
        color: a.color,
        broker: brokersById.get(a.brokerId),
      })),
    ];
  }, [accounts, brokersById]);

  return (
    <div className="portfolio-tab" key={refreshKey}>
      <OnboardingBanner visible={isEmpty} />

      <div className="owner-filter-bar">
        {filterOptions.map(opt => (
          <button
            key={opt.id}
            className={`owner-chip ${accountFilter === opt.id ? "active" : ""}`}
            style={{ "--chip-color": opt.color }}
            onClick={() => setAccountFilter(opt.id)}
          >
            <span>{opt.emoji}</span>
            <span>{opt.label}</span>
            {opt.broker && (
              <span className="chip-broker">· {opt.broker.name}</span>
            )}
          </button>
        ))}
      </div>

      <AccountDashboard accountFilter={accountFilter} accounts={accounts} persons={persons} />

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">💼 Лоти (записи реальних покупок)</h2>
          <p className="portfolio-section-sub">
            Тут пишеш "Купив N штук ISIN за ціну Y у такому-то брокері на такий-то рахунок" —
            і додаток автоматично спише гроші з cash balance цього рахунку та згенерує купонний графік.
          </p>
        </header>
        <LotsManager accountFilter={accountFilter} />
      </section>

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">📅 Календар купонів (12 місяців)</h2>
          <p className="portfolio-section-sub">Майбутні виплати по місяцях. Для спільних рахунків — показано як розподілиться між бенефіціарами.</p>
        </header>
        <CouponCalendar accountFilter={accountFilter} />
      </section>

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">💰 Транзакції готівки</h2>
          <p className="portfolio-section-sub">Поповнення, зняття, перекази, авто-списання купівель, авто-зарахування купонів.</p>
        </header>
        <TransactionsPanel accountFilter={accountFilter} />
      </section>

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">💳 Рахунки</h2>
          <p className="portfolio-section-sub">Брокерські рахунки, де фізично лежать активи. Згруповано за брокером.</p>
        </header>
        <AccountsManager />
      </section>

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">📚 Довідник облігацій (умови випуску)</h2>
          <p className="portfolio-section-sub">
            Параметри ISIN: купон, дати, номінал, періодичність. Без брокера й кількості —
            одну ISIN можна купити в різних брокерах. Для запису покупки використовуй "🛒 Купив облігацію" вище.
          </p>
        </header>
        <BondsManager />
      </section>

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">👥 Особи</h2>
          <p className="portfolio-section-sub">Люди, які є бенефіціарами рахунків.</p>
        </header>
        <PersonsManager />
      </section>

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">🏛 Брокери</h2>
          <p className="portfolio-section-sub">Установи, де фізично відкриті рахунки (Monobank, Sense, ICU, Приват…).</p>
        </header>
        <BrokersManager />
      </section>

      <section className="portfolio-section">
        <header className="portfolio-section-head">
          <h2 className="portfolio-section-title">💾 Бекап</h2>
          <p className="portfolio-section-sub">Експорт усього портфелю в JSON. Імпорт з раніше створеного файлу.</p>
        </header>
        <BackupPanel onRestore={() => setRefreshKey(k => k + 1)} />
      </section>
    </div>
  );
}
