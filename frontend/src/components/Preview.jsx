import { useEffect, useRef } from "react";
import { useStore } from "../store";
import {
  PREVIEW_W,
  PREVIEW_H,
  PAGES_ORIGIN,
  PREVIEW_HANDSHAKE_MS,
} from "../constants";
import { report } from "../../report.js";
import { loadChildren } from "./LayersPanel";

const INIT_DELAYS = [80, 250, 600, 1200];

export const Preview = ({ screen }) => {
  const iframeRef = useRef(null);
  const preview = useStore((s) => s.previews[screen.id]);
  const isActive = useStore((s) => s.activeScreenId === screen.id);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    window.__figrWindows ??= new Map();
    window.__figrWindows.set(screen.id, iframe);

    const session = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    useStore.getState().updatePreview(screen.id, { session });

    const sendInit = () => {
      const { mode, previews } = useStore.getState();
      iframe.contentWindow?.postMessage(
        {
          channel: "figr-board",
          type: "init",
          session,
          mode,
          selected: (previews[screen.id]?.selection ?? []).map((s) => s.ref),
        },
        PAGES_ORIGIN,
      );
    };

    // The bridge may miss the first init if it loads late, so re-send on load and a few delays.
    const timers = [];
    const scheduleInit = () => {
      sendInit();
      INIT_DELAYS.forEach((ms) => timers.push(setTimeout(sendInit, ms)));
    };

    scheduleInit();
    iframe.addEventListener("load", scheduleInit);

    const handshake = setTimeout(() => {
      const store = useStore.getState();
      if (store.previews[screen.id]?.status !== "loading") return;
      store.setPreviewStatus(
        screen.id,
        "error",
        "Couldn't connect to this preview",
      );
      report(new Error("Preview handshake timeout"), {
        region: "preview",
        screenId: screen.id,
      });
    }, PREVIEW_HANDSHAKE_MS);

    return () => {
      iframe.removeEventListener("load", scheduleInit);
      timers.forEach(clearTimeout);
      clearTimeout(handshake);
      window.__figrWindows.delete(screen.id);
    };
  }, [screen.id]);

  if (!preview) return null;
  const failed = preview.status === "error";

  const onHeaderClick = () => {
    const store = useStore.getState();
    store.setActiveScreen(screen.id);

    const current = store.previews[screen.id];
    if (!current?.tree.length) loadChildren(screen.id, null).catch(() => {});

    window.__figrSend?.(screen.id)?.({
      type: "selection",
      refs: current?.selection?.map((s) => s.ref) ?? [],
    });
  };

  return (
    <div className="preview-card" data-screen-id={screen.id}>
      <div
        className={`preview-header${isActive ? " is-active" : ""}`}
        onClick={onHeaderClick}
        role="button"
        tabIndex={-1}
        title="Click to activate this preview"
      >
        <span className="preview-title">{screen.name}</span>
        <span className="preview-id">{screen.id}</span>
        {preview.pageError && (
          <span className="page-error-badge" title={preview.pageError}>
            Page error
          </span>
        )}
      </div>

      <div
        className="preview-frame-wrap"
        style={{ width: PREVIEW_W, height: PREVIEW_H }}
      >
        {failed ? (
          <div className="preview-failed">
            <div className="preview-failed-title">
              {preview.error || "Couldn't connect to this preview"}
            </div>
            <button
              className="btn"
              onClick={() => {
                useStore.getState().setPreviewStatus(screen.id, "loading");
                iframeRef.current?.contentWindow?.location.reload();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={screen.url}
            title={screen.name}
            width={PREVIEW_W}
            height={PREVIEW_H}
            className="preview-frame"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
        {!failed && <PreviewOverlay preview={preview} />}
      </div>
    </div>
  );
};

const PreviewOverlay = ({ preview }) => {
  const zoom = useStore((s) => s.zoom);
  const mode = useStore((s) => s.mode);
  if (mode === "interact") return null;

  const geometry = preview.geometry ?? {};
  const hovered = geometry.hovered?.rect
    ? geometry.hovered
    : preview.hovered?.rect
      ? preview.hovered
      : null;
  const selected = geometry.selected ?? [];

  const px = (n) => n / zoom;
  const boxes = [
    hovered && { kind: "hover", item: hovered },
    ...selected
      .filter((s) => s?.rect)
      .map((item) => ({ kind: "selected", item })),
  ].filter(Boolean);

  return (
    <div className="preview-overlay">
      {boxes.map(({ kind, item }) => {
        const { rect, name } = item;
        const below = rect.y < px(28);
        return (
          <div key={`${kind}-${item.ref}`}>
            <div
              className={`outline ${kind}`}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                outlineWidth: px(kind === "hover" ? 1 : 2),
              }}
            />
            <div
              className={`outline-label ${kind}`}
              style={{
                left: rect.x,
                top: below ? rect.y + rect.height + 4 : rect.y - px(22),
                fontSize: px(12),
                lineHeight: `${px(18)}px`,
                padding: `${px(1)}px ${px(6)}px`,
                borderRadius: px(4),
              }}
            >
              {name}
            </div>
          </div>
        );
      })}
    </div>
  );
};
