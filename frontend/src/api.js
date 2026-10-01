import { API_ORIGIN } from "./constants";

export async function getScreens({ signal } = {}) {
  const res = await fetch(`${API_ORIGIN}/screens`, { signal });
  if (!res.ok) throw new Error(`GET /screens ${res.status}`);
  const screens = await res.json();
  if (
    !Array.isArray(screens) ||
    screens.some(
      (s) =>
        !s ||
        typeof s.id !== "string" ||
        typeof s.name !== "string" ||
        typeof s.url !== "string",
    )
  ) {
    throw new Error("Malformed /screens body");
  }
  return screens;
}

export async function getElementDetails(key, { signal } = {}) {
  const res = await fetch(`${API_ORIGIN}/elements/${encodeURIComponent(key)}`, {
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /elements/${key} ${res.status}`);
  const details = await res.json();
  const fields = ["component", "description", "status", "owner"];
  if (
    !details ||
    typeof details !== "object" ||
    Array.isArray(details) ||
    fields.some((f) => typeof details[f] !== "string")
  ) {
    throw new Error("Malformed element details body");
  }
  return details;
}
