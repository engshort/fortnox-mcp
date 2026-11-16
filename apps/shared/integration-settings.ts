import {
  type Ciphertext,
  type Connections,
  type CredentialVault,
  DomainError,
  type StateStore,
} from "@fortnox-mcp/core";
import { z } from "zod";

export const integrationInput = z
  .object({
    client_id: z.string().regex(/^[A-Za-z0-9_-]{5,128}$/),
    client_secret: z.string().min(8).max(4096),
  })
  .strict();
type IntegrationInput = z.infer<typeof integrationInput>;
export class IntegrationSettings {
  constructor(
    readonly state: StateStore,
    readonly vault: CredentialVault,
    readonly operator: { clientId: string; clientSecret: string },
  ) {}
  private binding(owner: string) {
    return JSON.stringify(["installation-fortnox-v1", owner]);
  }
  async status(owner: string, connections?: Connections) {
    const snapshot = await this.snapshot(owner);
    const credentials = snapshot.credentials;
    let verified = false;
    if (credentials && connections) {
      for (const c of await connections.list(owner)) {
        if (c.state !== "active") continue;
        const saved = await connections.credentials(owner, c);
        if (
          saved.clientId === credentials.clientId &&
          saved.clientSecret === credentials.clientSecret
        ) {
          verified = true;
          break;
        }
      }
    }
    return {
      configured: !!credentials,
      verified,
      revision: snapshot.revision,
      source:
        this.operator.clientId || this.operator.clientSecret
          ? "operator"
          : "owner",
    } as const;
  }
  async credentials(owner: string) {
    return (await this.snapshot(owner)).credentials;
  }
  private async snapshot(owner: string) {
    if (this.operator.clientId || this.operator.clientSecret) {
      const input = integrationInput.parse({
        client_id: this.operator.clientId,
        client_secret: this.operator.clientSecret,
      });
      return {
        credentials: {
          clientId: input.client_id,
          clientSecret: input.client_secret,
        },
        revision: null,
      };
    }
    const row = await this.state.get<Ciphertext | null>(
      "integration-config",
      owner,
    );
    if (!row?.value)
      return { credentials: null, revision: row?.version ?? null };
    const input = integrationInput.parse(
      await this.vault.openData(row.value, this.binding(owner)),
    );
    return {
      credentials: {
        clientId: input.client_id,
        clientSecret: input.client_secret,
      },
      revision: row.version,
    };
  }
  async save(owner: string, value: IntegrationInput) {
    if (this.operator.clientId || this.operator.clientSecret)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const input = integrationInput.parse(value);
    const row = await this.state.get<Ciphertext>("integration-config", owner);
    if (
      !(await this.state.put(
        "integration-config",
        owner,
        await this.vault.sealData(input, this.binding(owner)),
        row?.version ?? null,
      ))
    )
      throw new DomainError("INTENT_CONFLICT");
  }
  async rotate(owner: string) {
    const row = await this.state.get<Ciphertext | null>(
      "integration-config",
      owner,
    );
    if (!row?.value) return;
    if (
      !(await this.state.put(
        "integration-config",
        owner,
        await this.vault.sealData(
          await this.vault.openData(row.value, this.binding(owner)),
          this.binding(owner),
        ),
        row.version,
      ))
    )
      throw new DomainError("INTENT_CONFLICT");
  }
  async forget(owner: string, revision: number) {
    z.number().int().positive().safe().parse(revision);
    if (this.operator.clientId || this.operator.clientSecret)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const row = await this.state.get("integration-config", owner);
    if (!row?.value || row.version !== revision)
      throw new DomainError("INTENT_CONFLICT");
    // Preserve the CAS revision without retaining a ciphertext or its key/IV.
    if (!(await this.state.put("integration-config", owner, null, revision)))
      throw new DomainError("INTENT_CONFLICT");
  }
}
