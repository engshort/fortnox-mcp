export const clientChecks = [
  "ownerLogin",
  "oauthConsent",
  "listTwoCompanies",
  "readBothProfiles",
  "wrongCompanyDenied",
  "refreshAfterExpiry",
  "revocation",
  "renewableReconnect",
  "savedAnswer",
  "conversationReload",
  "reloadTools",
];
export function validateClientEvidence(record) {
  return (
    record &&
    /^[a-f0-9]{40}$/.test(record.serverCommit ?? "") &&
    typeof record.observedAt === "string" &&
    Number.isFinite(Date.parse(record.observedAt)) &&
    typeof record.client === "string" &&
    record.client.length > 0 &&
    typeof record.runtime === "string" &&
    record.runtime.length > 0 &&
    typeof record.limitations === "string" &&
    clientChecks.every((key) => record.checks?.[key] === true)
  );
}
