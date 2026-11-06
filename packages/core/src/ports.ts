import type { Identity } from "./context.js";

export interface Clock {
  now(): number;
}
export interface StateRecord<T> {
  version: number;
  value: T;
}
export interface StateStore {
  get<T>(space: string, id: string): Promise<StateRecord<T> | null>;
  put<T>(
    space: string,
    id: string,
    value: T,
    expected: number | null,
  ): Promise<boolean>;
  list<T>(
    space: string,
    limit: number,
  ): Promise<Array<{ id: string } & StateRecord<T>>>;
}
export interface SecretStore {
  get(name: string): Promise<string | undefined>;
}
export interface HttpClient {
  fetch(request: Request): Promise<Response>;
}
export interface TokenVerifier {
  verify(token: string): Promise<Identity | null>;
}
export type LogEvent = "request_failed" | "server_started";
export interface SafeLogger {
  // Intentionally accepts no payloads, headers, URLs or exception text.
  write(event: LogEvent): void;
}
