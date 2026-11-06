export type ErrorCode =
  | "AUTH_REQUIRED"
  | "COMPANY_FORBIDDEN"
  | "CONNECTION_DISCONNECTED"
  | "VALIDATION_FAILED"
  | "INTENT_CONFLICT"
  | "CAPABILITY_UNAVAILABLE"
  | "CONNECTION_CONFLICT"
  | "RECONNECT_REQUIRED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "PARTIAL_RESULT"
  | "OUTCOME_UNKNOWN";

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = "DomainError";
  }
}
