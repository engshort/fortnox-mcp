import { z } from "zod";
import {
  type AuthConfig,
  createProductAuth,
  hashToken,
  type Owner,
  requireOwner,
} from "./product-auth.js";

export const privateHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
export const safeResponse = (
  body: string,
  status = 200,
  type = "application/json",
) =>
  new Response(body, {
    status,
    headers: { ...privateHeaders, "content-type": type },
  });
export async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new Error("VALIDATION_FAILED");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
const bootstrapInput = z
  .object({
    token: z.string().min(32).max(512),
    email: z.email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
export function createAdmin(config: AuthConfig) {
  const auth = createProductAuth(config);
  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.origin !== config.origin ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !== config.origin)
    )
      return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
    if (
      request.method === "GET" &&
      ["/setup", "/sign-in", "/admin", "/reset-password"].includes(url.pathname)
    ) {
      if (url.pathname === "/admin") {
        try {
          await requireOwner(auth, config.state, request.headers);
        } catch {
          return safeResponse('{"error":"AUTH_REQUIRED"}', 401);
        }
      }
      if (url.pathname === "/reset-password")
        return safeResponse(
          '<!doctype html><html lang="sv"><meta charset="utf-8"><title>Återställ lösenord</title><h1>Återställ lösenord</h1><p>Engångskoden kräver installationsåtkomst och gäller i tio minuter.</p><form id="login"><label>Engångskod <input name="token" autocomplete="off" required></label><label>Nytt lösenord <input name="newPassword" type="password" minlength="12" maxlength="128" required></label><button>Återställ lösenord</button></form><p id="status" role="status"></p><a href="/sign-in">Logga in</a><script src="/admin.js"></script></html>',
          200,
          "text/html; charset=utf-8",
        );
      return safeResponse(
        `<!doctype html><html lang="sv"><meta charset="utf-8"><title>Företagsanslutningar</title><h1>Företagsanslutningar</h1><form id="login"><label>E-post <input name="email" type="email" required></label><label>Lösenord <input name="password" type="password" minlength="12" required></label>${url.pathname === "/setup" ? '<label>Engångskod <input name="token" autocomplete="off" required></label>' : ""}<button>Logga in</button></form><p id="status" role="status"></p><a href="/admin">Administration</a><script src="/admin.js"></script></html>`,
        200,
        "text/html; charset=utf-8",
      );
    }
    if (request.method === "GET" && url.pathname === "/admin.js")
      return safeResponse(
        `document.querySelector('#login')?.addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const reset=location.pathname==='/reset-password';const r=await fetch(reset?'/auth/reset-password':location.pathname==='/setup'?'/admin/bootstrap':'/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(r.ok&&location.search&&!reset){location.assign('/auth/oauth2/authorize'+location.search);return;}document.querySelector('#status').textContent=r.ok?(reset?'Lösenordet är återställt. Logga in igen.':'Inloggad. Öppna administrationen.'):'Åtgärden misslyckades.';});`,
        200,
        "text/javascript",
      );
    if (request.method === "POST") {
      if (request.headers.get("origin") !== config.origin)
        return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
      let body: unknown;
      try {
        body = await boundedJson(request);
      } catch {
        return safeResponse('{"error":"VALIDATION_FAILED"}', 400);
      }
      if (url.pathname === "/admin/bootstrap") {
        const parsed = bootstrapInput.safeParse(body);
        const current = await config.state.get<Owner>("installation", "owner");
        if (
          !parsed.success ||
          !current ||
          current.value.phase !== "ready" ||
          current.value.expiresAt <= Date.now() ||
          current.value.tokenHash !== (await hashToken(parsed.data.token))
        )
          return safeResponse('{"error":"BOOTSTRAP_DENIED"}', 403);
        if (
          !(await config.state.put(
            "installation",
            "owner",
            { ...current.value, phase: "claiming", tokenHash: "" },
            current.version,
          ))
        )
          return safeResponse('{"error":"BOOTSTRAP_DENIED"}', 403);
        try {
          const signed = await auth.api.signUpEmail({
            body: {
              email: parsed.data.email,
              name: "Installation owner",
              password: parsed.data.password,
            },
            returnHeaders: true,
          });
          if (
            !(await config.state.put(
              "installation",
              "owner",
              {
                phase: "active",
                ownerId: signed.response.user.id,
                tokenHash: "",
                expiresAt: 0,
              },
              current.version + 1,
            ))
          )
            throw new Error("BOOTSTRAP_DENIED");
          const response = safeResponse('{"ok":true}');
          for (const cookie of signed.headers.getSetCookie())
            response.headers.append("set-cookie", cookie);
          return response;
        } catch {
          return safeResponse('{"error":"BOOTSTRAP_RECOVERY_REQUIRED"}', 409);
        }
      }
      if (
        [
          "/auth/sign-in/email",
          "/auth/sign-out",
          "/auth/reset-password",
        ].includes(url.pathname)
      ) {
        if (url.pathname !== "/auth/sign-out") {
          let limited = true;
          for (let attempt = 0; attempt < 5; attempt++) {
            const prior = await config.state.get<{
              until: number;
              count: number;
            }>("admin-rate", "login");
            const value =
              prior && prior.value.until > Date.now()
                ? { ...prior.value, count: prior.value.count + 1 }
                : { until: Date.now() + 60000, count: 1 };
            if (value.count > 10) break;
            if (
              await config.state.put(
                "admin-rate",
                "login",
                value,
                prior?.version ?? null,
              )
            ) {
              limited = false;
              break;
            }
          }
          if (limited) return safeResponse('{"error":"RATE_LIMITED"}', 429);
        }
        if (url.pathname === "/auth/sign-out") {
          try {
            await requireOwner(auth, config.state, request.headers);
          } catch {
            return safeResponse('{"error":"AUTH_REQUIRED"}', 401);
          }
        }
        const response = await auth.handler(
          new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(body),
          }),
        );
        const safe = safeResponse(
          response.ok ? '{"ok":true}' : '{"error":"AUTH_REQUIRED"}',
          response.ok ? 200 : 401,
        );
        for (const cookie of response.headers.getSetCookie())
          safe.headers.append("set-cookie", cookie);
        return safe;
      }
    }
    return safeResponse('{"error":"NOT_FOUND"}', 404);
  }
  return { auth, fetch };
}
