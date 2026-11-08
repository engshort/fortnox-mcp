import {
  decodeFile,
  fileDigest,
  type ReceiptFileStore,
} from "@fortnox-mcp/core";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import {
  createProductApplication,
  type ProductFileTest,
} from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";
import { pdfFixture, pngFixture } from "./receipt-fixtures.js";

type Runtime = AuthConfig & { receiptFiles: ReceiptFileStore };
const sourceCommit = "1".repeat(40);
const callback = "https://client.example.invalid/callback";

export function productFileTestContract(fixture: () => Promise<Runtime>) {
  async function setup(profile = true) {
    const runtime = await fixture();
    let time = Date.now(),
      calls = 0;
    const originals = [pngFixture(), await pdfFixture()] as const;
    let late = false;
    const delivered: Uint8Array[] = [];
    const settings = {
      origin: runtime.origin,
      secret: runtime.secret,
      keys: { a: keyA },
      activeKey: "a",
      redirects: [callback],
      testMode: true,
      clientId: "synthetic-client",
      clientSecret: "synthetic-secret",
      testTenants: ["100001", "100002"],
    };
    const fileSource = async (input: { file_id: string }) => {
      calls++;
      const bytes = new Uint8Array(originals[input.file_id === "b" ? 1 : 0]);
      delivered.push(bytes);
      if (late) time += 60 * 60_000;
      return { bytes, contentType: undefined };
    };
    const testProfile: ProductFileTest = {
      sourceCommit,
      until: time + 60_000,
      now: () => time,
    };
    const app = createProductApplication(
      settings,
      { ...runtime, fileSource },
      async () => {
        throw new Error("Provider access is forbidden in the file experiment");
      },
      profile ? testProfile : undefined,
    );
    return {
      app,
      runtime,
      settings,
      testProfile,
      fileSource,
      originals,
      delivered,
      expire: () => {
        time += 60_000;
      },
      late: () => {
        late = true;
      },
      calls: () => calls,
    };
  }
  async function authorize(
    f: Awaited<ReturnType<typeof setup>>,
    scope: string,
  ) {
    const owner = await f.app.auth.api.signUpEmail({
      body: {
        email: `${crypto.randomUUID()}@example.invalid`,
        name: "Synthetic file-test owner",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    await f.runtime.state.put(
      "installation",
      "owner",
      {
        phase: "active",
        ownerId: owner.response.user.id,
        tokenHash: "",
        expiresAt: 0,
      },
      null,
    );
    const companies = [];
    for (const tenant of ["100001", "100002"]) {
      const c = await f.app.connections.add(
        owner.response.user.id,
        { ...syntheticCompany, tenant },
        syntheticCredentials,
      );
      await f.app.connections.setAccountingPolicy(
        owner.response.user.id,
        c.id,
        c.policyVersion,
        "review_required",
        false,
      );
      companies.push(c);
    }
    const cookie = owner.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const req = (
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      f.app.fetch(
        new Request(`${f.runtime.origin}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type":
              body instanceof URLSearchParams
                ? "application/x-www-form-urlencoded"
                : "application/json",
            ...headers,
          },
          ...(body === undefined
            ? {}
            : {
                body:
                  body instanceof URLSearchParams ? body : JSON.stringify(body),
              }),
        }),
      );
    const registration = await req("/auth/oauth2/register", {
      client_name: "Synthetic M14 client",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
    });
    expect(registration.status).toBe(201);
    const { client_id } = (await registration.json()) as { client_id: string };
    const verifier =
      "synthetic-code-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const challenge = btoa(String.fromCharCode(...digest))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const started = await req(
      `/auth/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id, redirect_uri: callback, scope, state: "synthetic-m14", code_challenge: challenge, code_challenge_method: "S256", resource: `${f.runtime.origin}/mcp` })}`,
      undefined,
      { cookie },
    );
    const location = new URL(
      started.headers.get("location") ??
        ((await started.json()) as { url: string }).url,
      f.runtime.origin,
    );
    const consent = await req(
      "/auth/oauth2/consent",
      { accept: true, oauth_query: location.search.slice(1) },
      { cookie, origin: f.runtime.origin },
    );
    expect(consent.status).toBe(200);
    const code =
      new URL(((await consent.json()) as { url: string }).url).searchParams.get(
        "code",
      ) ?? "";
    const response = await req(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id,
        redirect_uri: callback,
        resource: `${f.runtime.origin}/mcp`,
        code,
        code_verifier: verifier,
      }),
    );
    expect(response.status).toBe(200);
    const { access_token } = (await response.json()) as {
      access_token: string;
    };
    const client = new Client({ name: "M14 client", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${f.runtime.origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${access_token}` } },
        fetch: (input, init) => f.app.fetch(new Request(input, init)),
      }),
    );
    const [a, b] = companies;
    if (!a || !b) throw new Error("Missing synthetic companies");
    return { client, companies: [a, b] as const, cookie, access_token };
  }
  const files = ["a", "b"].map((file_id) => ({
    file_id,
    download_url: `https://files.example.com/${file_id}`,
  }));

  it("keeps the normal product off and refuses non-test, unbound or excessive experiment configuration", async () => {
    const f = await setup(false);
    expect(f.app.receiptFiles?.enabled).toBe(false);
    const runtime = { ...f.runtime, fileSource: f.fileSource };
    for (const settings of [
      { ...f.settings, testMode: false },
      { ...f.settings, testTenants: ["100001"] },
    ])
      expect(() =>
        createProductApplication(settings, runtime, undefined, f.testProfile),
      ).toThrow("CAPABILITY_UNAVAILABLE");
    for (const p of [
      { ...f.testProfile, until: Date.now() + 3_600_001 },
      { ...f.testProfile, sourceCommit: "0".repeat(40) },
      { ...f.testProfile, until: NaN },
    ])
      expect(() =>
        createProductApplication(f.settings, runtime, undefined, p),
      ).toThrow("CAPABILITY_UNAVAILABLE");
    expect(() =>
      createProductApplication(f.settings, f.runtime, undefined, f.testProfile),
    ).toThrow("CAPABILITY_UNAVAILABLE");
  });
  it("uses real product OAuth for two exact file round trips and denies anonymous, foreign-company and admin token access", async () => {
    const f = await setup();
    const { client, companies, access_token } = await authorize(
      f,
      "mcp:read mcp:files offline_access",
    );
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect([...names].sort()).toEqual([
        "get_company_profile",
        "get_connection_status",
        "ingest_receipt_files",
        "list_companies",
        "read_receipt_file",
      ]);
      expect(names).toContain("ingest_receipt_files");
      expect(names).toContain("read_receipt_file");
      expect(names).not.toContain("prepare_receipt_batch");
      expect(
        names.some((n) =>
          /upload_receipt|link_receipt|create_manual|commit_reviewed/.test(n),
        ),
      ).toBe(false);
      expect(f.app.bookkeeping.gates).toMatchObject({
        writes: false,
        reviewHost: false,
      });
      expect(f.app.receiptAttachments?.gates).toEqual({
        upload: false,
        link: false,
        retrieve: false,
      });
      expect(f.app.receiptWorkflow?.enabled).toBe(false);
      const anon = await f.app.fetch(
        new Request(`${f.runtime.origin}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "ingest_receipt_files",
              arguments: { company_id: companies[0].id, files },
            },
          }),
        }),
      );
      expect(anon.status).toBe(401);
      expect(
        (
          await f.app.fetch(
            new Request(`${f.runtime.origin}/admin`, {
              headers: { authorization: `Bearer ${access_token}` },
            }),
          )
        ).status,
      ).toBe(401);
      const denied = await client.callTool({
        name: "ingest_receipt_files",
        arguments: {
          company_id: "00000000-0000-4000-8000-000000000000",
          files,
        },
      });
      expect(denied.isError).toBe(true);
      expect(f.calls()).toBe(0);
      for (const company of companies) {
        const result = await client.callTool({
          name: "ingest_receipt_files",
          arguments: { company_id: company.id, files },
        });
        expect(result.isError).not.toBe(true);
        const data = result.structuredContent as {
          company_id: string;
          workflow_id: string;
          files: { file_id: string; sha256: string }[];
        };
        for (const [index, file] of data.files.entries()) {
          const ref = {
            company_id: company.id,
            workflow_id: data.workflow_id,
            file_id: file.file_id,
          };
          const other = await client.callTool({
            name: "read_receipt_file",
            arguments: {
              ...ref,
              company_id: companies.find((c) => c.id !== company.id)?.id,
            },
          });
          expect(other.isError).toBe(true);
          const read = await client.callTool({
            name: "read_receipt_file",
            arguments: ref,
          });
          const resource = read.content as {
            type: string;
            resource: { blob: string };
          }[];
          const original = f.originals[index];
          const output = resource[0];
          if (!original || !output) throw new Error("Missing file round trip");
          expect(decodeFile(output.resource.blob)).toEqual(original);
          expect(file.sha256).toBe(await fileDigest(original));
        }
      }
      expect(f.calls()).toBe(4);
      const health = await (
        await f.app.fetch(new Request(`${f.runtime.origin}/health`))
      ).json();
      expect(health).toMatchObject({
        file_test: {
          source_commit: sourceCommit,
          active: true,
          financial_writes: false,
          provider_file_writes: false,
        },
      });
    } finally {
      await client.close();
    }
  });
  it("does not broaden a read-only OAuth grant and leaves administration available after experiment expiry", async () => {
    const f = await setup();
    const { client, companies, cookie, access_token } = await authorize(
      f,
      "mcp:read offline_access",
    );
    try {
      const denied = await client.callTool({
        name: "ingest_receipt_files",
        arguments: { company_id: companies[0].id, files },
      });
      expect(denied.isError).toBe(true);
      expect(f.calls()).toBe(0);
      f.expire();
      const response = await f.app.fetch(
        new Request(`${f.runtime.origin}/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "FILE_TEST_EXPIRED" });
      expect(
        (
          await f.app.fetch(
            new Request(`${f.runtime.origin}/admin`, { headers: { cookie } }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          (await (
            await f.app.fetch(new Request(`${f.runtime.origin}/health`))
          ).json()) as { file_test: { active: boolean } }
        ).file_test.active,
      ).toBe(false);
    } finally {
      await client.close();
    }
  });
  it("discards source bytes returned after the experiment deadline without storing a file", async () => {
    const f = await setup();
    const { client, companies } = await authorize(
      f,
      "mcp:read mcp:files offline_access",
    );
    f.late();
    try {
      await expect(
        client.callTool({
          name: "ingest_receipt_files",
          arguments: { company_id: companies[0].id, files },
        }),
      ).rejects.toThrow();
      expect(f.calls()).toBe(1);
      expect(f.delivered[0]?.every((byte) => byte === 0)).toBe(true);
    } finally {
      await client.close();
    }
  });
}
