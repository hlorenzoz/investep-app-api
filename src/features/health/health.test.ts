import { describe, expect, it } from "bun:test";
import { createApp } from "../../app";

describe("health", () => {
  it("GET /health responde 200 con status ok", async () => {
    const res = await createApp().request("/health");

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("investep-app-api");
  });
});
