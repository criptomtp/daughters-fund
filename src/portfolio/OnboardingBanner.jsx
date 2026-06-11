import { useState } from "react";
import { demo } from "./repository.js";

export function OnboardingBanner({ visible }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  if (!visible) return null;

  const loadDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      await demo.loadSamplePortfolio();
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="onboarding-banner success">
        <span>✓ Демо-портфель завантажено. Прокрути нижче — побачиш приклад рахунків, лотів і купонів.</span>
      </div>
    );
  }

  return (
    <div className="onboarding-banner">
      <div className="onboarding-content">
        <h3 className="onboarding-title">👋 Перший раз тут?</h3>
        <p className="onboarding-text">
          Поки що порожньо. Завантаж демо-портфель — побачиш як працює: 2 ОВДП, 2 рахунки
          (Доньки разом ICU + Тато Monobank), 3 лоти, поповнення готівки.
          Усе можна потім видалити вручну.
        </p>
        {error && <div className="portfolio-error">⚠ {error}</div>}
      </div>
      <button className="onboarding-cta" onClick={loadDemo} disabled={loading}>
        {loading ? "Завантаження…" : "🎁 Завантажити демо-портфель"}
      </button>
    </div>
  );
}
