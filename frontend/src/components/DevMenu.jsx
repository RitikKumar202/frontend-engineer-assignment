import { useStore } from "../store";

export const DevMenu = () => {
  const open = useStore((s) => s.devOpen);
  const devFail = useStore((s) => s.devFail);
  const setDevFail = useStore((s) => s.setDevFail);
  const toggleDevOpen = useStore((s) => s.toggleDevOpen);

  if (!open) return null;

  return (
    <div className="dev-menu">
      <div className="dev-menu-head">
        <strong>Failure demos</strong>
        <button className="btn-icon" onClick={toggleDevOpen}>
          ×
        </button>
      </div>
      <label>
        <input
          type="checkbox"
          checked={devFail.screens}
          onChange={(e) => setDevFail("screens", e.target.checked)}
        />
        Fail <code>GET /screens</code>
      </label>
      <label>
        <input
          type="checkbox"
          checked={devFail.preview}
          onChange={(e) => setDevFail("preview", e.target.checked)}
        />
        Fail preview handshake
      </label>
      <label>
        <input
          type="checkbox"
          checked={devFail.details}
          onChange={(e) => setDevFail("details", e.target.checked)}
        />
        Fail <code>GET /elements/:key</code>
      </label>
    </div>
  );
};
