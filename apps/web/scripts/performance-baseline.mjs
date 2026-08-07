import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseURL = (process.env.MEMORA_PUBLIC_URL ?? "http://localhost:8080").replace(/\/$/, "");
const email = process.env.SEED_USER_1_EMAIL ?? "alex@memora.local";
const password = process.env.SEED_USER_1_PASSWORD ?? "memora-local-alex";
const outputPath = path.resolve(
  process.env.WEB_PERFORMANCE_OUTPUT ?? "../../artifacts/web-performance-baseline.json",
);

const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true },
];

async function measureNavigation(browser, profile, authenticated) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    colorScheme: "dark",
    locale: "zh-CN",
  });
  if (authenticated) {
    const login = await context.request.post(`${baseURL}/api/auth/login`, {
      data: { email, password },
    });
    if (!login.ok()) {
      throw new Error(`Performance login failed with ${login.status()}`);
    }
  }
  await context.addInitScript(() => {
    window.__memoraPerformance = { cls: 0, lcp: 0 };
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const latest = entries.at(-1);
      if (latest) window.__memoraPerformance.lcp = latest.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__memoraPerformance.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const page = await context.newPage();
  const started = performance.now();
  const response = await page.goto(baseURL, { waitUntil: "networkidle", timeout: 30_000 });
  if (!response?.ok()) throw new Error(`Navigation failed with ${response?.status()}`);
  await page.waitForTimeout(500);
  const wallMs = performance.now() - started;
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const scripts = resources.filter((entry) => entry.initiatorType === "script");
    return {
      ttfb_ms: navigation.responseStart,
      dom_content_loaded_ms: navigation.domContentLoadedEventEnd,
      load_event_ms: navigation.loadEventEnd,
      lcp_ms: window.__memoraPerformance.lcp,
      cls: window.__memoraPerformance.cls,
      transferred_bytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
      script_bytes: scripts.reduce((total, entry) => total + entry.transferSize, 0),
      script_requests: scripts.length,
    };
  });
  await context.close();
  return {
    viewport: profile.viewport,
    authenticated,
    wall_ms: Math.round(wallMs * 100) / 100,
    ...Object.fromEntries(
      Object.entries(metrics).map(([key, value]) => [key, Math.round(value * 100) / 100]),
    ),
  };
}

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
try {
  const scenarios = {};
  for (const profile of profiles) {
    scenarios[`${profile.name}_public`] = await measureNavigation(browser, profile, false);
    scenarios[`${profile.name}_app`] = await measureNavigation(browser, profile, true);
  }
  const report = {
    measured_at: new Date().toISOString(),
    base_url: baseURL,
    scenarios,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(outputPath);
} finally {
  await browser.close();
}
