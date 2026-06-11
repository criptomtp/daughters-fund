import { useState } from "react";
import { usePersons } from "./hooks/usePersons.js";

const TYPE_OPTIONS = [
  { value: "parent", label: "Дорослий" },
  { value: "child",  label: "Дитина" },
  { value: "other",  label: "Інший" },
];

const COLORS = ["#c9a96a", "#8fae7a", "#6f86c4", "#b85c5c", "#a78bfa", "#f472b6", "#fb923c", "#22d3ee"];
const EMOJI_BY_TYPE = { parent: "👨", child: "👧", other: "👤" };

function nextColor(taken) {
  return COLORS.find(c => !taken.includes(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
}

export function PersonsManager() {
  const { list, loading, error, add, update, remove } = usePersons();
  const [adding, setAdding] = useState(false);
  const [opErr, setOpErr] = useState(null);

  if (loading) return <div className="portfolio-loading">Завантаження…</div>;

  const handleAdd = async (draft) => {
    setOpErr(null);
    try {
      const color = nextColor(list.map(o => o.color));
      const emoji = EMOJI_BY_TYPE[draft.type] || "👤";
      await add({ ...draft, emoji, color });
      setAdding(false);
    } catch (e) { setOpErr(e.message); }
  };

  const handleRemove = async (id, name) => {
    if (!confirm(`Видалити особу "${name}"?\nЦе також видалить їх з бенефіціарів усіх рахунків (якщо нема залежних лотів).`)) return;
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
          <div className="portfolio-empty">Жодної особи. Додайте першу нижче.</div>
        )}
        {list.map(p => (
          <PersonRow key={p.id} person={p} onUpdate={handleUpdate} onRemove={handleRemove} />
        ))}
      </div>

      {adding ? (
        <NewPersonForm onSubmit={handleAdd} onCancel={() => setAdding(false)} />
      ) : (
        <button className="add-btn" onClick={() => setAdding(true)}>+ Додати особу</button>
      )}
    </div>
  );
}

function PersonRow({ person, onUpdate, onRemove }) {
  const [name, setName] = useState(person.name);
  const [target, setTarget] = useState(person.targetAmount ?? "");

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== person.name) onUpdate(person.id, { name: trimmed });
    else setName(person.name);
  };

  const commitTarget = () => {
    const num = target === "" ? null : Number(target);
    if (num !== person.targetAmount) onUpdate(person.id, { targetAmount: num });
  };

  return (
    <div className="owner-row" style={{ "--owner-color": person.color }}>
      <span className="owner-emoji">{person.emoji}</span>
      <input
        className="owner-name-input"
        value={name}
        onChange={e => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === "Enter" && e.target.blur()}
        aria-label="Ім'я"
      />
      <select
        className="owner-type-select"
        value={person.type}
        onChange={e => onUpdate(person.id, { type: e.target.value, emoji: EMOJI_BY_TYPE[e.target.value] })}
        aria-label="Тип"
      >
        {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input
        type="date"
        className="owner-date-input"
        value={person.birthDate ? person.birthDate.slice(0, 10) : ""}
        onChange={e => onUpdate(person.id, { birthDate: e.target.value || null })}
        aria-label="Дата народження"
        title="Дата народження (для розрахунку цілі до 18 років)"
      />
      <input
        type="number"
        step="1000"
        min="0"
        className="owner-target-input"
        value={target}
        placeholder="ціль ₴"
        onChange={e => setTarget(e.target.value)}
        onBlur={commitTarget}
        aria-label="Ціль до 18 років"
        title="Цільова сума на 18-річчя (опціонально)"
      />
      <button className="remove-btn" onClick={() => onRemove(person.id, person.name)} aria-label="Видалити">✕</button>
    </div>
  );
}

function NewPersonForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("child");
  const [birthDate, setBirthDate] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), type, birthDate: birthDate || null });
  };

  return (
    <div className="owner-row owner-row--new">
      <span className="owner-emoji">{EMOJI_BY_TYPE[type]}</span>
      <input
        className="owner-name-input"
        placeholder="Ім'я нової особи"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === "Enter" && submit()}
        autoFocus
        aria-label="Ім'я"
      />
      <select className="owner-type-select" value={type} onChange={e => setType(e.target.value)}>
        {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input
        type="date"
        className="owner-date-input"
        value={birthDate}
        onChange={e => setBirthDate(e.target.value)}
        aria-label="Дата народження"
      />
      <button className="owner-action-btn ok" onClick={submit} disabled={!name.trim()}>Додати</button>
      <button className="owner-action-btn" onClick={onCancel} aria-label="Скасувати">✕</button>
    </div>
  );
}
