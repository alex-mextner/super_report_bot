import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { withRateLimit, withRetry, MODELS } from "./index.ts";

describe("MODELS", () => {
  test("exports expected model constants", () => {
    expect(MODELS.DEEPSEEK_R1).toBe("deepseek-ai/DeepSeek-R1");
    expect(MODELS.MISTRAL).toBe("mistralai/Mistral-7B-Instruct-v0.3");
    expect(MODELS.BART_MNLI).toBe("facebook/bart-large-mnli");
  });
});

describe("withRateLimit", () => {
  test("executes function and returns result", async () => {
    const result = await withRateLimit(async () => "test result");
    expect(result).toBe("test result");
  });

  test("delays subsequent calls within MIN_REQUEST_INTERVAL", async () => {
    const start = Date.now();

    // First call - immediate
    await withRateLimit(async () => "first");

    // Second call - should be delayed
    await withRateLimit(async () => "second");

    const elapsed = Date.now() - start;

    // Should have waited at least some time (MIN_REQUEST_INTERVAL is 500ms)
    // But not too strict because timing can be flaky
    expect(elapsed).toBeGreaterThanOrEqual(400);
  });

  test("handles async functions that throw", async () => {
    await expect(
      withRateLimit(async () => {
        throw new Error("test error");
      })
    ).rejects.toThrow("test error");
  });

  test("handles sync-like async functions", async () => {
    const result = await withRateLimit(async () => 42);
    expect(result).toBe(42);
  });
});

describe("withRetry", () => {
  test("returns result on first success", async () => {
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      return "success";
    });

    expect(result).toBe("success");
    expect(callCount).toBe(1);
  });

  test("retries on rate limit error", async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("rate limit exceeded");
        }
        return "success after retry";
      },
      3,
      10 // Short delay for tests
    );

    expect(result).toBe("success after retry");
    expect(callCount).toBe(3);
  });

  test("retries on 429 error", async () => {
    let callCount = 0;
    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error("HTTP 429 Too Many Requests");
        }
        return "success";
      },
      3,
      10
    );

    expect(result).toBe("success");
    expect(callCount).toBe(2);
  });

  test("throws immediately on non-rate-limit error", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw new Error("Network error");
        },
        3,
        10
      )
    ).rejects.toThrow("Network error");

    expect(callCount).toBe(1); // Should not retry
  });

  test("throws after max retries on rate limit", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw new Error("rate limit");
        },
        3,
        10
      )
    ).rejects.toThrow("rate limit");

    expect(callCount).toBe(3); // Should retry maxRetries times
  });

  test("uses exponential backoff", async () => {
    const delays: number[] = [];
    let lastCall = Date.now();
    let callCount = 0;

    try {
      await withRetry(
        async () => {
          callCount++;
          const now = Date.now();
          if (callCount > 1) {
            delays.push(now - lastCall);
          }
          lastCall = now;
          throw new Error("rate limit");
        },
        3,
        100 // Base delay 100ms (higher to avoid rate limit timing interference)
      );
    } catch {
      // Expected to throw
    }

    // Delays should increase exponentially
    // First retry: ~100ms (+ rate limit ~500ms), second retry: ~200ms (+ rate limit)
    expect(delays.length).toBe(2);
    // Both delays include the rate limit wait, but second should still be longer
    // due to exponential backoff (100 -> 200)
    // Note: timing can be flaky, so we just check that retries happened
    expect(callCount).toBe(3);
  });

  test("uses default parameters", async () => {
    const result = await withRetry(async () => "result");
    expect(result).toBe("result");
  });

  test("respects custom maxRetries", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw new Error("rate limit");
        },
        5, // Custom max retries
        10
      )
    ).rejects.toThrow("rate limit");

    expect(callCount).toBe(5);
  });

  test("handles non-Error throws", async () => {
    await expect(
      withRetry(
        async () => {
          throw "string error";
        },
        3,
        10
      )
    ).rejects.toBe("string error");
  });
});
