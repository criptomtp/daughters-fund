import { useState } from "react";
import { useBonds } from "./hooks/useBonds.js";
import { BondForm } from "./BondForm.jsx";
import { EMPTY_BOND_DRAFT } from "./bondConstants.js";

const TYPE_LABELS = { ovdp: "ОВДП", corporate: "Корпоративна" };
const TYPE_COLORS = { ovdp: "#4ade80", corporate: "#fb923c" };
const CURRENCY_SYMBOL = { UAH: "₴", USD: "$", EUR: "€" };

export function BondsManager() {
  const { list, loading, error, add, update, remove } = useBonds();
  const [opErr, setOpErr] = useState(null);
  const [editingBond, setEditingBond] = useState(null); // null | "new" | bondObj

  if (loading) return <div className="portfolio-loading">Завантаження…</div>;

  const handleSubmit = async (draft) => {
    setOpErr(null);
    try {
      if (editingBond === "new") await add(draft);
      else await update(editingBond.isin, draft);
      setEditingBond(null);
    } catch (e) {
      setOpErr(e.message);
    }
  };

  const handleRemove = async (isin) => {
    if (!confirm(`Видалити ISIN ${isin}?`)) return;
    setOpErr(null);
    try { await remove(isin); }
    catch (e) { setOpErr(e.message); }
  };

  return (
    <div className="bonds-manager">
      {error && <div className="portfolio-error">⚠ {error}</div>}
      {opErr && <div className="portfolio-error">⚠ {opErr}</div>}

      <div className="bonds-list">
        {list.length === 0 && (
          <div className="portfolio-empty">Жодного ISIN. Додайте першу облігацію нижче.</div>
        )}
        {list.map(b => (
          <div key={b.isin} className="bond-card" style={{ "--bond-color": TYPE_COLORS[b.type] }}>
            <div className="bond-card-main">
              <div className="bond-card-top">
                <span className="bond-isin">{b.isin}</span>
                <span className="bond-type-badge" style={{ color: TYPE_COLORS[b.type] }}>
                  {TYPE_LABELS[b.type]}
                </span>
                <span className="bond-currency">{CURRENCY_SYMBOL[b.currency]} {b.currency}</span>
              </div>
              <div className="bond-card-meta">
                <span>{b.ticker || "—"}</span>
                <span className="bond-meta-sep">·</span>
                <span>купон {b.couponRate}%</span>
                <span className="bond-meta-sep">·</span>
                <span>номінал {b.faceValue}</span>
                <span className="bond-meta-sep">·</span>
                <span>погашення {b.maturityDate?.slice(0, 10) || "—"}</span>
              </div>
            </div>
            <div className="bond-card-actions">
              <button className="owner-action-btn" onClick={() => setEditingBond(b)}>✎</button>
              <button className="remove-btn" onClick={() => handleRemove(b.isin)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <button className="add-btn" onClick={() => setEditingBond("new")}>📚 + Додати ISIN у довідник</button>

      {editingBond && (
        <BondForm
          initial={editingBond === "new" ? EMPTY_BOND_DRAFT : editingBond}
          isNew={editingBond === "new"}
          onSubmit={handleSubmit}
          onCancel={() => setEditingBond(null)}
        />
      )}
    </div>
  );
}
