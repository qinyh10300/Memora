import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LandingConstellation } from "./landing-constellation";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("memora-reduce-motion");
});

describe("LandingConstellation", () => {
  it("renders a decorative canvas that never captures interaction", () => {
    const { container } = render(<LandingConstellation />);
    const canvas = container.querySelector("canvas.landing-constellation");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");
  });

  it("stays inert when the environment cannot draw (jsdom has no 2d context)", () => {
    const { container, unmount } = render(<LandingConstellation />);
    const canvas = container.querySelector("canvas.landing-constellation");
    expect(canvas).toHaveAttribute("data-constellation", "unsupported");
    unmount(); // must not throw during cleanup
  });
});
