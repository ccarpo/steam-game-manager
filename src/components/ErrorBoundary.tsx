"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ""}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 gap-3 text-center">
          <span className="text-2xl">⚠️</span>
          <p className="text-sm text-muted">Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}.</p>
          <p className="text-xs text-danger font-mono max-w-sm truncate">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs px-3 py-1 rounded border border-border hover:border-accent text-muted hover:text-foreground transition-colors"
          >Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
