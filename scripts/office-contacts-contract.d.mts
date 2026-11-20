export interface OfficeContractConfiguration {
  origin: string;
  access_token: string;
  bureau_company_id: string;
  customer_company_id: string;
  organisation_number: string;
  allow_integration_users_unavailable?: boolean;
}
export function runOfficeContactsContract(
  input: OfficeContractConfiguration,
  send?: typeof fetch,
): Promise<{
  version: "office-contacts-v1";
  checks: Array<{
    source: string;
    outcome: "complete" | "source_unavailable";
    pages: number;
    records: number;
  }>;
}>;
