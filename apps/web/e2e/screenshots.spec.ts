import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const OUT =
  process.env.SCREENSHOT_DIR ??
  path.join(__dirname, "..", "..", "..", "artifacts", "screenshots", "current");

const widths = [
  { w: 1280, h: 800 },
  { w: 820, h: 1024 },
  { w: 390, h: 844 },
];
const themes = ["dark", "light"] as const;

function shotPath(screen: string, w: number, theme: string) {
  return path.join(OUT, `${screen}--w${w}--${theme}.png`);
}

async function shoot(page: Page, screen: string, w: number, theme: string) {
  await page.waitForTimeout(350);
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows, `${screen} must not overflow horizontally at ${w}px`).toBe(false);
  await page.screenshot({
    path: shotPath(screen, w, theme),
    animations: "disabled",
    fullPage: false,
  });
}

for (const { w, h } of widths) {
  for (const theme of themes) {
    test(`screens ${w}px ${theme}`, async ({ page }) => {
      await page.addInitScript(
        ([t]) => window.localStorage.setItem("memora.interface.theme", t),
        [theme],
      );
      await page.setViewportSize({ width: w, height: h });

      await page.goto("/");
      await expect(page.getByRole("button", { name: "快速开始" }).first()).toBeVisible();
      await shoot(page, "landing", w, theme);

      await page.getByRole("button", { name: "快速开始" }).first().click();
      const dialog = page.getByRole("dialog", { name: "创建个人空间" });
      await expect(dialog).toBeVisible();
      await shoot(page, "auth", w, theme);

      const stamp = `${Date.now()}-${w}-${theme}`;
      await dialog.locator('input[name="display_name"]').fill(`Shot ${w} ${theme}`);
      await dialog.locator('input[name="email"]').fill(`shot-${stamp}@memora.local`);
      await dialog.locator('input[name="password"]').fill("screenshot-password");
      await dialog.locator('input[name="password_confirm"]').fill("screenshot-password");
      await dialog.getByRole("button", { name: "创建并进入" }).click();
      await expect(page.getByRole("navigation", { name: "主要功能" })).toBeVisible({
        timeout: 30_000,
      });
      await shoot(page, "capture", w, theme);

      const isMobile = w < 821;
      async function openDrawerIfMobile() {
        if (!isMobile) return;
        const opener = page.getByRole("button", { name: "打开导航" });
        if (await opener.isVisible().catch(() => false)) {
          await opener.click();
        }
      }
      async function goTo(name: string) {
        await openDrawerIfMobile();
        await page
          .getByRole("navigation", { name: "主要功能" })
          .getByRole("button", { name })
          .click();
      }

      await goTo("我的记忆");
      await shoot(page, "library", w, theme);
      await goTo("团队记忆");
      await shoot(page, "team-memory", w, theme);

      await openDrawerIfMobile();
      await page.getByRole("button", { name: "打开账户菜单" }).click();
      await page.getByRole("menuitem", { name: "通用设置" }).click();
      await expect(page.getByRole("tabpanel", { name: "通用设置" })).toBeVisible();
      await shoot(page, "settings", w, theme);
      await page.keyboard.press("Escape");

      await openDrawerIfMobile();
      await page.getByRole("button", { name: "打开账户菜单" }).click();
      await page.getByRole("menuitem", { name: /订阅与账单/ }).click();
      await expect(page.getByRole("dialog", { name: /订阅/ })).toBeVisible();
      await shoot(page, "subscription", w, theme);
    });
  }
}
