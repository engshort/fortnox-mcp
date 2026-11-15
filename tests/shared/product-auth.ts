import { describe, expect, it, vi } from "vitest";
import { createAdmin } from "../../apps/shared/admin.js";
import {
  type AuthConfig,
  createProductAuth,
  hashToken,
  type Owner,
} from "../../apps/shared/product-auth.js";
import {
  emailSettings,
  resendAccountEmails,
} from "../../apps/shared/product-email.js";

export function ownerContract(fixture: () => Promise<AuthConfig>) {
  describe("product owner boundary", () => {
    it("keeps Resend off by default and rejects incomplete or malformed enabled configuration", () => {
      expect(emailSettings({})).toBeUndefined();
      expect(
        emailSettings({
          RESEND_ENABLED: "false",
          RESEND_API_KEY: "re_synthetic",
          RESEND_FROM: "sender@example.invalid",
        }),
      ).toBeUndefined();
      for (const env of [
        { RESEND_ENABLED: "true" },
        {
          RESEND_ENABLED: "true",
          RESEND_API_KEY: "re_synthetic",
          RESEND_FROM: "bad\naddress",
        },
        {
          RESEND_ENABLED: "true",
          RESEND_API_KEY: "bad",
          RESEND_FROM: "sender@example.invalid",
        },
      ])
        expect(() => emailSettings(env)).toThrow(
          "Invalid Resend configuration",
        );
    });
    it("emails only the active owner, redeems the code once, revokes sessions, and limits requests across handler recreation", async () => {
      const config = await fixture();
      const deliveries: Array<{ email: string; token: string }> = [];
      const changed = vi.fn(async (_email: string, _eventId: string) => {
        throw new Error("private-notification-error");
      });
      const enabled = {
        ...config,
        emails: {
          welcome: async () => {},
          passwordChanged: changed,
          passwordReset: async (email: string, token: string) => {
            deliveries.push({ email, token });
          },
        },
      };
      const app = createAdmin(enabled);
      const created = await app.auth.api.signUpEmail({
        body: {
          email: "email-owner@example.invalid",
          name: "Synthetic owner",
          password: "Synthetic-initial-password",
        },
        returnHeaders: true,
      });
      await app.auth.api.signUpEmail({
        body: {
          email: "other@example.invalid",
          name: "Synthetic other",
          password: "Synthetic-other-password",
        },
      });
      await config.state.put<Owner>(
        "installation",
        "owner",
        {
          phase: "active",
          ownerId: created.response.user.id,
          expiresAt: 0,
          tokenHash: "",
        },
        null,
      );
      const req = (body: unknown, origin: string | undefined = config.origin) =>
        new Request(`${config.origin}/auth/request-password-reset`, {
          method: "POST",
          headers: {
            ...(origin ? { origin } : {}),
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      for (const origin of ["https://foreign.example.invalid", undefined]) {
        const request = req({ email: "email-owner@example.invalid" }, origin);
        if (!origin) request.headers.delete("origin");
        expect((await app.fetch(request)).status).toBe(403);
      }
      expect(
        (
          await app.fetch(
            req({
              email: "email-owner@example.invalid",
              redirectTo: "https://foreign.example.invalid",
            }),
          )
        ).status,
      ).toBe(400);
      const responses = [];
      for (const email of [
        "missing@example.invalid",
        "other@example.invalid",
        "email-owner@example.invalid",
      ])
        responses.push(await (await app.fetch(req({ email }))).text());
      expect(new Set(responses).size).toBe(1);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.email).toBe("email-owner@example.invalid");
      expect(responses.join()).not.toContain(deliveries[0]?.token);
      expect(
        (
          await createAdmin(enabled).fetch(
            req({ email: "email-owner@example.invalid" }),
          )
        ).status,
      ).toBe(429);
      const redeem = () =>
        app.fetch(
          new Request(`${config.origin}/auth/reset-password`, {
            method: "POST",
            headers: {
              origin: config.origin,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              token: deliveries[0]?.token,
              newPassword: "Synthetic-replacement-password",
            }),
          }),
        );
      expect((await redeem()).status).toBe(200);
      expect((await redeem()).status).toBe(401);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(changed.mock.calls[0]?.[0]).toBe("email-owner@example.invalid");
      const cookie = created.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      expect(
        (
          await app.fetch(
            new Request(`${config.origin}/admin`, { headers: { cookie } }),
          )
        ).status,
      ).toBe(401);
    });
    it("sends one bounded Resend request with a hashed idempotency key and redacts uncertain failures", async () => {
      const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
      const mock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          calls.push({ url: String(input), init });
          return Response.json({ id: "synthetic-message" });
        });
      try {
        const send = resendAccountEmails(
          { apiKey: "re_synthetic", from: "sender@example.invalid" },
          "https://product.example.invalid",
        ).passwordReset;
        await send("email-owner@example.invalid", "synthetic-private-code");
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("https://api.resend.com/emails");
        const headers = new Headers(calls[0]?.init?.headers);
        expect(headers.get("idempotency-key")).toBe(
          `owner-reset/${await hashToken("synthetic-private-code")}`,
        );
        expect(headers.get("authorization")).toBe("Bearer re_synthetic");
        expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
        const body = JSON.parse(String(calls[0]?.init?.body));
        expect(body.to).toEqual(["email-owner@example.invalid"]);
        expect(body.text).toContain(
          "https://product.example.invalid/reset-password",
        );
        expect(body.text).toContain("synthetic-private-code");
        mock.mockImplementation(async () => {
          throw new Error("private-provider-text");
        });
        await expect(
          send("email-owner@example.invalid", "synthetic-private-code"),
        ).rejects.toThrow(/^EMAIL_DELIVERY_UNCONFIRMED$/);
        expect(mock).toHaveBeenCalledTimes(2);
      } finally {
        mock.mockRestore();
      }
    });
    it.each([false, true])(
      "commits one owner and one welcome attempt even when email fails: %s",
      async (fail) => {
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
        const welcome = vi.fn(async (_email: string, _ownerId: string) => {
          if (fail) throw new Error("private-delivery-error");
        });
        const app = createAdmin({
          ...config,
          emails: {
            welcome,
            passwordReset: async () => {},
            passwordChanged: async () => {},
          },
        });
        const request = () =>
          new Request(`${config.origin}/admin/bootstrap`, {
            method: "POST",
            headers: {
              origin: config.origin,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              token,
              email: "welcome@example.invalid",
              password: "Synthetic-initial-password",
            }),
          });
        expect((await app.fetch(request())).status).toBe(200);
        expect((await app.fetch(request())).status).toBe(403);
        expect(welcome).toHaveBeenCalledTimes(1);
        const owner = await config.state.get<Owner>("installation", "owner");
        expect(welcome).toHaveBeenCalledWith(
          "welcome@example.invalid",
          owner?.value.ownerId,
        );
        expect(owner?.value.phase).toBe("active");
      },
    );
    it("does not expose delivery errors or retry an uncertain reset email", async () => {
      const config = await fixture();
      const delivery = vi.fn(async () => {
        throw new Error("private-provider-error");
      });
      const app = createAdmin({
        ...config,
        emails: {
          welcome: async () => {},
          passwordChanged: async () => {},
          passwordReset: delivery,
        },
      });
      const owner = await app.auth.api.signUpEmail({
        body: {
          email: "email-owner@example.invalid",
          name: "Synthetic owner",
          password: "Synthetic-initial-password",
        },
      });
      await config.state.put<Owner>(
        "installation",
        "owner",
        {
          phase: "active",
          ownerId: owner.user.id,
          tokenHash: "",
          expiresAt: 0,
        },
        null,
      );
      const response = await app.fetch(
        new Request(`${config.origin}/auth/request-password-reset`, {
          method: "POST",
          headers: {
            origin: config.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email: "email-owner@example.invalid" }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"ok":true}');
      expect(delivery).toHaveBeenCalledTimes(1);
    });
    it("rejects a persisted expired admin session after recreating the handler", async () => {
      const config = await fixture();
      const app = createAdmin(config);
      const created = await app.auth.api.signUpEmail({
        body: {
          email: "expiry@example.invalid",
          name: "Synthetic owner",
          password: "Synthetic-expiry-password",
        },
        returnHeaders: true,
      });
      await config.state.put<Owner>(
        "installation",
        "owner",
        {
          phase: "active",
          ownerId: created.response.user.id,
          expiresAt: 0,
          tokenHash: "",
        },
        null,
      );
      const cookie = created.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const headers = new Headers({ cookie });
      const session = await app.auth.api.getSession({ headers });
      if (!session) throw new Error("Missing synthetic owner session");
      expect(
        (await app.fetch(new Request(`${config.origin}/admin`, { headers })))
          .status,
      ).toBe(200);
      await (await app.auth.$context).internalAdapter.updateSession(
        session.session.token,
        { expiresAt: new Date(Date.now() - 1000) },
      );
      const restarted = createAdmin(config);
      expect(
        (
          await restarted.fetch(
            new Request(`${config.origin}/admin`, { headers }),
          )
        ).status,
      ).toBe(401);
      expect(
        (await config.state.get<Owner>("installation", "owner"))?.value.ownerId,
      ).toBe(created.response.user.id);
    });
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
      for (const email of [input.email, "unknown@example.invalid"]) {
        const denied = await restarted.fetch(
          request("/auth/sign-in/email", {
            email,
            password: "Wrong-synthetic-password",
          }),
        );
        expect(denied.status).toBe(401);
        expect(await denied.json()).toEqual({ error: "SIGN_IN_FAILED" });
        expect(denied.headers.get("set-cookie")).toBeNull();
      }
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
