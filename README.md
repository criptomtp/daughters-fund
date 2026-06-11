# Daughters Fund

Особистий трекер українських ОВДП і корпоративних облігацій для сім'ї.
Калькулятор накопичень + реальний облік портфелю з 15-річним горизонтом.

## Що це

Один React+Vite SPA. Без сервера. Усе локально в браузері (IndexedDB через Dexie).
Source of truth — JSON-файл бекапу, який ти регулярно експортуєш.

## Можливості

### Калькулятор (старий)
- Прогноз накопичень за DCA: ОВДП UAH (з девальвацією), EUR/USD облігації, BTC/ETH/SOL
- Розщеплення по дітях (вік → роки до 18)
- Порівняння двох сценаріїв
- Live ціни (CoinGecko + ECB)
- Моніторинг крипто-гаманців (за публічними адресами)

### Реальний облік портфелю (нове)
- **3-шарова модель:** Особи → Брокери → Рахунки (комбінація брокер + бенефіціари)
- **Спільні рахунки** з кількома бенефіціарами (напр. "Доньки разом")
- **Лоти** з НКД per piece, ціною, датою, авто-розрахунком купонного графіку
- **Розщеплення лоту** (✂) при 18-річчі — переносить частину на персональний рахунок
- **Календар купонів** на 12 місяців з бейджами `КУПОН / ПОГАШЕННЯ / КУПОН+ПОГАШЕННЯ`
- **Cash balance** на кожному рахунку (поповнення, зняття, перекази між рахунками)
- **Auto-tx** при купівлі лоту → `lot_purchase`; при отриманні купона → `coupon_received`
- **markReceived модалка** для точного запису фактичної суми/дати (відрізнення від плану)
- **Hero-tile** "Найближча виплата" + список неподтверджених
- **🎯 Goals**: для кожної дитини target sum + days to 18 + required monthly contribution
- **📊 Maturity ladder**: коли скільки погашається
- **📈 Equity curve**: daily snapshots → SVG line chart
- **📐 Diversification**: розподіл по типах/валютах/брокерах/терміну/емітентах
- **🔮 Projection**: прогноз з реінвестицією
- **XIRR** (real IRR через Newton-Raphson) замість approximated YTM
- **PWA** installable на iOS/Android home screen, offline працює
- **Backup JSON** з reminder "14 днів без бекапу" + auto-migration старих версій
- **`navigator.storage.persist()`** — браузер не видалить дані в low-storage
- **ErrorBoundary + IndexedDB detection** — стабільний fail-safe

## Запуск локально

```bash
npm install
npm run dev       # → http://localhost:5173
npm run build     # → dist/
npm run lint
```

## Деплой

Railway з `nixpacks.toml` + `railway.json`. Build → `npx serve dist`.

Альтернатива: GitHub Pages (статичний build, безкоштовно довічно).

## Архітектура

```
src/
├── App.jsx                  # Калькулятор + Гаманці + Порівняння + Інструменти (старий)
├── App.css
├── main.jsx                 # ErrorBoundary + SupportCheck + App
├── index.css
└── portfolio/               # Реальний облік (новий, з 2026-05)
    ├── db.js                # Dexie schema v5 з міграціями v1→v5
    ├── repository.js        # persons/brokers/accounts/bonds/lots/coupons/transactions/snapshots/demo
    ├── calculations.js      # couponSchedule, accruedInterest O(1), xirr, goalProgress, maturityLadder
    ├── taxRules.js          # ОВДП 0%, корпоративні 23%
    ├── bondConstants.js     # EMPTY_BOND_DRAFT
    ├── migrations.js        # backup JSON upgrade chain v1→v5
    ├── PortfolioTab.jsx     # корінь вкладки + фільтр-чіпи
    ├── PersonsManager.jsx   # CRUD осіб + targetAmount
    ├── BrokersManager.jsx   # CRUD брокерів
    ├── AccountsManager.jsx  # CRUD рахунків (groupped by broker), показ балансів
    ├── BondsManager.jsx     # CRUD довідника облігацій
    ├── BondForm.jsx         # форма облігації (reused в Lots inline)
    ├── LotsManager.jsx      # CRUD лотів, форма покупки, split, inline create bond
    ├── CouponCalendar.jsx   # 12-міс календар з типами kind
    ├── MarkReceivedModal.jsx# модалка точного запису факту
    ├── TransactionsPanel.jsx# історія готівки + Поповнити/Зняти/Переказ
    ├── CashOpForm.jsx       # модалка deposit/withdraw/transfer
    ├── AccountDashboard.jsx # тайли + збірка Hero/Goals/Equity/Ladder/Diversification/Projection
    ├── HeroTile.jsx         # next coupon + overdue list
    ├── GoalsPanel.jsx       # progress to 18 for each child
    ├── MaturityLadder.jsx   # SVG bar chart по роках
    ├── EquityCurve.jsx      # SVG line chart з daily snapshots
    ├── DiversificationPanel.jsx  # bars по 5 групам
    ├── ProjectionPanel.jsx  # compound projection з графіком
    ├── OnboardingBanner.jsx # empty state CTA "Завантажити демо"
    ├── BackupPanel.jsx      # JSON export/import + stale warning
    ├── Modal.jsx            # generic modal wrapper з Esc + ARIA
    ├── ErrorBoundary.jsx    # React ErrorBoundary з UI
    ├── SupportCheck.jsx     # detection IndexedDB + persist storage
    ├── portfolio.css        # "Private ledger" дизайн
    └── hooks/
        ├── usePersons.js    # useLiveQuery + seed
        ├── useAccounts.js
        ├── useBrokers.js
        ├── useBonds.js
        ├── useLots.js
        ├── useCoupons.js
        └── useTransactions.js  # + useCashBalance
```

### Модель даних

```
Person  ─┐
         ├─→ Account.beneficiaryIds (many-to-many)
Broker ──┘                  │
                            │
              Account ──< Lot ──< CouponPayment
                  │            │
                  └──< CashTransaction (refId → Lot або Coupon)
                            │
Snapshots (date, totalsByCurrency) ← обчислюється з Lots + Cash
```

### Інваріанти
- `Account.beneficiaryIds.length ≥ 1`, `personal: exactly 1`, `shared: ≥ 2`
- `Lot.accountId` — immutable після створення (move = split)
- `Lot.purchasePrice = clean price`, `accruedInterestPerPiece` окремо
- `CashTransaction.amount` — signed (deposit +, withdraw −, lot_purchase −, coupon_received +)
- `Transfer` — atomic пара `transfer_out`/`transfer_in` з взаємними `counterTxId`
- `Snapshots` — один на день (PK = date), авто-снімок при відкритті вкладки
- Видалення особи блокується якщо вона бенефіціар
- Видалення рахунку блокується якщо є лоти або транзакції
- Видалення ISIN блокується якщо є лоти

## Безпека

- **CSP** в `index.html` (script-src 'self', connect-src whitelisted 5 APIs)
- **referrer="no-referrer"** для приватності адрес гаманців
- **Privacy notice** у вкладці Гаманці
- Backup JSON — **не зашифрований** (особистий додаток). Тримай файли в Drive/iCloud
- ОВДП тримаються по адресах персональних рахунків ICU/Monobank/Sense — не йдуть в наш додаток

## Roadmap (нереалізовано)

- Read-only sharing link для дружини/тещі через encrypted URL fragment
- Push reminders за 3 дні до купона (Web Push або Telegram bot)
- Auto-fetch ISIN reference data з bank.gov.ua (потребує serverless proxy)
- Vitest тести для calculations.js (xirr, accruedInterest, generateCouponSchedule)
- Backup encryption (AES-GCM + PBKDF2)
- Vite 5 → 8 upgrade
