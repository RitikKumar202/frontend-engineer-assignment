# Figr Frontend Engineer Assignment

A viewer for a design tool. It shows live previews of web pages from another origin, lets users select elements inside those previews, and renders outlines, a layers panel, and an inspector on top.

**One command:** `npm run dev` — starts the backend and the frontend together.

Open `http://localhost:3000`.

**Requires Node 18 or newer.**

---

## Running

```bash
# Install backend dependencies at the repo root
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Start everything
npm run dev
```

---

## Architecture

The host (`localhost:3000`) and the previewed pages (`localhost:4001`) are different origins. The host cannot touch the iframe DOM directly, so every interaction goes through `postMessage`.

Two pieces:

- **The bridge** (`backend/pages/bridge.js`) — a script injected into every preview page via one `<script>` tag. It owns element identity, hit testing, geometry, and DOM observation inside the page.
- **The host** (`frontend/src/`) — React + Zustand. It renders the board, draws overlays in its own DOM, and drives the layers panel and inspector.

The bridge is served from the page origin (`:4001`), so the injection is same-origin with the page.

---

## State organisation

All host state lives in a single Zustand store (`frontend/src/store.js`). Nothing outside the store mutates shared state directly — components read via selectors and call actions.

Two shapes live in the store:

- **Board state** — `screens`, `mode`, `zoom`, `panX`, `panY`, `activeScreenId`, `devFail`.
- **Per-preview state** — one entry per screen under `previews[screenId]`. Each entry holds `selection`, `hovered`, `geometry`, `tree`, `expanded`, `rowStatus`, `search`, `searchTree`, `status`, `pageError`, `panelScroll`, and `session`.

Why per-preview instead of per-board: expanded rows, scroll position, selection, and search must be remembered independently for each preview, and switching between previews must restore them exactly. Everything that varies by screen lives inside `previews`.

The **bridge** keeps its own state inside the iframe — the `refs` map, `selected`, `hovered`, `mode`, `session`. It never reads host state; it only posts messages.

**Who is allowed to change what:**

- Only the store's actions mutate host state.
- Only the bridge mutates its own variables.
- The host tells the bridge what to do via messages; the bridge tells the host what happened via messages. Neither side reaches into the other.

---

## Host ↔ page protocol

Every message carries `channel: 'figr-board'`. Messages from the host go to the iframe's `contentWindow` at `PAGES_ORIGIN`. Messages from the bridge go to `window.parent` at `HOST_ORIGIN` (derived from `document.referrer`).

### Host → bridge

| Message            | Payload                         | Purpose                                                                                     |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `init`             | `session`, `mode`, `selected[]` | Handshake. Sent on mount and re-sent on `load` and after short delays (80/250/600/1200 ms). |
| `mode`             | `mode`                          | Switches Select/Interact.                                                                   |
| `selection`        | `refs[]`, `scrollTo?`           | Sets the selected refs. Optionally scrolls one into view.                                   |
| `hover-ref`        | `ref \| null`                   | Forces a hover from the layers panel.                                                       |
| `children`         | `ref \| null`, `requestId`      | Asks for the children of a node (or `<body>` when `null`).                                  |
| `ancestors`        | `ref`, `requestId`              | Asks for the ancestor chain of a node.                                                      |
| `navigate-element` | `ref`, `action`                 | Enter/Shift+Enter/Tab sibling or child navigation.                                          |
| `zoom` (inbound)   | —                               | The bridge sends this to the host, not the other way.                                       |

### Bridge → host

| Message           | Payload                    | Purpose                                                                                       |
| ----------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| `ready`           | `session`, `url`           | Fires on script load and after `init`. The host re-sends `init` if the session doesn't match. |
| `hover`           | `item`, `ancestors`        | Pointer moved over a new element (or `item: null` on leave).                                  |
| `geometry`        | `hovered`, `selected[]`    | Full rect snapshot. Coalesced to one per animation frame.                                     |
| `select`          | `item`, `shift`            | Click inside the page.                                                                        |
| `background`      | —                          | Click landed on `<html>` or `<body>`.                                                         |
| `keyboard-select` | `item`                     | Result of a navigate-element action.                                                          |
| `children`        | `requestId`, `nodes[]`     | Response to a `children` request.                                                             |
| `ancestors`       | `requestId`, `ancestors[]` | Response to an `ancestors` request.                                                           |
| `changed`         | `selected[]`, `removed[]`  | DOM mutation. Reconciles refs and prunes selection.                                           |
| `page-error`      | `message`                  | Uncaught error or unhandled rejection inside the page.                                        |
| `zoom`            | `deltaY`, `x`, `y`         | Ctrl/Cmd + wheel inside a preview.                                                            |
| `shortcut`        | `key`, `shift`             | Keyboard shortcuts forwarded from the iframe.                                                 |

### Slowness, absence, replacement

- **Slowness.** `children` and `ancestors` requests time out after 3 seconds; the row shows "Couldn't load" with a Retry button. The handshake times out after 10 seconds; that preview shows "Couldn't connect to this preview". Both timeouts produce exactly one `report()` call for that region.
- **Absence.** If a preview never answers, only that preview shows an error. The board, other previews, layers panel, and inspector continue to work.
- **Replacement.** A navigation fires `ready` again with a new URL; the host clears that preview's selection, tree, and expanded state, and starts fresh. Stale responses from the previous page can't win because every response is matched to a `requestId` in a `pending` map; if the request was cancelled or the session changed, the response is dropped silently — no error shown, nothing reported.
- **Late responses.** If a response arrives after its preview is gone or its session has changed, it changes nothing and reports nothing.

---

## Element identity

Every element is identified by a `ref` string:

1. `key:<data-key>` if the element has a `data-key` attribute.
2. `id:<id>` if the element has an `id`.
3. `node:<N>` — an anonymous counter stored in a `WeakMap`, so the ref dies with the node.

When a ref is resolved, the bridge first checks its cached node. If the cached node is disconnected, it re-queries the live DOM:

- For `key:` and `id:` — only if the match is **unique**. Two elements with the same `data-key` or `id` means "ambiguous, don't resolve".
- For `node:` — never. Anonymous refs simply expire.

This is the guarantee behind R3.7 ("the selection must never jump"): an element can only stay selected if its identifier still resolves to exactly the same element. It can't resolve to a different one.

---

## Where this breaks

Cases the current build gets wrong or can't handle:

1. **Anonymous elements across a DOM rebuild.** An element with no `data-key` and no `id` gets a `node:N` ref. If the page replaces that node, the ref expires and the selection clears. Deliberate — it's the price of guaranteeing no jumps.

2. **Duplicate `data-key` or `id` attributes.** If the page has two elements with the same `data-key`, resolution fails after a rebuild and the selection clears. Same reasoning as above.

3. **Element fully occluded by a sticky header.** `elementsFromPoint` returns the topmost painted element. If an opaque sticky header fully covers something, that something is not separately hoverable. Partially covered elements work.

4. **Search on very deep trees.** Page-5 goes 30 levels deep. `buildFullTree` walks all levels; on a slow machine this can take a second. The search box shows results only once the walk finishes.

5. **Session identity across reloads.** The host compares `msg.session` to `preview.session`; if they differ it re-sends `init`. This handles the common race where the bridge loads before React attaches listeners. It does not handle a page that self-navigates without firing a `ready` — a same-document navigation (e.g. `history.pushState`) will not trigger a session change.

6. **Very long running timers.** The `INIT_DELAYS` retry sends `init` at 80/250/600/1200 ms after mount and after every `load`. If a preview takes longer than 1.2 s to load its first paint and its `load` event has already fired, the retries stop before the bridge is up. The 10-second handshake timer still fires, but only after it's too late to avoid the error.

7. **Inspector render errors.** Each region is wrapped in an `ErrorBoundary`, so a render error in the Inspector doesn't take down the Board or the layers panel. However, the boundary resets on the next render, which means a persistent render error will loop: the boundary catches, resets, and catches again. In practice this hasn't occurred with the current code, but it's a known weakness.

8. **Ctrl/Cmd + wheel when the pointer is over an iframe.** The bridge intercepts the wheel and forwards a `zoom` message to the host. The host applies the zoom but centres it on the iframe's top-left corner, not on the pointer. This is because the pointer's exact location inside the iframe is not currently included in the message. Zooming still works, but the anchor point is approximate.

---

## Ambiguities I had to decide

- **One `<script>` tag per page.** The brief allows "one `<script>` tag" but doesn't say whether it must be inline or can be a `src`. I used a `src` pointing at a file served by the same origin as the pages (`backend/pages/bridge.js`), which is a single tag per page and keeps the pages byte-identical except for that tag.

- **"Clicks never reach the page" in Select mode.** I block `pointerdown`, `click`, `submit`, and `focus` in capture phase. This stops links from navigating, buttons from firing, inputs from focusing, and forms from submitting. Tab order inside the page is not blocked — pressing Tab while the iframe has focus still moves focus inside the iframe. The bridge forwards the Tab key to the host as a shortcut, so the host's selection logic runs; the browser's own focus movement is prevented with `preventDefault()`, but this only works because the bridge's `keydown` listener is in capture phase.

- **Label position "below the element when there's no room above".** "No room" is defined as the element's top edge being less than 28 × (1/zoom) px from the preview's top edge. That's the height the label plus its padding occupies at screen scale.

- **"Selection must never jump" with anonymous elements.** R3.7 says the selection must never jump to a different element. My approach clears the selection for anonymous elements when they're removed. This is a case where I could not satisfy both "never jump" and "stay selected across a rebuild" simultaneously; I chose the safety guarantee.

---

## Reporting

Every failure reaches `report(error, { region, screenId, elementKey? })` exactly once. The reporter is `frontend/report.js` — the same signature as the starter stub.

Regions:

- `board` — `GET /screens` failure.
- `preview` — a preview's handshake timeout, page load error, or in-page runtime error. Each preview has its own region.
- `layers` — the root tree fetch for a preview failed.
- `layers-row` — one row's children fetch failed.
- `details` — `GET /elements/:key` failed.
- `inspector` — a render error inside the Inspector.

A retry that fails again is a new failure and gets a new report. A request that was cancelled or replaced because the user moved on is not reported.

## Development

- The failure demos menu (bottom-right of the app) triggers each region's failure on demand. It only exists when `devFail` is toggled on.
- All the code is JavaScript — no TypeScript build step, no Babel preset beyond Vite's defaults.
- Backend data files and page contents are unchanged except for the single `<script>` tag per page.

---

## AI usage

AI was used to scaffold the React + Vite setup and to explore the identity-ladder approach. Two things it got wrong that I rewrote:

- The first `postMessage` implementation used `'*'` as the target origin. Rewritten to derive `HOST_ORIGIN` from `document.referrer` and validate it on receipt.
- The first `LayersPanel` search walked the tree with an empty `expanded` map, so nested matches never rendered. Rewritten to build an `expandAllWithChildren` map for the filtered subtree.

All state management, the message protocol, and the error regions were designed by hand; the AI's contributions were limited to React boilerplate and CSS scaffolding, both of which were then rewritten to match the actual message flow.

---

## Known trade-offs

- **Zustand over Context.** Store actions are called from outside React components (the message handler), which is awkward with Context. Zustand's `getState()` makes that trivial.
- **`postMessage` with `'*'` as target.** Sending to the iframe uses `'*'` because the iframe's origin is known at send time but the target window can't be validated against it without a round-trip. The receiving side (the bridge) validates `event.source === parent`, which is the real security boundary. The outgoing `'*'` is a code smell rather than a vulnerability in this setup.
- **No routing.** Navigation between previews is state, not URL. A reload puts the board back at square one. This matches the brief ("saving anything across a reload" is out of scope).
