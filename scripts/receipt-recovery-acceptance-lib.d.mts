export interface ReceiptCounts {
  requested: number;
  completed: number;
  partial: number;
  failed: number;
  unknown: number;
  needs_input: number;
  prepared: number;
}
export interface ReceiptRecoveryReadConfig {
  origin: string;
  serverCommit: string;
  accessToken: string;
  companyIds: string[];
  snapshots: Array<{
    company_id: string;
    batch_id: string;
    batch_hash: string;
    expectedCounts: ReceiptCounts;
  }>;
}
export const receiptRecoveryScenarios: readonly string[];
export function parseReceiptRecoveryConfig(
  input: unknown,
): ReceiptRecoveryReadConfig;
export function validateReceiptRecoveryRecord(input: unknown): boolean;
export function readReceiptRecoverySnapshots(
  input: unknown,
  send?: typeof fetch,
): Promise<{
  status: string;
  serverCommit: string;
  companies: number;
  batches: number;
  counts: ReceiptCounts;
  commitSource: string;
  providerOrBrowserExecutedByThisCheck: false;
  mutationsPerformed: false;
  acceptanceGranted: false;
}>;
