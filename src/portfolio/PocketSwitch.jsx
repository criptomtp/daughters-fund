// Перемикач просторів. Показується лише коли кишень справді більше однієї —
// поки ведеш тільки доньок, зайвого контролу на екрані немає.

export function PocketSwitch({ pockets, pocketId, onChange }) {
  if (!pockets || pockets.length < 2) return null;
  return (
    <div className="pocket-switch" role="tablist" aria-label="Чий портфель">
      {pockets.map(p => (
        <button
          key={p.id}
          role="tab"
          aria-selected={p.id === pocketId}
          className={`pocket-tab ${p.id === pocketId ? "active" : ""}`}
          style={p.id === pocketId ? { "--pocket-color": p.color || "var(--brass)" } : undefined}
          onClick={() => onChange(p.id)}
        >
          {p.emoji} {p.name}
        </button>
      ))}
    </div>
  );
}
