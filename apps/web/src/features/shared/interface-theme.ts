export type InterfaceTheme = "dark" | "light";
export type InterfaceThemePreference = InterfaceTheme | "system";

export const INTERFACE_THEME_STORAGE_KEY = "memora.interface.theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(LIGHT_QUERY);
  } catch {
    return null;
  }
}

export function readInterfaceThemePreference(): InterfaceThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(INTERFACE_THEME_STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

export function resolveInterfaceTheme(preference: InterfaceThemePreference): InterfaceTheme {
  if (preference !== "system") return preference;
  return systemMedia()?.matches ? "light" : "dark";
}

export function readInterfaceTheme(): InterfaceTheme {
  return resolveInterfaceTheme(readInterfaceThemePreference());
}

export function applyInterfaceTheme(theme: InterfaceTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("memora-theme-light", theme === "light");
  document.documentElement.dataset.memoraTheme = theme;
}

export function storeInterfaceThemePreference(preference: InterfaceThemePreference) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, preference);
  applyInterfaceTheme(resolveInterfaceTheme(preference));
}

/** Subscribes to system theme changes; the caller decides whether they apply. */
export function watchSystemTheme(onChange: (theme: InterfaceTheme) => void): () => void {
  const media = systemMedia();
  if (!media) return () => {};
  const listener = (event: { matches: boolean }) => onChange(event.matches ? "light" : "dark");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
