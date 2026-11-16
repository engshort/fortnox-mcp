import {
  type Ciphertext,
  type CompanyGrant,
  type Connections,
  DomainError,
  type Membership,
  type Memberships,
  membershipHash,
  membershipInput,
} from "@fortnox-mcp/core";
import { z } from "zod";
import { boundedJson, safeResponse } from "./admin.js";
import {
  type ProductAuth,
  requireAdministrator,
  requireMember,
} from "./product-auth.js";

const revision = z.number().int().positive().safe();
const externalId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const sourceInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    companies: z.array(z.string().uuid()).max(50),
    allowAdmins: z.boolean(),
  })
  .strict();
export const publicMember = (m: Membership) => ({
  id: m.id,
  user_id: m.userId,
  external_id: m.externalId,
  source: m.source,
  email: m.email,
  name: m.name,
  role: m.role,
  active: m.active,
  blocked: m.blocked,
  companies: m.companies,
  revision: m.revision,
  invitation_pending: !!m.invitation,
});
export function membershipRoutes(config: {
  auth: ProductAuth;
  connections: Connections;
  memberships: Memberships;
  origin: string;
  provisioning: boolean;
}) {
  const { auth, memberships, connections } = config;
  const json = (value: unknown, status = 200) =>
    safeResponse(JSON.stringify(value), status);
  async function budget(id: string, max: number) {
    for (let n = 0; n < 8; n++) {
      const row = await memberships.state.get<{ until: number; count: number }>(
        "membership-rate",
        id,
      );
      const value =
        row && row.value.until > Date.now()
          ? { ...row.value, count: row.value.count + 1 }
          : { until: Date.now() + 60000, count: 1 };
      if (value.count > max) throw new DomainError("RATE_LIMITED");
      if (
        await memberships.state.put(
          "membership-rate",
          id,
          value,
          row?.version ?? null,
        )
      )
        return;
    }
    throw new DomainError("RATE_LIMITED");
  }
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const machine = url.pathname.startsWith("/api/membership-provisioning/");
    try {
      if (!memberships.enabled || (machine && !config.provisioning))
        return json({ error: "NOT_FOUND" }, 404);
      if (
        url.origin !== config.origin ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !== config.origin)
      )
        return json({ error: "ORIGIN_FORBIDDEN" }, 403);
      if (machine) {
        if (request.headers.has("cookie") || request.headers.has("origin"))
          throw new DomainError("AUTH_REQUIRED");
        const match = /^Bearer ([^\s]+)$/i.exec(
          request.headers.get("authorization") ?? "",
        );
        const token = match?.[1] ?? "";
        const { owner, source } = await memberships.authenticate(token);
        await budget(source.id, 60);
        const path =
          /^\/api\/membership-provisioning\/v1\/users(?:\/([A-Za-z0-9_-]{1,128})(\/invitation)?)?$/.exec(
            url.pathname,
          );
        if (!path) return json({ error: "NOT_FOUND" }, 404);
        const directory = await memberships.directory(owner);
        if (request.method === "GET" && !path[2]) {
          const members = directory.members
            .filter((m) => m.source === source.id)
            .sort((a, b) => a.externalId.localeCompare(b.externalId));
          if (path[1]) {
            const m = members.find((m) => m.externalId === path[1]);
            if (!m) return json({ error: "MEMBER_NOT_FOUND" }, 404);
            const response = json({
              version: "membership-provisioning-v1",
              user: publicMember(m),
            });
            response.headers.set("etag", `"${m.revision}"`);
            return response;
          }
          const after = externalId
            .optional()
            .parse(url.searchParams.get("after") ?? undefined);
          const limit = z.coerce
            .number()
            .int()
            .min(1)
            .max(50)
            .parse(url.searchParams.get("limit") ?? "50");
          const remaining = members.filter(
            (m) => !after || m.externalId.localeCompare(after) > 0,
          );
          const page = remaining.slice(0, limit);
          return json({
            version: "membership-provisioning-v1",
            users: page.map(publicMember),
            next: remaining.length > limit ? page.at(-1)?.externalId : null,
          });
        }
        if (!path[1]) return json({ error: "NOT_FOUND" }, 404);
        const key = z
          .string()
          .uuid()
          .parse(request.headers.get("idempotency-key"));
        const observed = request.headers.get("if-match");
        const expected =
          observed && /^"[1-9][0-9]*"$/.test(observed)
            ? revision.parse(Number(observed.slice(1, -1)))
            : null;
        if (observed && request.headers.has("if-none-match"))
          throw new DomainError("VALIDATION_FAILED");
        if (observed && expected === null)
          throw new DomainError("VALIDATION_FAILED");
        if (!expected && request.headers.get("if-none-match") !== "*")
          return json({ error: "PRECONDITION_REQUIRED" }, 428);
        if (request.method === "PUT" && !path[2]) {
          const input = membershipInput.parse(await boundedJson(request));
          const result = await memberships.provision(
            token,
            path[1],
            input,
            expected,
            key,
          );
          const response = json(
            {
              version: "membership-provisioning-v1",
              user: publicMember(result),
            },
            expected ? 200 : 201,
          );
          response.headers.set("etag", `"${result.revision}"`);
          return response;
        }
        if (request.method === "POST" && path[2] && expected) {
          z.object({})
            .strict()
            .parse(await boundedJson(request));
          const member = directory.members.find(
            (m) => m.source === source.id && m.externalId === path[1],
          );
          if (!member) return json({ error: "MEMBER_NOT_FOUND" }, 404);
          const hash = await membershipHash(
            JSON.stringify(["invitation", path[1], expected]),
          );
          const binding = JSON.stringify([
            owner,
            source.id,
            "membership-invitation",
            key,
          ]);
          const result = await memberships.issueInvitation(
            owner,
            member.id,
            expected,
            source.id,
            source.id,
            {
              key,
              hash,
              sourceHash: source.tokenHash,
              seal: (value) => connections.vault.sealData(value, binding),
            },
          );
          if (!("encrypted" in result))
            throw new DomainError("CONNECTION_CONFLICT");
          const invite = (await connections.vault.openData(
            result.encrypted as Ciphertext,
            binding,
          )) as {
            id: string;
            token: string;
            expiresAt: number;
            revision: number;
          };
          return json({
            version: "membership-provisioning-v1",
            ...invitationResult(invite),
          });
        }
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      if (
        request.method !== "GET" &&
        request.headers.get("origin") !== config.origin
      )
        return json({ error: "ORIGIN_FORBIDDEN" }, 403);
      if (
        request.method === "POST" &&
        url.pathname === "/api/invitations/accept"
      ) {
        await budget("invitations", 10);
        const input = z
          .object({
            id: z.string().uuid(),
            token: z.string().regex(/^[a-f0-9]{64}$/),
            password: z.string().min(12).max(128),
          })
          .strict()
          .parse(await boundedJson(request));
        const member = await memberships.claimInvitation(input.id, input.token);
        // Existing accounts require explicit administrator linking; a matching
        // email address from a provisioning source never proves account control.
        if (
          await (await auth.$context).internalAdapter.findUserByEmail(
            member.email,
          )
        )
          throw new DomainError("CONNECTION_CONFLICT");
        const created = await auth.api.signUpEmail({
          body: {
            email: member.email,
            name: member.name,
            password: input.password,
          },
          returnHeaders: true,
        });
        await memberships.finishInvitation(
          member.id,
          member.invitation?.claim ?? "",
          created.response.user.id,
        );
        const response = json({ ok: true });
        for (const cookie of created.headers.getSetCookie())
          response.headers.append("set-cookie", cookie);
        return response;
      }
      if (url.pathname.startsWith("/api/me")) {
        const session = await requireMember(auth, request.headers);
        const p = session.principal;
        if (request.method === "GET" && url.pathname === "/api/me") {
          const companies = (await connections.list(p.ownerId))
            .filter(
              (c) =>
                c.state !== "disconnected" &&
                (p.role !== "member" || p.companies[c.id]),
            )
            .map((c) => ({
              company_id: c.id,
              name: c.name,
              state: c.state,
              access: p.role === "member" ? p.companies[c.id] : "read_write",
              read_only: c.readOnly,
              review: c.review,
            }));
          const rows = await memberships.state.list<CompanyGrant>(
            "company-grants",
            101,
          );
          return json({
            subject_id: p.subjectId,
            email: session.user.email,
            role: p.role,
            companies,
            mcp_url: `${config.origin}/mcp`,
            clients: rows
              .filter(
                (r) =>
                  r.value.ownerId === p.ownerId &&
                  (r.value.subjectId ?? p.ownerId) === p.subjectId &&
                  !r.id.startsWith("owner-recovery:"),
              )
              .map((r) => ({
                registration_key: r.id,
                client_id: r.value.oauthClientId ?? r.id,
                revision: r.value.revision ?? 0,
                companies: Object.keys(r.value.companies),
                current:
                  !r.value.grantId?.startsWith("revoked:") &&
                  (p.role === "owner" ||
                    r.value.membershipRevision === p.revision),
              })),
            clients_partial: rows.length > 100,
          });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/api/me/clients/revoke"
        ) {
          const input = z
            .object({
              registration_key: z.string().max(512),
              revision: z.number().int().nonnegative(),
            })
            .strict()
            .parse(await boundedJson(request));
          const row = await memberships.state.get<CompanyGrant>(
            "company-grants",
            input.registration_key,
          );
          if (
            !row ||
            row.value.ownerId !== p.ownerId ||
            (row.value.subjectId ?? p.ownerId) !== p.subjectId
          )
            throw new DomainError("COMPANY_FORBIDDEN");
          if (
            (row.value.revision ?? 0) !== input.revision ||
            !(await memberships.state.put(
              "company-grants",
              input.registration_key,
              {
                ...row.value,
                revision: input.revision + 1,
                companies: {},
                grantId: `revoked:${crypto.randomUUID()}`,
              },
              row.version,
            ))
          )
            throw new DomainError("CONNECTION_CONFLICT");
          return json({ ok: true });
        }
        if (request.method === "POST" && url.pathname === "/api/me/password") {
          const input = z
            .object({
              currentPassword: z.string().min(1).max(128),
              newPassword: z.string().min(12).max(128),
            })
            .strict()
            .parse(await boundedJson(request));
          const result = await auth.api.changePassword({
            body: { ...input, revokeOtherSessions: true },
            headers: request.headers,
            returnHeaders: true,
          });
          const response = json({ ok: true });
          for (const cookie of result.headers.getSetCookie())
            response.headers.append("set-cookie", cookie);
          return response;
        }
        return json({ error: "NOT_FOUND" }, 404);
      }
      const session = await requireAdministrator(auth, request.headers);
      const subject = session.principal.subjectId;
      const directory = await memberships.directory(session.principal.ownerId);
      if (request.method === "GET" && url.pathname === "/admin/members/state")
        return json({
          members: directory.members.map(publicMember),
          sources: directory.sources.map(
            ({ tokenHash: _hash, ...source }) => source,
          ),
          audit: directory.audit,
          role: session.principal.role,
          provisioning: config.provisioning,
        });
      if (request.method !== "POST") return json({ error: "NOT_FOUND" }, 404);
      const body = await boundedJson(request);
      if (url.pathname === "/admin/members/save") {
        const input = z
          .object({
            id: z.string().uuid().nullable(),
            revision: revision.nullable(),
            user: membershipInput,
          })
          .strict()
          .parse(body);
        return json({
          user: publicMember(
            await memberships.save(
              subject,
              input.id,
              input.user,
              input.revision,
            ),
          ),
        });
      }
      if (url.pathname === "/admin/members/block") {
        const input = z
          .object({ id: z.string().uuid(), revision, blocked: z.boolean() })
          .strict()
          .parse(body);
        return json({
          user: publicMember(
            await memberships.block(
              subject,
              input.id,
              input.revision,
              input.blocked,
            ),
          ),
        });
      }
      if (url.pathname === "/admin/members/link") {
        const input = z
          .object({
            id: z.string().uuid(),
            revision,
            email: z.email(),
            source: z.string().min(1).max(128),
            external_id: externalId,
          })
          .strict()
          .parse(body);
        const existing = await (
          await auth.$context
        ).internalAdapter.findUserByEmail(input.email.toLowerCase());
        const member = directory.members.find((m) => m.id === input.id);
        if (!existing || existing.user.email.toLowerCase() !== member?.email)
          throw new DomainError("CONNECTION_CONFLICT");
        return json({
          user: publicMember(
            await memberships.link(
              subject,
              input.id,
              input.revision,
              existing.user.id,
              input.source,
              input.external_id,
            ),
          ),
        });
      }
      if (url.pathname === "/admin/members/invitation") {
        const input = z
          .object({ id: z.string().uuid(), revision })
          .strict()
          .parse(body);
        const result = await memberships.invite(
          subject,
          input.id,
          input.revision,
        );
        if (!("token" in result)) throw new DomainError("CONNECTION_CONFLICT");
        return json(invitationResult(result));
      }
      if (url.pathname === "/admin/membership-sources/create") {
        const result = await memberships.source(
          subject,
          sourceInput.parse(body),
        );
        const { tokenHash: _hash, ...source } = result.source;
        return json({ source, token: result.token }, 201);
      }
      if (url.pathname === "/admin/membership-sources/rotate") {
        const input = z
          .object({ id: z.string().uuid(), revision, active: z.boolean() })
          .strict()
          .parse(body);
        const result = await memberships.rotateSource(
          subject,
          input.id,
          input.revision,
          input.active,
        );
        const { tokenHash: _hash, ...source } = result.source;
        return json({
          source,
          ...(result.token ? { token: result.token } : {}),
        });
      }
      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      const code =
        error instanceof DomainError
          ? error.code
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? "VALIDATION_FAILED"
            : error instanceof Error && error.message === "AUTH_REQUIRED"
              ? "AUTH_REQUIRED"
              : "CAPABILITY_UNAVAILABLE";
      const status =
        code === "AUTH_REQUIRED"
          ? 401
          : code === "COMPANY_FORBIDDEN"
            ? 403
            : code === "RATE_LIMITED"
              ? 429
              : code === "CAPABILITY_UNAVAILABLE"
                ? 503
                : ["CONNECTION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(code)
                  ? 409
                  : 400;
      return json(
        {
          ...(machine ? { version: "membership-provisioning-v1" } : {}),
          error: code,
        },
        status,
      );
    }
  };
  function invitationResult(invite: {
    id: string;
    token: string;
    expiresAt: number;
    revision: number;
  }) {
    return {
      invitation_url: `${config.origin}/accept-invitation#${new URLSearchParams({ id: invite.id, token: invite.token })}`,
      expires_at: new Date(invite.expiresAt).toISOString(),
      revision: invite.revision,
    };
  }
}
