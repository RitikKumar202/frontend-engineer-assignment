import { useStore } from "../store";

export const Toolbar = () => {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const toggleDevOpen = useStore((s) => s.toggleDevOpen);

  const zoomPct = Math.round(zoom * 100);

  return (
    <header className="toolbar">
      <div className="brand">
        <div className="brand-mark" aria-label="Figr board">
          F
        </div>
        <span className="brand-name">Figr Board</span>
      </div>

      <div className="mode-switch" role="tablist" aria-label="Interaction mode">
        <button
          className={mode === "select" ? "active" : ""}
          onClick={() => setMode("select")}
          title="Select (V)"
        >
          Select
          <kbd>V</kbd>
        </button>
        <button
          className={mode === "interact" ? "active" : ""}
          onClick={() => setMode("interact")}
          title="Interact (I)"
        >
          Interact
          <kbd>I</kbd>
        </button>
      </div>

      <div className="zoom-cluster">
        <button
          className="btn-icon"
          onClick={() => setZoom(zoom / 1.1)}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="zoom-readout">{zoomPct}%</span>
        <button
          className="btn-icon"
          onClick={() => setZoom(zoom * 1.1)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button className="btn-ghost" onClick={() => setZoom(0.45)}>
          Reset
        </button>
      </div>

      <button className="btn-ghost dev-toggle" onClick={toggleDevOpen}>
        Failures
      </button>
    </header>
  );
};
