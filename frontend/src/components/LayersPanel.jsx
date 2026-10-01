import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";
import { report } from "../../report.js";

const INDENT = 16;
const BASE_PAD = 10;
const SEARCH_DEBOUNCE_MS = 180;

// ---------- tag icon ----------
const TAG_CATEGORY = new Map();
const register = (category, tags) =>
  tags.forEach((t) => TAG_CATEGORY.set(t, category));

register("media", ["img", "picture", "video", "canvas", "figure"]);
register("link", ["a"]);
register("button", ["button"]);
register("form", ["input", "textarea", "select", "option", "label", "form"]);
register("svg", ["svg", "path", "circle", "rect", "g", "use"]);
register("list", ["ul", "ol", "li"]);
register("text", [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "strong",
  "em",
  "small",
  "b",
  "i",
]);
register("landmark", [
  "nav",
  "header",
  "footer",
  "aside",
  "main",
  "section",
  "article",
]);

const tagCategory = (tag) =>
  TAG_CATEGORY.get(tag?.toLowerCase()) ?? "container";

const ICON_SHAPES = {
  media: (
    <>
      <rect x="1.5" y="2.5" width="9" height="7" rx="1" />
      <circle cx="4.5" cy="5" r="0.9" />
      <path d="M2 8.5l2.5-2 2 1.5L9 6l1.5 2.5" />
    </>
  ),
  link: (
    <>
      <path d="M5 7l2-2" />
      <path d="M4.2 5.5L3 6.7a1.8 1.8 0 002.5 2.5l1.3-1.3" />
      <path d="M7.8 6.5L9 5.3a1.8 1.8 0 00-2.5-2.5L5.2 4.1" />
    </>
  ),
  button: (
    <>
      <rect x="1.5" y="3.5" width="9" height="5" rx="2.5" />
      <path d="M4 6h4" />
    </>
  ),
  form: (
    <>
      <rect x="1.5" y="3" width="9" height="6" rx="1" />
      <path d="M3 5h2M3 7h4" />
    </>
  ),
  svg: (
    <>
      <circle cx="6" cy="6" r="4" />
      <path d="M6 2v8M2 6h8" />
    </>
  ),
  list: (
    <>
      <path d="M3 3.5h7M3 6h7M3 8.5h7" />
      <circle cx="1.6" cy="3.5" r="0.4" fill="currentColor" />
      <circle cx="1.6" cy="6" r="0.4" fill="currentColor" />
      <circle cx="1.6" cy="8.5" r="0.4" fill="currentColor" />
    </>
  ),
  text: <path d="M2.5 3h7M6 3v6.5M4 9.5h4" />,
  landmark: <path d="M2 10h8M3 10V5.5M6 10V5.5M9 10V5.5M2 5.5L6 2.5l4 3z" />,
  container: (
    <rect x="2" y="2" width="8" height="8" rx="1.2" strokeDasharray="2 2" />
  ),
  default: <circle cx="6" cy="6" r="2.6" />,
};

const TagIcon = ({ tag }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {ICON_SHAPES[tagCategory(tag)] ?? ICON_SHAPES.default}
  </svg>
);

// ---------- tree walking ----------
const walkRows = (nodes, expanded, depth = 0, guides = []) => {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((item, i) => {
    const isLast = i === nodes.length - 1;
    const row = { item, depth, guides, isLast };
    if (!expanded[item.ref] || !Array.isArray(item.children)) return [row];
    return [
      row,
      ...walkRows(item.children, expanded, depth + 1, [...guides, !isLast]),
    ];
  });
};

const filterTree = (nodes, query) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.reduce((acc, item) => {
    const children = filterTree(item.children || [], needle);
    if (item.name.toLowerCase().includes(needle) || children.length) {
      acc.push({ ...item, children });
    }
    return acc;
  }, []);
};

const countNodes = (nodes = []) =>
  nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);

const expandAllWithChildren = (nodes) => {
  const open = {};
  const visit = (list) =>
    list.forEach((n) => {
      if (n.children?.length) {
        open[n.ref] = true;
        visit(n.children);
      }
    });
  visit(nodes);
  return open;
};

// ---------- panel ----------
export const LayersPanel = () => {
  const activeScreenId = useStore((s) => s.activeScreenId);
  const preview = useStore((s) =>
    activeScreenId ? s.previews[activeScreenId] : undefined,
  );
  const panelRef = useRef(null);
  const lastActiveRef = useRef(null);

  const expanded = preview?.expanded;
  const searchTree = preview?.searchTree;
  const search = preview?.search;
  const tree = preview?.tree;
  const searchActive = !!search?.trim() && !!searchTree;

  useEffect(() => {
    if (!activeScreenId) return;

    if (!search?.trim()) {
      useStore.getState().setSearchTree(activeScreenId, null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const fetched = await buildFullTree(activeScreenId);
      if (cancelled) return;
      if (useStore.getState().previews[activeScreenId]?.search === search) {
        useStore.getState().setSearchTree(activeScreenId, fetched);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeScreenId, search]);

  const rows = useMemo(() => {
    if (!preview) return [];
    if (searchActive) {
      const filtered = filterTree(searchTree, search);
      return walkRows(filtered, expandAllWithChildren(filtered));
    }
    return walkRows(tree || [], expanded || {});
  }, [preview, tree, expanded, searchTree, search, searchActive]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || !activeScreenId || lastActiveRef.current === activeScreenId)
      return;
    lastActiveRef.current = activeScreenId;
    el.scrollTop =
      useStore.getState().previews[activeScreenId]?.panelScroll ?? 0;
  }, [activeScreenId]);

  const onSearchChange = (value) => {
    const store = useStore.getState();
    store.setSearch(activeScreenId, value);
    if (!value) store.setSearchTree(activeScreenId, null);
  };

  if (!activeScreenId || !preview) {
    return (
      <aside className="side-panel layers-panel">
        <div className="layers-empty-state">
          <div className="layers-empty-icon" aria-hidden>
            <svg
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="6" y="8" width="10" height="20" rx="2" />
              <rect x="20" y="8" width="10" height="9" rx="2" />
              <rect x="20" y="21" width="10" height="7" rx="2" />
            </svg>
          </div>
          <div className="layers-empty-title">No active preview</div>
          <div className="layers-empty-hint">
            Click any element inside a preview to inspect its tree.
          </div>
        </div>
      </aside>
    );
  }

  const total = countNodes(tree);
  const isEmptyRoot = !tree?.length;

  return (
    <aside className="side-panel layers-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <span className="panel-title">Layers</span>
          <span className="panel-count">{total}</span>
        </div>
        <span className="panel-subtitle">{preview.name}</span>
      </div>

      <div className="panel-search">
        <span className="search-icon" aria-hidden>
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="5.5" cy="5.5" r="4" />
            <path d="M8.5 8.5L11 11" />
          </svg>
        </span>
        <input
          value={search ?? ""}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search elements…"
          spellCheck={false}
        />
        {search && (
          <button
            className="search-clear"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div
        className="panel-scroll layers-scroll"
        ref={panelRef}
        onScroll={(e) =>
          useStore.getState().setPanelScroll(activeScreenId, e.target.scrollTop)
        }
      >
        {rows.length === 0 && isEmptyRoot ? (
          <LoadingRows count={6} />
        ) : rows.length === 0 ? (
          <div className="layers-no-matches">
            <div className="layers-no-matches-title">No matches</div>
            <div className="layers-no-matches-hint">
              Try a different term or clear the search.
            </div>
          </div>
        ) : (
          rows.map(({ item, depth, guides, isLast }) => (
            <LayerRow
              key={item.ref}
              screenId={activeScreenId}
              item={item}
              depth={depth}
              guides={guides}
              isLast={isLast}
              expanded={
                searchActive
                  ? Boolean(item.children?.length)
                  : !!expanded?.[item.ref]
              }
              selected={preview.selection.some((s) => s.ref === item.ref)}
              hovered={preview.hovered?.ref === item.ref}
              searching={searchActive}
            />
          ))
        )}
      </div>
    </aside>
  );
};

// ---------- row ----------
const LayerRow = ({
  screenId,
  item,
  depth,
  guides,
  isLast,
  expanded,
  selected,
  hovered,
  searching,
}) => {
  const rowRef = useRef(null);
  const rowStatus = useStore(
    (s) => s.previews[screenId]?.rowStatus?.[`${screenId}:${item.ref}`],
  );

  useEffect(() => {
    if (!rowRef.current) return;
    window.__figrRowRefs ??= new Map();
    window.__figrRowRefs.set(`${screenId}:${item.ref}`, rowRef.current);
  }, [screenId, item.ref]);

  const toggleExpand = async (event) => {
    event?.stopPropagation();
    if (!item.hasChildren) return;
    // During search the tree is fully expanded — nothing to toggle.
    if (searching) return;

    const store = useStore.getState();
    const next = { ...(store.previews[screenId]?.expanded || {}) };

    if (next[item.ref]) {
      delete next[item.ref];
      store.setExpanded(screenId, next);
      return;
    }

    next[item.ref] = true;
    store.setExpanded(screenId, next);
    if (item.childrenLoaded) return;

    try {
      await loadChildren(screenId, item.ref);
    } catch (err) {
      report(err, { region: "layers-row", screenId });
    }
  };

  const onClick = (event) => {
    const store = useStore.getState();
    store.setActiveScreen(screenId);

    const current = store.previews[screenId].selection;
    const exists = current.some((x) => x.ref === item.ref);
    const next = event.shiftKey
      ? exists
        ? current.filter((x) => x.ref !== item.ref)
        : [...current, item]
      : [item];

    store.setSelection(screenId, next);
    store.setRemoved(screenId, false);
    window.__figrSend?.(screenId)?.({
      type: "selection",
      refs: next.map((x) => x.ref),
      scrollTo: item.ref,
    });
  };

  const onHover = (ref) => {
    useStore.getState().setHovered(screenId, ref ? item : null);
    window.__figrSend?.(screenId)?.({ type: "hover-ref", ref });
  };

  const className = [
    "layer-row",
    selected && "selected",
    hovered && "hovered",
    rowStatus?.error && "has-error",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rowRef}
      className={className}
      style={{ paddingLeft: BASE_PAD + depth * INDENT }}
      onClick={onClick}
      onMouseEnter={() => onHover(item.ref)}
      onMouseLeave={() => onHover(null)}
      role="treeitem"
      aria-expanded={item.hasChildren ? expanded : undefined}
      aria-selected={selected}
      tabIndex={-1}
    >
      {guides.map((draw, level) =>
        draw ? (
          <span
            key={`g-${level}`}
            className="tree-guide"
            style={{ left: BASE_PAD + level * INDENT + 7 }}
            aria-hidden
          />
        ) : null,
      )}
      {depth > 0 && (
        <span
          className={`tree-elbow${isLast ? " last" : ""}`}
          style={{ left: BASE_PAD + (depth - 1) * INDENT + 7 }}
          aria-hidden
        />
      )}

      <span
        className="layer-chevron-slot"
        onClick={toggleExpand}
        role="button"
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        {item.hasChildren ? (
          <svg
            className={`layer-chevron${expanded ? " open" : ""}`}
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 2L6.5 5L3.5 8" />
          </svg>
        ) : (
          <span className="layer-leaf-dot" />
        )}
      </span>

      <span className={`layer-icon layer-icon-${tagCategory(item.tag)}`}>
        <TagIcon tag={item.tag} />
      </span>

      <span className="layer-name" title={item.name}>
        {item.name}
      </span>

      {item.dataKey && (
        <span className="layer-key" title={`data-key="${item.dataKey}"`}>
          {item.dataKey}
        </span>
      )}

      {item.hasChildren && !expanded && !rowStatus?.loading && !searching && (
        <span className="layer-count">{item.childCount ?? "·"}</span>
      )}

      {rowStatus?.loading && (
        <span className="layer-dots" aria-label="Loading">
          <i />
          <i />
          <i />
        </span>
      )}

      {rowStatus?.error && (
        <button className="layer-retry" onClick={toggleExpand}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M1.5 5a3.5 3.5 0 106-2.5" />
            <path d="M8 1v2.5H5.5" />
          </svg>
          Retry
        </button>
      )}
    </div>
  );
};

// ---------- loading skeleton ----------
const LoadingRows = ({ count }) => (
  <div className="layers-loading">
    {Array.from({ length: count }, (_, i) => (
      <div
        key={i}
        className="layers-loading-row"
        style={{ paddingLeft: BASE_PAD + (i % 3) * INDENT }}
      >
        <span className="layers-loading-chevron" />
        <span className="layers-loading-icon" />
        <span
          className="layers-loading-bar"
          style={{ width: `${40 + ((i * 13) % 45)}%` }}
        />
      </div>
    ))}
  </div>
);

// ---------- loaders ----------
export const loadChildren = async (screenId, parentRef) => {
  const store = useStore.getState();
  const preview = store.previews[screenId];
  if (!preview) return [];

  const key = `${screenId}:${parentRef || "@root"}`;
  if (preview.rowStatus?.[key]?.loading) return [];

  store.setRowStatus(screenId, key, { loading: true, error: null });

  try {
    const nodes = await window.__figrRequest(screenId, "children", {
      ref: parentRef,
    });
    const current = useStore.getState().previews[screenId];
    if (!current) return [];

    const next = markChildrenLoaded(
      withChildren(current.tree, parentRef, nodes),
      parentRef,
    );
    useStore.getState().setTree(screenId, next);
    useStore.getState().setRowStatus(screenId, key, null);
    return nodes;
  } catch (err) {
    useStore.getState().setRowStatus(screenId, key, {
      loading: false,
      error: err.message || "Could not load",
    });
    report(err, { region: "layers-row", screenId });
    return [];
  }
};

const withChildren = (nodes, parentRef, children) => {
  if (!parentRef) return mergeChildList(nodes, children);
  return nodes.map((node) => {
    if (node.ref === parentRef) {
      return {
        ...node,
        children: mergeChildList(node.children, children),
        childCount: children.length,
      };
    }
    if (Array.isArray(node.children)) {
      return {
        ...node,
        children: withChildren(node.children, parentRef, children),
      };
    }
    return node;
  });
};

const markChildrenLoaded = (nodes, parentRef) => {
  if (!parentRef) return nodes;
  return nodes.map((node) => {
    if (node.ref === parentRef) return { ...node, childrenLoaded: true };
    if (Array.isArray(node.children)) {
      return {
        ...node,
        children: markChildrenLoaded(node.children, parentRef),
      };
    }
    return node;
  });
};

const mergeChildList = (previous, next) => {
  const byRef = new Map((previous || []).map((item) => [item.ref, item]));
  return next.map((item) => {
    const existing = byRef.get(item.ref);
    if (!existing || !Array.isArray(existing.children)) {
      return { ...item, childCount: existing?.childCount };
    }
    return {
      ...item,
      children: existing.children,
      childrenLoaded: existing.childrenLoaded,
      childCount: existing.childCount,
    };
  });
};

export const buildFullTree = async (screenId, parentRef = null, depth = 0) => {
  if (depth > 40) return [];
  try {
    const nodes = await window.__figrRequest(screenId, "children", {
      ref: parentRef,
    });
    return await Promise.all(
      nodes.map(async (node) =>
        node.hasChildren
          ? {
              ...node,
              children: await buildFullTree(screenId, node.ref, depth + 1),
              childrenLoaded: true,
            }
          : node,
      ),
    );
  } catch {
    return [];
  }
};
