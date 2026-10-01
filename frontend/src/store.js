import { create } from "zustand";
import { MIN_ZOOM, MAX_ZOOM } from "./constants";

const emptyPreview = (screen) => ({
  screenId: screen.id,
  name: screen.name,
  url: screen.url,
  status: "loading",
  error: null,
  pageError: null,
  session: null,
  selection: [],
  hovered: null,
  geometry: { hovered: null, selected: [] },
  tree: [],
  expanded: {},
  rowStatus: {},
  search: "",
  searchTree: null,
  removed: false,
  panelScroll: 0,
});

// Every action that touches one preview goes through this.
const patch = (screenId, update) => (state) => {
  const current = state.previews[screenId];
  if (!current) return {};
  const next = typeof update === "function" ? update(current) : update;
  return {
    previews: { ...state.previews, [screenId]: { ...current, ...next } },
  };
};

const clamp = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const useStore = create((set) => ({
  // board
  screens: [],
  screensError: null,
  screensLoading: true,
  mode: "select",
  zoom: 0.45,
  panX: 24,
  panY: 24,
  activeScreenId: null,

  // per-preview
  previews: {},

  // inspector
  details: { loading: false, data: null, error: null, key: null },
  detailsRetry: 0,

  // dev
  devFail: { screens: false, preview: false, details: false },
  devOpen: false,

  // ---- board actions ----
  setScreens: (screens) =>
    set({ screens, screensError: null, screensLoading: false }),
  setScreensLoading: (screensLoading) => set({ screensLoading }),
  setScreensError: (screensError) =>
    set({ screensError, screensLoading: false }),
  setMode: (mode) => set({ mode }),
  setZoom: (zoom) => set({ zoom: clamp(zoom) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setActiveScreen: (activeScreenId) => set({ activeScreenId }),

  // ---- preview lifecycle ----
  initPreviews: (screens) =>
    set((state) => {
      const previews = { ...state.previews };
      for (const screen of screens)
        previews[screen.id] ??= emptyPreview(screen);
      return { previews };
    }),

  updatePreview: (screenId, fields) => set(patch(screenId, fields)),
  setPreviewStatus: (screenId, status, error = null) =>
    set(patch(screenId, { status, error })),
  setPageError: (screenId, pageError) => set(patch(screenId, { pageError })),
  setHovered: (screenId, hovered) => set(patch(screenId, { hovered })),
  setGeometry: (screenId, geometry) => set(patch(screenId, { geometry })),
  setRemoved: (screenId, removed) => set(patch(screenId, { removed })),
  setTree: (screenId, tree) => set(patch(screenId, { tree })),
  setExpanded: (screenId, expanded) => set(patch(screenId, { expanded })),
  setSearch: (screenId, search) => set(patch(screenId, { search })),
  setSearchTree: (screenId, searchTree) => set(patch(screenId, { searchTree })),
  setPanelScroll: (screenId, panelScroll) =>
    set(patch(screenId, { panelScroll })),

  setSelection: (screenId, selection) =>
    set(patch(screenId, { selection, removed: false })),

  setRowStatus: (screenId, key, status) =>
    set(
      patch(screenId, (current) => {
        const rowStatus = { ...current.rowStatus };
        if (status) rowStatus[key] = status;
        else delete rowStatus[key];
        return { rowStatus };
      }),
    ),

  clearAllSelections: () =>
    set((state) => {
      const previews = { ...state.previews };
      for (const id of Object.keys(previews)) {
        previews[id] = { ...previews[id], selection: [], removed: false };
      }
      return { previews };
    }),

  // ---- inspector ----
  setDetails: (fields) =>
    set((state) => ({ details: { ...state.details, ...fields } })),
  bumpDetailsRetry: () =>
    set((state) => ({ detailsRetry: state.detailsRetry + 1 })),

  // ---- dev ----
  setDevFail: (key, value) =>
    set((state) => ({ devFail: { ...state.devFail, [key]: value } })),
  toggleDevOpen: () => set((state) => ({ devOpen: !state.devOpen })),
}));
