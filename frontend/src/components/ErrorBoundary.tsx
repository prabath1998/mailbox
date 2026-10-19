import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Catches render errors so one bad message can't blank the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: (reset: () => void) => ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-semibold">MailBox hit an unexpected error</p>
        <p className="max-w-sm text-[13px] text-muted">{this.state.error.message}</p>
        <button onClick={() => location.reload()} className="btn-primary mt-2">
          Reload
        </button>
      </div>
    );
  }
}
