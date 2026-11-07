export function parseReceiptProviderConfig(input: unknown): unknown;
export function readReceiptProviderAttachments(
  input: unknown,
  send?: typeof fetch,
): Promise<{
  status: string;
  serverCommit: string;
  companies: number;
  attachments: number;
  bytesCompared: number;
  mimeTypes: string[];
  commitSource: string;
  bookkeepingOrFileMutationRequested: false;
  browserExecutedByThisScript: false;
  providerAcceptanceComplete: false;
}>;
