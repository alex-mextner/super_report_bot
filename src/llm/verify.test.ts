import { describe, test, expect } from "bun:test";
import type { VerificationResult } from "./verify.ts";

// Unit tests for VerificationResult type structure
describe("VerificationResult", () => {
  test("has correct structure", () => {
    const result: VerificationResult = {
      isMatch: true,
      confidence: 0.85,
      label: "matched",
    };

    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(0.85);
    expect(result.label).toBe("matched");
  });

  test("handles non-match", () => {
    const result: VerificationResult = {
      isMatch: false,
      confidence: 0.3,
      label: "not matched",
    };

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  test("handles error state", () => {
    const result: VerificationResult = {
      isMatch: false,
      confidence: 0,
      label: "error",
    };

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.label).toBe("error");
  });
});

// Note: verifyMatch and verifyMatches require mocking HuggingFace API
// Full integration tests should be run with HF_TOKEN environment variable
