import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="region-error">
          <div className="region-error-title">Something went wrong</div>
          <div className="region-error-body">
            {this.state.error.message || "Render error"}
          </div>
          <button
            className="btn"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
