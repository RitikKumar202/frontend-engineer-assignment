import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { getScreens } from "../api";
import { report } from "../../report.js";
import {
  BOARD_COLS,
  PREVIEW_W,
  PREVIEW_GAP,
  MAX_ZOOM,
  MIN_ZOOM,
} from "../constants";
import { Preview } from "./Preview";

const CANVAS_PADDING = 40;
const CARD_H = 830;

export const Board = () => {
  const screens = useStore((s) => s.screens);
  const screensError = useStore((s) => s.screensError);
  const screensLoading = useStore((s) => s.screensLoading);
  const zoom = useStore((s) => s.zoom);
  const devFail = useStore((s) => s.devFail);

  const viewportRef = useRef(null);
  const scalerRef = useRef(null);
  const dragRef = useRef(null);
  const abortRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [autoFitted, setAutoFitted] = useState(false);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      const store = useStore.getState();
      store.setScreensLoading(true);
      try {
        const data = await getScreens({ signal: controller.signal });
        if (controller.signal.aborted) return;
        store.setScreens(data);
        store.initPreviews(data);
        data.forEach((s) => store.setHovered(s.id, null));
        setAutoFitted(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        store.setScreensError(err.message || "Could not load screens");
        report(err, { region: "board", screenId: null });
      }
    })();

    return () => controller.abort();
  }, [devFail.screens]);

  // Retry skips the abort plumbing — it's only reachable when no load is in flight.
  const retry = async () => {
    const store = useStore.getState();
    try {
      const data = await getScreens();
      store.setScreens(data);
      store.initPreviews(data);
      setAutoFitted(false);
    } catch (err) {
      store.setScreensError(err.message);
      report(err, { region: "board", screenId: null });
    }
  };

  // Track viewport width so we know when to auto-fit.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const update = () => setViewportWidth(vp.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  const rows = Math.max(1, Math.ceil(screens.length / BOARD_COLS));
  const canvasW =
    CANVAS_PADDING * 2 +
    BOARD_COLS * PREVIEW_W +
    (BOARD_COLS - 1) * PREVIEW_GAP;
  const canvasH =
    CANVAS_PADDING * 2 + rows * CARD_H + Math.max(0, rows - 1) * PREVIEW_GAP;

  useEffect(() => {
    if (autoFitted || !viewportWidth || !screens.length) return;
    const fit = (viewportWidth - 40) / canvasW;
    useStore.getState().setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit)));
    setAutoFitted(true);
    const vp = viewportRef.current;
    if (vp) {
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    }
  }, [autoFitted, viewportWidth, screens.length, canvasW]);

  useLayoutEffect(() => {
    const scaler = scalerRef.current;
    if (!scaler) return;
    scaler.style.width = `${canvasW * zoom}px`;
    scaler.style.height = `${canvasH * zoom}px`;
  }, [canvasW, canvasH, zoom]);

  // Drag empty board space to pan.
  const onMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest?.(".preview-card")) return;
    const vp = viewportRef.current;
    if (!vp) return;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      sl: vp.scrollLeft,
      st: vp.scrollTop,
    };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const d = dragRef.current;
      const vp = viewportRef.current;
      if (!d || !vp) return;
      vp.scrollLeft = d.sl - (e.clientX - d.x);
      vp.scrollTop = d.st - (e.clientY - d.y);
    };
    const onUp = () => {
      setDragging(false);
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // Ctrl/Cmd + wheel zooms around the pointer. Plain wheel is native scroll.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const store = useStore.getState();
      const z = store.zoom;
      const rect = vp.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cx = (px + vp.scrollLeft) / z;
      const cy = (py + vp.scrollTop) / z;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, z * Math.exp(-e.deltaY * 0.002)),
      );

      store.setZoom(next);
      for (const id of Object.keys(store.previews)) store.setHovered(id, null);

      requestAnimationFrame(() => {
        vp.scrollLeft = cx * next - px;
        vp.scrollTop = cy * next - py;
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  if (screensError) {
    return (
      <div className="board-state">
        <div className="region-error">
          <div className="region-error-title">Couldn't load the board</div>
          <div className="region-error-body">{screensError}</div>
          <button className="btn" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (screensLoading || !screens.length) {
    return (
      <div className="board-state">
        <div className="board-spinner" />
        <div className="board-state-text">Loading board…</div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`board-viewport${dragging ? " dragging" : ""}`}
      onMouseDown={onMouseDown}
    >
      <div className="board-scaler" ref={scalerRef}>
        <div
          className="board-canvas"
          style={{
            width: canvasW,
            height: canvasH,
            transform: `scale(${zoom})`,
            transformOrigin: "0 0",
            gridTemplateColumns: `repeat(${BOARD_COLS}, ${PREVIEW_W}px)`,
            gap: `${PREVIEW_GAP}px`,
            padding: CANVAS_PADDING,
          }}
        >
          {screens.map((s) => (
            <Preview key={s.id} screen={s} />
          ))}
        </div>
      </div>
    </div>
  );
};
