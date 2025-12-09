/**
 * Tests for similar message search functionality
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { CachedMessage } from "../cache/messages.ts";

// Mock cache module before imports
const mockMessages: CachedMessage[] = [];
mock.module("../cache/messages.ts", () => ({
  getMessages: (groupId: number) => mockMessages.filter((m) => m.groupId === groupId),
  getAllCachedMessages: () => mockMessages,
}));

import { findSimilarMessages, findSimilarWithFallback, toRatingExamples, type SimilarMessage } from "./similar.ts";

describe("toRatingExamples", () => {
  test("converts SimilarMessage array to RatingExample array", () => {
    const messages: SimilarMessage[] = [
      { id: 1, text: "iPhone 15 продаю", groupId: -100123, groupTitle: "Test Group", score: 0.8 },
      { id: 2, text: "Samsung Galaxy", groupId: -100456, groupTitle: "Other Group", score: 0.6 },
    ];

    const examples = toRatingExamples(messages);

    expect(examples).toHaveLength(2);
    expect(examples[0]).toEqual({
      id: 1,
      text: "iPhone 15 продаю",
      groupId: -100123,
      groupTitle: "Test Group",
      isGenerated: false,
    });
    expect(examples[1]!.isGenerated).toBe(false);
  });

  test("returns empty array for empty input", () => {
    expect(toRatingExamples([])).toEqual([]);
  });
});

describe("findSimilarMessages", () => {
  beforeEach(() => {
    // Clear mock messages
    mockMessages.length = 0;
  });

  test("returns empty array when no keywords provided", () => {
    mockMessages.push({
      id: 1,
      text: "iPhone 15 Pro Max продаю срочно",
      groupId: -100123,
      groupTitle: "Sales",
      date: Date.now(),
    });

    const results = findSimilarMessages([], [-100123]);
    expect(results).toEqual([]);
  });

  test("finds messages matching keywords", () => {
    mockMessages.push(
      {
        id: 1,
        text: "Продаю iPhone 15 Pro Max 256gb в хорошем состоянии",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      },
      {
        id: 2,
        text: "Samsung Galaxy S24 продаю",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      }
    );

    const results = findSimilarMessages(["iphone", "продаю"], [-100123], 3, [], 0.1);

    expect(results.length).toBeGreaterThan(0);
    // iPhone message should score higher than Samsung
    expect(results[0]!.text).toContain("iPhone");
  });

  test("filters out messages with negative keywords", () => {
    mockMessages.push(
      {
        id: 1,
        text: "iPhone 15 на запчасти, разбитый экран",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      },
      {
        id: 2,
        text: "iPhone 15 Pro в идеале продаю",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      }
    );

    const results = findSimilarMessages(
      ["iphone", "продаю"],
      [-100123],
      3,
      ["запчасти", "разбит"],
      0.1
    );

    // Only the second message should remain
    expect(results.every((r) => !r.text.includes("запчасти"))).toBe(true);
  });

  test("skips very short messages", () => {
    mockMessages.push(
      {
        id: 1,
        text: "iPhone", // Too short (< 20 chars)
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      },
      {
        id: 2,
        text: "Продаю iPhone 15 Pro Max в хорошем состоянии",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      }
    );

    const results = findSimilarMessages(["iphone"], [-100123], 3, [], 0.1);

    // Should only find the long message
    expect(results.every((r) => r.text.length >= 20)).toBe(true);
  });

  test("respects maxResults limit", () => {
    // Add many messages
    for (let i = 0; i < 10; i++) {
      mockMessages.push({
        id: i,
        text: `iPhone ${i} продаю срочно дешево цена`,
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      });
    }

    const results = findSimilarMessages(["iphone", "продаю"], [-100123], 3, [], 0.1);

    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("sorts results by score descending", () => {
    mockMessages.push(
      {
        id: 1,
        text: "Автомобиль продаю срочно недорого",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      },
      {
        id: 2,
        text: "iPhone 15 Pro Max продаю цена хорошая",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      }
    );

    const results = findSimilarMessages(["iphone", "продаю", "цена"], [-100123], 3, [], 0.05);

    if (results.length >= 2) {
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    }
  });
});

describe("findSimilarWithFallback", () => {
  beforeEach(() => {
    mockMessages.length = 0;
  });

  test("returns results at first threshold if enough found", () => {
    // Add messages that match well
    for (let i = 0; i < 5; i++) {
      mockMessages.push({
        id: i,
        text: `iPhone ${i} продаю срочно хорошее состояние цена`,
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      });
    }

    const results = findSimilarWithFallback(["iphone", "продаю"], [-100123], 3);

    expect(results.length).toBe(3);
  });

  test("relaxes threshold when not enough results at strict threshold", () => {
    // Add only one good match and some weak matches
    mockMessages.push(
      {
        id: 1,
        text: "iPhone 15 продаю в хорошем состоянии срочно",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      },
      {
        id: 2,
        text: "Телефон apple новый недорого отдам",
        groupId: -100123,
        groupTitle: "Sales",
        date: Date.now(),
      }
    );

    const results = findSimilarWithFallback(["iphone", "продаю"], [-100123], 2);

    // Should find at least the good match
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
