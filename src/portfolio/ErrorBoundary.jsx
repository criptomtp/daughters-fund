import { Component } from "react";

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Залогувати в консоль; у майбутньому — слати в Sentry/etc.
    console.error("[Daughters Fund] Uncaught error:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <h1 className="error-boundary-title">Сталася непередбачувана помилка</h1>
          <p className="error-boundary-msg">
            Додаток впав. Дані в IndexedDB у безпеці, але інтерфейс не зміг відновитись.
          </p>
          <pre className="error-boundary-stack">{String(this.state.error?.message || this.state.error)}</pre>
          <div className="error-boundary-actions">
            <button className="error-boundary-btn" onClick={this.reset}>Спробувати знову</button>
            <button className="error-boundary-btn" onClick={() => window.location.reload()}>Перезавантажити сторінку</button>
          </div>
          <p className="error-boundary-hint">
            Якщо помилка повторюється — зробіть бекап (вкладка Портфель → Бекап → Експорт JSON) до повторного запуску.
          </p>
        </div>
      </div>
    );
  }
}
