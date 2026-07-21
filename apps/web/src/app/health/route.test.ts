import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /health", () => {
  it("返回 Web 服务健康状态", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "web",
    });
  });
});
