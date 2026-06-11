import { useState, useMemo } from "react";
import { BOND_TYPES, CURRENCIES, COUPON_FREQUENCIES, taxRateLabel } from "./taxRules.js";
import { generateCouponSchedule, xirr } from "./calculations.js";
import { Modal } from "./Modal.jsx";

const TYPE_LABELS = { ovdp: "ОВДП", corporate: "Корпоративна" };
const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

function fmt(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  return sym + Math.round(n * 100) / 100 + "";
}
function fmtMoney(n, cur = "UAH") {
  if (n == null || !isFinite(n)) return "—";
  const sym = CURRENCY_SYMBOL[cur] || "";
  return sym + Math.round(n).toLocaleString("uk-UA");
}

const KIND_OPTIONS = [
  { value: "coupon",             label: "Купон" },
  { value: "coupon+redemption",  label: "Купон + погашення" },
  { value: "redemption",         label: "Погашення (тільки тіло)" },
];

function autoSchedule(bond) {
  // Generate schedule using current bond conditions
  if (!bond.issueDate || !bond.maturityDate || !bond.couponFrequency || !bond.couponRate) return [];
  const fakeLot = { purchaseDate: "1900-01-01", quantity: 1, purchasePrice: bond.faceValue, accruedInterestPerPiece: 0, commission: 0 };
  const schedule = generateCouponSchedule(
    { ...bond, customSchedule: null },
    fakeLot
  );
  return schedule.map(p => ({
    date: p.scheduledDate.slice(0, 10),
    amountPerPiece: Math.round((p.amountGross / fakeLot.quantity) * 100) / 100,
    kind: p.kind || "coupon",
  }));
}

export function BondForm({ initial, isNew, onSubmit, onCancel, asModal = true }) {
  const [draft, setDraft] = useState(() => ({
    ...initial,
    customSchedule: Array.isArray(initial.customSchedule) ? initial.customSchedule : null,
  }));
  const [mode, setMode] = useState(Array.isArray(draft.customSchedule) && draft.customSchedule.length > 0 ? "manual" : "auto");

  // Calculator preview (DropStab-style smart input: 2 of 3 → third auto)
  const [calc, setCalc] = useState(() => ({
    quantity: 100,
    pricePerPiece: initial.faceValue || 1000,
    totalCost: 100 * (initial.faceValue || 1000),
    commission: 0,
    purchaseDate: new Date().toISOString().slice(0, 10),
    lastEdited: "quantity",
  }));

  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  // DropStab-style 2-of-3 auto-fill
  const round2 = (n) => Math.round(n * 100) / 100;
  const handleCalcChange = (field, rawValue) => {
    setCalc(c => {
      const next = { ...c, [field]: rawValue, lastEdited: field };
      const q = Number(field === "quantity"      ? rawValue : c.quantity);
      const p = Number(field === "pricePerPiece" ? rawValue : c.pricePerPiece);
      const t = Number(field === "totalCost"     ? rawValue : c.totalCost);
      const cm = Number(c.commission) || 0;

      // The "auto" field = the one not equal to `field` and not the previous lastEdited
      // i.e., user's input field stays + the previously-edited stays + we recompute the third
      const previous = c.lastEdited;
      const candidates = ["quantity", "pricePerPiece", "totalCost"].filter(f => f !== field && f !== previous);
      const autoField = candidates[0] || candidates[0] === undefined
        ? candidates[0]
        : ["quantity", "pricePerPiece", "totalCost"].find(f => f !== field);

      const target = autoField || ["quantity", "pricePerPiece", "totalCost"].find(f => f !== field);

      if (target === "totalCost" && q > 0 && p > 0) {
        next.totalCost = round2(q * p + cm);
      } else if (target === "pricePerPiece" && q > 0 && t >= 0) {
        next.pricePerPiece = round2((t - cm) / q);
      } else if (target === "quantity" && p > 0 && t > 0) {
        next.quantity = Math.max(1, Math.round((t - cm) / p));
      }
      return next;
    });
  };

  const handleCommissionChange = (v) => {
    setCalc(c => {
      const next = { ...c, commission: v };
      const q = Number(next.quantity);
      const p = Number(next.pricePerPiece);
      const t = Number(next.totalCost);
      const cm = Number(v) || 0;
      if (c.lastEdited === "totalCost" && q > 0) {
        next.pricePerPiece = round2((t - cm) / q);
      } else if (q > 0 && p > 0) {
        next.totalCost = round2(q * p + cm);
      }
      return next;
    });
  };

  const submit = () => {
    const payload = { ...draft };
    if (mode === "manual" && Array.isArray(draft.customSchedule)) {
      payload.customSchedule = draft.customSchedule.filter(r => r.date && r.amountPerPiece);
    } else {
      payload.customSchedule = null;
    }
    onSubmit(payload);
  };

  const canSubmit = draft.isin && draft.isin.length === 12;
  const taxLabel = taxRateLabel(draft.type, "coupon");

  // ── Schedule editor handlers ──
  const generateAuto = () => {
    const list = autoSchedule(draft);
    upd("customSchedule", list);
  };
  const addRow = () => {
    upd("customSchedule", [...(draft.customSchedule || []), {
      date: draft.maturityDate?.slice(0, 10) || "",
      amountPerPiece: 0,
      kind: "coupon",
    }]);
  };
  const removeRow = (idx) => {
    upd("customSchedule", draft.customSchedule.filter((_, i) => i !== idx));
  };
  const updRow = (idx, patch) => {
    upd("customSchedule", draft.customSchedule.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    if (nextMode === "manual" && (!draft.customSchedule || draft.customSchedule.length === 0)) {
      generateAuto();
    }
    if (nextMode === "auto") {
      upd("customSchedule", null);
    }
  };

  // ── Calculator preview ──
  // Розклад: dirty per piece = pricePerPiece (як показує брокер, з НКД)
  // Clean per piece = faceValue (для ОВДП завжди номінал)
  // НКД per piece = max(0, dirtyPerPiece - faceValue)
  const faceVal = Number(draft.faceValue) || 1000;
  const dirtyPerPiece = Number(calc.pricePerPiece) || 0;
  const cleanPerPiece = Math.min(dirtyPerPiece, faceVal);
  const accruedPerPiece = Math.max(0, dirtyPerPiece - faceVal);

  const schedule = useMemo(() => {
    const fakeLot = {
      purchaseDate: calc.purchaseDate,
      quantity: Number(calc.quantity) || 1,
      purchasePrice: cleanPerPiece || faceVal,
      accruedInterestPerPiece: accruedPerPiece,
      commission: Number(calc.commission) || 0,
    };
    const bondNow = mode === "manual"
      ? { ...draft, customSchedule: (draft.customSchedule || []).filter(r => r.date && r.amountPerPiece) }
      : { ...draft, customSchedule: null };
    return generateCouponSchedule(bondNow, fakeLot);
  }, [draft, mode, calc, cleanPerPiece, accruedPerPiece, faceVal]);

  const calcMetrics = useMemo(() => {
    const invested = Number(calc.totalCost) || 0;
    const totalGross = schedule.reduce((s, p) => s + p.amountGross, 0);
    const totalNet   = schedule.reduce((s, p) => s + p.amountNet, 0);
    const profitNet = totalNet - invested;
    const profitPct = invested > 0 ? (profitNet / invested) * 100 : 0;
    const flows = [
      { date: calc.purchaseDate, amount: -invested },
      ...schedule.map(p => ({ date: p.scheduledDate, amount: p.amountNet })),
    ];
    const rate = xirr(flows);
    return {
      invested, totalGross, totalNet, profitNet, profitPct,
      xirr: rate != null ? rate * 100 : null,
    };
  }, [calc, schedule]);

  // Auto-computed field marker для UX
  const lastEdited = calc.lastEdited;
  // Heuristic: computed field = "totalCost" by default unless user edited it
  const computedField = lastEdited === "totalCost" ? "pricePerPiece" : "totalCost";

  const cur = draft.currency || "UAH";

  const inner = (
    <>
      <h3 className="modal-title">{isNew ? "Нова облігація у довідник" : `ISIN ${draft.isin}`}</h3>

      {isNew && (
        <div className="modal-info" style={{ marginBottom: "12px", marginTop: 0 }}>
          💡 Це <strong>довідник умов випуску</strong>. Тут вводиш параметри облігації + графік виплат.
          Внизу — калькулятор: вкажи кількість і ціну, побачиш скільки заробиш.
          Для запису реальної покупки на конкретний рахунок натисни <strong>"🛒 Купив облігацію"</strong> у секції Лоти.
        </div>
      )}

      <div className="form-grid">
        <Field label="ISIN" required>
          <input
            className="form-input mono"
            value={draft.isin}
            onChange={e => upd("isin", e.target.value.toUpperCase())}
            maxLength={12}
            disabled={!isNew}
            placeholder="UA4000XXXXXX"
          />
        </Field>
        <Field label="Тікер (опц.)">
          <input className="form-input" value={draft.ticker} onChange={e => upd("ticker", e.target.value)} placeholder="напр. ОВДП-2027-04" />
        </Field>
        <Field label="Тип">
          <select className="form-input" value={draft.type} onChange={e => upd("type", e.target.value)}>
            {BOND_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Валюта">
          <select className="form-input" value={draft.currency} onChange={e => upd("currency", e.target.value)}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Номінал">
          <input type="number" step="0.01" className="form-input" value={draft.faceValue} onChange={e => upd("faceValue", Number(e.target.value))} />
        </Field>
        <Field label="Купон, %/рік">
          <input type="number" step="0.01" className="form-input" value={draft.couponRate} onChange={e => upd("couponRate", Number(e.target.value))} />
        </Field>
        <Field label="Періодичність">
          <select className="form-input" value={draft.couponFrequency} onChange={e => upd("couponFrequency", Number(e.target.value))}>
            {COUPON_FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Емітент">
          <input className="form-input" value={draft.issuer} onChange={e => upd("issuer", e.target.value)} />
        </Field>
        <Field label="Дата випуску">
          <input type="date" className="form-input" value={draft.issueDate?.slice(0, 10) || ""} onChange={e => upd("issueDate", e.target.value)} />
        </Field>
        <Field label="Дата погашення">
          <input type="date" className="form-input" value={draft.maturityDate?.slice(0, 10) || ""} onChange={e => upd("maturityDate", e.target.value)} />
        </Field>
        <Field label="Замітки" full>
          <textarea className="form-input" rows={2} value={draft.notes} onChange={e => upd("notes", e.target.value)} />
        </Field>
      </div>

      {/* ── Schedule editor ── */}
      <div className="schedule-editor">
        <div className="schedule-head">
          <h4 className="schedule-title">📅 Графік виплат</h4>
          <div className="schedule-mode">
            <label>
              <input type="radio" checked={mode === "auto"} onChange={() => handleModeChange("auto")} />
              Авто з умов
            </label>
            <label>
              <input type="radio" checked={mode === "manual"} onChange={() => handleModeChange("manual")} />
              Ручний (як у Monobank/ICU)
            </label>
          </div>
        </div>

        {mode === "manual" && (
          <>
            <div className="schedule-toolbar">
              <button type="button" className="owner-action-btn" onClick={generateAuto}>↻ Згенерувати з умов</button>
              <button type="button" className="owner-action-btn" onClick={addRow}>+ Додати виплату</button>
            </div>
            {(draft.customSchedule || []).length === 0 ? (
              <div className="portfolio-empty">Жодної виплати. Натисни "↻ Згенерувати з умов" або "+ Додати виплату".</div>
            ) : (
              <div className="schedule-table">
                <div className="schedule-row schedule-row--head">
                  <span>#</span>
                  <span>Дата</span>
                  <span>Сума за 1 шт.</span>
                  <span>Тип</span>
                  <span></span>
                </div>
                {(draft.customSchedule || []).map((row, i) => (
                  <div key={i} className="schedule-row">
                    <span className="schedule-idx">{i + 1}</span>
                    <input
                      type="date" className="form-input"
                      value={row.date?.slice(0, 10) || ""}
                      onChange={e => updRow(i, { date: e.target.value })}
                    />
                    <div className="schedule-amount-cell">
                      <input
                        type="number" step="0.01" className="form-input"
                        value={row.amountPerPiece}
                        onChange={e => updRow(i, { amountPerPiece: Number(e.target.value) })}
                      />
                      <span className="schedule-cur">{cur}</span>
                    </div>
                    <select
                      className="form-input"
                      value={row.kind || "coupon"}
                      onChange={e => updRow(i, { kind: e.target.value })}
                    >
                      {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button type="button" className="remove-btn" onClick={() => removeRow(i)} aria-label="Видалити">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="schedule-hint">
              💡 Останній рядок зазвичай "купон + погашення" — сума = купонна виплата + номінал ({fmtMoney(draft.faceValue, cur)}).
              Приклад з Monobank: 5 рядків по {fmt(80.8, cur)} (купон) + останній {fmt(1080.8, cur)} (купон+погашення).
            </div>
          </>
        )}
      </div>

      {/* ── Calculator preview ── */}
      <div className="calc-preview">
        <h4 className="calc-title">🧮 Калькулятор покупки (DropStab-style)</h4>
        <p className="calc-sub">
          Заповни <strong>будь-які 2 з 3 полів</strong> — третє обчислиться автоматично (поле з 🔄).
          Зміни товщині величину — інше переобчислиться. <strong>Це лише симуляція</strong>, не зберігається.
        </p>

        <div className="form-grid">
          <Field label={<>Кількість {computedField === "quantity" && <span className="calc-auto-badge">🔄 авто</span>}</>}>
            <input
              type="number" step="1" min="1"
              className={`form-input ${computedField === "quantity" ? "form-input--auto" : ""}`}
              value={calc.quantity}
              onChange={e => handleCalcChange("quantity", e.target.value)}
            />
          </Field>
          <Field label={<>Ціна за 1 шт. (з НКД, як показує брокер) {computedField === "pricePerPiece" && <span className="calc-auto-badge">🔄 авто</span>}</>}>
            <input
              type="number" step="0.01"
              className={`form-input ${computedField === "pricePerPiece" ? "form-input--auto" : ""}`}
              value={calc.pricePerPiece}
              onChange={e => handleCalcChange("pricePerPiece", e.target.value)}
            />
          </Field>
          <Field label={<>Заплатив всього (списано) {computedField === "totalCost" && <span className="calc-auto-badge">🔄 авто</span>}</>}>
            <input
              type="number" step="0.01"
              className={`form-input ${computedField === "totalCost" ? "form-input--auto" : ""}`}
              value={calc.totalCost}
              onChange={e => handleCalcChange("totalCost", e.target.value)}
            />
          </Field>
          <Field label="Комісія брокера (включено в суму)">
            <input
              type="number" step="0.01"
              className="form-input"
              value={calc.commission}
              onChange={e => handleCommissionChange(e.target.value)}
            />
          </Field>
          <Field label="Дата покупки">
            <input type="date" className="form-input"
              value={calc.purchaseDate}
              onChange={e => setCalc(c => ({ ...c, purchaseDate: e.target.value }))} />
          </Field>
        </div>

        {/* Decomposition: показ як ціна розкладається на номінал + націнку/НКД */}
        <div className="calc-decompose">
          <div className="calc-decompose-row">
            <span>Номінал × кількість:</span>
            <strong>{fmtMoney(faceVal * Number(calc.quantity), cur)}</strong>
          </div>
          <div className="calc-decompose-row">
            <span>Націнка / НКД на 1 шт ({fmtMoney(dirtyPerPiece - faceVal, cur)} над номіналом):</span>
            <strong style={{ color: dirtyPerPiece > faceVal ? "var(--oxblood)" : "var(--gain)" }}>
              {dirtyPerPiece >= faceVal ? "+" : ""}{fmtMoney((dirtyPerPiece - faceVal) * Number(calc.quantity), cur)}
            </strong>
          </div>
          {Number(calc.commission) > 0 && (
            <div className="calc-decompose-row">
              <span>Комісія брокера:</span>
              <strong>{fmtMoney(Number(calc.commission), cur)}</strong>
            </div>
          )}
        </div>

        <div className="calc-result">
          <div className="calc-row">
            <span>📤 Списано з рахунку</span>
            <strong>{fmtMoney(calcMetrics.invested, cur)}</strong>
          </div>
          <div className="calc-row">
            <span>📥 Сума всіх виплат (gross)</span>
            <strong>{fmtMoney(calcMetrics.totalGross, cur)}</strong>
          </div>
          <div className="calc-row">
            <span>📥 Сума всіх виплат (net, після податків)</span>
            <strong>{fmtMoney(calcMetrics.totalNet, cur)}</strong>
          </div>
          <div className="calc-row calc-row--profit">
            <span>💰 Чистий прибуток</span>
            <strong style={{ color: calcMetrics.profitNet >= 0 ? "var(--gain)" : "var(--oxblood)" }}>
              {calcMetrics.profitNet >= 0 ? "+" : ""}{fmtMoney(calcMetrics.profitNet, cur)}
              {" "}({calcMetrics.profitPct >= 0 ? "+" : ""}{calcMetrics.profitPct.toFixed(2)}%)
            </strong>
          </div>
          {calcMetrics.xirr != null && (
            <div className="calc-row calc-row--xirr">
              <span>📈 Реальний відсоток (XIRR)</span>
              <strong style={{ color: "var(--brass)" }}>{calcMetrics.xirr.toFixed(2)}% / рік</strong>
            </div>
          )}
        </div>

        {schedule.length > 0 && (
          <details className="calc-schedule-details">
            <summary>📅 Графік виплат для цієї покупки ({schedule.length})</summary>
            <div className="calc-schedule-list">
              {schedule.map((p, i) => (
                <div key={i} className="calc-schedule-item">
                  <span className="calc-schedule-idx">{i + 1}</span>
                  <span className="calc-schedule-date">{p.scheduledDate?.slice(0, 10)}</span>
                  <span className="calc-schedule-kind">{KIND_OPTIONS.find(o => o.value === p.kind)?.label || "Купон"}</span>
                  <span className="calc-schedule-amount">{fmtMoney(p.amountNet, cur)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="modal-info">💸 Оподаткування купона: <strong>{taxLabel}</strong></div>

      <div className="modal-actions">
        <button className="owner-action-btn ok" onClick={submit} disabled={!canSubmit}>
          {isNew ? "Додати" : "Зберегти"}
        </button>
        <button className="owner-action-btn" onClick={onCancel}>Скасувати</button>
      </div>
    </>
  );

  if (!asModal) return <div className="modal-inline">{inner}</div>;
  return <Modal onClose={onCancel} ariaLabel="Форма облігації">{inner}</Modal>;
}

function Field({ label, required, full, children }) {
  return (
    <label className={`form-field ${full ? "form-field--full" : ""}`}>
      <span className="form-label">{label}{required && <span className="req">*</span>}</span>
      {children}
    </label>
  );
}
