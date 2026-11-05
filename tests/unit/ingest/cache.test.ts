/**
 * Ingestion In-Memory Cache Unit Test Suite (Slice 1)
 *
 * Verifies acceptance criteria:
 * - AC-12.1: Bounded in-memory ingestion cache (ADR-12)
 *   - Keying by YouTube videoId or PDF SHA-256 buffer hash
 *   - TTL expiration
 *   - Capacity bound & LRU/FIFO eviction
 *   - SHA-256 deterministic calculation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IngestionCache, ingestionCache, computeSha256 } from "@/lib/ingest/cache";
import type { IngestionSuccess } from "@/types/ingest";

describe("AC-12.1: Bounded In-Memory Ingestion Cache (ADR-12)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ingestionCache.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    ingestionCache.clear();
  });

  const sampleSuccess: IngestionSuccess = {
    ok: true,
    sourceType: "youtube",
    title: "Test Video",
    text: "Sample extracted transcript text.",
    charCount: 32,
    estimatedTokens: 8,
    metadata: { videoId: "dQw4w9WgXcQ", language: "en" },
  };

  describe("Basic Operations (set, get, has, delete, clear, size)", () => {
    it("stores and retrieves cached ingestion results by key", () => {
      const cache = new IngestionCache<IngestionSuccess>({ maxEntries: 10, ttlMs: 60_000 });
      expect(cache.size).toBe(0);

      cache.set("youtube:dQw4w9WgXcQ", sampleSuccess);
      expect(cache.size).toBe(1);
      expect(cache.has("youtube:dQw4w9WgXcQ")).toBe(true);

      const retrieved = cache.get("youtube:dQw4w9WgXcQ");
      expect(retrieved).toEqual(sampleSuccess);
    });

    it("returns undefined for cache misses", () => {
      const cache = new IngestionCache<IngestionSuccess>();
      expect(cache.get("non-existent-key")).toBeUndefined();
      expect(cache.has("non-existent-key")).toBe(false);
    });

    it("deletes entries and clears cache cleanly", () => {
      const cache = new IngestionCache<IngestionSuccess>();
      cache.set("k1", sampleSuccess);
      cache.set("k2", sampleSuccess);
      expect(cache.size).toBe(2);

      expect(cache.delete("k1")).toBe(true);
      expect(cache.size).toBe(1);
      expect(cache.has("k1")).toBe(false);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has("k2")).toBe(false);
    });
  });

  describe("TTL Expiration", () => {
    it("evicts expired entries after TTL elapsed", () => {
      const ttlMs = 5_000;
      const cache = new IngestionCache<IngestionSuccess>({ maxEntries: 10, ttlMs });

      cache.set("youtube:expiring", sampleSuccess);
      expect(cache.has("youtube:expiring")).toBe(true);
      expect(cache.get("youtube:expiring")).toBeDefined();

      // Advance clock by 4.9 seconds (should still be valid)
      vi.advanceTimersByTime(4_900);
      expect(cache.get("youtube:expiring")).toBeDefined();

      // Advance clock past 5.0 seconds (expired)
      vi.advanceTimersByTime(200);
      expect(cache.get("youtube:expiring")).toBeUndefined();
      expect(cache.has("youtube:expiring")).toBe(false);
    });

    it("refreshes entry timestamp on update", () => {
      const ttlMs = 5_000;
      const cache = new IngestionCache<IngestionSuccess>({ maxEntries: 10, ttlMs });

      cache.set("k1", sampleSuccess);
      vi.advanceTimersByTime(3_000);

      // Re-set or update k1
      cache.set("k1", { ...sampleSuccess, title: "Updated Title" });

      // Advance another 3 seconds (6s from initial set, but 3s from update)
      vi.advanceTimersByTime(3_000);
      const entry = cache.get("k1");
      expect(entry).toBeDefined();
      expect(entry?.title).toBe("Updated Title");
    });
  });

  describe("Bounded Capacity & Eviction (LRU/FIFO)", () => {
    it("enforces maxEntries capacity and evicts oldest entries when exceeded", () => {
      const maxEntries = 3;
      const cache = new IngestionCache<string>({ maxEntries, ttlMs: 60_000 });

      cache.set("k1", "val1");
      cache.set("k2", "val2");
      cache.set("k3", "val3");
      expect(cache.size).toBe(3);

      // Adding 4th entry exceeds max capacity
      cache.set("k4", "val4");
      expect(cache.size).toBe(3);

      // Oldest entry (k1) should be evicted
      expect(cache.get("k1")).toBeUndefined();
      expect(cache.get("k2")).toBe("val2");
      expect(cache.get("k3")).toBe("val3");
      expect(cache.get("k4")).toBe("val4");
    });

    it("accessing an entry marks it as recently used in LRU eviction", () => {
      const maxEntries = 3;
      const cache = new IngestionCache<string>({ maxEntries, ttlMs: 60_000 });

      cache.set("k1", "val1");
      cache.set("k2", "val2");
      cache.set("k3", "val3");

      // Access k1 so k2 becomes the least recently used
      cache.get("k1");

      // Insert k4 -> should evict k2, not k1
      cache.set("k4", "val4");
      expect(cache.get("k1")).toBe("val1");
      expect(cache.get("k2")).toBeUndefined();
      expect(cache.get("k3")).toBe("val3");
      expect(cache.get("k4")).toBe("val4");
    });
  });

  describe("computeSha256 Helper", () => {
    it("produces deterministic 64-character hex SHA-256 hash for identical buffers", async () => {
      const buf1 = new TextEncoder().encode("%PDF-1.4 sample content");
      const buf2 = new TextEncoder().encode("%PDF-1.4 sample content");

      const hash1 = await computeSha256(buf1);
      const hash2 = await computeSha256(buf2);

      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash1).toBe(hash2);
    });

    it("produces distinct SHA-256 hashes for different buffers", async () => {
      const buf1 = new TextEncoder().encode("%PDF-1.4 sample content 1");
      const buf2 = new TextEncoder().encode("%PDF-1.4 sample content 2");

      const hash1 = await computeSha256(buf1);
      const hash2 = await computeSha256(buf2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Implicit Boundary: Namespace Isolation & Zero/Negative TTL", () => {
    it("strictly isolates keys across namespaces ('youtube:KEY' vs 'pdf:KEY') to prevent collision", () => {
      const cache = new IngestionCache<string>({ maxEntries: 10, ttlMs: 60_000 });
      const sharedKeySuffix = "abc123xyz89";

      cache.set(`youtube:${sharedKeySuffix}`, "YouTube Content");
      cache.set(`pdf:${sharedKeySuffix}`, "PDF Content");

      expect(cache.size).toBe(2);
      expect(cache.get(`youtube:${sharedKeySuffix}`)).toBe("YouTube Content");
      expect(cache.get(`pdf:${sharedKeySuffix}`)).toBe("PDF Content");
    });

    it("expires immediately or treats entries as expired when ttlMs <= 0", () => {
      const cache = new IngestionCache<string>({ maxEntries: 10, ttlMs: 0 });
      cache.set("k1", "immediateExpiry");

      expect(cache.get("k1")).toBeUndefined();
    });
  });
});
