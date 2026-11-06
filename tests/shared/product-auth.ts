import { describe, expect, it } from "vitest";
import { createAdmin } from "../../apps/shared/admin.js";
import {
  type AuthConfig,
  createProductAuth,
  hashToken,
  type Owner,
} from "../../apps/shared/product-auth.js";

export function ownerContract(fixture: () => Promise<AuthConfig>) {
  describe("product owner boundary", () => {
    it("claims one owner, rejects replay and keeps password login after recreation", async () => {
      const config = await fixture();
      const token = "synthetic-bootstrap-code-with-enough-entropy";
      await config.state.put<Owner>(
        "installation",
        "owner",
        {
          phase: "ready",
          ownerId: "",
          tokenHash: await hashToken(token),
          expiresAt: Date.now() + 60000,
        },
        null,
      );
      const request = (path: string, body: unknown, cookie = "") =>
        new Request(`${config.origin}${path}`, {
          method: "POST",
          headers: {
            origin: config.origin,
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify(body),
        });
      const app = createAdmin(config);
      const input = {
        token,
        email: "owner@example.invalid",
        password: "Synthetic-password-123456",
      };
      const responses = await Promise.all([
        app.fetch(request("/admin/bootstrap", input)),
        app.fetch(request("/admin/bootstrap", input)),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
      const first = await config.state.get<Owner>("installation", "owner");
      expect(first?.value.phase).toBe("active");
      expect((await app.fetch(request("/admin/bootstrap", input))).status).toBe(
        403,
      );
      const restarted = createAdmin(config);
      const login = await restarted.fetch(
        request("/auth/sign-in/email", {
          email: input.email,
          password: input.password,
        }),
      );
      expect(login.status).toBe(200);
      const cookie = login.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      expect(cookie).toContain("session_token");
      expect(login.headers.get("set-cookie")).toMatch(/HttpOnly/i);
      expect(login.headers.get("set-cookie")).toMatch(/Secure/i);
      expect(
        (
          await restarted.fetch(
            new Request(`${config.origin}/admin`, { headers: { cookie } }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await restarted.fetch(
            new Request(`${config.origin}/admin`, {
              headers: { authorization: "Bearer model-token" },
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (await restarted.fetch(request("/auth/sign-up/email", input))).status,
      ).toBe(404);
      expect(
        (await config.state.get<Owner>("installation", "owner"))?.value.ownerId,
      ).toBe(first?.value.ownerId);
      const logout = await restarted.fetch(
        request("/auth/sign-out", {}, cookie),
      );
      expect(logout.status).toBe(200);
      expect(
        (
          await restarted.fetch(
            new Request(`${config.origin}/admin`, { headers: { cookie } }),
          )
        ).status,
      ).toBe(401);
    });
    it("rejects expired bootstrap and forged browser origins before state changes", async () => {
      const config = await fixture();
      const token = "synthetic-expired-bootstrap-123456789";
      await config.state.put<Owner>(
        "installation",
        "owner",
        {
          phase: "ready",
          ownerId: "",
          tokenHash: await hashToken(token),
          expiresAt: 0,
        },
        null,
      );
      const app = createAdmin(config);
      for (const origin of [config.origin, "https://attacker.invalid", ""]) {
        const r = await app.fetch(
          new Request(`${config.origin}/admin/bootstrap`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({
              token,
              email: "owner@example.invalid",
              password: "Synthetic-password-123456",
            }),
          }),
        );
        expect(r.status).toBe(403);
      }
      expect(
        (await config.state.get<Owner>("installation", "owner"))?.value.phase,
      ).toBe("ready");
    });
    it("operator password reset preserves the owner, revokes sessions and cannot be requested over HTTP", async () => {
      const config = await fixture();
      let reset = "";
      const auth = createProductAuth({
        ...config,
        onReset: async (token) => {
          reset = token;
        },
      });
      const created = await auth.api.signUpEmail({
        body: {
          email: "reset@example.invalid",
          name: "Synthetic owner",
          password: "Synthetic-initial-password",
        },
        returnHeaders: true,
      });
      await config.state.put<Owner>(
        "installation",
        "owner",
        {
          phase: "active",
          ownerId: created.response.user.id,
          tokenHash: "",
          expiresAt: 0,
        },
        null,
      );
      const cookie = created.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      await auth.api.requestPasswordReset({
        body: { email: "reset@example.invalid" },
      });
      expect(reset.length).toBeGreaterThan(10);
      const app = createAdmin(config);
      const req = (path: string, body: unknown) =>
        new Request(`${config.origin}${path}`, {
          method: "POST",
          headers: {
            origin: config.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      expect(
        (
          await app.fetch(
            req("/auth/request-password-reset", {
              email: "reset@example.invalid",
            }),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await app.fetch(
            req("/auth/reset-password", {
              token: reset,
              newPassword: "Synthetic-new-password",
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await app.fetch(
            new Request(`${config.origin}/admin`, { headers: { cookie } }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await app.fetch(
            req("/auth/reset-password", {
              token: reset,
              newPassword: "Synthetic-other-password",
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (await config.state.get<Owner>("installation", "owner"))?.value.ownerId,
      ).toBe(created.response.user.id);
    });
  });
}
