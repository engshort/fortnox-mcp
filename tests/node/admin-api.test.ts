import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../apps/admin/src/api.js";

afterEach(() => vi.unstubAllGlobals());

it("reports non-JSON gateway failures without revealing their response body", async () => {
  for (const [status, error] of [
    [401, "AUTH_REQUIRED"],
    [403, "AUTH_REQUIRED"],
    [502, "REQUEST_FAILED"],
  ] as const) {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("Unauthorized private gateway diagnostic", { status }),
        ),
    );
    await expect(api("/admin/bootstrap", {})).rejects.toThrow(new Error(error));
  }
});

it("retains bounded application error codes and successful JSON responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: "VALIDATION_FAILED" }, { status: 400 }),
      ),
  );
  await expect(api("/admin/bootstrap", {})).rejects.toThrow(
    new Error("VALIDATION_FAILED"),
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: "private error text" }, { status: 500 }),
      ),
  );
  await expect(api("/admin/state")).rejects.toThrow(
    new Error("REQUEST_FAILED"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ok: true })),
  );
  await expect(api("/admin/state")).resolves.toEqual({ ok: true });
});
