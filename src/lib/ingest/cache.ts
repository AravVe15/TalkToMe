/**
 * Bounded In-Memory Ingestion Cache with LRU eviction and TTL expiration (ADR-12 / AC-12.1).
 */

import { createHash } from "node:crypto";
import type { IngestionSuccess } from "@/types/ingest";

export interface IngestionCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 25;
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class IngestionCache<T = IngestionSuccess> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly store: Map<string, CacheEntry<T>> = new Map();

  constructor(options?: IngestionCacheOptions) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (this.ttlMs <= 0 || Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh LRU order while preserving original TTL expiration timestamp
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      this.store.delete(key);
      return;
    }

    this.pruneExpired();

    if (this.store.has(key)) {
      this.store.delete(key);
    }

    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.store.delete(oldestKey);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    if (this.ttlMs <= 0 || Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    this.pruneExpired();
    return this.store.size;
  }
}

export const ingestionCache = new IngestionCache<IngestionSuccess>();

export async function computeSha256(buffer: Uint8Array): Promise<string> {
  return createHash("sha256").update(buffer).digest("hex");
}
