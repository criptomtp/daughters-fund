import { useState } from "react";
import { useBrokers } from "./hooks/useBrokers.js";

const EMOJI_PRESETS = ["🏛", "🏦", "🖤", "🌿", "💚", "💙", "💛", "🟧"];

export function BrokersManager() {
  const { list, loading, error, add, update, remove } = useBrokers();
  const [adding, setAdding] = useState(false);
  const [opErr, setOpErr] = useState(null);

  if (loading) return <div className="portfolio-loading">Завантаження…</div>;

  const handleAdd = async (draft) => {
    setOpErr(null);
    try { await add(draft); setAdding(false); }
    catch (e) { setOpErr(e.message); }
  };

  const handleRemove = async (id, name) => {
    if (!confirm(`Видалити брокера "${name}"?`)) return;
    setOpErr(null);
    try { await remove(id); }
    catch (e) { setOpErr(e.message); }
  };

  const handleUpdate = async (id, patch) => {
    setOpErr(null);
    try { await update(id, patch); }
    catch (e) { setOpErr(e.message); }
  };

  return (
    <div className="owners-manager">
      {error && <div className="portfolio-error">⚠ {error}</div>}
      {opErr && <div className="portfolio-error">⚠ {opErr}</div>}

      <div className="owners-list">
        {list.length === 0 && (
          <div className="portfolio-empty">Жодного брокера.</div>
        )}
        {list.map(b => (
          <BrokerRow key={b.id} broker={b} onUpdate={handleUpdate} onRemove={handleRemove} />
        ))}
      </div>

      {adding ? (
        <NewBrokerForm onSubmit={handleAdd} onCancel={() => setAdding(false)} />
      ) : (
        <button className="add-btn" onClick={() => setAdding(true)}>+ Додати брокера</button>
      )}
    </div>
  );
}

function BrokerRow({ broker, onUpdate, onRemove }) {
  const [name, setName] = useState(broker.name);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== broker.name) onUpdate(broker.id, { name: trimmed });
    else setName(broker.name);
  };

  return (
    <div className="owner-row" style={{ "--owner-color": broker.color }}>
      <span className="owner-emoji">{broker.emoji}</span>
      <input
        className="owner-name-input"
        value={name}
        onChange={e => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === "Enter" && e.target.blur()}
        aria-label="Назва брокера"
      />
      <button className="remove-btn" onClick={() => onRemove(broker.id, broker.name)} aria-label="Видалити">✕</button>
    </div>
  );
}

function NewBrokerForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI_PRESETS[0]);

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), emoji });
  };

  return (
    <div className="owner-row owner-row--new">
      <select
        className="owner-type-select"
        value={emoji}
        onChange={e => setEmoji(e.target.value)}
        aria-label="Іконка"
      >
        {EMOJI_PRESETS.map(e => <option key={e} value={e}>{e}</option>)}
      </select>
      <input
        className="owner-name-input"
        placeholder="Напр. ICU, Monobank, Sense"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === "Enter" && submit()}
        autoFocus
        aria-label="Назва"
      />
      <button className="owner-action-btn ok" onClick={submit} disabled={!name.trim()}>Додати</button>
      <button className="owner-action-btn" onClick={onCancel} aria-label="Скасувати">✕</button>
    </div>
  );
}
