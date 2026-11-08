import {
  Connections,
  CredentialVault,
  type StateStore,
} from "@fortnox-mcp/core";
import { diagnoseConnection, FortnoxConnections } from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";

export function diagnosticsContract(fixture: () => Promise<StateStore>) {
  async function seed(scopes = syntheticCompany.scopes) {
    const state = await fixture();
    const connections = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    const company = await connections.add(
      "owner",
      { ...syntheticCompany, scopes },
      syntheticCredentials,
    );
    await connections.grant("owner", "client", [company.id]);
    let calls = 0;
    let response: () => Promise<Response> = async () =>
      Response.json({
        CompanyInformation: {
          DatabaseNumber: company.tenant,
          CompanyName: "Synthetic private name",
          OrganizationNumber: "000000-0000",
        },
      });
    const provider = new FortnoxConnections({
      origin: "https://diagnostics.invalid",
      connections,
      testTenants: ["100001", "100002"],
      fetch: async () => {
        calls++;
        return response();
      },
    });
    const context = {
      owner: "owner",
      connections,
      provider,
      testMode: true,
      authorize: (id: string) =>
        connections.authorize("owner", "client", id, false),
    };
    return {
      state,
      connections,
      company,
      context,
      calls: () => calls,
      respond: (fn: typeof response) => {
        response = fn;
      },
    };
  }
  it("authorizes before I/O, separates missing scope and pending verification, and does not activate writes", async () => {
    const f = await seed();
    await expect(
      diagnoseConnection(f.context, crypto.randomUUID()),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    expect(
      (
        await diagnoseConnection(
          { ...f.context, testMode: false },
          f.company.id,
        )
      ).status,
    ).toBe("verification_blocked");
    expect(f.calls()).toBe(0);
    const result = await diagnoseConnection(f.context, f.company.id);
    expect(result.status).toBe("available");
    expect(result.capabilities).toContainEqual({
      id: "manual_vouchers",
      status: "verification_blocked",
      reason: "verification_pending",
    });
    expect(result.capabilities).toContainEqual({
      id: "payroll",
      status: "not_implemented",
      reason: "feature_not_implemented",
    });
    expect(JSON.stringify(result)).not.toContain("Synthetic private name");
    expect(JSON.stringify(result)).not.toContain(
      syntheticCredentials.accessToken,
    );
    expect((await f.state.list("provider-budget", 10)).length).toBe(1);
    const missing = await seed([]);
    expect(
      (await diagnoseConnection(missing.context, missing.company.id)).reason,
    ).toBe("missing_scope");
    expect(missing.calls()).toBe(0);
  });
  it("keeps provider rights/license causes unknown and redacts payloads", async () => {
    const f = await seed();
    f.respond(async () =>
      Response.json(
        {
          ErrorInformation: {
            code: 42,
            message: "synthetic-sensitive-provider-content",
          },
        },
        { status: 403 },
      ),
    );
    const result = await diagnoseConnection(f.context, f.company.id);
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe("permission_or_license_unknown");
    expect(JSON.stringify(result)).not.toContain("synthetic-sensitive");
    expect(result.correlation_id).toMatch(/^[a-f0-9-]{36}$/);
  });
  it("reports disconnected locally and denies a late success after disconnect", async () => {
    const f = await seed();
    f.respond(async () => {
      await f.connections.disconnect("owner", f.company.id);
      return Response.json({
        CompanyInformation: {
          DatabaseNumber: f.company.tenant,
          CompanyName: "Late",
        },
      });
    });
    expect((await diagnoseConnection(f.context, f.company.id)).status).toBe(
      "disconnected",
    );
    const calls = f.calls();
    expect((await diagnoseConnection(f.context, f.company.id)).reason).toBe(
      "connection_disconnected",
    );
    expect(f.calls()).toBe(calls);
  });
}
