import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "./error";

describe("ErrorPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports only bounded metadata and exposes a working retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const reset = vi.fn();
    const error = Object.assign(new Error("PRIVATE_MESSAGE_MUST_NOT_LEAVE_BROWSER"), {
      name: "ChunkLoadError",
      digest: "safe-digest-123",
    });

    render(<ErrorPage error={error} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(reset).toHaveBeenCalledOnce();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0];
    const options = request[1] as RequestInit;
    expect(request[0]).toBe("/api/client-errors");
    expect(options.body).toBe(
      JSON.stringify({
        surface: "workbench",
        error_type: "ChunkLoadError",
        digest: "safe-digest-123",
        recovery_action: "retry",
      }),
    );
    expect(String(options.body)).not.toContain("PRIVATE_MESSAGE_MUST_NOT_LEAVE_BROWSER");
  });
});
