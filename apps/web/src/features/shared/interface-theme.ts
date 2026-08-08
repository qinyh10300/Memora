export type InterfaceTheme = "dark" | "light";

export const INTERFACE_THEME_STORAGE_KEY = "memora.interface.theme";

export function readInterfaceTheme(): InterfaceTheme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(INTERFACE_THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

export function applyInterfaceTheme(theme: InterfaceTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("memora-theme-light", theme === "light");
  document.documentElement.dataset.memoraTheme = theme;
}

export function storeInterfaceTheme(theme: InterfaceTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, theme);
  applyInterfaceTheme(theme);
}
