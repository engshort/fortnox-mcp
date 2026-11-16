import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CompanyOnboarding,
  Connections,
  CredentialVault,
  completeOnboardingCompany,
} from "@fortnox-mcp/core";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { createProductApplication } from "../../apps/shared/product.js";
import { d1State } from "../../apps/worker/src/product-storage.js";
import {
  keyA,
  syntheticCompany,
  syntheticCredentials,
} from "../shared/connections.js";
import { onboardingFixture } from "../shared/onboarding.js";

it("retains an exact authorized result after closing and reopening SQLite and the application", async () => {
  const dir = mkdtempSync(join(tmpdir(), "onboarding-restart-"));
  const path = join(dir, "product.sqlite");
  let db = new DatabaseSync(path);
  try {
    for (const file of [
      "0002_product_state.sql",
      "0003_product_auth.sql",
      "0004_product_oauth.sql",
    ])
      db.exec(
        readFileSync(
          new URL(`../../apps/worker/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const config = {
      origin: "https://product.example.invalid",
      secret: "synthetic-restart-secret-at-least-32-characters",
      database: db,
      state: sqliteState(db),
    };
    const f = await onboardingFixture(config);
    const a = await f.start();
    await f.provider(a);
    const approval = await f.approve(a);
    const tokens = (await (await f.exchange(approval.target)).json()) as {
      access_token: string;
    };
    const expected = await (
      await f.result(a.attempt_id, tokens.access_token)
    ).json();
    db.close();
    db = new DatabaseSync(path);
    const restarted = createProductApplication(
      f.settings,
      { database: db, state: sqliteState(db) },
      async () => {
        throw new Error("No provider resend after restart");
      },
    );
    const response = await restarted.fetch(
      new Request(
        `${config.origin}/api/company-onboarding/v1/attempts/${a.attempt_id}/result`,
        { headers: { authorization: `Bearer ${tokens.access_token}` } },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("retains provider-success receipts and unknown outcomes across actual workerd/D1 restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "onboarding-d1-restart-"));
  const options = convertV4MiniflareOptions({
    name: "onboarding-restart",
    modules: true,
    script: "export default {fetch(){return new Response('synthetic');}};",
    compatibilityDate: "2026-10-18",
    d1Databases: { DB: "onboarding-restart" },
    resourcePersistencePath: dir,
  });
  let runtime = new Miniflare(options);
  try {
    let db = await runtime.getD1Database("DB");
    await db.exec(
      readFileSync(
        new URL(
          "../../apps/worker/migrations/0002_product_state.sql",
          import.meta.url,
        ),
        "utf8",
      ).replace(/\n/g, " "),
    );
    let connections = new Connections(
      d1State(db),
      new CredentialVault({ a: keyA }, "a"),
    );
    let service = new CompanyOnboarding(
      connections,
      "https://installation.example.invalid",
      ["synthetic-client"],
    );
    const input = {
      action: "connect" as const,
      redirect_uri: "https://consumer.example.invalid/callback",
      state: crypto.randomUUID(),
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256" as const,
      scope: "mcp:read" as const,
    };
    const a = await service.start(
      "owner",
      "synthetic-client",
      "Synthetic",
      crypto.randomUUID(),
      input,
    );
    const binding = await service.reserveProvider(
      "owner",
      a.attempt_id,
      1,
      "session",
    );
    const company = await connections.add(
      "owner",
      syntheticCompany,
      syntheticCredentials,
      binding,
    );
    const unknown = await service.start(
      "owner",
      "synthetic-client",
      "Synthetic",
      crypto.randomUUID(),
      { ...input, state: crypto.randomUUID() },
    );
    const unknownBinding = await service.reserveProvider(
      "owner",
      unknown.attempt_id,
      1,
      "session-2",
    );
    await service.providerFailure("owner", unknownBinding, true);
    await runtime.dispose();
    runtime = new Miniflare(options);
    db = await runtime.getD1Database("DB");
    connections = new Connections(
      d1State(db),
      new CredentialVault({ a: keyA }, "a"),
    );
    service = new CompanyOnboarding(
      connections,
      "https://installation.example.invalid",
      ["synthetic-client"],
    );
    expect(
      (await service.get("owner", "synthetic-client", a.attempt_id)).company
        ?.id,
    ).toBe(company.id);
    expect(
      service.status(
        await service.get("owner", "synthetic-client", unknown.attempt_id),
      ).status,
    ).toBe("provider_outcome_unknown");
    await expect(
      connections.updateSet("owner", (set) =>
        completeOnboardingCompany(set, binding, company),
      ),
    ).rejects.toThrow("ATTEMPT_CONFLICT");
  } finally {
    await runtime.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
