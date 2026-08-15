import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Keeps one broken screen from blanking the whole application.
 *
 * React 18 unmounts the entire tree when a render throws and nothing catches
 * it, and this app had no boundary anywhere -- so any error inside any screen
 * emptied <div id="root"> and left a white page with nothing to click and
 * nothing in the interface saying why. main.jsx reports errors only until the
 * app mounts (deliberately: after that, one failed API call should not take
 * over the page), so a later throw was silent. Reloading appeared to "fix" it
 * because a fresh mount starts from clean state.
 *
 * This catches the throw, keeps the sidebar and header usable, and says what
 * broke. Navigating elsewhere clears it, so a single bad screen no longer
 * strands the session.
 */
export default class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The stack is the only record of what actually happened; without it the
    // report is "something broke on some screen".
    console.error('Screen crashed:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // A different route is a different screen: clear the error so moving away
    // recovers without a reload.
    if (this.state.error && prevProps.routeKey !== this.props.routeKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <section className="screen-error" role="alert">
        <span className="screen-error-icon"><AlertTriangle size={22} /></span>
        <h2>This screen ran into a problem</h2>
        <p>
          The rest of the app still works — pick another screen from the menu, or
          try this one again.
        </p>
        <pre>{String(error?.message || error)}</pre>
        <div className="screen-error-actions">
          <button type="button" className="primary" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={15} />
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </section>
    );
  }
}
