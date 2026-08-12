import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTERFACE_THEME_STORAGE_KEY,
  applyInterfaceTheme,
  readInterfaceTheme,
  readInterfaceThemePreference,
  resolveInterfaceTheme,
  storeInterfaceThemePreference,
  watchSystemTheme,
} from "./interface-theme";

type MediaListener = (event: { matches: boolean }) => void;

function stubMatchMedia(prefersLight: boolean) {
  const listeners = new Set<MediaListener>();
  const mql = {
    matches: prefersLight,
    media: "(prefers-color-scheme: light)",
    addEventListener: (_: "change", listener: MediaListener) => listeners.add(listener),
    removeEventListener: (_: "change", listener: MediaListener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ ...mql, media: query })),
  );
  return {
    emitChange(matches: boolean) {
      listeners.forEach((listener) => listener({ matches }));
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove("memora-theme-light");
  delete document.documentElement.dataset.memoraTheme;
});

describe("readInterfaceThemePreference", () => {
  it("returns system when nothing is stored", () => {
    expect(readInterfaceThemePreference()).toBe("system");
  });

  it("returns system for unknown stored values", () => {
    window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, "sepia");
    expect(readInterfaceThemePreference()).toBe("system");
  });

  it("passes through explicit stored preferences", () => {
    window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, "light");
    expect(readInterfaceThemePreference()).toBe("light");
    window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, "dark");
    expect(readInterfaceThemePreference()).toBe("dark");
    window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, "system");
    expect(readInterfaceThemePreference()).toBe("system");
  });
});

describe("resolveInterfaceTheme", () => {
  it("returns explicit preferences unchanged regardless of the system", () => {
    stubMatchMedia(true);
    expect(resolveInterfaceTheme("dark")).toBe("dark");
    expect(resolveInterfaceTheme("light")).toBe("light");
  });

  it("follows the system preference for system", () => {
    stubMatchMedia(true);
    expect(resolveInterfaceTheme("system")).toBe("light");
    stubMatchMedia(false);
    expect(resolveInterfaceTheme("system")).toBe("dark");
  });

  it("falls back to dark when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(resolveInterfaceTheme("system")).toBe("dark");
  });
});

describe("readInterfaceTheme", () => {
  it("resolves a stored explicit preference", () => {
    stubMatchMedia(false);
    window.localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, "light");
    expect(readInterfaceTheme()).toBe("light");
  });

  it("resolves system preference when nothing is stored", () => {
    stubMatchMedia(true);
    expect(readInterfaceTheme()).toBe("light");
  });
});

describe("storeInterfaceThemePreference", () => {
  it("persists the preference and applies the resolved theme", () => {
    stubMatchMedia(false);
    storeInterfaceThemePreference("light");
    expect(window.localStorage.getItem(INTERFACE_THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("memora-theme-light")).toBe(true);
    expect(document.documentElement.dataset.memoraTheme).toBe("light");
  });

  it("applies the system-resolved theme when storing system", () => {
    stubMatchMedia(true);
    storeInterfaceThemePreference("system");
    expect(window.localStorage.getItem(INTERFACE_THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.classList.contains("memora-theme-light")).toBe(true);
  });
});

describe("applyInterfaceTheme", () => {
  it("toggles the light class and dataset", () => {
    applyInterfaceTheme("light");
    expect(document.documentElement.classList.contains("memora-theme-light")).toBe(true);
    applyInterfaceTheme("dark");
    expect(document.documentElement.classList.contains("memora-theme-light")).toBe(false);
    expect(document.documentElement.dataset.memoraTheme).toBe("dark");
  });
});

describe("watchSystemTheme", () => {
  it("notifies with the mapped theme when the system changes", () => {
    const media = stubMatchMedia(false);
    const seen: string[] = [];
    const stop = watchSystemTheme((theme) => seen.push(theme));
    media.emitChange(true);
    media.emitChange(false);
    expect(seen).toEqual(["light", "dark"]);
    stop();
    media.emitChange(true);
    expect(seen).toEqual(["light", "dark"]);
    expect(media.listenerCount()).toBe(0);
  });

  it("is a no-op without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    const stop = watchSystemTheme(() => {});
    expect(typeof stop).toBe("function");
    stop();
  });
});
