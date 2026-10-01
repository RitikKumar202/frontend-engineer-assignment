/* Runs inside every preview iframe. Served from PORT:4001. */
(() => {
  if (window === window.top) return;

  const CHANNEL = "figr-board";
  const HOST_ORIGIN = document.referrer
    ? new URL(document.referrer).origin
    : "*";

  const refs = new Map();
  const nodeRefs = new WeakMap();
  let nextRef = 0;

  const isSkipped = (node) =>
    !node ||
    node === document.documentElement ||
    node === document.body ||
    node.tagName === "SCRIPT" ||
    node.tagName === "STYLE";

  const children = (node) =>
    [...node.children].filter(
      (c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE",
    );

  const textOf = (node) =>
    (node.innerText || node.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

  const nameOf = (node) => {
    if (node.dataset.name) return node.dataset.name;
    const tag = node.tagName.toLowerCase();
    if (node.id) return `${tag}#${node.id}`;
    if (node.classList.length) return `${tag}.${node.classList[0]}`;
    return tag;
  };

  // Identity ladder: data-key → id → anonymous node:N
  const refOf = (node) => {
    const key = node.getAttribute("data-key");
    if (key) return `key:${key}`;
    if (node.id) return `id:${node.id}`;
    let ref = nodeRefs.get(node);
    if (!ref) {
      ref = `node:${++nextRef}`;
      nodeRefs.set(node, ref);
    }
    refs.set(ref, node);
    return ref;
  };

  // Only resolve if the match is unique — never jump to a different element.
  const resolve = (ref) => {
    if (!ref) return null;
    const cached = refs.get(ref);
    if (cached?.isConnected) return cached;
    const [kind, value] = splitRef(ref);
    if (!kind || !value) return null;
    const selector = kind === "key" ? "[data-key]" : "[id]";
    const attr = kind === "key" ? "data-key" : "id";
    const matches = [...document.querySelectorAll(selector)].filter(
      (n) => n.getAttribute(attr) === value,
    );
    return matches.length === 1 ? matches[0] : null;
  };

  const splitRef = (ref) => {
    const i = ref.indexOf(":");
    if (i < 0) return [null, null];
    const kind = ref.slice(0, i);
    if (kind !== "key" && kind !== "id") return [null, null];
    return [kind, ref.slice(i + 1)];
  };

  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const ref = refOf(node);
    refs.set(ref, node);
    return {
      ref,
      name: nameOf(node),
      tag: node.tagName.toLowerCase(),
      id: node.id || "",
      classes: [...node.classList],
      hasChildren: children(node).length > 0,
      parentRef:
        node.parentElement && node.parentElement !== document.body
          ? refOf(node.parentElement)
          : null,
      dataKey: node.getAttribute("data-key") || null,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      live: {
        text: textOf(node),
        color: style.color,
        background: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        pageX: Math.round(rect.left + scrollX),
        pageY: Math.round(rect.top + scrollY),
      },
    };
  };

  const nodeAt = (x, y) =>
    document.elementsFromPoint(x, y).find((n) => !isSkipped(n)) || null;

  const isVisible = (node) => {
    const b = node.getBoundingClientRect();
    return (
      b.width > 0 &&
      b.height > 0 &&
      b.bottom > 0 &&
      b.right > 0 &&
      b.top < innerHeight &&
      b.left < innerWidth
    );
  };

  const ancestorsOf = (node) => {
    const list = [];
    for (
      let p = node?.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      list.unshift(describe(p));
    }
    return list;
  };

  // ---- session state ----
  let session = null;
  let mode = "select";
  let selected = [];
  let hovered = null;
  let lastSignature = "";
  let geoQueued = false;
  let mutateQueued = false;

  const send = (type, data = {}) =>
    parent.postMessage(
      { channel: CHANNEL, type, session, ...data },
      HOST_ORIGIN,
    );

  const signature = () =>
    JSON.stringify({
      h: hovered,
      s: selected.map((ref) => {
        const box = resolve(ref)?.getBoundingClientRect();
        return box
          ? [
              ref,
              Math.round(box.left),
              Math.round(box.top),
              Math.round(box.width),
              Math.round(box.height),
            ]
          : [ref];
      }),
    });

  const sendBoxes = () => {
    const next = signature();
    if (next === lastSignature) return;
    lastSignature = next;
    send("geometry", {
      hovered: resolve(hovered) ? describe(resolve(hovered)) : null,
      selected: selected.map(resolve).filter(Boolean).map(describe),
    });
  };

  const queueBoxes = () => {
    if (geoQueued) return;
    geoQueued = true;
    requestAnimationFrame(() => {
      geoQueued = false;
      sendBoxes();
    });
  };

  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.channel !== CHANNEL) return;
    const msg = event.data;

    switch (msg.type) {
      case "init":
        session = msg.session;
        mode = msg.mode || "select";
        selected = msg.selected || [];
        send("ready", { title: document.title, url: location.href });
        sendBoxes();
        break;

      case "mode":
        mode = msg.mode;
        queueBoxes();
        break;

      case "selection": {
        selected = msg.refs || [];
        const target = msg.scrollTo && resolve(msg.scrollTo);
        if (target && !isVisible(target))
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
        sendBoxes();
        break;
      }

      case "children": {
        const parentNode = msg.ref ? resolve(msg.ref) : document.body;
        send("children", {
          requestId: msg.requestId,
          nodes: parentNode ? children(parentNode).map(describe) : [],
        });
        break;
      }

      case "ancestors":
        send("ancestors", {
          requestId: msg.requestId,
          ancestors: ancestorsOf(resolve(msg.ref)),
        });
        break;

      case "hover-ref":
        hovered = msg.ref || null;
        sendBoxes();
        break;

      case "navigate-element": {
        const node = resolve(msg.ref);
        if (!node) return;
        const siblings = node.parentElement ? children(node.parentElement) : [];
        const index = siblings.indexOf(node);
        const actions = {
          "first-child": () => children(node)[0] || null,
          parent: () =>
            node.parentElement !== document.body ? node.parentElement : null,
          "next-sibling": () => siblings[(index + 1) % siblings.length] || null,
          "previous-sibling": () =>
            siblings[(index - 1 + siblings.length) % siblings.length] || null,
        };
        const next = actions[msg.action]?.();
        if (next) send("keyboard-select", { item: describe(next) });
        break;
      }
    }
  });

  addEventListener(
    "pointermove",
    (event) => {
      if (mode !== "select") return;
      const node = nodeAt(event.clientX, event.clientY);
      const next = node ? refOf(node) : null;
      if (next === hovered) return;
      hovered = next;
      send("hover", {
        item: node ? describe(node) : null,
        ancestors: ancestorsOf(node),
      });
      sendBoxes();
    },
    true,
  );

  addEventListener(
    "pointerout",
    (event) => {
      if (event.relatedTarget || mode !== "select" || !hovered) return;
      hovered = null;
      send("hover", { item: null });
      sendBoxes();
    },
    true,
  );

  addEventListener(
    "pointerdown",
    (event) => {
      if (mode !== "select" || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const node = nodeAt(event.clientX, event.clientY);
      if (node) send("select", { item: describe(node), shift: event.shiftKey });
      else send("background");
    },
    true,
  );

  addEventListener(
    "click",
    (event) => {
      if (mode !== "select") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  addEventListener(
    "submit",
    (event) => {
      if (mode !== "select") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      send("zoom", {
        deltaY: event.deltaY,
        x: event.clientX,
        y: event.clientY,
      });
    },
    { capture: true, passive: false },
  );

  const GLOBAL_KEYS = ["v", "V", "i", "I", "Escape"];
  const PASS_KEYS = [
    ...GLOBAL_KEYS,
    "Enter",
    "Tab",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ];

  addEventListener(
    "keydown",
    (event) => {
      if (!PASS_KEYS.includes(event.key)) return;
      const typing = event.target.matches?.(
        'input,textarea,select,[contenteditable="true"]',
      );
      if (typing && GLOBAL_KEYS.includes(event.key)) return;
      if (mode === "interact" && !GLOBAL_KEYS.includes(event.key)) return;
      send("shortcut", { key: event.key, shift: event.shiftKey });
      if (mode === "select" || GLOBAL_KEYS.includes(event.key))
        event.preventDefault();
    },
    true,
  );

  addEventListener("scroll", queueBoxes, true);
  addEventListener("resize", queueBoxes);

  addEventListener("error", (event) => {
    send("page-error", { message: event.message || "Page error" });
  });

  addEventListener("unhandledrejection", (event) => {
    send("page-error", {
      message: String(
        event.reason?.message || event.reason || "Unhandled rejection",
      ),
    });
  });

  // Reconcile refs when the page mutates its own DOM.
  new MutationObserver((records) => {
    const structureChanged = records.some((r) => r.type === "childList");
    if (!structureChanged) {
      if (selected.length || hovered) queueBoxes();
      return;
    }
    if (mutateQueued) return;
    mutateQueued = true;
    requestAnimationFrame(() => {
      mutateQueued = false;
      for (const [ref, node] of refs) if (!node.isConnected) refs.delete(ref);
      const previous = selected;
      selected = selected.filter((ref) => resolve(ref));
      if (hovered && !resolve(hovered)) hovered = null;
      send("changed", {
        selected,
        removed: previous.filter((ref) => !selected.includes(ref)),
      });
      sendBoxes();
    });
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "id", "style", "data-key", "data-name"],
  });

  send("ready", { title: document.title, url: location.href });
})();
