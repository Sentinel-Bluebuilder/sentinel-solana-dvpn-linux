// ─── ErrorBoundary: a crashed screen shows "This screen hit a problem." with Try again ───
// Own file so tests/unit/error-boundary.test.ts can drive it without the App shell (Q0268).
import { Component, type ReactNode } from 'react';
import { tr } from '../../../shared/i18n';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('screen crashed', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card m-6">
        <h2 className="mb-2 font-semibold">{tr('This screen hit a problem.')}</h2>
        <p className="mb-4 text-sm text-fg-dim">{tr('Your connection is not affected. {message}', { message: this.state.error.message })}</p>
        <button className="btn-ghost" data-error-retry onClick={() => this.setState({ error: null })}>{tr('Try again')}</button>
      </div>
    );
  }
}
