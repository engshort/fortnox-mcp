import type { Ciphertext } from "./connections.js";

export const analysisLimits = {
  contextBytes: 64 * 1024 * 1024,
  ownerBytes: 128 * 1024 * 1024,
  installationBytes: 256 * 1024 * 1024,
  chunkCharacters: 16 * 1024,
  readyMs: 5 * 60_000,
  buildingMs: 10 * 60_000,
  leaseMs: 50_000,
  years: 5,
} as const;
export interface AnalysisRecord {
  id: string;
  namespace: string;
  owner: string;
  company: string;
  expires: number;
  ready: boolean;
  manifest: Ciphertext;
}
export interface AnalysisStore {
  reserve(record: AnalysisRecord, now: number): Promise<boolean>;
  find(namespace: string): Promise<AnalysisRecord | null>;
  get(id: string): Promise<AnalysisRecord | null>;
  claim(id: string, now: number): Promise<string | null>;
  write(
    id: string,
    lease: string,
    name: string,
    chunks: Ciphertext[],
    now: number,
  ): Promise<boolean>;
  read(id: string, name: string): Promise<Ciphertext[]>;
  finish(
    id: string,
    lease: string,
    manifest: Ciphertext,
    expires: number,
    ready: boolean,
    now: number,
  ): Promise<boolean>;
  remove(id: string, lease?: string): Promise<void>;
  cleanup(now: number): Promise<void>;
  clear(): Promise<void>;
}
