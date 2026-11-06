import { expect, it } from "vitest";
export function accountingMigrationContract(
  fixture: () => Promise<{
    execute(sql: string): Promise<unknown>;
    all(sql: string): Promise<unknown>;
    migrate(): Promise<unknown>;
  }>,
) {
  it("additive write capability migration is idempotent and never broadens existing client/consent/token scopes", async () => {
    const db = await fixture();
    await db.execute(
      `INSERT INTO oauthResource(id,identifier,name,allowedScopes) VALUES('old-resource','https://synthetic.invalid/mcp','Synthetic','["mcp:read","offline_access"]'),('custom-resource','https://custom.invalid/mcp','Custom','["custom:read"]')`,
    );
    await db.execute(
      `INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES('migration-owner','Synthetic','migration@example.invalid',1,1,1)`,
    );
    await db.execute(
      `INSERT INTO oauthClient(id,clientId,redirectUris,scopes) VALUES('migration-client','migration-client','["https://synthetic.invalid/callback"]','["mcp:read","offline_access"]')`,
    );
    await db.execute(
      `INSERT INTO oauthConsent(id,clientId,userId,scopes,createdAt,updatedAt) VALUES('migration-consent','migration-client','migration-owner','["mcp:read","offline_access"]',1,1)`,
    );
    await db.execute(
      `INSERT INTO oauthAccessToken(id,token,clientId,userId,scopes,expiresAt,createdAt) VALUES('migration-access','synthetic-access-value','migration-client','migration-owner','["mcp:read","offline_access"]',9999999999999,1)`,
    );
    const before = await db.all(
      `SELECT scopes FROM oauthConsent UNION ALL SELECT scopes FROM oauthClient UNION ALL SELECT scopes FROM oauthAccessToken`,
    );
    await db.migrate();
    await db.migrate();
    expect(
      await db.all(
        `SELECT allowedScopes FROM oauthResource WHERE id='old-resource'`,
      ),
    ).toEqual([{ allowedScopes: '["mcp:read","offline_access","mcp:write"]' }]);
    expect(
      await db.all(
        `SELECT allowedScopes FROM oauthResource WHERE id='custom-resource'`,
      ),
    ).toEqual([{ allowedScopes: '["custom:read"]' }]);
    expect(
      await db.all(
        `SELECT scopes FROM oauthConsent UNION ALL SELECT scopes FROM oauthClient UNION ALL SELECT scopes FROM oauthAccessToken`,
      ),
    ).toEqual(before);
  });
}
