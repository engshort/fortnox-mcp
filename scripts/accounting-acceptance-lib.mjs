export const accountingChecks = [
  "referencesBothCompanies",
  "nonCalendarYear",
  "lockedBoundary",
  "inactiveAccounts",
  "scopeOrRightsDenied",
  "tenantDenied",
  "precisionAndSigns",
  "actualHostReview",
  "reviewReplayExpiry",
  "createdVoucherReadback",
  "unknownOutcomeRecovery",
];
export function validateAccountingEvidence(record) {
  return Boolean(
    record &&
      /^[a-f0-9]{40}$/.test(record.serverCommit ?? "") &&
      typeof record.observedAt === "string" &&
      Number.isFinite(Date.parse(record.observedAt)) &&
      typeof record.client === "string" &&
      record.client.length > 0 &&
      typeof record.runtime === "string" &&
      record.runtime.length > 0 &&
      typeof record.limitations === "string" &&
      accountingChecks.every((c) => record.checks?.[c] === true),
  );
}
