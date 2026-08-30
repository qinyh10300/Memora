import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const responsiveCss = readFileSync(resolve(process.cwd(), "src/styles/responsive.css"), "utf8");

describe("mobile responsive contracts", () => {
  it("reserves the mobile header and device safe areas", () => {
    expect(responsiveCss).toContain(
      "--mobile-header-height: calc(58px + env(safe-area-inset-top, 0px))",
    );
    expect(responsiveCss).toContain(
      ".app-main > .view-transition {\n    height: calc(100dvh - var(--mobile-header-height))",
    );
    expect(responsiveCss).toContain("env(safe-area-inset-bottom, 0px)");
  });

  it("keeps the team search sheet within a narrow viewport", () => {
    expect(responsiveCss).toMatch(
      /\.library-search-popover \{[\s\S]*?position: fixed;[\s\S]*?bottom: calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*?max-height: calc\(100dvh - var\(--mobile-header-height\) - 20px\);/,
    );
  });

  it("provides mobile-sized primary touch targets", () => {
    expect(responsiveCss).toMatch(
      /\.team-memory-search,[\s\S]*?\.team-memory-ask \{[\s\S]*?min-height: 44px;/,
    );
    expect(responsiveCss).toMatch(/\.team-memory-members button \{[\s\S]*?min-height: 44px;/);
    expect(responsiveCss).toMatch(
      /\.composer \.attach-button,[\s\S]*?\.composer \.send-button \{[\s\S]*?width: 38px;[\s\S]*?height: 38px;/,
    );
  });
});
