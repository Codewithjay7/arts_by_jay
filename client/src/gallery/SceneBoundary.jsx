import { Component } from 'react';

/**
 * Catches anything thrown while building the 3D scene.
 *
 * The gallery had no boundary of any kind. Everything that can go wrong in
 * there goes wrong asynchronously and out of sight: a lazy chunk that fails
 * to load, a WebGL context the driver refuses, a texture or font that never
 * arrives. With no boundary, each of those leaves the visitor on the loading
 * state indefinitely, or blanks the route — and in both cases the 2D
 * walkthrough that would have served them perfectly well is sitting right
 * there, unreachable.
 *
 * So this does not show an apology. It switches to the flat gallery, which
 * shows the same rooms, the same walls and the same pieces.
 *
 * It must be a class: there is still no hook equivalent of
 * componentDidCatch.
 */
export class SceneBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Worth a console line: this is the only trace of a 3D failure, and
    // whoever is debugging it needs to know whether it was the chunk, the
    // context or an asset.
    console.error('[gallery] the 3D scene could not be built:', error);
    this.props.onFail?.(error);
  }

  componentDidUpdate(previousProps) {
    // Let a deliberate switch back to 3D try again, rather than staying
    // failed for the rest of the session.
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
