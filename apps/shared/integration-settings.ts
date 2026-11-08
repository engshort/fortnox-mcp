import {
  type Ciphertext,
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
  async status(owner: string) {
    return {
      configured: !!(await this.credentials(owner)),
      source:
        this.operator.clientId || this.operator.clientSecret
          ? "operator"
          : "owner",
    } as const;
  }
  async credentials(owner: string) {
    if (this.operator.clientId || this.operator.clientSecret) {
      const input = integrationInput.parse({
        client_id: this.operator.clientId,
        client_secret: this.operator.clientSecret,
      });
      return { clientId: input.client_id, clientSecret: input.client_secret };
    }
    const row = await this.state.get<Ciphertext>("integration-config", owner);
    if (!row) return null;
    const input = integrationInput.parse(
      await this.vault.openData(row.value, this.binding(owner)),
    );
    return { clientId: input.client_id, clientSecret: input.client_secret };
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
}
