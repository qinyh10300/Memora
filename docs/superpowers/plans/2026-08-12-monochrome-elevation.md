# Monochrome Elevation & Light Theme Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute spec `docs/plans/active/0036-monochrome-elevation-and-light-theme-completion.md`: enforce the token system across all 11 stylesheets, remove every chromatic value outside the allowlist, make the light theme first-class (no FOUC, tri-state preference, quick toggle), and polish all surfaces under a Playwright screenshot baseline.

**Architecture:** Pure web-layer work on branch `codex/core-platform-optimization`. CSS lives in `apps/web/src/styles/*.css` partitioned by ownership; theme state in `apps/web/src/features/shared/interface-theme.ts` applied as `html.memora-theme-light` + `data-memora-theme`. Screenshots run through the existing docker-compose e2e stack (`scripts/browser-e2e.sh` pattern, port 19180, seeded fake-AI backend). One commit per milestone; `docs/plans/active/0036-*.md` progress log updated at each milestone.

**Tech Stack:** Next.js 16.2.10 (App Router), React 19, plain CSS custom properties (no Tailwind), Playwright 1.55, Vitest 4, pnpm 11, docker compose via colima.

## Global Constraints

- No new runtime dependencies; no Tailwind/component library (spec Non-goals).
- No IA/nav changes; no structural refactors; hide-don't-delete honored — `RESEARCH`/`INSIGHTS` dead views untouched.
- No API/OpenAPI/DB changes. UI types come from `@memora/api-contract`.
- Raw color values allowed ONLY in: `tokens.css`, and the token-override block at the top of `theme-light.css`. Everywhere else: `var(--…)` or `rgba(var(--*-rgb), α)`.
- Chromatic allowlist: `--danger` family; provider brand marks in `apps/web/src/features/shared/model-picker.tsx` (inline SVG logos).
- All user-facing strings Chinese; Prettier `printWidth: 100`, double quotes; ESLint `next/core-web-vitals`; `tsc --noEmit` strict.
- Existing 93 web tests must stay green at every commit. Test queries are role/label-based — do not rename ARIA labels.
- `prefers-reduced-motion` / `html.memora-reduce-motion` behavior must not regress.
- Commit message style: conventional (`feat(web): …`, `docs: …`), each ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Web verification gate per milestone: `pnpm --filter @memora/web run format:check && pnpm --filter @memora/web run lint && pnpm --filter @memora/web run typecheck && pnpm --filter @memora/web run test && pnpm --filter @memora/web run build` (referred to below as **WEB-GATE**).

---

### Task 1: Screenshot baseline harness (M1)

**Files:**
- Create: `apps/web/e2e/screenshots.spec.ts`
- Create: `scripts/screenshot-baseline.sh`
- Modify: `docs/plans/active/0036-monochrome-elevation-and-light-theme-completion.md` (progress log + M1 checkbox)

**Interfaces:**
- Consumes: compose e2e stack from `scripts/browser-e2e.sh` (env contract copied verbatim); current UI labels: `快速开始` → dialog `创建个人空间` (inputs `display_name`/`email`/`password`/`password_confirm`, submit `创建并进入`); nav `role=navigation[name=主要功能]` buttons `新对话`/`我的记忆`/`团队记忆`; account button `打开账户菜单`; menu items `通用设置`/`订阅与账单`.
- Produces: `SCREENSHOT_DIR` tree of PNGs named `<screen>--w<width>--<theme>.png`; script invocation `SCREENSHOT_DIR=artifacts/screenshots/<tag> scripts/screenshot-baseline.sh` reused by every later task.

- [ ] **Step 1: Write `apps/web/e2e/screenshots.spec.ts`**

Six screens (`landing`, `auth`, `capture`, `library`, `team-memory`, `settings` + `subscription` bonus shot) × widths `[1280, 820, 390]` × themes `[dark, light]`. Theme is set pre-load via `addInitScript` writing `memora.interface.theme` (works with both the current useEffect mechanism and the future boot script). One registered account per (width, theme) combo with unique email. Screenshots use `animations: "disabled"`. Skeleton:

```ts
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const OUT = process.env.SCREENSHOT_DIR ?? "../../artifacts/screenshots/current";
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
  await page.waitForTimeout(350); // settle entrance animations' end state
  await page.screenshot({ path: shotPath(screen, w, theme), animations: "disabled", fullPage: false });
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
      await expect(page.getByRole("navigation", { name: "主要功能" })).toBeVisible({ timeout: 30_000 });
      await shoot(page, "capture", w, theme);

      const nav = (name: string) =>
        page.getByRole("navigation", { name: "主要功能" }).getByRole("button", { name });
      // 390px: nav sits in the mobile drawer
      async function goTo(name: string) {
        if (w < 821) {
          await page.getByRole("button", { name: "打开导航" }).click();
        }
        await nav(name).click();
      }
      await goTo("我的记忆");
      await shoot(page, "library", w, theme);
      await goTo("团队记忆");
      await shoot(page, "team-memory", w, theme);

      if (w < 821) {
        await page.getByRole("button", { name: "打开导航" }).click();
      }
      await page.getByRole("button", { name: "打开账户菜单" }).click();
      await page.getByRole("menuitem", { name: "通用设置" }).click();
      await expect(page.getByRole("tabpanel", { name: "通用设置" })).toBeVisible();
      await shoot(page, "settings", w, theme);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "打开账户菜单" }).click();
      await page.getByRole("menuitem", { name: /订阅与账单/ }).click();
      await shoot(page, "subscription", w, theme);
    });
  }
}
```

Selector names above were read from the current source (`sidebar.tsx`, `account-settings-dialog.tsx`, old e2e spec); if any locator fails at first run, fix the locator against the live DOM — do NOT change app labels to fit the test.

- [ ] **Step 2: Write `scripts/screenshot-baseline.sh`**

Derived from `scripts/browser-e2e.sh` (same env contract) but: project name `memora-screens`, leaves the stack UP between runs (no down in trap), runs only the screenshots spec:

```sh
#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_NAME=${SCREENS_PROJECT_NAME:-memora-screens}
HTTP_PORT=${SCREENS_HTTP_PORT:-19180}
export APP_ENV=test CADDY_SITE_ADDRESS=http://localhost HTTP_PORT HTTPS_PORT=0
export POSTGRES_DB=memora_e2e POSTGRES_USER=memora_e2e POSTGRES_PASSWORD=memora-e2e-password
export SESSION_SECRET=browser-e2e-session-secret-not-for-production
export SEED_DEVELOPMENT_DATA_ENABLED=true
export AI_CHAT_BASE_URL=http://fake-ai:18081/v1 AI_CHAT_API_KEY=browser-e2e-key AI_CHAT_MODEL=e2e-chat
export AI_MODEL_REGISTRY_JSON='[{"id":"gpt","label":"GPT E2E","provider_model":"e2e-chat","provider_family":"gpt","capabilities":["chat","vision","web_search","tools"],"cost_tier":"balanced","priority":10,"timeout_seconds":60,"fallback_ids":[],"default":true}]'
export AI_EMBEDDING_BASE_URL=http://fake-ai:18081/v1 AI_EMBEDDING_API_KEY=browser-e2e-key AI_EMBEDDING_MODEL=e2e-embedding
export AI_WEB_SEARCH_MODEL=e2e-search METRICS_ENABLED=true METRICS_TOKEN=browser-e2e-metrics-token-not-for-production
export DOCKER_NO_PROXY=localhost,127.0.0.1,db,api,web,worker,proxy,fake-ai

cd "$ROOT_DIR"
docker compose --project-name "$PROJECT_NAME" --profile e2e up --detach --build --wait fake-ai db migrate seed api worker web proxy
PLAYWRIGHT_BASE_URL="http://localhost:$HTTP_PORT" SCREENSHOT_DIR="${SCREENSHOT_DIR:-$ROOT_DIR/artifacts/screenshots/current}" \
  pnpm --filter @memora/web exec playwright test e2e/screenshots.spec.ts
```

`chmod +x scripts/screenshot-baseline.sh`. Teardown is manual: `docker compose --project-name memora-screens --profile e2e down --volumes --remove-orphans` (run once at end of all milestones).

- [ ] **Step 3: Run baseline** — `pnpm --filter @memora/web exec playwright install chromium` once, then `SCREENSHOT_DIR=$PWD/artifacts/screenshots/m0-baseline scripts/screenshot-baseline.sh`. Expected: 42 PNGs (7 screens × 3 widths × 2 themes). Iterate on locators until green.
- [ ] **Step 4: Eyeball the 42 shots** (Read tool on a sample incl. every screen at 1280/dark and 1280/light) to confirm they show real UI, not error states.
- [ ] **Step 5: WEB-GATE**, then commit `feat(web): add screenshot baseline harness` (spec/script only — PNGs are NOT committed; `artifacts/` is untracked). Tick M1 in 0036, append progress log line, include in same commit.

---

### Task 2: Token integrity sweep (M2)

**Files:**
- Modify: `apps/web/src/styles/tokens.css` (new tokens + canonical breakpoint comment + `.privacy-dot` fix)
- Modify: `apps/web/src/styles/theme-light.css` (token block additions only in this task)
- Modify: all of `workbench.css, capture.css, library.css, public.css, responsive.css, features.css, insights.css, settings.css, team.css` (literal conversion)
- Create: `scripts/audit-styles.sh` (grep audit used as the acceptance gate)

**Interfaces:**
- Produces (used by every later task): `--shadow-rgb` (always-black shadows), `--scrim-rgb` (backdrop dims; dark `3,4,8` / light `235,235,235`), `--panel-tint-rgb` (translucent panel fills; dark `9,9,11` / light `252,252,252`), fluid type tokens `--fs-fluid-*` as discovered, plus the audit script contract: `scripts/audit-styles.sh` exits non-zero when a violation exists.

- [ ] **Step 1: Add the shared tokens.** In `tokens.css` `:root` after `--mono-rgb`:

```css
  --shadow-rgb: 0, 0, 0; /* shadows stay dark in both themes */
  --scrim-rgb: 3, 4, 8; /* modal/backdrop dims */
  --panel-tint-rgb: 9, 9, 11; /* translucent panel fills over sheens */
  --danger-rgb: 255, 133, 133; /* alpha-composable danger family */
```

In `theme-light.css` token block: `--scrim-rgb: 235, 235, 235;`, `--panel-tint-rgb: 252, 252, 252;`, `--danger-rgb: 166, 43, 49;` (`--shadow-rgb` intentionally NOT overridden). Fix `tokens.css` `.privacy-dot` box-shadow `rgba(135,135,135,0.12)` → `rgba(var(--mono-rgb), 0.12)`. Add the canonical breakpoint comment block above `:root`:

```css
/* Canonical breakpoints (max-width unless noted): 1100 laptop-narrow, 1040/1000/900 stage-specific,
   820 mobile shell boundary (821 min-width desktop-only), 760/680/620 phone compaction,
   520 small phone, 360 minimum. Do not introduce new breakpoints without updating this list. */
```

- [ ] **Step 2: Write `scripts/audit-styles.sh`** — the acceptance grep, allowlist-aware:

```sh
#!/bin/sh
# Fails if raw colors appear outside tokens.css / theme-light.css token block.
set -eu
cd "$(dirname -- "$0")/../apps/web/src/styles"
viol=0
for f in workbench.css capture.css library.css public.css responsive.css features.css insights.css settings.css team.css; do
  hits=$(grep -nE 'rgba?\(\s*[0-9]|#[0-9a-fA-F]{3,8}\b' "$f" | grep -v 'var(--' || true)
  if [ -n "$hits" ]; then echo "== $f =="; echo "$hits"; viol=1; fi
done
# theme-light.css: raw colors legal only in the leading token block (before first non-token selector)
awk '/^html\.memora-theme-light \{/,/^\}/ {next} /rgba?\(\s*[0-9]|#[0-9a-fA-F]{3,8}/ && !/var\(--/ {print FILENAME":"FNR": "$0; v=1} END {exit v}' theme-light.css || viol=1
exit $viol
```

`chmod +x`. Run it now — expected: FAILS listing ~225 violations (this is the "failing test" for the sweep).

- [ ] **Step 3: Fan out the per-file conversion** (one subagent per CSS file, parallel — files are independent). Conversion rules each agent must apply, in priority order:
  1. `rgba(255, 255, 255, α)` → `rgba(var(--mono-rgb), α)` (keep α unchanged).
  1b. Mid-grey `rgba(G, G, G, α)` with `64 ≤ G ≤ 250` → `rgba(var(--mono-rgb), round(α × G / 255, 3))` — a grey overlay equals a dimmer pure-mono overlay (exact over black; report any case whose context makes the approximation visibly off).
  1c. Danger reds (`rgba(255,92,98,α)`, `rgba(210,72,72,α)`, `rgba(255,133,133,α)` etc.) → `rgba(var(--danger-rgb), α)` (keep α; report each).
  2. `rgba(0, 0, 0, α)` inside `box-shadow`/`text-shadow`/`drop-shadow` → `rgba(var(--shadow-rgb), α)`.
  3. Backdrop/scrim `background` on `*-backdrop`, `*-scrim`, overlay-dim rules → `rgba(var(--scrim-rgb), α)` (near-black rgb triplets like `0,1,5` / `0,0,0` used as full-viewport dims).
  4. Other near-black translucent fills (all channels ≤ 63, non-shadow) → `rgba(var(--panel-tint-rgb), α)`.
  5. Opaque grey hexes → nearest `--tone-*` / surface / text token (exact match required; if no exact tone exists, keep the value but hoist it into `tokens.css` as a new `--tone-XX` + light mirror — report additions back).
  6. Raw `font-size` in rem/px → nearest `--fs-*` (≤0.02rem delta acceptable); `clamp()` stays inline in this task (fluid type is deliberate) — EXCEPT identical clamp() repeated ≥3× in one file: hoist to a `--fs-fluid-<name>` token.
  7. Raw `border-radius` px → exact `--r-*` match only (7/8/10/12/16/999 → token; other values LEFT AS-IS in this task and reported back; do not visually shift radii).
  8. Chromatic values (any hue): DO NOT touch — report them back (they are Task 3's input).
  9. Never change selectors, property order, keyframes, or add/remove rules. Pure value substitution.
  Each agent returns: counts converted per rule, plus lists for rules 5/7/8.
- [ ] **Step 4: Reconcile.** Apply any new `--tone-*` requests to both token files. Re-run `scripts/audit-styles.sh` — expected: only chromatic (Task 3) lines remain; whitelist them by confirming every remaining hit is in the Task 3 inventory. Merge the duplicated `max-width: 1100px` / `820px` blocks: move `features.css`'s dupes into its OWN single block per breakpoint (do not cross files; import order `features → insights → responsive` means moving rules across files changes cascade).
- [ ] **Step 5: WEB-GATE + screenshot diff.** Run `SCREENSHOT_DIR=$PWD/artifacts/screenshots/m2 scripts/screenshot-baseline.sh`; compare vs `m0-baseline` (`Read` suspicious pairs side by side; expected: near-identical dark shots, light shots IMPROVE where literals now invert). Investigate any dark-theme diff — dark must be visually unchanged.
- [ ] **Step 6: Commit** `refactor(web): route all style colors through the token system` + 0036 M2 tick/progress.

---

### Task 3: Fully monochrome (M3)

**Files:**
- Modify: `apps/web/src/styles/features.css` (subscription blue cluster, lines ~2772-3082)
- Modify: `apps/web/src/styles/capture.css` (`#f4f3f0` empty-heading ~L451, `#b6c9e5` team chip ~L429)
- Modify: `apps/web/src/styles/theme-light.css` (delete `.plan-option.is-recommended` blue patch)
- Modify: `scripts/audit-styles.sh` → after this task it must pass with ZERO exceptions

**Interfaces:**
- Consumes: tokens from Task 2. Produces: nothing new — removals only.

- [ ] **Step 1: Replace the subscription blues in `features.css`** with this monochrome treatment (inverted-chip emphasis — white-on-black in dark, auto-flips via tokens):

```css
.subscription-promo svg { color: var(--text-soft); }

.credit-icon {
  border: 1px solid var(--accent-line);
  background: rgba(var(--mono-rgb), 0.1);
  color: var(--text);
}

.credit-meter span {
  background: linear-gradient(90deg, var(--accent-strong), var(--accent-light));
  box-shadow: 0 0 14px rgba(var(--mono-rgb), 0.28);
}

.plan-option.is-recommended {
  border-color: rgba(var(--mono-rgb), 0.45);
  background:
    radial-gradient(circle at 86% 0%, rgba(var(--mono-rgb), 0.12), transparent 31%),
    rgba(var(--panel-tint-rgb), 0.52);
  box-shadow:
    0 18px 56px rgba(var(--shadow-rgb), 0.3),
    0 0 0 1px rgba(var(--mono-rgb), 0.1) inset;
}

.plan-option.is-recommended:hover {
  border-color: rgba(var(--mono-rgb), 0.62);
  box-shadow:
    0 26px 64px rgba(var(--shadow-rgb), 0.4),
    0 0 0 1px rgba(var(--mono-rgb), 0.14) inset;
}

.plan-recommended-badge {
  background: var(--accent-light);
  color: var(--bg-deep);
  box-shadow: 0 8px 20px rgba(var(--shadow-rgb), 0.34);
}

.is-recommended .plan-symbol {
  border-color: var(--accent-line);
  background: rgba(var(--mono-rgb), 0.1);
  color: var(--text);
}

.plan-option.is-recommended > button:not(:disabled) {
  background: var(--accent-light);
  color: var(--bg-deep);
  box-shadow: 0 12px 28px rgba(var(--shadow-rgb), 0.3);
}

.plan-option.is-recommended > button:hover:not(:disabled) {
  background: var(--text);
  box-shadow: 0 16px 34px rgba(var(--shadow-rgb), 0.4);
}
```

(`--accent-light`/`--bg-deep` flip in light theme, giving black-chip-on-white — emphasis preserved without hue.)

- [ ] **Step 2: capture.css strays** — `#f4f3f0` → `var(--text)`; `#b6c9e5` → `var(--text-soft)`. Check both in context first; if the chip needs distinct-from-text treatment, use `var(--muted)` + `rgba(var(--mono-rgb), α)` background instead of a hue.
- [ ] **Step 3: theme-light.css** — delete any `.plan-option.is-recommended` / `.plan-recommended-badge` blue patch rules (search `3158e6|49, 88, 230|31, 58` in the file).
- [ ] **Step 4: Audit hard gate** — `scripts/audit-styles.sh` must now exit 0. Also `grep -rn '#[0-9a-fA-F]' apps/web/src/features --include='*.tsx' | grep -v model-picker` to confirm no chromatic inline styles hide in TSX.
- [ ] **Step 5: WEB-GATE + screenshots** `m3` tag; review `subscription--*` pairs in BOTH themes — the Pro card must still read as clearly emphasized. This is the spec's open question #1: record the chosen treatment + screenshot evidence in 0036 decision log for user review.
- [ ] **Step 6: Commit** `feat(web): make subscription and stray accents fully monochrome` + 0036 M3 tick/progress.

---

### Task 4: Light theme first-class (M4)

**Files:**
- Modify: `apps/web/src/features/shared/interface-theme.ts` (tri-state)
- Create: `apps/web/src/features/shared/interface-theme.test.ts`
- Modify: `apps/web/src/app/layout.tsx` (boot script)
- Modify: `apps/web/src/features/workbench/workbench-shell.tsx:945-951` (system watcher)
- Modify: `apps/web/src/features/settings/account-settings-dialog.tsx:561-597` (tri-state radiogroup)
- Modify: `apps/web/src/features/workspaces/sidebar.tsx:840-862` (quick toggle menuitem)
- Modify: `apps/web/src/styles/theme-light.css` (patch-layer shrink + annotations)
- Modify: `apps/web/vitest.setup.ts` (matchMedia stub) if jsdom lacks it
- Modify: `apps/web/src/app/page.test.tsx` (theme tests for new default)

**Interfaces:**
- Produces (exact signatures later steps and future code rely on):

```ts
export type InterfaceTheme = "dark" | "light";
export type InterfaceThemePreference = InterfaceTheme | "system";
export const INTERFACE_THEME_STORAGE_KEY = "memora.interface.theme";
export function readInterfaceThemePreference(): InterfaceThemePreference; // missing/invalid key → "system"
export function resolveInterfaceTheme(pref: InterfaceThemePreference): InterfaceTheme; // "system" → matchMedia, no-window → "dark"
export function readInterfaceTheme(): InterfaceTheme; // resolveInterfaceTheme(readInterfaceThemePreference())
export function applyInterfaceTheme(theme: InterfaceTheme): void; // unchanged behavior
export function storeInterfaceThemePreference(pref: InterfaceThemePreference): void; // persists pref, applies resolved
export function watchSystemTheme(onChange: (theme: InterfaceTheme) => void): () => void; // active regardless of pref; caller filters
```

Storage values: `"dark" | "light" | "system"`; missing key ⇒ system (new-user default). Existing stored `dark`/`light` keep meaning explicit choice — no migration.

- [ ] **Step 1: Write failing tests** `interface-theme.test.ts` (vitest, jsdom): pref read (missing→system, garbage→system, explicit passthrough); resolve (system+light matchMedia→light, system+dark→dark, explicit ignores matchMedia); store round-trip applies class; watchSystemTheme fires on `change` event and unsubscribes. Mock `window.matchMedia` locally in the test with a controllable stub.
- [ ] **Step 2: Run** `pnpm --filter @memora/web run test -- interface-theme` — expected FAIL (functions missing).
- [ ] **Step 3: Implement** `interface-theme.ts` per the interface block above (keep `readInterfaceTheme`/`applyInterfaceTheme` names so existing call sites in `workbench-shell.tsx` and `account-settings-dialog.tsx` keep compiling). Run tests — PASS.
- [ ] **Step 4: Boot script.** In `layout.tsx`, first child of `<body>`:

```tsx
const themeBootScript = `(function(){try{var k="memora.interface.theme";var v=localStorage.getItem(k);var t=v==="dark"||v==="light"?v:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.classList.toggle("memora-theme-light",t==="light");document.documentElement.dataset.memoraTheme=t;}catch(e){}})();`;
// in JSX: <body><script dangerouslySetInnerHTML={{ __html: themeBootScript }} />{children}</body>
```

- [ ] **Step 5: System watcher.** In `workbench-shell.tsx` theme effect (~948) replace the one-shot apply with: apply once, then `watchSystemTheme((t) => { if (readInterfaceThemePreference() === "system") applyInterfaceTheme(t); })`, returning the unsubscribe from the effect.
- [ ] **Step 6: Settings radiogroup** — three options, `跟随系统` first (swatch `is-system`: half-dark/half-light diagonal via existing CSS pattern; add small CSS in `settings.css` using only tokens): state from `readInterfaceThemePreference()`, `updateTheme` takes `InterfaceThemePreference` and calls `storeInterfaceThemePreference`. Labels: 跟随系统/自动匹配设备, 黑色/深色背景, 白色/浅色背景.
- [ ] **Step 7: Quick toggle.** In `sidebar.tsx` account menu, insert before 通用设置 item: menuitem `切换主题` with `Sun`/`Moon` lucide icon reflecting CURRENT resolved theme, onClick: `storeInterfaceThemePreference(readInterfaceTheme() === "dark" ? "light" : "dark")` (an explicit override; menu stays open is fine to close — follow the other items' close behavior). aria-label `切换主题，当前${dark?"深色":"浅色"}`.
- [ ] **Step 8: Patch-layer shrink.** For each remaining `html.memora-theme-light <component>` rule in `theme-light.css` below the token block: delete it, re-shoot the affected screen light-theme, keep deletion if identical-or-better; if genuinely asymmetric (light shadows, glass tints), keep with a one-line `/* asymmetric: reason */` comment. Target: single-digit survivors, all annotated.
- [ ] **Step 9: Fix page.test.tsx** theme expectations (default is now system-resolved; jsdom matchMedia stub in `vitest.setup.ts` returning dark preserves old assertions — add stub only if tests fail without it).
- [ ] **Step 10: FOUC verification.** Against the running stack: Playwright script sets `light` pref, loads `/` with CDP … simplest reliable check: `page.addInitScript` storing light + `page.goto` + immediately `page.evaluate(() => document.documentElement.dataset.memoraTheme)` must be `"light"` before any rAF; plus manual hard-reload spot check. Also verify `system` follows `page.emulateMedia({ colorScheme: "light" })`.
- [ ] **Step 11: WEB-GATE + screenshots `m4` (both themes) + commit** `feat(web): first-class light theme with system preference and quick toggle` + 0036 M4 tick/progress.

---

### Task 5: Elevation — capture + shell/sidebar (M5)

**Files:** `capture.css`, `workbench.css` (+ tiny tsx className additions only if a state hook is missing)

Method (applies to Tasks 5-7): invoke `frontend-design:frontend-design` skill once at Task 5 start; audit each dimension against the 1280/820/390 × dark/light shots; make targeted CSS diffs; re-shoot; keep diffs that survive side-by-side review; every change through tokens.

- [ ] **Step 1: Audit checklist — capture:** intro heading typography (per-char entrance from 0029 — verify reduced-motion end-state), centered→docked composer transition continuity, activity-trace hierarchy (step labels vs body contrast), composer border/hover/focus states, attachment chips consistency.
- [ ] **Step 2: Audit checklist — shell/sidebar:** `:focus-visible` ring visibility on BOTH themes against `--accent-light` outline, hairline consistency (`--line` vs `--line-strong` usage on panel seams), nav active-state affordance, empty states (no conversations / no memories) share one visual grammar, account dock density.
- [ ] **Step 3:** Apply diffs → WEB-GATE + screenshots `m5` → side-by-side review vs `m4` → commit `feat(web): polish capture and shell surfaces` + 0036 M5.

### Task 6: Elevation — library + team memory center (M6)

**Files:** `library.css`, `features.css` (team-memory areas), `insights.css` (analysis tab)

- [ ] **Step 1: Audit checklist — library:** timeline date-group headers vs card contrast, memory-card hover/active/selected states, detail-view Markdown reading measure (line length, heading scale, code blocks in both themes), revision-history affordance.
- [ ] **Step 2: Audit checklist — team memory center:** tablist active indicator, 共享记忆 empty + populated states, graph tab canvas background vs tokens (xyflow default styles may fight the theme — override via tokens only), analysis tab visual consistency with the rest (it predates the monochrome pivot).
- [ ] **Step 3:** Apply → WEB-GATE + screenshots `m6` → review → commit `feat(web): polish library and team memory surfaces` + 0036 M6.

### Task 7: Elevation — dialogs, landing, mobile (M7)

**Files:** `settings.css`, `features.css` (subscription dialog frame), `public.css`, `responsive.css`, `team.css` (dialog bits)

- [ ] **Step 1: Audit checklist — dialogs:** one modal grammar (backdrop α, panel radius `--panel-radius`, header treatment, close affordance) across auth/settings/team/subscription; subscription hero density after Task 3's monochrome cards.
- [ ] **Step 2: Audit checklist — landing:** section rhythm at 1280/820/390, entrance-motion restraint (spec open question #2 — decide, record in 0036 decision log with screenshots), CTA hierarchy, both themes.
- [ ] **Step 3: Audit checklist — mobile (390 shots of every screen):** drawer behavior, tap-target ≥40px on nav/menu/composer controls, horizontal overflow check (reuse e2e overflow assertion pattern), safe spacing at 360px.
- [ ] **Step 4:** Apply → WEB-GATE + full screenshots `m7-final` (all 42) → review → commit `feat(web): polish dialogs, landing and mobile surfaces` + 0036 M7.

---

### Task 8: Closeout

- [ ] **Step 1:** Re-run `scripts/audit-styles.sh` (must pass), full WEB-GATE, attempt full `make check` (if API python env unavailable, run web subset and record the limitation).
- [ ] **Step 2:** Fill 0036 Completion summary (results, verification evidence, deviations), tick acceptance criteria, move `docs/plans/active/0036-*.md` → `docs/plans/completed/`, update progress/decision logs.
- [ ] **Step 3:** Tear down compose stack. Final commit `docs: complete monochrome elevation rollout`. Report to user with before/after screenshot pairs and the two recorded design decisions (Pro card treatment, landing motion).

## Self-review notes

- Spec coverage: M1→Task1, M2→Task2, M3→Task3, M4→Task4, M5-M7→Tasks5-7, acceptance-criteria greps→`audit-styles.sh`, completion/archival→Task8. Open questions #1/#2 handled in Tasks 3/7 via decision-log + screenshot evidence (user not available mid-run; explicitly flagged for post-hoc review).
- Type consistency: `InterfaceThemePreference` union and function names in Task 4 Step 1 tests match the Interfaces block verbatim; `readInterfaceTheme`/`applyInterfaceTheme` signatures unchanged for existing call sites.
- No placeholders: mechanical sweeps are specified as deterministic rule lists + a hard audit gate rather than enumerated line edits (225 conversions); design tasks are specified as bounded audit checklists + review gates rather than pixel values, which cannot be honestly pre-specified.
