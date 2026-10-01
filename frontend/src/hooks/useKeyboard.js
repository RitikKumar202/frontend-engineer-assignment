import { useEffect } from "react";
import { useStore } from "../store";

export function useKeyboard() {
  useEffect(() => {
    const handler = (event) => {
      const target = event.target;
      if (target?.matches?.('input,textarea,select,[contenteditable="true"]'))
        return;

      const state = useStore.getState();
      const active = state.activeScreenId;

      const key = event.key;

      if (key === "v" || key === "V") {
        state.setMode("select");
        return;
      }
      if (key === "i" || key === "I") {
        state.setMode("interact");
        return;
      }
      if (key === "Escape") {
        state.clearAllSelections();
        return;
      }
      if (!active) return;

      const preview = state.previews[active];
      if (!preview) return;

      const send = window.__figrSend?.(active);
      if (!send) return;

      if (key === "Enter") {
        event.preventDefault();
        const last = preview.selection[preview.selection.length - 1];
        if (!last) return;
        if (event.shiftKey)
          send({ type: "navigate-element", ref: last.ref, action: "parent" });
        else
          send({
            type: "navigate-element",
            ref: last.ref,
            action: "first-child",
          });
      } else if (key === "Tab") {
        event.preventDefault();
        const last = preview.selection[preview.selection.length - 1];
        if (!last) return;
        send({
          type: "navigate-element",
          ref: last.ref,
          action: event.shiftKey ? "previous-sibling" : "next-sibling",
        });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
