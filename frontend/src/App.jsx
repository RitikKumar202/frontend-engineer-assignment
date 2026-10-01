import { useEffect } from "react";
import { useStore } from "./store";
import { CHANNEL, PAGES_ORIGIN, REQUEST_TIMEOUT_MS } from "./constants";
import { report } from "../report.js";
import { Toolbar } from "./components/Toolbar";
import { Board } from "./components/Board";
import { LayersPanel, loadChildren } from "./components/LayersPanel";
import { Inspector } from "./components/Inspector";
import { DevMenu } from "./components/DevMenu";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useKeyboard } from "./hooks/useKeyboard";
import "./styles.css";

// ---------- host ↔ preview transport ----------
const pending = new Map();
let nextRequestId = 0;

const post = (screenId, message) => {
  const iframe = window.__figrWindows?.get(screenId);
  if (!iframe?.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(
      { channel: CHANNEL, ...message },
      PAGES_ORIGIN,
    );
  } catch (err) {
    report(err, { region: "preview", screenId });
  }
};

const request = (screenId, type, payload = {}) =>
  new Promise((resolve, reject) => {
    const iframe = window.__figrWindows?.get(screenId);
    if (!iframe?.contentWindow)
      return reject(new Error("Preview is not available"));

    const requestId = ++nextRequestId;
    const timer = setTimeout(() => {
      if (!pending.delete(requestId)) return;
      reject(new Error(`Preview ${type} request timed out`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer });
    try {
      iframe.contentWindow.postMessage(
        { channel: CHANNEL, type, requestId, ...payload },
        PAGES_ORIGIN,
      );
    } catch (err) {
      pending.delete(requestId);
      clearTimeout(timer);
      reject(err);
    }
  });

const respondTo = (key) => (_screenId, msg) => {
  const entry = pending.get(msg.requestId);
  if (!entry) return;
  pending.delete(msg.requestId);
  clearTimeout(entry.timer);
  entry.resolve(msg[key] ?? []);
};

const findScreenId = (source) => {
  for (const [id, iframe] of window.__figrWindows ?? []) {
    if (iframe.contentWindow === source) return id;
  }
  return null;
};

// ---------- error funnel — one report per failure ----------
const failRegion = (region, screenId, error, elementKey) => {
  report(error, { region, screenId, ...(elementKey ? { elementKey } : {}) });
  const store = useStore.getState();
  if (region === "board")
    store.setScreensError(error.message || "Could not load screens");
  if (region === "preview")
    store.setPreviewStatus(
      screenId,
      "error",
      error.message || "Preview unavailable",
    );
  if (region === "layers")
    store.setRowStatus(screenId, `${screenId}:@root`, {
      loading: false,
      error: error.message,
    });
  if (region === "details")
    store.setDetails({
      loading: false,
      data: null,
      error: error.message,
      key: null,
    });
};

// ---------- layers panel helpers ----------
const findInTree = (nodes, ref) => {
  for (const n of nodes) {
    if (n.ref === ref) return n;
    const hit = Array.isArray(n.children) ? findInTree(n.children, ref) : null;
    if (hit) return hit;
  }
  return null;
};

const revealSelection = async (screenId, item) => {
  const rowKey = `${screenId}:${item.ref}`;
  const existing = window.__figrRowRefs?.get(rowKey);
  if (existing) return existing.scrollIntoView({ block: "nearest" });

  try {
    const ancestors = await request(screenId, "ancestors", { ref: item.ref });
    const store = useStore.getState();
    const expanded = { ...(store.previews[screenId]?.expanded ?? {}) };
    ancestors.forEach((a) => {
      expanded[a.ref] = true;
    });
    store.setExpanded(screenId, expanded);

    if (!store.previews[screenId]?.tree?.length)
      await loadChildren(screenId, null);
    for (const a of ancestors) {
      const node = findInTree(
        useStore.getState().previews[screenId]?.tree ?? [],
        a.ref,
      );
      if (node && !node.childrenLoaded) await loadChildren(screenId, a.ref);
    }
    setTimeout(
      () =>
        window.__figrRowRefs?.get(rowKey)?.scrollIntoView({ block: "nearest" }),
      80,
    );
  } catch (err) {
    report(err, { region: "layers", screenId });
  }
};

// ---------- preview message handlers ----------
const handlers = {
  ready: (screenId, msg) => {
    const store = useStore.getState();
    const preview = store.previews[screenId];
    if (!preview) return;

    // Bridge loaded before our init arrived — reply with init again.
    if (!preview.session || msg.session !== preview.session) {
      post(screenId, {
        type: "init",
        session: preview.session,
        mode: store.mode,
        selected: preview.selection.map((s) => s.ref),
      });
      return;
    }
    store.setPreviewStatus(screenId, "ready", null);
  },

  hover: (screenId, msg) =>
    useStore.getState().setHovered(screenId, msg.item ?? null),

  geometry: (screenId, msg) =>
    useStore.getState().setGeometry(screenId, {
      hovered: msg.hovered ?? null,
      selected: msg.selected ?? [],
    }),

  select: (screenId, msg) => {
    const { item, shift } = msg;
    if (!item) return;
    const store = useStore.getState();
    const current = store.previews[screenId].selection;
    const exists = current.some((s) => s.ref === item.ref);
    const next = shift
      ? exists
        ? current.filter((s) => s.ref !== item.ref)
        : [...current, item]
      : [item];

    store.setActiveScreen(screenId);
    store.setSelection(screenId, next);
    store.setRemoved(screenId, false);
    post(screenId, { type: "selection", refs: next.map((s) => s.ref) });
    revealSelection(screenId, item);
  },

  background: (screenId) => {
    useStore.getState().setSelection(screenId, []);
    post(screenId, { type: "selection", refs: [] });
  },

  "keyboard-select": (screenId, msg) => {
    if (!msg.item) return;
    const store = useStore.getState();
    store.setActiveScreen(screenId);
    store.setSelection(screenId, [msg.item]);
    store.setRemoved(screenId, false);
    post(screenId, { type: "selection", refs: [msg.item.ref] });
  },

  children: respondTo("nodes"),
  ancestors: respondTo("ancestors"),

  changed: (screenId, msg) => {
    const store = useStore.getState();
    const preview = store.previews[screenId];
    if (!preview) return;

    if (msg.removed?.length) {
      const next = preview.selection.filter(
        (s) => !msg.removed.includes(s.ref),
      );
      store.setSelection(screenId, next);
      if (next.length === 0) store.setRemoved(screenId, true);
    }

    loadChildren(screenId, null).catch(() => {});
    Object.keys(preview.expanded ?? {}).forEach((ref) =>
      loadChildren(screenId, ref).catch(() => {}),
    );
  },

  "page-error": (screenId, msg) => {
    useStore.getState().setPageError(screenId, msg.message);
    report(new Error(msg.message), { region: "preview", screenId });
  },

  zoom: (_screenId, msg) => {
    const viewport = document.querySelector(".board-viewport");
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const store = useStore.getState();
    const next = Math.min(
      4,
      Math.max(0.25, store.zoom * Math.exp(-msg.deltaY * 0.002)),
    );
    const ratio = next / store.zoom;
    store.setPan(
      rect.left - (rect.left - store.panX) * ratio,
      rect.top - (rect.top - store.panY) * ratio,
    );
    store.setZoom(next);
    Object.keys(store.previews).forEach((id) => store.setHovered(id, null));
  },

  shortcut: (_screenId, msg) => {
    const store = useStore.getState();
    const key = msg.key.toLowerCase();
    if (key === "v") store.setMode("select");
    else if (key === "i") store.setMode("interact");
    else if (msg.key === "Escape") store.clearAllSelections();
  },
};

// ---------- app ----------
export default function App() {
  useKeyboard();

  useEffect(() => {
    window.__figrSend = (screenId) => (message) => post(screenId, message);
    window.__figrRequest = (screenId, type, payload) =>
      request(screenId, type, payload);
    return () => {
      delete window.__figrSend;
      delete window.__figrRequest;
    };
  }, []);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.channel !== CHANNEL) return;
      const screenId = findScreenId(event.source);
      if (!screenId) return;
      try {
        handlers[event.data.type]?.(screenId, event.data);
      } catch (err) {
        failRegion("preview", screenId, err);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (
          !state.activeScreenId ||
          state.activeScreenId === prev.activeScreenId
        )
          return;
        const preview = state.previews[state.activeScreenId];
        if (preview && !preview.tree.length) {
          loadChildren(state.activeScreenId, null).catch(() => {});
        }
      }),
    [],
  );

  return (
    <div className="app">
      <Toolbar />
      <main className="app-main">
        <div className="board-column">
          <ErrorBoundary
            onError={(err) => report(err, { region: "board", screenId: null })}
          >
            <Board />
          </ErrorBoundary>
        </div>
        <div className="side-column">
          <ErrorBoundary
            onError={(err) => report(err, { region: "layers", screenId: null })}
          >
            <LayersPanel />
          </ErrorBoundary>
          <ErrorBoundary
            onError={(err) =>
              report(err, { region: "inspector", screenId: null })
            }
          >
            <Inspector />
          </ErrorBoundary>
        </div>
      </main>
      <DevMenu />
    </div>
  );
}
