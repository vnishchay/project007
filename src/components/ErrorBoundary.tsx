import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * One broken screen must never leave a blank app. Shows what went wrong with a way back,
 * and resets when the address changes (`resetKey`).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Screen crashed:", error, info.componentStack); }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <div className="empty" role="alert">
          <h2>Something went wrong on this screen</h2>
          <p className="small muted">Reload to try again. If it keeps happening, send us this: <code style={{ wordBreak: "break-word" }}>{error.message || String(error)}</code></p>
          <div className="row wrap" style={{ justifyContent: "center", gap: 8 }}>
            <button type="button" className="btn small green" onClick={() => window.location.reload()}>Reload</button>
            <a href="/" className="btn small ghost">Home</a>
          </div>
        </div>
      </div>
    );
  }
}
