import { useEffect } from "react";
import { useStore } from "../store";
import { getElementDetails } from "../api";
import { report } from "../../report.js";

const Field = ({ label, value }) => {
  return (
    <div className="inspector-field">
      <span className="inspector-label">{label}</span>
      <span className="inspector-value">{String(value ?? "—")}</span>
    </div>
  );
};

const LIVE_FIELDS = [
  ["Name", (i) => i.name],
  ["Tag", (i) => i.tag],
  ["ID", (i) => i.id || "None"],
  ["Classes", (i) => i.classes?.join(" ") || "None"],
  ["Size", (i) => `${i.rect?.width || 0} × ${i.rect?.height || 0} px`],
  ["Position", (i) => `${i.live?.pageX || 0}, ${i.live?.pageY || 0} px`],
  ["Text", (i) => i.live?.text || "None"],
  ["Text colour", (i) => i.live?.color || "—"],
  ["Background", (i) => i.live?.background || "—"],
  ["Font", (i) => i.live?.fontFamily || "—"],
  ["Font size", (i) => i.live?.fontSize || "—"],
  ["Weight", (i) => i.live?.fontWeight || "—"],
];

const LiveSection = ({ items }) => {
  return (
    <section className="inspector-section">
      <h4>Live</h4>
      {LIVE_FIELDS.map(([label, read]) => {
        const values = items.map(read);
        const shared = values.every((v) => v === values[0]);
        return (
          <Field
            key={label}
            label={label}
            value={shared ? values[0] : "Mixed"}
          />
        );
      })}
    </section>
  );
};

export const Inspector = () => {
  const activeScreenId = useStore((s) => s.activeScreenId);
  const preview = useStore((s) =>
    activeScreenId ? s.previews[activeScreenId] : undefined,
  );
  const details = useStore((s) => s.details);
  const detailsRetry = useStore((s) => s.detailsRetry);
  const bumpDetailsRetry = useStore((s) => s.bumpDetailsRetry);
  const setDetails = useStore((s) => s.setDetails);
  const devFail = useStore((s) => s.devFail);

  const selection = preview?.selection || [];
  const single = selection.length === 1 ? selection[0] : null;
  const dataKey = single?.dataKey || null;

  useEffect(() => {
    if (!dataKey) {
      setDetails({ loading: false, data: null, error: null, key: null });
      return;
    }
    const controller = new AbortController();
    setDetails({ loading: true, data: null, error: null, key: dataKey });
    getElementDetails(dataKey, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setDetails({ loading: false, data, error: null, key: dataKey });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setDetails({
          loading: false,
          data: null,
          error: err.message || "Could not load details",
          key: dataKey,
        });
        report(err, {
          region: "details",
          screenId: activeScreenId,
          elementKey: dataKey,
        });
      });
    return () => controller.abort();
  }, [dataKey, detailsRetry, activeScreenId, setDetails]);

  return (
    <aside className="side-panel inspector-panel">
      <div className="panel-header">
        <span>Inspector</span>
      </div>
      <div className="panel-scroll">
        {!activeScreenId || !preview ? (
          <div className="panel-empty">Select an element to inspect</div>
        ) : selection.length === 0 ? (
          <div className="panel-empty">
            {preview.removed
              ? "This element no longer exists"
              : "Select an element to inspect"}
          </div>
        ) : selection.length > 1 ? (
          <>
            <h3 className="inspector-multi">{selection.length} elements</h3>
            <LiveSection items={selection} />
          </>
        ) : (
          <>
            <LiveSection items={selection} />
            <section className="inspector-section">
              <h4>Details</h4>
              {!dataKey ? (
                <div className="panel-empty small">No details</div>
              ) : details.loading ? (
                <div className="panel-empty small">Loading details…</div>
              ) : details.error ? (
                <div className="region-error small">
                  <div className="region-error-body">{details.error}</div>
                  <button className="btn" onClick={bumpDetailsRetry}>
                    Retry
                  </button>
                </div>
              ) : !details.data ? (
                <div className="panel-empty small">
                  No details for this element
                </div>
              ) : (
                Object.entries(details.data).map(([k, v]) => (
                  <Field key={k} label={k} value={v} />
                ))
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
};
