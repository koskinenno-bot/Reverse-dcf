import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary caught error in "${this.props.name || 'Component'}":`, error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 bg-red-950/20 border border-red-500/30 rounded-xl text-center">
          <h2 className="text-red-500 font-serif text-lg mb-2">Section Unavailable</h2>
          <p className="text-red-400 text-sm">Something went wrong while loading this analysis.</p>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 text-xs text-red-300 hover:text-white underline"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
